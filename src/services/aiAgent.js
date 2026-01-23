const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../config/database');

// Initialize AI clients based on environment configuration
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// Tool result cache (5 minute TTL)
const toolCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cost tracking per model (per 1K tokens)
const MODEL_COSTS = {
  'gpt-4-turbo-preview': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-5-sonnet-20240620': { input: 0.003, output: 0.015 },
  'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
  'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 }
};

// System prompt for the retail buyer assistant
const SYSTEM_PROMPT = `You are an expert retail buyer assistant for The Front, a sporting goods retailer specializing in outdoor and climbing gear.

BUSINESS CONTEXT:
- The Front operates multiple retail locations (Salt Lake City, Boise, Ogden, etc.)
- They work with premium outdoor brands: Petzl, Arcteryx, Black Diamond, Patagonia, etc.
- Ordering is done by season (Spring, Fall, ASAP/replenishment)
- Each brand/location/season combination has a budget allocation
- Orders have original quantities (from brand forms) and adjusted quantities (buyer modifications)
- Products are grouped into "families" by base_name (e.g., "Sirocco Helmet" in multiple sizes/colors)

YOUR CAPABILITIES:
- Query historical sales data from BigQuery (last 12 months)
- View current orders with original AND adjusted quantities
- Analyze sales velocity and stock coverage
- Check current inventory levels across locations
- Find products with low stock that should be added to orders
- Compare current orders to last year's sales performance
- Analyze orders by category, family, or gender
- View finalized order history
- CREATE order modification suggestions (quantity adjustments, product additions/removals)
- Analyze budget utilization

KEY METRICS TO USE:
- Stock coverage (months of supply = stock on hand / avg monthly sales)
- Sales velocity (units sold per month)
- Year-over-year comparison (current order vs last year's sales)
- Budget utilization (current spend vs allocated budget)
- Seasonality index (1.0 = average month, >1.2 = peak, <0.8 = slow)

LEAD TIME ASSUMPTION:
- Assume 1 month lead time for all brands
- Items with <1 month stock coverage are CRITICAL - need to order immediately
- Items with 1-2 months coverage are LOW - order soon
- Factor in seasonality: if December is a peak month (index 1.5), order 50% more to cover that period

RULES FOR ANALYSIS:
1. Always consider BOTH original and adjusted quantities - tell users what has already changed
2. Use get_suggested_items to find products with <1 month of stock coverage
3. Use compare_to_last_year to validate order quantities against historical performance
4. Use analyze_by_category to understand order composition
5. Products with high velocity (>10 units/month) and low stock (<1 month) are priority adds
6. Flag items where order quantity significantly exceeds last year's sales (potential overstock)

RULES FOR TAKING ACTION:
1. When users ask you to modify orders, you MUST use suggest_bulk_quantity_change or suggest_quantity_adjustment tools
2. DO NOT just tell the user what they should do - CREATE THE SUGGESTIONS using tools
3. For bulk changes across entire orders, use suggest_bulk_quantity_change with percentage or fixed values
4. Always show the budget impact of your suggestions
5. Explain your reasoning with supporting data (velocity, stock levels, year-over-year trends)
6. Use confidence scores: 0.9+ for data-backed changes, 0.7-0.8 for reasonable estimates, <0.7 for uncertain

WORKFLOW EXAMPLE:
When a user says "help me optimize the Petzl Fall 2026 orders":
1. Use find_orders_by_name to get the orders
2. Use get_order_details to see current quantities and adjustments
3. Use compare_to_last_year to validate against historical sales
4. Use get_suggested_items to find missing products that should be added
5. Use analyze_by_category to understand the order composition
6. Create suggestions using suggest_bulk_quantity_change or individual adjustments
7. Summarize what you found and what suggestions you created

IMPORTANT:
- When users ask to take action, USE THE TOOLS to create suggestions
- Don't just explain what should be done - actually do it
- Users must approve suggestions before they're applied
- Always tell users how many suggestions were created and the total budget impact`;

