const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const aiAgent = require('../services/aiAgent');
const agentTools = require('../services/agentTools');

// Tool definitions for AI (OpenAI/Anthropic format)
const AVAILABLE_TOOLS = [
  {
    name: 'find_orders_by_name',
    description: 'Find orders using natural language - brand name, season name, location name. USE THIS FIRST for order searches with names like "Petzl Fall 2026" or "Arcteryx orders". This is much simpler than using find_orders which requires numeric IDs.',
    parameters: {
      type: 'object',
      properties: {
        brandName: { type: 'string', description: 'Brand name to search for (case-insensitive partial match, e.g., "Petzl", "Arcteryx")' },
        seasonName: { type: 'string', description: 'Season name to search for (case-insensitive partial match, e.g., "Fall 2026", "Spring 2025")' },
        locationName: { type: 'string', description: 'Location name to search for (case-insensitive partial match, optional)' },
        status: { type: 'string', description: 'Filter by status: draft, submitted, approved, ordered (optional)' }
      }
    }
  },
  {
    name: 'query_sales_data',
    description: 'Query historical sales data from BigQuery for a specific brand, location, and date range. Use this to analyze past sales performance.',
    parameters: {
      type: 'object',
      properties: {
        brandId: { type: 'integer', description: 'Brand ID' },
        locationId: { type: 'integer', description: 'Location ID' },
        startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        upcs: { type: 'array', items: { type: 'string' }, description: 'Optional: filter by specific UPCs' }
      },
      required: ['brandId', 'locationId', 'startDate', 'endDate']
    }
  },
  {
    name: 'get_order_inventory',
    description: 'Get current order items/inventory. Use this to see what products are already in orders.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'integer', description: 'Specific order ID (optional)' },
        seasonId: { type: 'integer', description: 'Filter by season (optional)' },
        brandId: { type: 'integer', description: 'Filter by brand (optional)' },
        locationId: { type: 'integer', description: 'Filter by location (optional)' }
      }
    }
  },
  {
    name: 'analyze_velocity',
    description: 'Calculate sales velocity metrics (daily/weekly/monthly velocity) for products. Use this to identify fast-moving vs slow-moving items.',
    parameters: {
      type: 'object',
      properties: {
        brandId: { type: 'integer', description: 'Brand ID' },
        locationId: { type: 'integer', description: 'Location ID' },
        startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' }
      },
      required: ['brandId', 'locationId', 'startDate', 'endDate']
    }
  },
  {
    name: 'get_stock_on_hand',
    description: 'Get current inventory stock levels from RGP system. Use this to check if products need replenishment.',
    parameters: {
      type: 'object',
      properties: {
        upcs: { type: 'array', items: { type: 'string' }, description: 'Array of UPCs to check' },
        locationId: { type: 'integer', description: 'Optional: filter by location' }
      },
      required: ['upcs']
    }
  },
  {
    name: 'suggest_quantity_adjustment',
    description: 'Create a suggestion to adjust the quantity of an existing order item. ALWAYS use this instead of directly modifying orders.',
    parameters: {
      type: 'object',
      properties: {
        conversationId: { type: 'integer', description: 'Current conversation ID' },
        messageId: { type: 'integer', description: 'Current message ID' },
        orderItemId: { type: 'integer', description: 'Order item ID to adjust' },
        fromQuantity: { type: 'integer', description: 'Current quantity' },
        toQuantity: { type: 'integer', description: 'Proposed new quantity' },
        reasoning: { type: 'string', description: 'Clear explanation with data supporting this change' },
        confidence: { type: 'number', description: 'Confidence score 0.0-1.0' }
      },
      required: ['conversationId', 'messageId', 'orderItemId', 'fromQuantity', 'toQuantity', 'reasoning']
    }
  },
  {
    name: 'suggest_add_product',
    description: 'Create a suggestion to add a new product to an order. ALWAYS use this instead of directly modifying orders.',
    parameters: {
      type: 'object',
      properties: {
        conversationId: { type: 'integer', description: 'Current conversation ID' },
        messageId: { type: 'integer', description: 'Current message ID' },
        orderId: { type: 'integer', description: 'Order to add product to' },
        productId: { type: 'integer', description: 'Product ID to add' },
        quantity: { type: 'integer', description: 'Quantity to add' },
        unitCost: { type: 'number', description: 'Unit cost' },
        shipDate: { type: 'string', description: 'Ship date (YYYY-MM-DD)' },
        reasoning: { type: 'string', description: 'Clear explanation with data supporting this addition' },
        confidence: { type: 'number', description: 'Confidence score 0.0-1.0' }
      },
      required: ['conversationId', 'messageId', 'orderId', 'productId', 'quantity', 'unitCost', 'reasoning']
    }
  },
  {
    name: 'suggest_remove_product',
    description: 'Create a suggestion to remove a product from an order. ALWAYS use this instead of directly modifying orders.',
    parameters: {
      type: 'object',
      properties: {
        conversationId: { type: 'integer', description: 'Current conversation ID' },
        messageId: { type: 'integer', description: 'Current message ID' },
        orderItemId: { type: 'integer', description: 'Order item ID to remove' },
        reasoning: { type: 'string', description: 'Clear explanation for removal' },
        confidence: { type: 'number', description: 'Confidence score 0.0-1.0' }
      },
      required: ['conversationId', 'messageId', 'orderItemId', 'reasoning']
    }
  },
  {
    name: 'get_order_budget',
    description: 'Get budget information and utilization for orders. Use this to check remaining budget before suggesting additions.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'integer', description: 'Specific order ID (optional)' },
        seasonId: { type: 'integer', description: 'Filter by season (optional)' },
        brandId: { type: 'integer', description: 'Filter by brand (optional)' },
        locationId: { type: 'integer', description: 'Filter by location (optional)' }
      }
    }
  },
  {
    name: 'get_product_info',
    description: 'Look up product details by ID, UPC, SKU, or name. Use this to find product information.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'integer', description: 'Product ID' },
        upc: { type: 'string', description: 'Product UPC' },
        sku: { type: 'string', description: 'Product SKU' },
        name: { type: 'string', description: 'Product name (partial match)' }
      }
    }
  },
  {
    name: 'get_order_details',
    description: 'Get complete details for a specific order including all items. Use this to understand order contents.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'integer', description: 'Order ID' }
      },
      required: ['orderId']
    }
  },
  {
    name: 'search_products',
    description: 'Search for products by name, SKU, or UPC. Use this to find products.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term' },
        brandId: { type: 'integer', description: 'Filter by brand (optional)' },
        seasonId: { type: 'integer', description: 'Filter by season (optional)' },
        limit: { type: 'integer', description: 'Result limit (default 20)' }
      },
      required: ['query']
    }
  },
  {
    name: 'find_orders',
    description: 'Find and list existing orders with detailed filtering. Use this to identify specific preseason orders that need to be modified.',
    parameters: {
      type: 'object',
      properties: {
        seasonId: { type: 'integer', description: 'Filter by season (optional)' },
        brandId: { type: 'integer', description: 'Filter by brand (optional)' },
        locationId: { type: 'integer', description: 'Filter by location (optional)' },
        status: { type: 'string', description: 'Filter by status: draft, submitted, approved, ordered (optional)' },
        orderNumber: { type: 'string', description: 'Search by order number (partial match, optional)' }
      }
    }
  },
  {
    name: 'suggest_bulk_quantity_change',
    description: 'Suggest bulk quantity changes for multiple items in an order at once (e.g., increase all items by 20%, decrease footwear by 10%). Use this instead of individual adjustments when modifying entire categories.',
    parameters: {
      type: 'object',
      properties: {
        conversationId: { type: 'integer', description: 'Current conversation ID' },
        messageId: { type: 'integer', description: 'Current message ID' },
        orderId: { type: 'integer', description: 'Order ID to modify' },
        changeType: { type: 'string', description: 'Type of change: "percentage" (e.g., 20 for +20%, -15 for -15%) or "fixed" (e.g., 5 for +5, -3 for -3)' },
        changeValue: { type: 'number', description: 'The amount to change. For percentage: 20 means +20%. For fixed: 5 means +5 units per item.' },
        reasoning: { type: 'string', description: 'Clear explanation with data supporting this bulk change' },
        confidence: { type: 'number', description: 'Confidence score 0.0-1.0' },
        filters: {
          type: 'object',
          description: 'Optional filters to apply bulk change to specific items only',
          properties: {
            category: { type: 'string', description: 'Only change items in this category' },
            subcategory: { type: 'string', description: 'Only change items in this subcategory' },
            minQuantity: { type: 'integer', description: 'Only change items with quantity >= this value' },
            maxQuantity: { type: 'integer', description: 'Only change items with quantity <= this value' }
          }
        }
      },
      required: ['conversationId', 'messageId', 'orderId', 'changeType', 'changeValue', 'reasoning']
    }
  },
  {
    name: 'get_order_summary',
    description: 'Get aggregated statistics across multiple orders. Use this to understand the big picture of ordering activity.',
    parameters: {
      type: 'object',
      properties: {
        seasonId: { type: 'integer', description: 'Filter by season (optional)' },
        brandId: { type: 'integer', description: 'Filter by brand (optional)' },
        locationId: { type: 'integer', description: 'Filter by location (optional)' },
        status: { type: 'string', description: 'Filter by status (optional)' }
      }
    }
  },
  {
    name: 'get_brands',
    description: 'List all brands or search for a brand by name. Use this FIRST when you need to find a brand ID from a brand name (e.g., "Petzl", "Arcteryx").',
    parameters: {
      type: 'object',
      properties: {
        searchTerm: { type: 'string', description: 'Brand name to search for (optional, case-insensitive partial match)' }
      }
    }
  },
  {
    name: 'get_seasons',
    description: 'List all seasons or search for a season by name. Use this FIRST when you need to find a season ID from a season name (e.g., "Fall 2026", "Spring 2025").',
    parameters: {
      type: 'object',
      properties: {
        searchTerm: { type: 'string', description: 'Season name to search for (optional, case-insensitive partial match)' }
      }
    }
  }
];

