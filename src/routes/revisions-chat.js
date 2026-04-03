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

You have access to powerful tools that can:
- Query live inventory from BigQuery (on-hand quantities across 3 locations: SLC, South Main, Ogden)
- Look up sales data and velocity metrics
- Run automated revision workflows (zero-stock logic, 20% cap enforcement)
- Check and compare revision history
- Add institutional knowledge and rules
- Save vendor form templates
- Import vendor order confirmations
- Query orders, products, and adjustments

LOCATIONS: SLC (ID 1), South Main (ID 2), Ogden (ID 3)

REVISION LOGIC:
- Items with on_hand > 0 → cancel (already in stock)
- Items with on_hand = 0 and no recent sales → ship (genuinely needed)
- Items with on_hand = 0 but recent sales → cancel (received but not inventoried)
- Discontinued items → always cancel
- If total cancellations exceed the max reduction cap, flip lowest-stock items back to ship

KNOWLEDGE SYSTEM:
- Use add_knowledge to save rules, discontinued products, sizing preferences, etc.
- Types are freeform: "discontinued_product", "sizing_preference", "workflow", "demand_pattern", "max_stock_level", etc.
- Knowledge persists across sessions and informs revision decisions

When the user asks you to do something, USE THE TOOLS. Don't just explain — take action.
When adding rules or knowledge, confirm what you saved.
Be concise and direct.`;

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
    console.error('Revision chat error:', error);
    res.status(500).json({ error: error.message });
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