/**
 * Send a message to the AI provider and get a response
 * @param {number} conversationId - Database conversation ID
 * @param {string} userMessage - The user's message
 * @param {Object} context - Order context (seasonId, brandId, locationId)
 * @param {Array} tools - Available tools for the agent
 * @returns {Object} Response with message content and tool calls
 */
async function sendMessage(conversationId, userMessage, context = {}, tools = []) {
  const client = pool;
  const provider = process.env.AI_PROVIDER || 'openai';
  const model = process.env.AI_MODEL || 'gpt-4-turbo-preview';

  try {
    // Get conversation history
    const historyResult = await client.query(
      `SELECT role, content, metadata
       FROM agent_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC
       LIMIT 10`,
      [conversationId]
    );

    // Build messages array
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT }
    ];

    // Add context if provided - fetch actual names for better AI understanding
    if (context.seasonId || context.brandId || context.locationId) {
      const contextParts = [];

      // Fetch names from database for better context
      if (context.seasonId) {
        const seasonResult = await client.query('SELECT name FROM seasons WHERE id = $1', [context.seasonId]);
        const seasonName = seasonResult.rows[0]?.name || `ID ${context.seasonId}`;
        contextParts.push(`Season: ${seasonName} (ID: ${context.seasonId})`);
      }
      if (context.brandId) {
        const brandResult = await client.query('SELECT name FROM brands WHERE id = $1', [context.brandId]);
        const brandName = brandResult.rows[0]?.name || `ID ${context.brandId}`;
        contextParts.push(`Brand: ${brandName} (ID: ${context.brandId})`);
      }
      if (context.locationId) {
        const locationResult = await client.query('SELECT name FROM locations WHERE id = $1', [context.locationId]);
        const locationName = locationResult.rows[0]?.name || `ID ${context.locationId}`;
        contextParts.push(`Location: ${locationName} (ID: ${context.locationId})`);
      }
      if (context.shipDate) {
        contextParts.push(`Ship Date Filter: ${context.shipDate}`);
      }

      // Get detailed order info - if shipDate provided, filter to just that order
      if (context.seasonId && context.brandId && context.locationId) {
        let orderQuery = `
          SELECT o.id, o.order_number, o.ship_date, o.status, o.finalized_at,
                 COUNT(oi.id) as item_count,
                 SUM(oi.quantity) as original_units,
                 SUM(COALESCE(oi.adjusted_quantity, oi.quantity)) as adjusted_units,
                 SUM(oi.quantity * oi.unit_cost) as original_total,
                 SUM(COALESCE(oi.adjusted_quantity, oi.quantity) * oi.unit_cost) as adjusted_total
          FROM orders o
          LEFT JOIN order_items oi ON oi.order_id = o.id
          WHERE o.season_id = $1 AND o.brand_id = $2 AND o.location_id = $3 AND o.status != 'cancelled'
        `;
        const queryParams = [context.seasonId, context.brandId, context.locationId];

        if (context.shipDate) {
          orderQuery += ` AND o.ship_date = $4`;
          queryParams.push(context.shipDate);
        }

        orderQuery += ` GROUP BY o.id ORDER BY o.ship_date`;

        const orderResult = await client.query(orderQuery, queryParams);

        if (orderResult.rows.length > 0) {
          const ordersInfo = orderResult.rows.map(o => {
            const originalTotal = parseFloat(o.original_total) || 0;
            const adjustedTotal = parseFloat(o.adjusted_total) || 0;
            const reductionPct = originalTotal > 0
              ? ((originalTotal - adjustedTotal) / originalTotal * 100).toFixed(1)
              : 0;

            return `
Order: ${o.order_number} (ID: ${o.id})
  Ship Date: ${o.ship_date ? new Date(o.ship_date).toLocaleDateString() : 'N/A'}
  Status: ${o.finalized_at ? 'finalized' : 'draft'}
  Items: ${o.item_count}
  Original: ${o.original_units} units / $${originalTotal.toFixed(2)}
  Adjusted: ${o.adjusted_units} units / $${adjustedTotal.toFixed(2)}
  Reduction: ${reductionPct}%`;
          }).join('\n');

          contextParts.push(`\n--- CURRENT ORDER DETAILS ---${ordersInfo}`);
        }
      }

      messages.push({
        role: 'system',
        content: `Current working context - The user is viewing the Order Adjustment page for:\n${contextParts.join('\n')}\n\nYou have access to tools to search products, check inventory, and create order adjustment suggestions. Use the IDs provided when calling tools. The user wants to adjust orders to target a specific reduction percentage (often 20% or less).`
      });
    }

    // Add conversation history (last 10 messages)
    // Filter out messages with empty content to avoid Anthropic API errors
    historyResult.rows.forEach(msg => {
      if (msg.content && msg.content.trim().length > 0) {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    });

    // Add current user message
    messages.push({
      role: 'user',
      content: userMessage
    });

    // Call appropriate AI provider
    let response, usage, cost;
    const startTime = Date.now();

    if (provider === 'openai' && openai) {
      response = await callOpenAI(messages, tools, model);
      usage = response.usage;
      cost = calculateCost(model, usage.prompt_tokens, usage.completion_tokens);
    } else if (provider === 'anthropic' && anthropic) {
      response = await callAnthropic(messages, tools, model);
      usage = response.usage;
      cost = calculateCost(model, usage.input_tokens, usage.output_tokens);
    } else {
      throw new Error(`AI provider ${provider} not configured or invalid`);
    }

    const responseTime = Date.now() - startTime;

    // Save user message to database
    await client.query(
      `INSERT INTO agent_messages (conversation_id, role, content)
       VALUES ($1, $2, $3)`,
      [conversationId, 'user', userMessage]
    );

    // Save assistant response to database
    // If content is empty but there are tool calls, use a placeholder
    const contentToSave = response.content ||
      (response.toolCalls && response.toolCalls.length > 0 ? '[Tool execution]' : '');

    const messageResult = await client.query(
      `INSERT INTO agent_messages (conversation_id, role, content, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        conversationId,
        'assistant',
        contentToSave,
        JSON.stringify({ tool_calls: response.toolCalls || [] })
      ]
    );

    const messageId = messageResult.rows[0].id;

    // Track API usage
    await client.query(
      `INSERT INTO agent_api_usage
       (conversation_id, message_id, provider, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost, response_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        conversationId,
        messageId,
        provider,
        model,
        usage.prompt_tokens || usage.input_tokens,
        usage.completion_tokens || usage.output_tokens,
        (usage.prompt_tokens || usage.input_tokens) + (usage.completion_tokens || usage.output_tokens),
        cost,
        responseTime
      ]
    );

    return {
      messageId,
      content: response.content,
      toolCalls: response.toolCalls || [],
      usage,
      cost,
      responseTime
    };
  } catch (error) {
    console.error('Error in sendMessage:', error);
    throw error;
  }
}

