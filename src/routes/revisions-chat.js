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

      // Inject revision state if available
      if (context.revisionContext) {
        const rc = context.revisionContext;
        let revisionInfo = '\n\nACTIVE REVISION STATE:';
        revisionInfo += `\nMode: ${rc.mode || 'none'} | Step: ${rc.step || 'idle'}`;

        if (rc.summary) {
          revisionInfo += `\nSummary: ${rc.summary.totalItems || 0} items | Ship: ${rc.summary.ship || 0} | Cancel: ${rc.summary.cancel || 0} | Reduction: ${rc.summary.reductionPct || 0}%`;
        }

        if (rc.compareResults?.summary) {
          const cs = rc.compareResults.summary;
          revisionInfo += `\nVendor Comparison: ${cs.vendorItems} vendor items | ${cs.matched} matched | ${cs.qtyMismatches} qty mismatches | ${cs.vendorOnly} vendor-only | ${cs.systemOnly} system-only`;
        }

        // Include decision details (truncated for context window)
        const decisions = rc.decisions || rc.spreadsheetDecisions;
        if (decisions && decisions.length > 0) {
          revisionInfo += `\n\nDECISION DETAILS (${decisions.length} items):`;
          const sample = decisions.slice(0, 100); // Cap at 100 to avoid huge prompts
          for (const d of sample) {
            revisionInfo += `\n  ${d.upc || '?'} | ${(d.productName || '').substring(0, 30)} | Size: ${d.size || '-'} | Location: ${d.location || '-'} | OnHand: ${d.onHand ?? '?'} | Decision: ${d.decision} | Qty: ${d.originalQty || d.orderedQty || '?'}→${d.adjustedQty ?? '?'} | Reason: ${d.reason || '-'}`;
          }
          if (decisions.length > 100) {
            revisionInfo += `\n  ... and ${decisions.length - 100} more items`;
          }
        }

        if (rc.compareResults?.qtyMismatches?.length > 0) {
          revisionInfo += `\n\nQTY MISMATCHES:`;
          for (const m of rc.compareResults.qtyMismatches.slice(0, 50)) {
            revisionInfo += `\n  ${m.upc || '?'} | ${(m.productName || '').substring(0, 30)} | Vendor: ${m.vendorQty} | System: ${m.systemQty} | Diff: ${m.diff > 0 ? '+' : ''}${m.diff}`;
          }
        }

        if (rc.compareResults?.vendorOnly?.length > 0) {
          revisionInfo += `\n\nVENDOR-ONLY ITEMS (not in system):`;
          for (const v of rc.compareResults.vendorOnly.slice(0, 30)) {
            revisionInfo += `\n  ${v.upc || '?'} | ${(v.productName || '').substring(0, 30)} | Qty: ${v.vendorQty}`;
          }
        }

        if (rc.compareResults?.systemOnly?.length > 0) {
          revisionInfo += `\n\nSYSTEM-ONLY ITEMS (not in vendor form):`;
          for (const s of rc.compareResults.systemOnly.slice(0, 30)) {
            revisionInfo += `\n  ${s.upc || '?'} | ${(s.productName || '').substring(0, 30)} | Qty: ${s.systemQty}`;
          }
        }

        systemPrompt += revisionInfo;
      }
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
    console.error('Revision chat error:', error?.status, error?.message, error?.error?.message);
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
