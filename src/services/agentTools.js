const pool = require('../config/database');
const bigquery = require('./bigquery');

/**
 * Tool 1: Query historical sales data from BigQuery
 * @param {Object} args - { brandId, locationId, startDate, endDate, upcs? }
 * @param {Object} context - { userId }
 * @returns {Object} Sales data with metrics
 */
async function query_sales_data(args, context) {
  const { brandId, locationId, startDate, endDate, upcs } = args;

  try {
    // Get brand and location names
    const brandResult = await pool.query('SELECT name FROM brands WHERE id = $1', [brandId]);
    const locationResult = await pool.query('SELECT name, code FROM locations WHERE id = $1', [locationId]);

    if (brandResult.rows.length === 0) {
      return { error: true, message: 'Brand not found' };
    }

    const brandName = brandResult.rows[0].name;
    const facilityId = bigquery.LOCATION_TO_FACILITY[locationId];

    if (!facilityId) {
      return { error: true, message: 'Location not mapped to BigQuery facility' };
    }

    // Build BigQuery query
    let bqQuery = `
      SELECT
        p.BARCODE as upc,
        p.DESCRIPTION as product_name,
        DATE(i.POSTDATE) as sale_date,
        SUM(ii.QUANTITY) as qty_sold,
        SUM(ii.QUANTITY * ii.PRICE) as revenue,
        COUNT(DISTINCT i.INVOICE_ID) as transaction_count
      FROM \`front-data-production.rgp_cleaned_zone.invoice_items_all\` ii
      JOIN \`front-data-production.rgp_cleaned_zone.invoices_all\` i ON ii.invoice_concat = i.invoice_concat
      JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON ii.product_concat = p.product_concat
      LEFT JOIN \`front-data-production.rgp_cleaned_zone.vendors_all\` v ON p.vendor_concat = v.vendor_concat
      WHERE DATE(i.POSTDATE) >= @startDate
        AND DATE(i.POSTDATE) <= @endDate
        AND p.facility_id_true = @facilityId
        AND LOWER(v.VENDOR_NAME) LIKE CONCAT('%', @brandName, '%')
        AND p.BARCODE IS NOT NULL
        AND LENGTH(p.BARCODE) > 5
        AND ii.QUANTITY > 0
    `;

    const queryParams = {
      startDate,
      endDate,
      facilityId,
      brandName: brandName.toLowerCase()
    };

    // Filter by specific UPCs if provided
    if (upcs && upcs.length > 0) {
      bqQuery += ` AND p.BARCODE IN UNNEST(@upcs)`;
      queryParams.upcs = upcs;
    }

    bqQuery += `
      GROUP BY p.BARCODE, p.DESCRIPTION, DATE(i.POSTDATE)
      ORDER BY sale_date DESC, qty_sold DESC
      LIMIT 10000
    `;

    const [rows] = await bigquery.bigquery.query({
      query: bqQuery,
      params: queryParams
    });

    // Calculate summary metrics
    const totalQty = rows.reduce((sum, r) => sum + parseInt(r.qty_sold || 0), 0);
    const totalRevenue = rows.reduce((sum, r) => sum + parseFloat(r.revenue || 0), 0);
    const uniqueProducts = new Set(rows.map(r => r.upc)).size;

    return {
      success: true,
      summary: {
        total_quantity_sold: totalQty,
        total_revenue: totalRevenue.toFixed(2),
        unique_products: uniqueProducts,
        records_count: rows.length,
        date_range: { start: startDate, end: endDate }
      },
      sales_data: rows.slice(0, 50) // Return top 50 for context
    };
  } catch (error) {
    console.error('query_sales_data error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 2: Get current order inventory (order items)
 * @param {Object} args - { orderId?, seasonId?, brandId?, locationId? }
 * @param {Object} context - { userId }
 * @returns {Object} Order items with details
 */
async function get_order_inventory(args, context) {
  const { orderId, seasonId, brandId, locationId } = args;

  try {
    let query = `
      SELECT
        o.id as order_id,
        o.order_number,
        o.status as order_status,
        oi.id as item_id,
        oi.quantity,
        oi.unit_cost,
        oi.ship_date,
        p.id as product_id,
        p.name as product_name,
        p.sku,
        p.upc,
        p.size,
        p.color,
        p.base_name,
        b.name as brand_name,
        l.name as location_name,
        s.name as season_name
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON oi.product_id = p.id
      LEFT JOIN brands b ON o.brand_id = b.id
      LEFT JOIN locations l ON o.location_id = l.id
      LEFT JOIN seasons s ON o.season_id = s.id
      WHERE o.status != 'cancelled'
    `;

    const params = [];
    let paramIndex = 1;

    if (orderId) {
      query += ` AND o.id = $${paramIndex}`;
      params.push(orderId);
      paramIndex++;
    }
    if (seasonId) {
      query += ` AND o.season_id = $${paramIndex}`;
      params.push(seasonId);
      paramIndex++;
    }
    if (brandId) {
      query += ` AND o.brand_id = $${paramIndex}`;
      params.push(brandId);
      paramIndex++;
    }
    if (locationId) {
      query += ` AND o.location_id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }

    query += ' ORDER BY o.created_at DESC, oi.ship_date';

    const result = await pool.query(query, params);

    // Group by order
    const ordersMap = {};
    for (const row of result.rows) {
      if (!ordersMap[row.order_id]) {
        ordersMap[row.order_id] = {
          order_id: row.order_id,
          order_number: row.order_number,
          order_status: row.order_status,
          brand_name: row.brand_name,
          location_name: row.location_name,
          season_name: row.season_name,
          items: [],
          total_quantity: 0,
          total_cost: 0
        };
      }

      if (row.item_id) {
        const itemCost = row.quantity * parseFloat(row.unit_cost || 0);
        ordersMap[row.order_id].items.push({
          item_id: row.item_id,
          product_id: row.product_id,
          product_name: row.product_name,
          sku: row.sku,
          upc: row.upc,
          size: row.size,
          color: row.color,
          quantity: row.quantity,
          unit_cost: row.unit_cost,
          line_cost: itemCost.toFixed(2),
          ship_date: row.ship_date
        });
        ordersMap[row.order_id].total_quantity += row.quantity;
        ordersMap[row.order_id].total_cost += itemCost;
      }
    }

    const orders = Object.values(ordersMap);

    return {
      success: true,
      orders_count: orders.length,
      orders: orders.map(o => ({
        ...o,
        total_cost: o.total_cost.toFixed(2)
      }))
    };
  } catch (error) {
    console.error('get_order_inventory error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 3: Analyze sales velocity for products
 * @param {Object} args - { brandId, locationId, startDate, endDate }
 * @param {Object} context - { userId }
 * @returns {Object} Velocity analysis with recommendations
 */
async function analyze_velocity(args, context) {
  const { brandId, locationId, startDate, endDate } = args;

  try {
    // Get sales data from BigQuery
    const salesResult = await query_sales_data(
      { brandId, locationId, startDate, endDate },
      context
    );

    if (salesResult.error) {
      return salesResult;
    }

    // Calculate date range in days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

    // Calculate velocity metrics per product
    const velocityByUpc = {};
    for (const sale of (salesResult.sales_data || [])) {
      const upc = sale.upc;
      if (!velocityByUpc[upc]) {
        velocityByUpc[upc] = {
          upc,
          product_name: sale.product_name,
          total_qty: 0,
          days_with_sales: new Set(),
          transactions: 0
        };
      }
      velocityByUpc[upc].total_qty += parseInt(sale.qty_sold || 0);
      velocityByUpc[upc].days_with_sales.add(sale.sale_date);
      velocityByUpc[upc].transactions += parseInt(sale.transaction_count || 0);
    }

    // Calculate velocity metrics
    const velocityData = Object.values(velocityByUpc).map(v => {
      const daysWithSales = v.days_with_sales.size;
      const avgDailyVelocity = v.total_qty / days;
      const avgWeeklyVelocity = avgDailyVelocity * 7;
      const avgMonthlyVelocity = avgDailyVelocity * 30;

      return {
        upc: v.upc,
        product_name: v.product_name,
        total_quantity_sold: v.total_qty,
        days_with_sales: daysWithSales,
        total_transactions: v.transactions,
        avg_daily_velocity: avgDailyVelocity.toFixed(2),
        avg_weekly_velocity: avgWeeklyVelocity.toFixed(2),
        avg_monthly_velocity: avgMonthlyVelocity.toFixed(2),
        velocity_category: avgMonthlyVelocity > 50 ? 'high' : avgMonthlyVelocity > 10 ? 'medium' : 'low'
      };
    });

    // Sort by monthly velocity
    velocityData.sort((a, b) => parseFloat(b.avg_monthly_velocity) - parseFloat(a.avg_monthly_velocity));

    return {
      success: true,
      analysis_period: {
        start_date: startDate,
        end_date: endDate,
        total_days: days
      },
      products_analyzed: velocityData.length,
      velocity_data: velocityData.slice(0, 100) // Top 100 by velocity
    };
  } catch (error) {
    console.error('analyze_velocity error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 4: Get current stock on hand from inventory
 * @param {Object} args - { upcs, locationId? }
 * @param {Object} context - { userId }
 * @returns {Object} Stock levels by location
 */
async function get_stock_on_hand(args, context) {
  const { upcs, locationId } = args;

  if (!upcs || upcs.length === 0) {
    return { error: true, message: 'UPCs array is required' };
  }

  try {
    const stockData = await bigquery.getStockByUPCs(upcs);

    // Filter by location if specified
    const result = {};
    for (const [upc, locations] of Object.entries(stockData)) {
      if (locationId) {
        result[upc] = {
          [locationId]: locations[locationId] || 0
        };
      } else {
        result[upc] = locations;
      }
    }

    return {
      success: true,
      stock_data: result,
      upcs_queried: upcs.length,
      upcs_found: Object.keys(result).length
    };
  } catch (error) {
    console.error('get_stock_on_hand error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 5: Suggest quantity adjustment for an order item
 * @param {Object} args - { conversationId, messageId, orderItemId, fromQuantity, toQuantity, reasoning, confidence }
 * @param {Object} context - { userId }
 * @returns {Object} Suggestion created
 */
async function suggest_quantity_adjustment(args, context) {
  const { conversationId, messageId, orderItemId, fromQuantity, toQuantity, reasoning, confidence } = args;

  try {
    // Get order item details
    const itemResult = await pool.query(`
      SELECT oi.*, o.id as order_id, o.order_number, p.name as product_name, p.upc
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE oi.id = $1
    `, [orderItemId]);

    if (itemResult.rows.length === 0) {
      return { error: true, message: 'Order item not found' };
    }

    const item = itemResult.rows[0];

    // Create suggestion
    const result = await pool.query(`
      INSERT INTO agent_suggestions
      (conversation_id, message_id, suggestion_type, order_id, order_item_id, product_id, action_data, reasoning, confidence_score)
      VALUES ($1, $2, 'adjust_quantity', $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      conversationId,
      messageId,
      item.order_id,
      orderItemId,
      item.product_id,
      JSON.stringify({
        from: fromQuantity,
        to: toQuantity,
        unit: 'units',
        unit_cost: item.unit_cost,
        cost_impact: (toQuantity - fromQuantity) * parseFloat(item.unit_cost)
      }),
      reasoning,
      confidence || 0.8
    ]);

    return {
      success: true,
      suggestion_id: result.rows[0].id,
      order_number: item.order_number,
      product_name: item.product_name,
      from_quantity: fromQuantity,
      to_quantity: toQuantity,
      cost_impact: ((toQuantity - fromQuantity) * parseFloat(item.unit_cost)).toFixed(2)
    };
  } catch (error) {
    console.error('suggest_quantity_adjustment error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 6: Suggest adding a product to an order
 * @param {Object} args - { conversationId, messageId, orderId, productId, quantity, unitCost, shipDate, reasoning, confidence }
 * @param {Object} context - { userId }
 * @returns {Object} Suggestion created
 */
async function suggest_add_product(args, context) {
  const { conversationId, messageId, orderId, productId, quantity, unitCost, shipDate, reasoning, confidence } = args;

  try {
    // Verify order and product exist
    const orderResult = await pool.query('SELECT order_number FROM orders WHERE id = $1', [orderId]);
    const productResult = await pool.query('SELECT name, sku FROM products WHERE id = $1', [productId]);

    if (orderResult.rows.length === 0) {
      return { error: true, message: 'Order not found' };
    }
    if (productResult.rows.length === 0) {
      return { error: true, message: 'Product not found' };
    }

    const order = orderResult.rows[0];
    const product = productResult.rows[0];

    // Create suggestion
    const result = await pool.query(`
      INSERT INTO agent_suggestions
      (conversation_id, message_id, suggestion_type, order_id, product_id, action_data, reasoning, confidence_score)
      VALUES ($1, $2, 'add_product', $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      conversationId,
      messageId,
      orderId,
      productId,
      JSON.stringify({
        product_id: productId,
        quantity,
        unit_cost: unitCost,
        ship_date: shipDate,
        cost_impact: quantity * unitCost
      }),
      reasoning,
      confidence || 0.8
    ]);

    return {
      success: true,
      suggestion_id: result.rows[0].id,
      order_number: order.order_number,
      product_name: product.name,
      quantity,
      cost_impact: (quantity * unitCost).toFixed(2)
    };
  } catch (error) {
    console.error('suggest_add_product error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 7: Suggest removing a product from an order
 * @param {Object} args - { conversationId, messageId, orderItemId, reasoning, confidence }
 * @param {Object} context - { userId }
 * @returns {Object} Suggestion created
 */
async function suggest_remove_product(args, context) {
  const { conversationId, messageId, orderItemId, reasoning, confidence } = args;

  try {
    // Get order item details
    const itemResult = await pool.query(`
      SELECT oi.*, o.id as order_id, o.order_number, p.name as product_name
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE oi.id = $1
    `, [orderItemId]);

    if (itemResult.rows.length === 0) {
      return { error: true, message: 'Order item not found' };
    }

    const item = itemResult.rows[0];

    // Create suggestion
    const result = await pool.query(`
      INSERT INTO agent_suggestions
      (conversation_id, message_id, suggestion_type, order_id, order_item_id, product_id, action_data, reasoning, confidence_score)
      VALUES ($1, $2, 'remove_product', $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      conversationId,
      messageId,
      item.order_id,
      orderItemId,
      item.product_id,
      JSON.stringify({
        product_id: item.product_id,
        current_quantity: item.quantity,
        unit_cost: item.unit_cost,
        cost_impact: -1 * item.quantity * parseFloat(item.unit_cost)
      }),
      reasoning,
      confidence || 0.8
    ]);

    return {
      success: true,
      suggestion_id: result.rows[0].id,
      order_number: item.order_number,
      product_name: item.product_name,
      removed_quantity: item.quantity,
      cost_impact: (-1 * item.quantity * parseFloat(item.unit_cost)).toFixed(2)
    };
  } catch (error) {
    console.error('suggest_remove_product error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 8: Get order budget information
 * @param {Object} args - { orderId?, seasonId?, brandId?, locationId? }
 * @param {Object} context - { userId }
 * @returns {Object} Budget information
 */
async function get_order_budget(args, context) {
  const { orderId, seasonId, brandId, locationId } = args;

  try {
    let query = `
      SELECT
        o.id as order_id,
        o.order_number,
        b.name as brand_name,
        l.name as location_name,
        s.name as season_name,
        sb.budget_amount,
        COALESCE(SUM(oi.quantity * oi.unit_cost), 0) as order_total
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN brands b ON o.brand_id = b.id
      LEFT JOIN locations l ON o.location_id = l.id
      LEFT JOIN seasons s ON o.season_id = s.id
      LEFT JOIN season_budgets sb ON sb.season_id = o.season_id AND sb.brand_id = o.brand_id AND sb.location_id = o.location_id
      WHERE o.status != 'cancelled'
    `;

    const params = [];
    let paramIndex = 1;

    if (orderId) {
      query += ` AND o.id = $${paramIndex}`;
      params.push(orderId);
      paramIndex++;
    }
    if (seasonId) {
      query += ` AND o.season_id = $${paramIndex}`;
      params.push(seasonId);
      paramIndex++;
    }
    if (brandId) {
      query += ` AND o.brand_id = $${paramIndex}`;
      params.push(brandId);
      paramIndex++;
    }
    if (locationId) {
      query += ` AND o.location_id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }

    query += ' GROUP BY o.id, o.order_number, b.name, l.name, s.name, sb.budget_amount';

    const result = await pool.query(query, params);

    const budgets = result.rows.map(row => {
      const budgetAmount = parseFloat(row.budget_amount || 0);
      const orderTotal = parseFloat(row.order_total || 0);
      const remaining = budgetAmount - orderTotal;
      const utilizationPct = budgetAmount > 0 ? (orderTotal / budgetAmount * 100).toFixed(1) : 0;

      return {
        order_id: row.order_id,
        order_number: row.order_number,
        brand_name: row.brand_name,
        location_name: row.location_name,
        season_name: row.season_name,
        budget_amount: budgetAmount.toFixed(2),
        order_total: orderTotal.toFixed(2),
        remaining_budget: remaining.toFixed(2),
        utilization_percent: utilizationPct
      };
    });

    return {
      success: true,
      budgets
    };
  } catch (error) {
    console.error('get_order_budget error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 9: Get product information
 * @param {Object} args - { productId?, upc?, sku?, name? }
 * @param {Object} context - { userId }
 * @returns {Object} Product details
 */
async function get_product_info(args, context) {
  const { productId, upc, sku, name } = args;

  try {
    let query = `
      SELECT
        p.id,
        p.name,
        p.sku,
        p.upc,
        p.base_name,
        p.size,
        p.color,
        p.category,
        p.subcategory,
        p.gender,
        p.wholesale_cost,
        p.msrp,
        p.case_qty,
        b.name as brand_name,
        s.name as season_name
      FROM products p
      JOIN brands b ON p.brand_id = b.id
      JOIN seasons s ON p.season_id = s.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (productId) {
      query += ` AND p.id = $${paramIndex}`;
      params.push(productId);
      paramIndex++;
    }
    if (upc) {
      query += ` AND p.upc = $${paramIndex}`;
      params.push(upc);
      paramIndex++;
    }
    if (sku) {
      query += ` AND p.sku ILIKE $${paramIndex}`;
      params.push(`%${sku}%`);
      paramIndex++;
    }
    if (name) {
      query += ` AND p.name ILIKE $${paramIndex}`;
      params.push(`%${name}%`);
      paramIndex++;
    }

    query += ' LIMIT 50';

    const result = await pool.query(query, params);

    return {
      success: true,
      products_found: result.rows.length,
      products: result.rows
    };
  } catch (error) {
    console.error('get_product_info error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 10: Get full order details
 * @param {Object} args - { orderId }
 * @param {Object} context - { userId }
 * @returns {Object} Complete order details with items
 */
async function get_order_details(args, context) {
  const { orderId } = args;

  if (!orderId) {
    return { error: true, message: 'orderId is required' };
  }

  try {
    // Get order header
    const orderResult = await pool.query(`
      SELECT
        o.*,
        b.name as brand_name,
        l.name as location_name,
        s.name as season_name,
        sb.budget_amount
      FROM orders o
      JOIN brands b ON o.brand_id = b.id
      JOIN locations l ON o.location_id = l.id
      JOIN seasons s ON o.season_id = s.id
      LEFT JOIN season_budgets sb ON sb.season_id = o.season_id AND sb.brand_id = o.brand_id AND sb.location_id = o.location_id
      WHERE o.id = $1
    `, [orderId]);

    if (orderResult.rows.length === 0) {
      return { error: true, message: 'Order not found' };
    }

    const order = orderResult.rows[0];

    // Get order items
    const itemsResult = await pool.query(`
      SELECT
        oi.*,
        p.name as product_name,
        p.sku,
        p.upc,
        p.size,
        p.color,
        p.base_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      ORDER BY oi.ship_date, p.base_name
    `, [orderId]);

    const items = itemsResult.rows.map(item => ({
      ...item,
      line_cost: (item.quantity * parseFloat(item.unit_cost)).toFixed(2)
    }));

    const totalCost = items.reduce((sum, i) => sum + parseFloat(i.line_cost), 0);
    const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);

    return {
      success: true,
      order: {
        ...order,
        items,
        total_cost: totalCost.toFixed(2),
        total_quantity: totalQuantity,
        budget_amount: order.budget_amount ? parseFloat(order.budget_amount).toFixed(2) : null,
        budget_remaining: order.budget_amount ? (parseFloat(order.budget_amount) - totalCost).toFixed(2) : null
      }
    };
  } catch (error) {
    console.error('get_order_details error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 11: Search for products
 * @param {Object} args - { query, brandId?, seasonId?, limit? }
 * @param {Object} context - { userId }
 * @returns {Object} Search results
 */
async function search_products(args, context) {
  const { query, brandId, seasonId, limit } = args;

  if (!query) {
    return { error: true, message: 'query is required' };
  }

  try {
    let sql = `
      SELECT
        p.id,
        p.name,
        p.sku,
        p.upc,
        p.base_name,
        p.size,
        p.color,
        p.category,
        p.wholesale_cost,
        p.msrp,
        b.name as brand_name,
        s.name as season_name
      FROM products p
      JOIN brands b ON p.brand_id = b.id
      JOIN seasons s ON p.season_id = s.id
      WHERE (
        p.name ILIKE $1 OR
        p.sku ILIKE $1 OR
        p.upc = $2 OR
        p.base_name ILIKE $1
      )
    `;

    const params = [`%${query}%`, query];
    let paramIndex = 3;

    if (brandId) {
      sql += ` AND p.brand_id = $${paramIndex}`;
      params.push(brandId);
      paramIndex++;
    }

    if (seasonId) {
      sql += ` AND p.season_id = $${paramIndex}`;
      params.push(seasonId);
      paramIndex++;
    }

    sql += ` LIMIT ${limit || 20}`;

    const result = await pool.query(sql, params);

    return {
      success: true,
      query,
      results_found: result.rows.length,
      products: result.rows
    };
  } catch (error) {
    console.error('search_products error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 12: Find and list orders with detailed filtering
 * @param {Object} args - { seasonId?, brandId?, locationId?, status?, shipDate?, orderNumber? }
 * @param {Object} context - { userId }
 * @returns {Object} List of matching orders with summary
 */
async function find_orders(args, context) {
  const { seasonId, brandId, locationId, status, shipDate, orderNumber } = args;

  try {
    let query = `
      SELECT
        o.id,
        o.order_number,
        o.status,
        o.ship_date,
        o.created_at,
        o.updated_at,
        b.name as brand_name,
        l.name as location_name,
        l.code as location_code,
        s.name as season_name,
        COUNT(DISTINCT oi.id) as item_count,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.quantity * oi.unit_cost) as total_cost
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      JOIN brands b ON o.brand_id = b.id
      JOIN locations l ON o.location_id = l.id
      JOIN seasons s ON o.season_id = s.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (seasonId) {
      query += ` AND o.season_id = $${paramIndex}`;
      params.push(seasonId);
      paramIndex++;
    }
    if (brandId) {
      query += ` AND o.brand_id = $${paramIndex}`;
      params.push(brandId);
      paramIndex++;
    }
    if (locationId) {
      query += ` AND o.location_id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }
    if (status) {
      query += ` AND o.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    if (orderNumber) {
      query += ` AND o.order_number ILIKE $${paramIndex}`;
      params.push(`%${orderNumber}%`);
      paramIndex++;
    }

    query += `
      GROUP BY o.id, o.order_number, o.status, o.ship_date, o.created_at, o.updated_at, b.name, l.name, l.code, s.name
      ORDER BY o.created_at DESC
      LIMIT 50
    `;

    const result = await pool.query(query, params);

    const orders = result.rows.map(row => ({
      order_id: row.id,
      order_number: row.order_number,
      brand: row.brand_name,
      location: `${row.location_name} (${row.location_code})`,
      season: row.season_name,
      status: row.status,
      ship_date: row.ship_date,
      item_count: parseInt(row.item_count || 0),
      total_quantity: parseInt(row.total_quantity || 0),
      total_cost: parseFloat(row.total_cost || 0).toFixed(2),
      created_at: row.created_at
    }));

    return {
      success: true,
      orders_found: orders.length,
      orders
    };
  } catch (error) {
    console.error('find_orders error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 13: Suggest bulk quantity changes for multiple items in an order
 * @param {Object} args - { conversationId, messageId, orderId, changeType, changeValue, reasoning, confidence, filters? }
 * @param {Object} context - { userId }
 * @returns {Object} Multiple suggestions created
 */
async function suggest_bulk_quantity_change(args, context) {
  // Use context values if not provided in args
  const conversationId = args.conversationId || context.conversationId;
  const messageId = args.messageId || context.messageId;
  const { orderId, changeType, changeValue, reasoning, confidence, filters } = args;

  // changeType: 'percentage' (e.g., +20%, -15%) or 'fixed' (e.g., +5, -3)
  // filters: optional { category?, subcategory?, minQuantity?, maxQuantity? }

  try {
    // Get order items
    let query = `
      SELECT oi.id, oi.quantity, oi.unit_cost, p.name, p.category, p.subcategory
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `;

    const params = [orderId];
    let paramIndex = 2;

    // Apply filters if provided
    if (filters?.category) {
      query += ` AND p.category = $${paramIndex}`;
      params.push(filters.category);
      paramIndex++;
    }
    if (filters?.subcategory) {
      query += ` AND p.subcategory = $${paramIndex}`;
      params.push(filters.subcategory);
      paramIndex++;
    }
    if (filters?.minQuantity) {
      query += ` AND oi.quantity >= $${paramIndex}`;
      params.push(filters.minQuantity);
      paramIndex++;
    }
    if (filters?.maxQuantity) {
      query += ` AND oi.quantity <= $${paramIndex}`;
      params.push(filters.maxQuantity);
      paramIndex++;
    }

    const itemsResult = await pool.query(query, params);

    if (itemsResult.rows.length === 0) {
      return { error: true, message: 'No items found matching criteria' };
    }

    const suggestions = [];
    let totalCostImpact = 0;

    for (const item of itemsResult.rows) {
      const currentQty = item.quantity;
      let newQty;

      if (changeType === 'percentage') {
        // changeValue is a percentage (e.g., 20 for +20%, -15 for -15%)
        newQty = Math.max(0, Math.round(currentQty * (1 + changeValue / 100)));
      } else if (changeType === 'fixed') {
        // changeValue is a fixed number (e.g., 5 for +5, -3 for -3)
        newQty = Math.max(0, currentQty + changeValue);
      } else {
        return { error: true, message: 'Invalid changeType. Must be "percentage" or "fixed"' };
      }

      // Skip if quantity doesn't change
      if (newQty === currentQty) continue;

      const costImpact = (newQty - currentQty) * parseFloat(item.unit_cost);
      totalCostImpact += costImpact;

      // Create suggestion
      const suggResult = await pool.query(
        `INSERT INTO agent_suggestions
         (conversation_id, message_id, suggestion_type, order_id, order_item_id, action_data, reasoning, confidence_score)
         VALUES ($1, $2, 'adjust_quantity', $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          conversationId,
          messageId,
          orderId,
          item.id,
          JSON.stringify({
            from: currentQty,
            to: newQty,
            unit: 'units',
            unit_cost: item.unit_cost,
            cost_impact: costImpact
          }),
          `${reasoning} (${item.name})`,
          confidence || 0.8
        ]
      );

      suggestions.push({
        suggestion_id: suggResult.rows[0].id,
        product_name: item.name,
        from_quantity: currentQty,
        to_quantity: newQty,
        cost_impact: costImpact.toFixed(2)
      });
    }

    return {
      success: true,
      suggestions_created: suggestions.length,
      total_cost_impact: totalCostImpact.toFixed(2),
      suggestions
    };
  } catch (error) {
    console.error('suggest_bulk_quantity_change error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 14: Get order summary across multiple orders
 * @param {Object} args - { seasonId?, brandId?, locationId?, status? }
 * @param {Object} context - { userId }
 * @returns {Object} Aggregated order statistics
 */
async function get_order_summary(args, context) {
  const { seasonId, brandId, locationId, status } = args;

  try {
    let query = `
      SELECT
        COUNT(DISTINCT o.id) as total_orders,
        COUNT(DISTINCT CASE WHEN o.status = 'draft' THEN o.id END) as draft_orders,
        COUNT(DISTINCT CASE WHEN o.status = 'submitted' THEN o.id END) as submitted_orders,
        COUNT(DISTINCT CASE WHEN o.status = 'approved' THEN o.id END) as approved_orders,
        COUNT(DISTINCT oi.id) as total_items,
        SUM(oi.quantity) as total_units,
        SUM(oi.quantity * oi.unit_cost) as total_value,
        AVG(oi.quantity * oi.unit_cost) as avg_item_value,
        COUNT(DISTINCT o.brand_id) as unique_brands,
        COUNT(DISTINCT o.location_id) as unique_locations
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status != 'cancelled'
    `;

    const params = [];
    let paramIndex = 1;

    if (seasonId) {
      query += ` AND o.season_id = $${paramIndex}`;
      params.push(seasonId);
      paramIndex++;
    }
    if (brandId) {
      query += ` AND o.brand_id = $${paramIndex}`;
      params.push(brandId);
      paramIndex++;
    }
    if (locationId) {
      query += ` AND o.location_id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }
    if (status) {
      query += ` AND o.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    const result = await pool.query(query, params);
    const summary = result.rows[0];

    return {
      success: true,
      summary: {
        total_orders: parseInt(summary.total_orders || 0),
        orders_by_status: {
          draft: parseInt(summary.draft_orders || 0),
          submitted: parseInt(summary.submitted_orders || 0),
          approved: parseInt(summary.approved_orders || 0)
        },
        total_items: parseInt(summary.total_items || 0),
        total_units: parseInt(summary.total_units || 0),
        total_value: parseFloat(summary.total_value || 0).toFixed(2),
        avg_item_value: parseFloat(summary.avg_item_value || 0).toFixed(2),
        unique_brands: parseInt(summary.unique_brands || 0),
        unique_locations: parseInt(summary.unique_locations || 0)
      }
    };
  } catch (error) {
    console.error('get_order_summary error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 15: Find orders by natural language (brand name, season name)
 * @param {Object} args - { brandName?, seasonName?, locationName?, status? }
 * @param {Object} context - { userId }
 * @returns {Object} List of matching orders
 */
async function find_orders_by_name(args, context) {
  const { brandName, seasonName, locationName, status } = args;

  try {
    // Build query with JOIN to allow name-based filtering
    let query = `
      SELECT
        o.id,
        o.order_number,
        o.status,
        o.ship_date,
        o.created_at,
        o.updated_at,
        b.name as brand_name,
        l.name as location_name,
        l.code as location_code,
        s.name as season_name,
        COUNT(DISTINCT oi.id) as item_count,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.quantity * oi.unit_cost) as total_cost
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      JOIN brands b ON o.brand_id = b.id
      JOIN locations l ON o.location_id = l.id
      JOIN seasons s ON o.season_id = s.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (brandName) {
      query += ` AND b.name ILIKE $${paramIndex}`;
      params.push(`%${brandName}%`);
      paramIndex++;
    }
    if (seasonName) {
      query += ` AND s.name ILIKE $${paramIndex}`;
      params.push(`%${seasonName}%`);
      paramIndex++;
    }
    if (locationName) {
      query += ` AND l.name ILIKE $${paramIndex}`;
      params.push(`%${locationName}%`);
      paramIndex++;
    }
    if (status) {
      query += ` AND o.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += `
      GROUP BY o.id, o.order_number, o.status, o.ship_date, o.created_at, o.updated_at, b.name, l.name, l.code, s.name
      ORDER BY o.created_at DESC
      LIMIT 50
    `;

    const result = await pool.query(query, params);

    const orders = result.rows.map(row => ({
      order_id: row.id,
      order_number: row.order_number,
      brand: row.brand_name,
      location: `${row.location_name} (${row.location_code})`,
      season: row.season_name,
      status: row.status,
      ship_date: row.ship_date,
      item_count: parseInt(row.item_count || 0),
      total_quantity: parseInt(row.total_quantity || 0),
      total_cost: parseFloat(row.total_cost || 0).toFixed(2),
      created_at: row.created_at
    }));

    return {
      success: true,
      orders_found: orders.length,
      filters_used: { brandName, seasonName, locationName, status },
      orders
    };
  } catch (error) {
    console.error('find_orders_by_name error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 16: Get brands list or search by name
 * @param {Object} args - { searchTerm? }
 * @param {Object} context - { userId }
 * @returns {Object} List of brands
 */
async function get_brands(args, context) {
  const { searchTerm } = args;

  try {
    let query = `
      SELECT id, name, code, vendor_code, active
      FROM brands
      WHERE active = true
    `;

    const params = [];
    if (searchTerm) {
      query += ` AND name ILIKE $1`;
      params.push(`%${searchTerm}%`);
    }

    query += ` ORDER BY name ASC`;

    const result = await pool.query(query, params);

    return {
      success: true,
      brands_found: result.rows.length,
      brands: result.rows.map(row => ({
        brand_id: row.id,
        name: row.name,
        code: row.code,
        vendor_code: row.vendor_code
      }))
    };
  } catch (error) {
    console.error('get_brands error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 16: Get seasons list or search by name
 * @param {Object} args - { searchTerm? }
 * @param {Object} context - { userId }
 * @returns {Object} List of seasons
 */
async function get_seasons(args, context) {
  const { searchTerm } = args;

  try {
    let query = `
      SELECT id, name, start_date, end_date, status
      FROM seasons
    `;

    const params = [];
    if (searchTerm) {
      query += ` WHERE name ILIKE $1`;
      params.push(`%${searchTerm}%`);
    }

    query += ` ORDER BY start_date DESC`;

    const result = await pool.query(query, params);

    return {
      success: true,
      seasons_found: result.rows.length,
      seasons: result.rows.map(row => ({
        season_id: row.id,
        name: row.name,
        start_date: row.start_date,
        end_date: row.end_date,
        status: row.status
      }))
    };
  } catch (error) {
    console.error('get_seasons error:', error);
    return { error: true, message: error.message };
  }
}

module.exports = {
  query_sales_data,
  get_order_inventory,
  analyze_velocity,
  get_stock_on_hand,
  suggest_quantity_adjustment,
  suggest_add_product,
  suggest_remove_product,
  get_order_budget,
  get_product_info,
  get_order_details,
  search_products,
  find_orders,
  suggest_bulk_quantity_change,
  get_order_summary,
  find_orders_by_name,
  get_brands,
  get_seasons
};