/**
 * Call OpenAI API
 */
async function callOpenAI(messages, tools, model) {
  const params = {
    model,
    messages,
    max_tokens: parseInt(process.env.AI_MAX_TOKENS_PER_REQUEST) || 4000
  };

  // Add tools if provided
  if (tools && tools.length > 0) {
    params.tools = tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
    params.tool_choice = 'auto';
  }

  const completion = await openai.chat.completions.create(params);
  const message = completion.choices[0].message;

  return {
    content: message.content || '',
    toolCalls: message.tool_calls || [],
    usage: completion.usage
  };
}

/**
 * Call Anthropic API
 */
async function callAnthropic(messages, tools, model) {
  // Anthropic requires system message separate from messages array
  // Combine ALL system messages (there may be multiple - base prompt + context)
  const systemMessages = messages.filter(m => m.role === 'system');
  const systemContent = systemMessages.map(m => m.content).join('\n\n');
  const conversationMessages = messages.filter(m => m.role !== 'system');

  const params = {
    model,
    max_tokens: parseInt(process.env.AI_MAX_TOKENS_PER_REQUEST) || 4000,
    system: systemContent || SYSTEM_PROMPT,
    messages: conversationMessages
  };

  // Add tools if provided
  if (tools && tools.length > 0) {
    params.tools = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));
  }

  const completion = await anthropic.messages.create(params);

  // Extract content and tool calls
  let textContent = '';
  const toolCalls = [];

  completion.content.forEach(block => {
    if (block.type === 'text') {
      textContent += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input)
        }
      });
    }
  });

  return {
    content: textContent,
    toolCalls,
    usage: completion.usage
  };
}

