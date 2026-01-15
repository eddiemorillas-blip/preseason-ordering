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
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
  'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 }
};

// System prompt for the retail buyer assistant
const SYSTEM_PROMPT = `You are an expert retail buyer assistant for a sporting goods company.

CAPABILITIES:
- Query historical sales data from BigQuery
- Analyze current order inventory and performance
- Calculate sales velocity and trends
- Check stock levels across locations
- Suggest order modifications (quantity adjustments, product additions)
- Analyze budget utilization

RULES:
1. NEVER directly modify orders - you must create suggestions for user approval
2. Base all recommendations on data, not assumptions
3. Explain your reasoning clearly with supporting metrics
4. Consider multiple factors: velocity, stock levels, seasonality, budget constraints
5. For ASAP orders: prioritize fast-moving items with low stock
6. For preseason orders: consider planning horizon and historical trends
7. Always show budget impact for suggestions

SUGGESTION FORMAT:
1. State the recommended change clearly
2. Provide data-driven reasoning (sales velocity, stock status, trends)
3. Show budget impact (cost and remaining budget)
4. Indicate your confidence level (0.0-1.0)

CONTEXT:
- Users work with orders organized by brand, location, and season
- Each order has a budget allocation
- Products have historical sales data
- Orders can have multiple ship dates
- Quantities are tracked per product per ship date

When analyzing data or making suggestions, always cite specific metrics and explain your reasoning.`;

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

    // Add context if provided
    if (context.seasonId || context.brandId || context.locationId) {
      const contextParts = [];
      if (context.seasonId) contextParts.push(`Season ID: ${context.seasonId}`);
      if (context.brandId) contextParts.push(`Brand ID: ${context.brandId}`);
      if (context.locationId) contextParts.push(`Location ID: ${context.locationId}`);

      messages.push({
        role: 'system',
        content: `Current context: ${contextParts.join(', ')}`
      });
    }

    // Add conversation history (last 10 messages)
    historyResult.rows.forEach(msg => {
      messages.push({
        role: msg.role,
        content: msg.content
      });
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
    const messageResult = await client.query(
      `INSERT INTO agent_messages (conversation_id, role, content, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        conversationId,
        'assistant',
        response.content,
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
  const systemMessage = messages.find(m => m.role === 'system');
  const conversationMessages = messages.filter(m => m.role !== 'system');

  const params = {
    model,
    max_tokens: parseInt(process.env.AI_MAX_TOKENS_PER_REQUEST) || 4000,
    system: systemMessage ? systemMessage.content : SYSTEM_PROMPT,
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
