const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { getAnthropicToolDefinitions, executeTool } = require('../services/mcpToolBridge');

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const MODELS = {
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
};

const MODEL_COSTS = {
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
};

const MAX_ITERATIONS = 5;

const REVISION_SYSTEM_PROMPT = `You are an expert retail buyer assistant for The Front Climbing Club, helping with preseason order revisions.

CRITICAL: The user is working in a revision workstation. When the ACTIVE REVISION STATE section is present below, it contains the FULL details of the order they are currently revising — every item with UPC, product name, size, location, on-hand, decision, and quantity. USE THIS DATA DIRECTLY. Do NOT ask the user for order IDs, UPCs, or other information that is already in the revision state. When they say "remove the Genius products" or "cancel all size 38", search the DECISION DETAILS provided and act on those items.

You have access to powerful tools that can:
- Query live inventory from BigQuery (on-hand quantities across 3 locations: SLC, South Main, Ogden)
- Look up sales data and velocity metrics
- Run automated revision workflows (zero-stock logic, 20% cap enforcement)
- Check and compare revision history
- Add institutional knowledge and rules (add_knowledge tool)
- Save vendor form templates
- Import vendor order confirmations
- Query orders, products, and adjustments
- Update order decisions (update_order_decisions tool)
- Adjust individual items (adjust_item tool)

LOCATIONS: SLC (ID 1), South Main (ID 2), Ogden (ID 3)

REVISION LOGIC:
- Items with on_hand > 0 → cancel (already in stock)
- Items with on_hand = 0 and no recent sales → ship (genuinely needed)
- Items with on_hand = 0 but recent sales → cancel (received but not inventoried)
- Discontinued items → always cancel

KNOWLEDGE SYSTEM:
- Use add_knowledge to save rules, discontinued products, sizing preferences, etc.
- Types are freeform: "discontinued_product", "sizing_preference", "workflow", "demand_pattern", "max_stock_level", etc.
- Knowledge persists across sessions and informs revision decisions

WHEN ACTING ON REVISION DATA:
- The DECISION DETAILS contain orderItemId for each item — use this with adjust_item or update_order_decisions
- When the user says "cancel X" or "ship X", find the matching items in the decision details and use the tools to update them
- When the user asks about specific products, search the decision details first before querying the database
- Always confirm what you changed and the impact (qty, cost)

Be concise and direct. USE THE TOOLS — don't just explain what to do.`;

router.use(authenticateToken);

// Debug: log all requests to this router
router.use((req, res, next) => {
  console.log('CHAT ROUTER HIT:', req.method, req.path);
  next();
});

/**
 * POST /api/revisions/chat/conversations
 * Create a new chat conversation
 */