/**
 * POST /api/agent/conversations
 * Create a new conversation
 */
router.post('/conversations', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { seasonId, brandId, locationId, title } = req.body;

    const result = await pool.query(
      `INSERT INTO agent_conversations (user_id, season_id, brand_id, location_id, title)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [req.user.id, seasonId || null, brandId || null, locationId || null, title || null]
    );

    res.json({
      success: true,
      conversation: {
        id: result.rows[0].id,
        created_at: result.rows[0].created_at
      }
    });
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

/**
 * GET /api/agent/conversations
 * List user's conversations
 */
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const { seasonId, brandId, locationId, limit } = req.query;

    let query = `
      SELECT
        ac.*,
        s.name as season_name,
        b.name as brand_name,
        l.name as location_name,
        COUNT(DISTINCT am.id) as message_count,
        COUNT(DISTINCT asug.id) as suggestion_count,
        SUM(au.estimated_cost) as total_cost
      FROM agent_conversations ac
      LEFT JOIN seasons s ON ac.season_id = s.id
      LEFT JOIN brands b ON ac.brand_id = b.id
      LEFT JOIN locations l ON ac.location_id = l.id
      LEFT JOIN agent_messages am ON am.conversation_id = ac.id
      LEFT JOIN agent_suggestions asug ON asug.conversation_id = ac.id
      LEFT JOIN agent_api_usage au ON au.conversation_id = ac.id
      WHERE ac.user_id = $1
    `;

    const params = [req.user.id];
    let paramIndex = 2;

    if (seasonId) {
      query += ` AND ac.season_id = $${paramIndex}`;
      params.push(seasonId);
      paramIndex++;
    }
    if (brandId) {
      query += ` AND ac.brand_id = $${paramIndex}`;
      params.push(brandId);
      paramIndex++;
    }
    if (locationId) {
      query += ` AND ac.location_id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }

    query += `
      GROUP BY ac.id, s.name, b.name, l.name
      ORDER BY ac.updated_at DESC
      LIMIT ${limit || 50}
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      conversations: result.rows.map(row => ({
        ...row,
        total_cost: parseFloat(row.total_cost || 0).toFixed(4)
      }))
    });
  } catch (error) {
    console.error('List conversations error:', error);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

/**
 * GET /api/agent/conversations/:id
 * Get conversation details
 */
router.get('/conversations/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify user owns conversation
    const convResult = await pool.query(
      `SELECT ac.*,
        s.name as season_name,
        b.name as brand_name,
        l.name as location_name
       FROM agent_conversations ac
       LEFT JOIN seasons s ON ac.season_id = s.id
       LEFT JOIN brands b ON ac.brand_id = b.id
       LEFT JOIN locations l ON ac.location_id = l.id
       WHERE ac.id = $1 AND ac.user_id = $2`,
      [id, req.user.id]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const conversation = convResult.rows[0];

    // Get usage stats
    const usage = await aiAgent.getConversationUsage(id);

    res.json({
      success: true,
      conversation: {
        ...conversation,
        usage: {
          message_count: parseInt(usage.message_count || 0),
          total_tokens: parseInt(usage.total_tokens || 0),
          total_cost: parseFloat(usage.total_cost || 0).toFixed(4),
          avg_response_time: parseFloat(usage.avg_response_time || 0).toFixed(0)
        }
      }
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

/**
 * DELETE /api/agent/conversations/:id
 * Delete a conversation
 */
router.delete('/conversations/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify user owns conversation
    const result = await pool.query(
      'DELETE FROM agent_conversations WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json({ success: true, message: 'Conversation deleted' });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

/**
 * POST /api/agent/conversations/:id/messages
 * Send a message to the agent and get a response
 */
router.post('/conversations/:id/messages', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Check if AI agent is enabled
    if (process.env.AI_AGENT_ENABLED !== 'true') {
      return res.status(503).json({ error: 'AI agent is not enabled' });
    }

    // Verify user owns conversation
    const convResult = await pool.query(
      'SELECT season_id, brand_id, location_id FROM agent_conversations WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Check budget
    const budgetExceeded = await aiAgent.isBudgetExceeded(req.user.id);
    if (budgetExceeded) {
      return res.status(402).json({ error: 'Monthly AI budget exceeded' });
    }

    const context = {
      userId: req.user.id,
      seasonId: convResult.rows[0].season_id,
      brandId: convResult.rows[0].brand_id,
      locationId: convResult.rows[0].location_id
    };

    // Send message to AI agent
    const response = await aiAgent.sendMessage(id, message, context, AVAILABLE_TOOLS);

    // Process tool calls if any
    let toolResults = [];
    if (response.toolCalls && response.toolCalls.length > 0) {
      toolResults = await aiAgent.processToolCalls(response.toolCalls, context);

      // Save tool results as a system message for context
      const toolSummary = toolResults.map(tr =>
        `Tool: ${tr.toolName}\nResult: ${JSON.stringify(tr.result)}`
      ).join('\n\n');

      await pool.query(
        `INSERT INTO agent_messages (conversation_id, role, content)
         VALUES ($1, 'system', $2)`,
        [id, `Tool execution results:\n${toolSummary}`]
      );
    }

    res.json({
      success: true,
      message_id: response.messageId,
      content: response.content,
      tool_calls: response.toolCalls,
      tool_results: toolResults,
      usage: {
        cost: parseFloat(response.cost).toFixed(4),
        tokens: (response.usage.prompt_tokens || response.usage.input_tokens) +
                (response.usage.completion_tokens || response.usage.output_tokens),
        response_time_ms: response.responseTime
      }
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: error.message || 'Failed to send message' });
  }
});

/**
 * GET /api/agent/conversations/:id/messages
 * Get conversation messages
 */
router.get('/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit } = req.query;

    // Verify user owns conversation
    const convCheck = await pool.query(
      'SELECT id FROM agent_conversations WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (convCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const result = await pool.query(
      `SELECT id, role, content, metadata, created_at
       FROM agent_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC
       LIMIT ${limit || 100}`,
      [id]
    );

    res.json({
      success: true,
      messages: result.rows
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

/**
 * GET /api/agent/suggestions
 * Get user's suggestions (all or filtered)
 */
router.get('/suggestions', authenticateToken, async (req, res) => {
  try {
    const { conversationId, orderId, status } = req.query;

    let query = `
      SELECT
        asug.*,
        ac.title as conversation_title,
        o.order_number,
        p.name as product_name,
        p.sku
      FROM agent_suggestions asug
      JOIN agent_conversations ac ON asug.conversation_id = ac.id
      LEFT JOIN orders o ON asug.order_id = o.id
      LEFT JOIN products p ON asug.product_id = p.id
      WHERE ac.user_id = $1
    `;

    const params = [req.user.id];
    let paramIndex = 2;

    if (conversationId) {
      query += ` AND asug.conversation_id = $${paramIndex}`;
      params.push(conversationId);
      paramIndex++;
    }
    if (orderId) {
      query += ` AND asug.order_id = $${paramIndex}`;
      params.push(orderId);
      paramIndex++;
    }
    if (status) {
      query += ` AND asug.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ' ORDER BY asug.created_at DESC LIMIT 100';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      suggestions: result.rows
    });
  } catch (error) {
    console.error('Get suggestions error:', error);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

/**
 * GET /api/agent/suggestions/:id
 * Get suggestion details
 */
router.get('/suggestions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT
        asug.*,
        ac.title as conversation_title,
        o.order_number,
        p.name as product_name,
        p.sku,
        p.upc
      FROM agent_suggestions asug
      JOIN agent_conversations ac ON asug.conversation_id = ac.id
      LEFT JOIN orders o ON asug.order_id = o.id
      LEFT JOIN products p ON asug.product_id = p.id
      WHERE asug.id = $1 AND ac.user_id = $2`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    res.json({
      success: true,
      suggestion: result.rows[0]
    });
  } catch (error) {
    console.error('Get suggestion error:', error);
    res.status(500).json({ error: 'Failed to get suggestion' });
  }
});

/**
 * POST /api/agent/suggestions/:id/approve
 * Approve a suggestion and apply the change
 */
router.post('/suggestions/:id/approve', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query('BEGIN');

    // Get suggestion details
    const suggResult = await client.query(
      `SELECT asug.*, ac.user_id
       FROM agent_suggestions asug
       JOIN agent_conversations ac ON asug.conversation_id = ac.id
       WHERE asug.id = $1 AND ac.user_id = $2`,
      [id, req.user.id]
    );

    if (suggResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    const suggestion = suggResult.rows[0];

    if (suggestion.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Suggestion is already ${suggestion.status}` });
    }

    // Apply the suggestion based on type
    let applied = false;
    let errorMessage = null;

    try {
      const actionData = suggestion.action_data;

      switch (suggestion.suggestion_type) {
        case 'adjust_quantity':
          // Update order item quantity
          await client.query(
            'UPDATE order_items SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [actionData.to, suggestion.order_item_id]
          );
          applied = true;
          break;

        case 'add_product':
          // Add new order item
          await client.query(
            `INSERT INTO order_items (order_id, product_id, quantity, unit_cost, ship_date)
             VALUES ($1, $2, $3, $4, $5)`,
            [suggestion.order_id, actionData.product_id, actionData.quantity, actionData.unit_cost, actionData.ship_date]
          );
          applied = true;
          break;

        case 'remove_product':
          // Delete order item
          await client.query(
            'DELETE FROM order_items WHERE id = $1',
            [suggestion.order_item_id]
          );
          applied = true;
          break;

        default:
          errorMessage = `Unknown suggestion type: ${suggestion.suggestion_type}`;
      }
    } catch (applyError) {
      errorMessage = applyError.message;
    }

    // Update suggestion status
    const newStatus = applied ? 'applied' : 'failed';
    await client.query(
      `UPDATE agent_suggestions
       SET status = $1,
           approved_by = $2,
           approved_at = CURRENT_TIMESTAMP,
           applied_at = ${applied ? 'CURRENT_TIMESTAMP' : 'NULL'}
       WHERE id = $3`,
      [newStatus, req.user.id, id]
    );

    await client.query('COMMIT');

    res.json({
      success: applied,
      status: newStatus,
      message: applied ? 'Suggestion approved and applied successfully' : `Failed to apply suggestion: ${errorMessage}`
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Approve suggestion error:', error);
    res.status(500).json({ error: 'Failed to approve suggestion' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/agent/suggestions/:id/reject
 * Reject a suggestion
 */
router.post('/suggestions/:id/reject', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE agent_suggestions
       SET status = 'rejected', rejected_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND EXISTS (SELECT 1 FROM agent_conversations WHERE id = agent_suggestions.conversation_id AND user_id = $2)
         AND status = 'pending'
       RETURNING id`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Suggestion not found or already processed' });
    }

    res.json({
      success: true,
      message: 'Suggestion rejected'
    });
  } catch (error) {
    console.error('Reject suggestion error:', error);
    res.status(500).json({ error: 'Failed to reject suggestion' });
  }
});

/**
 * GET /api/agent/usage
 * Get usage statistics for the user
 */
router.get('/usage', authenticateToken, async (req, res) => {
  try {
    const usage = await aiAgent.getMonthlyUsage(req.user.id);

    res.json({
      success: true,
      usage: {
        conversation_count: parseInt(usage.conversation_count || 0),
        message_count: parseInt(usage.message_count || 0),
        total_tokens: parseInt(usage.total_tokens || 0),
        total_cost: parseFloat(usage.total_cost || 0).toFixed(2),
        max_monthly_cost: parseFloat(usage.max_monthly_cost).toFixed(2),
        remaining_budget: parseFloat(usage.remaining_budget).toFixed(2),
        budget_utilization_pct: (
          (parseFloat(usage.total_cost || 0) / parseFloat(usage.max_monthly_cost)) * 100
        ).toFixed(1)
      }
    });
  } catch (error) {
    console.error('Get usage error:', error);
    res.status(500).json({ error: 'Failed to get usage statistics' });
  }
});

module.exports = router;