/**
 * Execute a tool and return the result
 * @param {string} toolName - Name of the tool to execute
 * @param {Object} args - Tool arguments
 * @param {Object} context - User and order context
 * @returns {Object} Tool execution result
 */
async function executeTool(toolName, args, context) {
  // Check cache first
  const cacheKey = `${toolName}:${JSON.stringify(args)}`;
  const cached = toolCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`Cache hit for ${toolName}`);
    return cached.result;
  }

  try {
    // Import agent tools
    const agentTools = require('./agentTools');

    // Verify tool exists
    if (!agentTools[toolName]) {
      throw new Error(`Tool ${toolName} not found`);
    }

    // Execute tool
    const result = await agentTools[toolName](args, context);

    // Cache result
    toolCache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });

    return result;
  } catch (error) {
    console.error(`Error executing tool ${toolName}:`, error);
    return {
      error: true,
      message: error.message
    };
  }
}

/**
 * Process tool calls from AI response
 * @param {Array} toolCalls - Tool calls from AI
 * @param {Object} context - User and order context
 * @returns {Array} Tool results
 */
async function processToolCalls(toolCalls, context) {
  const results = [];

  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments);

    const result = await executeTool(toolName, args, context);

    results.push({
      toolCallId: toolCall.id,
      toolName,
      result
    });
  }

  return results;
}

/**
 * Calculate estimated cost based on token usage
 */
function calculateCost(model, promptTokens, completionTokens) {
  const costs = MODEL_COSTS[model] || { input: 0.01, output: 0.03 };

  const inputCost = (promptTokens / 1000) * costs.input;
  const outputCost = (completionTokens / 1000) * costs.output;

  return inputCost + outputCost;
}

/**
 * Get conversation usage statistics
 * @param {number} conversationId - Conversation ID
 * @returns {Object} Usage statistics
 */
async function getConversationUsage(conversationId) {
  const client = pool;

  const result = await client.query(
    `SELECT
      COUNT(*) as message_count,
      SUM(total_tokens) as total_tokens,
      SUM(estimated_cost) as total_cost,
      AVG(response_time_ms) as avg_response_time
     FROM agent_api_usage
     WHERE conversation_id = $1`,
    [conversationId]
  );

  return result.rows[0];
}

/**
 * Get monthly usage statistics for a user
 * @param {number} userId - User ID
 * @returns {Object} Monthly usage statistics
 */
async function getMonthlyUsage(userId) {
  const client = pool;

  const result = await client.query(
    `SELECT
      COUNT(DISTINCT u.conversation_id) as conversation_count,
      COUNT(*) as message_count,
      SUM(u.total_tokens) as total_tokens,
      SUM(u.estimated_cost) as total_cost
     FROM agent_api_usage u
     JOIN agent_conversations c ON c.id = u.conversation_id
     WHERE c.user_id = $1
       AND u.created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
    [userId]
  );

  const usage = result.rows[0];
  const maxMonthlyCost = parseFloat(process.env.AI_MAX_MONTHLY_COST) || 500;

  return {
    ...usage,
    max_monthly_cost: maxMonthlyCost,
    remaining_budget: maxMonthlyCost - (parseFloat(usage.total_cost) || 0)
  };
}

/**
 * Check if user has exceeded monthly budget
 * @param {number} userId - User ID
 * @returns {boolean} True if budget exceeded
 */
async function isBudgetExceeded(userId) {
  const usage = await getMonthlyUsage(userId);
  return usage.remaining_budget <= 0;
}

module.exports = {
  sendMessage,
  executeTool,
  processToolCalls,
  getConversationUsage,
  getMonthlyUsage,
  isBudgetExceeded,
  SYSTEM_PROMPT
};