router.post('/conversations', async (req, res) => {
  try {
    const { brandId, seasonId } = req.body;

    const result = await pool.query(
      `INSERT INTO agent_conversations (user_id, brand_id, season_id, title, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id`,
      [req.user.id, brandId || null, seasonId || null, 'Revision Chat']
    );

    res.json({ conversationId: result.rows[0].id });
  } catch (error) {
    console.error('CHAT CONV CREATE ERROR:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/revisions/chat/conversations/:id/messages
 * Send a message and get AI response with tool execution
 */
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { message, model: modelKey, context } = req.body;

    if (!anthropic) {
      return res.status(503).json({ error: 'Anthropic API key not configured' });
    }

    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const model = MODELS[modelKey] || MODELS.sonnet;

    // Get conversation history
    const historyResult = await pool.query(
      `SELECT role, content FROM agent_messages
       WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 20`,
      [id]
    );

    // Build system prompt with context
    let systemPrompt = REVISION_SYSTEM_PROMPT;
    if (context) {
      const contextParts = [];
      if (context.brandId) {
        const brandRes = await pool.query('SELECT name FROM brands WHERE id = $1', [context.brandId]);
        if (brandRes.rows[0]) contextParts.push(`Brand: ${brandRes.rows[0].name} (ID: ${context.brandId})`);
      }
      if (context.seasonId) {
        const seasonRes = await pool.query('SELECT name FROM seasons WHERE id = $1', [context.seasonId]);
        if (seasonRes.rows[0]) contextParts.push(`Season: ${seasonRes.rows[0].name} (ID: ${context.seasonId})`);
      }
      if (context.orderIds && context.orderIds.length > 0) {
        contextParts.push(`Selected Order IDs: ${context.orderIds.join(', ')}`);
      }
      if (contextParts.length > 0) {
        systemPrompt += `\n\nCURRENT CONTEXT:\n${contextParts.join('\n')}`;
      }

    }

    // Build revision context as a separate data block (not in system prompt — too large)
    let revisionDataMessage = null;
    if (context?.revisionContext) {
      const rc = context.revisionContext;
      let data = `[REVISION DATA — This is the complete current revision state. Use this data to answer questions and take actions. DO NOT ask for order IDs — they are listed here.]\n`;
      data += `Mode: ${rc.mode || 'none'} | Step: ${rc.step || 'idle'}\n`;

      if (rc.selectedOrderIds && rc.selectedOrderIds.length > 0) {
        data += `Selected Order IDs: ${rc.selectedOrderIds.join(', ')}\n`;
        data += `Use get_order_details with these IDs if you need item-level data and no decisions are loaded below.\n`;
      }

      if (rc.summary) {
        data += `Summary: ${rc.summary.totalItems || 0} items | Ship: ${rc.summary.ship || 0} | Cancel: ${rc.summary.cancel || 0} | Reduction: ${rc.summary.reductionPct || 0}%\n`;
      }

      if (rc.compareResults?.summary) {
        const cs = rc.compareResults.summary;
        data += `Vendor Comparison: ${cs.vendorItems} vendor items | ${cs.matched} matched | ${cs.qtyMismatches} qty mismatches | ${cs.vendorOnly} vendor-only | ${cs.systemOnly} system-only\n`;
      }

      // ALL decision details — no cap
      const decisions = rc.decisions || rc.spreadsheetDecisions;
      if (decisions && decisions.length > 0) {
        data += `\nALL ITEMS (${decisions.length}):\n`;
        data += `orderItemId|orderId|UPC|Product|Size|Color|Location|LocationID|OnHand|Decision|OrigQty|AdjQty|Reason\n`;
        for (const d of decisions) {
          data += `${d.orderItemId || '-'}|${d.orderId || '-'}|${d.upc || '?'}|${(d.productName || '').substring(0, 35)}|${d.size || '-'}|${d.color || '-'}|${d.location || '-'}|${d.locationId || '-'}|${d.onHand ?? '?'}|${d.decision}|${d.originalQty || d.orderedQty || '?'}|${d.adjustedQty ?? '?'}|${d.reason || '-'}\n`;
        }
      }

      if (rc.compareResults?.qtyMismatches?.length > 0) {
        data += `\nQTY MISMATCHES:\n`;
        for (const m of rc.compareResults.qtyMismatches) {
          data += `${m.upc || '?'}|${(m.productName || '').substring(0, 35)}|Vendor:${m.vendorQty}|System:${m.systemQty}|Diff:${m.diff > 0 ? '+' : ''}${m.diff}\n`;
        }
      }

      if (rc.compareResults?.vendorOnly?.length > 0) {
        data += `\nVENDOR-ONLY (not in system):\n`;
        for (const v of rc.compareResults.vendorOnly) {
          data += `${v.upc || '?'}|${(v.productName || '').substring(0, 35)}|Qty:${v.vendorQty}\n`;
        }
      }

      if (rc.compareResults?.systemOnly?.length > 0) {
        data += `\nSYSTEM-ONLY (not in vendor form):\n`;
        for (const s of rc.compareResults.systemOnly) {
          data += `${s.upc || '?'}|${(s.productName || '').substring(0, 35)}|Qty:${s.systemQty}\n`;
        }
      }

      // Append full revision data to system prompt — Anthropic supports large system prompts
      systemPrompt += '\n\n' + data;
    }

    // Build messages
    const messages = [];
    historyResult.rows.forEach(msg => {
      if (msg.content && msg.content.trim()) {
        messages.push({ role: msg.role, content: msg.content });
      }
    });
    messages.push({ role: 'user', content: message });

    // Save user message
    await pool.query(
      'INSERT INTO agent_messages (conversation_id, role, content) VALUES ($1, $2, $3)',
      [id, 'user', message]
    );

    // Get MCP tool definitions
    const tools = getAnthropicToolDefinitions();

    console.log('CHAT DEBUG: model=', model, 'messages=', messages.length, 'tools=', tools.length, 'systemPromptLen=', systemPrompt.length);

    // Call Anthropic
    let response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools
    });

    let totalInputTokens = response.usage.input_tokens;
    let totalOutputTokens = response.usage.output_tokens;
    let iteration = 0;
    let allToolResults = [];

    // Tool execution loop
    while (response.stop_reason === 'tool_use' && iteration < MAX_ITERATIONS) {
      iteration++;

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const textBlocks = response.content.filter(b => b.type === 'text');

      // Save any intermediate text
      const intermediateText = textBlocks.map(b => b.text).join('');
      if (intermediateText) {
        await pool.query(
          'INSERT INTO agent_messages (conversation_id, role, content) VALUES ($1, $2, $3)',
          [id, 'assistant', intermediateText]
        );
      }

      // Execute all tool calls
      const toolResults = [];
      for (const block of toolUseBlocks) {
        const result = await executeTool(block.name, block.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result
        });
        allToolResults.push({ tool: block.name, args: block.input, result });
      }

      // Continue conversation with tool results
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      response = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: iteration < MAX_ITERATIONS - 1 ? tools : [] // No tools on last iteration
      });

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
    }

    // Extract final text response
    const finalText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Save assistant response
    await pool.query(
      'INSERT INTO agent_messages (conversation_id, role, content, metadata) VALUES ($1, $2, $3, $4)',
      [id, 'assistant', finalText, JSON.stringify({ tool_calls: allToolResults, model })]
    );

    // Calculate cost
    const costs = MODEL_COSTS[model] || MODEL_COSTS[MODELS.sonnet];
    const cost = (totalInputTokens / 1000) * costs.input + (totalOutputTokens / 1000) * costs.output;

    // Track usage
    try {
      await pool.query(
        `INSERT INTO agent_api_usage
         (conversation_id, provider, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, 'anthropic', model, totalInputTokens, totalOutputTokens,
         totalInputTokens + totalOutputTokens, cost]
      );
    } catch (e) { /* usage tracking is non-critical */ }

    res.json({
      content: finalText,
      toolResults: allToolResults,
      iterations: iteration,
      model,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cost: parseFloat(cost.toFixed(4))
      }
    });
  } catch (error) {
    console.error('CHAT ERROR FULL:', JSON.stringify({
      status: error?.status,
      message: error?.message,
      errorMsg: error?.error?.message,
      errorType: error?.error?.type,
      stack: error?.stack?.split('\n').slice(0, 3)
    }));
    const errMsg = error?.error?.message || error?.message || 'Unknown error';
    res.status(error?.status || 500).json({ error: errMsg });
  }
});

/**
 * GET /api/revisions/chat/conversations/:id/messages
 */
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, role, content, metadata, created_at
       FROM agent_messages WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ messages: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
