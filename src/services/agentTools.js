const pool = require('../config/database');
const bigquery = require('./bigquery');

/**
 * Tool 1: Query historical sales data - tries BigQuery first, falls back to local PostgreSQL
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

    // Try BigQuery first
    let usedBigQuery = false;
    let rows = [];

    try {
      const facilityId = bigquery.LOCATION_TO_FACILITY[locationId];
      if (facilityId && bigquery.bigquery) {
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

        if (upcs && upcs.length > 0) {
          bqQuery += ` AND p.BARCODE IN UNNEST(@upcs)`;
          queryParams.upcs = upcs;
        }

        bqQuery += `
          GROUP BY p.BARCODE, p.DESCRIPTION, DATE(i.POSTDATE)
          ORDER BY sale_date DESC, qty_sold DESC
          LIMIT 10000
        `;

        const [bqRows] = await bigquery.bigquery.query({
          query: bqQuery,
          params: queryParams
        });
        rows = bqRows;
        usedBigQuery = true;
      }
    } catch (bqError) {
      console.log('BigQuery failed, falling back to local sales_data:', bqError.message);
    }

    // Fallback to local PostgreSQL sales_data table
    if (!usedBigQuery || rows.length === 0) {
      let localQuery = `
        SELECT
          p.upc,
          p.name as product_name,
          sd.start_date as sale_date,
          SUM(sd.quantity_sold) as qty_sold,
          SUM(sd.quantity_sold * COALESCE(p.wholesale_price, p.msrp * 0.5)) as revenue
        FROM sales_data sd
        JOIN products p ON sd.product_id = p.id
        WHERE sd.location_id = $1
          AND p.brand_id = $2
          AND sd.start_date >= $3::date
          AND sd.end_date <= $4::date
      `;
      const localParams = [locationId, brandId, startDate, endDate];

      if (upcs && upcs.length > 0) {
        localQuery += ` AND p.upc = ANY($5)`;
        localParams.push(upcs);
      }

      localQuery += `
        GROUP BY p.upc, p.name, sd.start_date
        ORDER BY sale_date DESC, qty_sold DESC
        LIMIT 500
      `;

      const localResult = await pool.query(localQuery, localParams);
      rows = localResult.rows;
    }

    // Calculate summary metrics
    const totalQty = rows.reduce((sum, r) => sum + parseInt(r.qty_sold || 0), 0);
    const totalRevenue = rows.reduce((sum, r) => sum + parseFloat(r.revenue || 0), 0);
    const uniqueProducts = new Set(rows.map(r => r.upc)).size;

    return {
      success: true,
      source: usedBigQuery ? 'bigquery' : 'local_cache',
      summary: {
        total_quantity_sold: totalQty,
        total_revenue: totalRevenue.toFixed(2),
        unique_products: uniqueProducts,
        records_count: rows.length,
        date_range: { start: startDate, end: endDate }
      },
      sales_data: rows.slice(0, 50)
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
 * @returns {Object} Order items with details including adjusted quantities
 */
async function get_order_inventory(args, context) {
  const { orderId, seasonId, brandId, locationId } = args;

  try {
    let query = `
      SELECT
        o.id as order_id,
        o.order_number,
        o.status as order_status,
        o.finalized_at,
        oi.id as item_id,
        oi.quantity as original_quantity,
        oi.adjusted_quantity,
        COALESCE(oi.adjusted_quantity, oi.quantity) as effective_quantity,
        oi.unit_cost,
        oi.ship_date,
        p.id as product_id,
        p.name as product_name,
        p.sku,
        p.upc,
        p.size,
        p.color,
        p.base_name,
        p.category,
        p.msrp,
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
          finalized_at: row.finalized_at,
          brand_name: row.brand_name,
          location_name: row.location_name,
          season_name: row.season_name,
          items: [],
          total_original_quantity: 0,
          total_effective_quantity: 0,
          total_original_cost: 0,
          total_effective_cost: 0
        };
      }

      if (row.item_id) {
        const originalQty = row.original_quantity || 0;
        const effectiveQty = row.effective_quantity || 0;
        const unitCost = parseFloat(row.unit_cost || 0);
        const originalCost = originalQty * unitCost;
        const effectiveCost = effectiveQty * unitCost;
        const isAdjusted = row.adjusted_quantity !== null && row.adjusted_quantity !== row.original_quantity;

        ordersMap[row.order_id].items.push({
          item_id: row.item_id,
          product_id: row.product_id,
          product_name: row.product_name,
          sku: row.sku,
          upc: row.upc,
          size: row.size,
          color: row.color,
          category: row.category,
          base_name: row.base_name,
          original_quantity: originalQty,
          adjusted_quantity: row.adjusted_quantity,
          effective_quantity: effectiveQty,
          is_adjusted: isAdjusted,
          unit_cost: row.unit_cost,
          msrp: row.msrp,
          original_cost: originalCost.toFixed(2),
          effective_cost: effectiveCost.toFixed(2),
          ship_date: row.ship_date
        });
        ordersMap[row.order_id].total_original_quantity += originalQty;
        ordersMap[row.order_id].total_effective_quantity += effectiveQty;
        ordersMap[row.order_id].total_original_cost += originalCost;
        ordersMap[row.order_id].total_effective_cost += effectiveCost;
      }
    }

    const orders = Object.values(ordersMap);

    return {
      success: true,
      orders_count: orders.length,
      orders: orders.map(o => ({
        ...o,
        total_original_cost: o.total_original_cost.toFixed(2),
        total_effective_cost: o.total_effective_cost.toFixed(2),
        adjustment_delta: (o.total_effective_cost - o.total_original_cost).toFixed(2),
        items_adjusted: o.items.filter(i => i.is_adjusted).length
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
 * @returns {Object} Complete order details with items including adjustments
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
        b.id as brand_id,
        l.name as location_name,
        l.id as location_id,
        s.name as season_name,
        s.id as season_id,
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

    // Get order items with adjustment info
    const itemsResult = await pool.query(`
      SELECT
        oi.id,
        oi.product_id,
        oi.quantity as original_quantity,
        oi.adjusted_quantity,
        COALESCE(oi.adjusted_quantity, oi.quantity) as effective_quantity,
        oi.unit_cost,
        oi.ship_date,
        p.name as product_name,
        p.sku,
        p.upc,
        p.size,
        p.color,
        p.base_name,
        p.category,
        p.subcategory,
        p.gender,
        p.msrp
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      ORDER BY oi.ship_date, p.base_name, p.size
    `, [orderId]);

    const items = itemsResult.rows.map(item => {
      const originalQty = item.original_quantity || 0;
      const effectiveQty = item.effective_quantity || 0;
      const unitCost = parseFloat(item.unit_cost || 0);
      const isAdjusted = item.adjusted_quantity !== null && item.adjusted_quantity !== item.original_quantity;

      return {
        item_id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        sku: item.sku,
        upc: item.upc,
        size: item.size,
        color: item.color,
        base_name: item.base_name,
        category: item.category,
        subcategory: item.subcategory,
        gender: item.gender,
        original_quantity: originalQty,
        adjusted_quantity: item.adjusted_quantity,
        effective_quantity: effectiveQty,
        is_adjusted: isAdjusted,
        quantity_change: isAdjusted ? effectiveQty - originalQty : 0,
        unit_cost: unitCost.toFixed(2),
        msrp: item.msrp ? parseFloat(item.msrp).toFixed(2) : null,
        original_cost: (originalQty * unitCost).toFixed(2),
        effective_cost: (effectiveQty * unitCost).toFixed(2),
        ship_date: item.ship_date
      };
    });

    const totalOriginalCost = items.reduce((sum, i) => sum + parseFloat(i.original_cost), 0);
    const totalEffectiveCost = items.reduce((sum, i) => sum + parseFloat(i.effective_cost), 0);
    const totalOriginalQty = items.reduce((sum, i) => sum + i.original_quantity, 0);
    const totalEffectiveQty = items.reduce((sum, i) => sum + i.effective_quantity, 0);
    const adjustedItemsCount = items.filter(i => i.is_adjusted).length;

    return {
      success: true,
      order: {
        order_id: order.id,
        order_number: order.order_number,
        status: order.status,
        brand_id: order.brand_id,
        brand_name: order.brand_name,
        location_id: order.location_id,
        location_name: order.location_name,
        season_id: order.season_id,
        season_name: order.season_name,
        ship_date: order.ship_date,
        finalized_at: order.finalized_at,
        created_at: order.created_at,
        updated_at: order.updated_at,
        items,
        summary: {
          total_items: items.length,
          adjusted_items: adjustedItemsCount,
          total_original_quantity: totalOriginalQty,
          total_effective_quantity: totalEffectiveQty,
          quantity_change: totalEffectiveQty - totalOriginalQty,
          total_original_cost: totalOriginalCost.toFixed(2),
          total_effective_cost: totalEffectiveCost.toFixed(2),
          cost_change: (totalEffectiveCost - totalOriginalCost).toFixed(2),
          budget_amount: order.budget_amount ? parseFloat(order.budget_amount).toFixed(2) : null,
          budget_remaining: order.budget_amount ? (parseFloat(order.budget_amount) - totalEffectiveCost).toFixed(2) : null,
          budget_utilization_pct: order.budget_amount ? ((totalEffectiveCost / parseFloat(order.budget_amount)) * 100).toFixed(1) : null
        }
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

/**
 * Tool 17: Get locations list or search by name
 * @param {Object} args - { searchTerm? }
 * @param {Object} context - { userId }
 * @returns {Object} List of locations
 */
async function get_locations(args, context) {
  const { searchTerm } = args;

  try {
    let query = `
      SELECT id, name, code, active
      FROM locations
      WHERE active = true
    `;

    const params = [];
    if (searchTerm) {
      query += ` AND (name ILIKE $1 OR code ILIKE $1)`;
      params.push(`%${searchTerm}%`);
    }

    query += ` ORDER BY name ASC`;

    const result = await pool.query(query, params);

    return {
      success: true,
      locations_found: result.rows.length,
      locations: result.rows.map(row => ({
        location_id: row.id,
        name: row.name,
        code: row.code
      }))
    };
  } catch (error) {
    console.error('get_locations error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 18: Get suggested items (products with low stock coverage that should be added to orders)
 * @param {Object} args - { seasonId, brandId, locationId, targetMonths? }
 * @param {Object} context - { userId }
 * @returns {Object} Products with low stock that need replenishment
 */
async function get_suggested_items(args, context) {
  const { seasonId, brandId, locationId, targetMonths = 3 } = args;

  if (!seasonId || !brandId || !locationId) {
    return { error: true, message: 'seasonId, brandId, and locationId are required' };
  }

  try {
    const target = parseInt(targetMonths);

    // Get products for this brand/season NOT currently in any order for this location
    const productsResult = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.base_name,
        p.sku,
        p.upc,
        p.size,
        p.color,
        p.category,
        p.gender,
        COALESCE(sp.wholesale_cost, p.wholesale_cost) as wholesale_cost,
        COALESCE(sp.msrp, p.msrp) as msrp
      FROM products p
      INNER JOIN season_prices sp ON sp.product_id = p.id AND sp.season_id = $2
      WHERE
        p.brand_id = $1
        AND p.active = true
        AND p.id NOT IN (
          SELECT DISTINCT oi.product_id
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE o.season_id = $2
            AND o.location_id = $3
            AND o.status != 'cancelled'
            AND COALESCE(oi.adjusted_quantity, oi.quantity) > 0
        )
        AND p.id NOT IN (
          SELECT product_id FROM ignored_products
          WHERE brand_id = $1
            AND (location_id = $3 OR location_id IS NULL)
        )
      ORDER BY p.base_name, p.size, p.color
    `, [brandId, seasonId, locationId]);

    const products = productsResult.rows;
    if (products.length === 0) {
      return { success: true, message: 'All products are already in orders or no products found', suggested_items: [], families: [] };
    }

    // Get UPCs for BigQuery lookup
    const upcs = products.filter(p => p.upc).map(p => p.upc);

    // Fetch stock and velocity data from BigQuery
    let stockByUpc = {};
    let velocityByUpc = {};

    if (upcs.length > 0) {
      const { LOCATION_TO_FACILITY, getStockByUPCs } = require('./bigquery');
      const facilityId = LOCATION_TO_FACILITY[locationId];

      if (facilityId) {
        // Get stock on hand
        try {
          stockByUpc = await getStockByUPCs(upcs, facilityId);
        } catch (e) {
          console.error('Error fetching stock:', e.message);
        }

        // Get velocity (average monthly sales)
        try {
          const { bigquery } = require('./bigquery');
          const upcList = upcs.map(u => `'${u}'`).join(',');

          const velocityQuery = `
            SELECT
              p.BARCODE as upc,
              SUM(ii.QUANTITY) as total_qty_sold,
              COUNT(DISTINCT FORMAT_DATE('%Y-%m', DATE(i.POSTDATE))) as months_of_data
            FROM \`front-data-production.rgp_cleaned_zone.invoice_items_all\` ii
            JOIN \`front-data-production.rgp_cleaned_zone.invoices_all\` i ON ii.invoice_concat = i.invoice_concat
            JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON ii.product_concat = p.product_concat
            WHERE DATE(i.POSTDATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
              AND p.BARCODE IN (${upcList})
              AND ii.QUANTITY > 0
              AND p.facility_id_true = '${facilityId}'
            GROUP BY p.BARCODE
          `;

          const [rows] = await bigquery.query({ query: velocityQuery });
          rows.forEach(row => {
            const monthsOfData = Math.max(1, parseInt(row.months_of_data) || 1);
            const totalSold = parseInt(row.total_qty_sold) || 0;
            velocityByUpc[row.upc] = totalSold / monthsOfData;
          });
        } catch (e) {
          console.error('Error fetching velocity:', e.message);
        }
      }
    }

    // Calculate suggested items (where months_supply < 1)
    const suggestedItems = [];
    products.forEach(product => {
      if (!product.upc) return;

      const stock = stockByUpc[product.upc] ?? 0;
      const velocity = velocityByUpc[product.upc] ?? 0;

      // Skip if no sales history
      if (velocity <= 0) return;

      const monthsSupply = stock / velocity;

      // Suggest if less than 1 month of supply
      if (monthsSupply < 1) {
        const targetStock = velocity * target;
        const suggestedQty = Math.max(1, Math.round(targetStock - stock));

        suggestedItems.push({
          product_id: product.id,
          product_name: product.name,
          base_name: product.base_name,
          sku: product.sku,
          upc: product.upc,
          size: product.size,
          color: product.color,
          category: product.category,
          wholesale_cost: parseFloat(product.wholesale_cost).toFixed(2),
          stock_on_hand: stock,
          avg_monthly_sales: Math.round(velocity * 10) / 10,
          months_supply: Math.round(monthsSupply * 10) / 10,
          suggested_qty: suggestedQty,
          suggested_cost: (suggestedQty * parseFloat(product.wholesale_cost)).toFixed(2)
        });
      }
    });

    // Group by base_name for family view
    const familyMap = {};
    suggestedItems.forEach(item => {
      const baseName = item.base_name || item.product_name;
      if (!familyMap[baseName]) {
        familyMap[baseName] = { base_name: baseName, products: [], total_suggested_qty: 0, total_suggested_cost: 0 };
      }
      familyMap[baseName].products.push(item);
      familyMap[baseName].total_suggested_qty += item.suggested_qty;
      familyMap[baseName].total_suggested_cost += parseFloat(item.suggested_cost);
    });

    const families = Object.values(familyMap).map(f => ({
      ...f,
      total_suggested_cost: f.total_suggested_cost.toFixed(2)
    })).sort((a, b) => a.base_name.localeCompare(b.base_name));

    return {
      success: true,
      suggested_items: suggestedItems,
      families,
      summary: {
        total_products: suggestedItems.length,
        total_families: families.length,
        total_suggested_units: suggestedItems.reduce((sum, i) => sum + i.suggested_qty, 0),
        total_suggested_value: suggestedItems.reduce((sum, i) => sum + parseFloat(i.suggested_cost), 0).toFixed(2)
      }
    };
  } catch (error) {
    console.error('get_suggested_items error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 19: Get finalized order history
 * @param {Object} args - { seasonId?, brandId?, locationId?, orderId? }
 * @param {Object} context - { userId }
 * @returns {Object} Finalized adjustments history
 */
async function get_finalized_history(args, context) {
  const { seasonId, brandId, locationId, orderId } = args;

  try {
    let query = `
      SELECT
        fa.id,
        fa.order_id,
        fa.order_item_id,
        fa.product_id,
        fa.original_quantity,
        fa.adjusted_quantity,
        fa.unit_cost,
        fa.finalized_at,
        fa.finalized_by,
        o.order_number,
        p.name as product_name,
        p.sku,
        p.upc,
        p.base_name,
        b.name as brand_name,
        l.name as location_name,
        s.name as season_name,
        u.username as finalized_by_name
      FROM finalized_adjustments fa
      JOIN orders o ON fa.order_id = o.id
      JOIN products p ON fa.product_id = p.id
      JOIN brands b ON fa.brand_id = b.id
      JOIN locations l ON fa.location_id = l.id
      JOIN seasons s ON fa.season_id = s.id
      LEFT JOIN users u ON fa.finalized_by = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (orderId) {
      query += ` AND fa.order_id = $${paramIndex}`;
      params.push(orderId);
      paramIndex++;
    }
    if (seasonId) {
      query += ` AND fa.season_id = $${paramIndex}`;
      params.push(seasonId);
      paramIndex++;
    }
    if (brandId) {
      query += ` AND fa.brand_id = $${paramIndex}`;
      params.push(brandId);
      paramIndex++;
    }
    if (locationId) {
      query += ` AND fa.location_id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }

    query += ` ORDER BY fa.finalized_at DESC LIMIT 500`;

    const result = await pool.query(query, params);

    // Calculate summary
    const totalOriginal = result.rows.reduce((sum, r) => sum + (r.original_quantity * parseFloat(r.unit_cost)), 0);
    const totalAdjusted = result.rows.reduce((sum, r) => sum + (r.adjusted_quantity * parseFloat(r.unit_cost)), 0);
    const increasedItems = result.rows.filter(r => r.adjusted_quantity > r.original_quantity).length;
    const decreasedItems = result.rows.filter(r => r.adjusted_quantity < r.original_quantity).length;
    const unchangedItems = result.rows.filter(r => r.adjusted_quantity === r.original_quantity).length;

    return {
      success: true,
      finalized_count: result.rows.length,
      summary: {
        total_original_value: totalOriginal.toFixed(2),
        total_adjusted_value: totalAdjusted.toFixed(2),
        net_change: (totalAdjusted - totalOriginal).toFixed(2),
        items_increased: increasedItems,
        items_decreased: decreasedItems,
        items_unchanged: unchangedItems
      },
      finalized_items: result.rows.map(row => ({
        ...row,
        quantity_change: row.adjusted_quantity - row.original_quantity,
        cost_change: ((row.adjusted_quantity - row.original_quantity) * parseFloat(row.unit_cost)).toFixed(2)
      }))
    };
  } catch (error) {
    console.error('get_finalized_history error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 20: Compare current orders to last year's sales
 * @param {Object} args - { brandId, locationId, currentSeasonId, comparisonMonths? }
 * @param {Object} context - { userId }
 * @returns {Object} Year-over-year comparison data
 */
async function compare_to_last_year(args, context) {
  const { brandId, locationId, currentSeasonId, comparisonMonths = 12 } = args;

  if (!brandId || !locationId) {
    return { error: true, message: 'brandId and locationId are required' };
  }

  try {
    // Get current order data
    const orderResult = await pool.query(`
      SELECT
        p.upc,
        p.name as product_name,
        p.base_name,
        p.category,
        SUM(COALESCE(oi.adjusted_quantity, oi.quantity)) as ordered_qty,
        SUM(COALESCE(oi.adjusted_quantity, oi.quantity) * oi.unit_cost) as ordered_value
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE o.brand_id = $1
        AND o.location_id = $2
        ${currentSeasonId ? 'AND o.season_id = $3' : ''}
        AND o.status != 'cancelled'
        AND p.upc IS NOT NULL
      GROUP BY p.upc, p.name, p.base_name, p.category
    `, currentSeasonId ? [brandId, locationId, currentSeasonId] : [brandId, locationId]);

    if (orderResult.rows.length === 0) {
      return { success: true, message: 'No current orders found', comparison: [] };
    }

    const upcs = orderResult.rows.map(r => r.upc).filter(u => u);
    if (upcs.length === 0) {
      return { success: true, message: 'No UPCs found in orders', comparison: [] };
    }

    // Get last year's sales from BigQuery
    const { LOCATION_TO_FACILITY, bigquery } = require('./bigquery');
    const facilityId = LOCATION_TO_FACILITY[locationId];

    if (!facilityId) {
      return { error: true, message: 'Location not mapped to BigQuery facility' };
    }

    const upcList = upcs.map(u => `'${u}'`).join(',');
    const salesQuery = `
      SELECT
        p.BARCODE as upc,
        SUM(ii.QUANTITY) as qty_sold,
        SUM(ii.QUANTITY * ii.PRICE) as revenue
      FROM \`front-data-production.rgp_cleaned_zone.invoice_items_all\` ii
      JOIN \`front-data-production.rgp_cleaned_zone.invoices_all\` i ON ii.invoice_concat = i.invoice_concat
      JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON ii.product_concat = p.product_concat
      WHERE DATE(i.POSTDATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${comparisonMonths} MONTH)
        AND p.BARCODE IN (${upcList})
        AND ii.QUANTITY > 0
        AND p.facility_id_true = '${facilityId}'
      GROUP BY p.BARCODE
    `;

    const [salesRows] = await bigquery.query({ query: salesQuery });
    const salesByUpc = {};
    salesRows.forEach(row => {
      salesByUpc[row.upc] = {
        qty_sold: parseInt(row.qty_sold) || 0,
        revenue: parseFloat(row.revenue) || 0
      };
    });

    // Build comparison
    const comparison = orderResult.rows.map(order => {
      const sales = salesByUpc[order.upc] || { qty_sold: 0, revenue: 0 };
      const orderedQty = parseInt(order.ordered_qty) || 0;
      const soldQty = sales.qty_sold;

      const orderVsSales = soldQty > 0 ? ((orderedQty / soldQty) * 100).toFixed(0) : 'N/A';
      const trend = soldQty === 0 ? 'no_history' :
                    orderedQty > soldQty * 1.2 ? 'ordering_more' :
                    orderedQty < soldQty * 0.8 ? 'ordering_less' : 'similar';

      return {
        upc: order.upc,
        product_name: order.product_name,
        base_name: order.base_name,
        category: order.category,
        ordered_qty: orderedQty,
        ordered_value: parseFloat(order.ordered_value).toFixed(2),
        last_year_qty_sold: soldQty,
        last_year_revenue: sales.revenue.toFixed(2),
        order_vs_sales_pct: orderVsSales,
        trend
      };
    });

    // Summary
    const totalOrdered = comparison.reduce((sum, c) => sum + c.ordered_qty, 0);
    const totalSold = comparison.reduce((sum, c) => sum + c.last_year_qty_sold, 0);
    const orderingMore = comparison.filter(c => c.trend === 'ordering_more').length;
    const orderingLess = comparison.filter(c => c.trend === 'ordering_less').length;
    const noHistory = comparison.filter(c => c.trend === 'no_history').length;

    return {
      success: true,
      comparison_period_months: comparisonMonths,
      summary: {
        total_products: comparison.length,
        total_ordered_qty: totalOrdered,
        total_last_year_sold: totalSold,
        overall_order_vs_sales_pct: totalSold > 0 ? ((totalOrdered / totalSold) * 100).toFixed(0) : 'N/A',
        products_ordering_more: orderingMore,
        products_ordering_less: orderingLess,
        products_no_history: noHistory
      },
      comparison: comparison.sort((a, b) => b.ordered_qty - a.ordered_qty).slice(0, 100)
    };
  } catch (error) {
    console.error('compare_to_last_year error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 21: Analyze orders by category/family
 * @param {Object} args - { seasonId?, brandId?, locationId?, groupBy? }
 * @param {Object} context - { userId }
 * @returns {Object} Category/family level analysis
 */
async function analyze_by_category(args, context) {
  const { seasonId, brandId, locationId, groupBy = 'category' } = args;

  // groupBy can be: 'category', 'subcategory', 'base_name' (family), 'gender'

  try {
    const groupColumn = groupBy === 'base_name' ? 'p.base_name' :
                        groupBy === 'subcategory' ? 'p.subcategory' :
                        groupBy === 'gender' ? 'p.gender' : 'p.category';

    let query = `
      SELECT
        ${groupColumn} as group_name,
        COUNT(DISTINCT oi.id) as item_count,
        COUNT(DISTINCT p.id) as unique_products,
        SUM(oi.quantity) as original_qty,
        SUM(COALESCE(oi.adjusted_quantity, oi.quantity)) as effective_qty,
        SUM(oi.quantity * oi.unit_cost) as original_value,
        SUM(COALESCE(oi.adjusted_quantity, oi.quantity) * oi.unit_cost) as effective_value,
        COUNT(CASE WHEN oi.adjusted_quantity IS NOT NULL AND oi.adjusted_quantity != oi.quantity THEN 1 END) as adjusted_items
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
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

    query += `
      GROUP BY ${groupColumn}
      HAVING ${groupColumn} IS NOT NULL
      ORDER BY SUM(COALESCE(oi.adjusted_quantity, oi.quantity) * oi.unit_cost) DESC
    `;

    const result = await pool.query(query, params);

    const totalOriginalValue = result.rows.reduce((sum, r) => sum + parseFloat(r.original_value || 0), 0);
    const totalEffectiveValue = result.rows.reduce((sum, r) => sum + parseFloat(r.effective_value || 0), 0);

    const categories = result.rows.map(row => {
      const originalValue = parseFloat(row.original_value || 0);
      const effectiveValue = parseFloat(row.effective_value || 0);

      return {
        group_name: row.group_name,
        item_count: parseInt(row.item_count),
        unique_products: parseInt(row.unique_products),
        original_qty: parseInt(row.original_qty || 0),
        effective_qty: parseInt(row.effective_qty || 0),
        qty_change: parseInt(row.effective_qty || 0) - parseInt(row.original_qty || 0),
        original_value: originalValue.toFixed(2),
        effective_value: effectiveValue.toFixed(2),
        value_change: (effectiveValue - originalValue).toFixed(2),
        adjusted_items: parseInt(row.adjusted_items || 0),
        pct_of_total: totalEffectiveValue > 0 ? ((effectiveValue / totalEffectiveValue) * 100).toFixed(1) : '0'
      };
    });

    return {
      success: true,
      group_by: groupBy,
      summary: {
        total_groups: categories.length,
        total_original_value: totalOriginalValue.toFixed(2),
        total_effective_value: totalEffectiveValue.toFixed(2),
        total_value_change: (totalEffectiveValue - totalOriginalValue).toFixed(2)
      },
      categories
    };
  } catch (error) {
    console.error('analyze_by_category error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 22: Get comprehensive inventory status for a brand/location
 * Shows stock on hand, order quantities, velocity, and coverage analysis
 * @param {Object} args - { brandId, locationId, seasonId?, includeZeroStock? }
 * @param {Object} context - { userId }
 * @returns {Object} Complete inventory status with stock, orders, and analysis
 */
async function get_inventory_status(args, context) {
  const { brandId, locationId, seasonId, includeZeroStock = false } = args;

  if (!brandId || !locationId) {
    return { error: true, message: 'brandId and locationId are required' };
  }

  try {
    // Get brand info
    const brandResult = await pool.query('SELECT name, code FROM brands WHERE id = $1', [brandId]);
    if (brandResult.rows.length === 0) {
      return { error: true, message: 'Brand not found' };
    }
    const brandName = brandResult.rows[0].name;

    // Get location info
    const locationResult = await pool.query('SELECT name, code FROM locations WHERE id = $1', [locationId]);
    if (locationResult.rows.length === 0) {
      return { error: true, message: 'Location not found' };
    }
    const locationName = locationResult.rows[0].name;

    const { LOCATION_TO_FACILITY, bigquery } = require('./bigquery');
    const facilityId = LOCATION_TO_FACILITY[locationId];

    if (!facilityId) {
      return { error: true, message: 'Location not mapped to BigQuery facility' };
    }

    // Query BigQuery for ALL inventory for this brand at this location
    // Join with sales data to get velocity
    const inventoryQuery = `
      WITH inventory AS (
        SELECT
          i.barcode as upc,
          i.product_description as product_name,
          i.on_hand_qty as stock_on_hand,
          i.facility_id
        FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
        JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON i.barcode = p.BARCODE
        LEFT JOIN \`front-data-production.rgp_cleaned_zone.vendors_all\` v ON p.vendor_concat = v.vendor_concat
        WHERE i.facility_id = '${facilityId}'
          AND LOWER(v.VENDOR_NAME) LIKE '%${brandName.toLowerCase()}%'
          ${includeZeroStock ? '' : 'AND i.on_hand_qty > 0'}
      ),
      sales AS (
        SELECT
          p.BARCODE as upc,
          SUM(ii.QUANTITY) as total_sold_12m,
          COUNT(DISTINCT FORMAT_DATE('%Y-%m', DATE(i.POSTDATE))) as months_with_sales
        FROM \`front-data-production.rgp_cleaned_zone.invoice_items_all\` ii
        JOIN \`front-data-production.rgp_cleaned_zone.invoices_all\` i ON ii.invoice_concat = i.invoice_concat
        JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON ii.product_concat = p.product_concat
        WHERE DATE(i.POSTDATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
          AND p.facility_id_true = '${facilityId}'
          AND ii.QUANTITY > 0
        GROUP BY p.BARCODE
      )
      SELECT
        inv.upc,
        inv.product_name,
        inv.stock_on_hand,
        COALESCE(s.total_sold_12m, 0) as total_sold_12m,
        COALESCE(s.months_with_sales, 0) as months_with_sales,
        CASE
          WHEN COALESCE(s.months_with_sales, 0) > 0
          THEN ROUND(COALESCE(s.total_sold_12m, 0) / GREATEST(s.months_with_sales, 1), 2)
          ELSE 0
        END as avg_monthly_sales
      FROM inventory inv
      LEFT JOIN sales s ON inv.upc = s.upc
      ORDER BY inv.stock_on_hand DESC
    `;

    const [inventoryRows] = await bigquery.query({ query: inventoryQuery });

    if (inventoryRows.length === 0) {
      return {
        success: true,
        message: `No inventory found for ${brandName} at ${locationName}`,
        inventory: [],
        summary: { total_items: 0 }
      };
    }

    // Get UPCs for database lookup
    const upcs = inventoryRows.map(r => r.upc);

    // Get order quantities from database for these UPCs
    let orderQuery = `
      SELECT
        p.upc,
        SUM(oi.quantity) as original_order_qty,
        SUM(COALESCE(oi.adjusted_quantity, oi.quantity)) as effective_order_qty,
        SUM(oi.quantity * oi.unit_cost) as original_order_value,
        SUM(COALESCE(oi.adjusted_quantity, oi.quantity) * oi.unit_cost) as effective_order_value
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE o.brand_id = $1
        AND o.location_id = $2
        AND o.status != 'cancelled'
        AND p.upc = ANY($3)
    `;
    const orderParams = [brandId, locationId, upcs];

    if (seasonId) {
      orderQuery += ` AND o.season_id = $4`;
      orderParams.push(seasonId);
    }

    orderQuery += ` GROUP BY p.upc`;

    const orderResult = await pool.query(orderQuery, orderParams);
    const ordersByUpc = {};
    orderResult.rows.forEach(row => {
      ordersByUpc[row.upc] = {
        original_order_qty: parseInt(row.original_order_qty) || 0,
        effective_order_qty: parseInt(row.effective_order_qty) || 0,
        original_order_value: parseFloat(row.original_order_value) || 0,
        effective_order_value: parseFloat(row.effective_order_value) || 0
      };
    });

    // Build combined inventory status
    const inventory = inventoryRows.map(row => {
      const stock = parseInt(row.stock_on_hand) || 0;
      const avgMonthlySales = parseFloat(row.avg_monthly_sales) || 0;
      const orders = ordersByUpc[row.upc] || { original_order_qty: 0, effective_order_qty: 0 };

      // Calculate months of coverage (stock / velocity)
      const monthsCoverage = avgMonthlySales > 0 ? stock / avgMonthlySales : (stock > 0 ? 999 : 0);

      // Determine status
      let status;
      if (avgMonthlySales === 0 && stock > 0) {
        status = 'no_velocity';  // Has stock but no recent sales
      } else if (monthsCoverage < 1) {
        status = 'critical';  // Less than 1 month coverage
      } else if (monthsCoverage < 2) {
        status = 'low';  // 1-2 months coverage
      } else if (monthsCoverage > 6) {
        status = 'overstocked';  // More than 6 months coverage
      } else {
        status = 'healthy';  // 2-6 months coverage
      }

      return {
        upc: row.upc,
        product_name: row.product_name,
        stock_on_hand: stock,
        avg_monthly_sales: avgMonthlySales,
        total_sold_12m: parseInt(row.total_sold_12m) || 0,
        months_coverage: monthsCoverage > 100 ? '99+' : monthsCoverage.toFixed(1),
        status,
        original_order_qty: orders.original_order_qty,
        effective_order_qty: orders.effective_order_qty,
        order_adjusted: orders.effective_order_qty !== orders.original_order_qty,
        total_available: stock + orders.effective_order_qty  // Stock + incoming order
      };
    });

    // Calculate summary
    const totalStock = inventory.reduce((sum, i) => sum + i.stock_on_hand, 0);
    const totalOrderQty = inventory.reduce((sum, i) => sum + i.effective_order_qty, 0);
    const criticalCount = inventory.filter(i => i.status === 'critical').length;
    const lowCount = inventory.filter(i => i.status === 'low').length;
    const healthyCount = inventory.filter(i => i.status === 'healthy').length;
    const overstockedCount = inventory.filter(i => i.status === 'overstocked').length;
    const noVelocityCount = inventory.filter(i => i.status === 'no_velocity').length;

    return {
      success: true,
      brand: brandName,
      location: locationName,
      season_filter: seasonId ? 'applied' : 'all seasons',
      summary: {
        total_skus: inventory.length,
        total_stock_on_hand: totalStock,
        total_on_order: totalOrderQty,
        status_breakdown: {
          critical: criticalCount,
          low: lowCount,
          healthy: healthyCount,
          overstocked: overstockedCount,
          no_velocity: noVelocityCount
        }
      },
      inventory: inventory.slice(0, 200),  // Limit to 200 items
      alerts: {
        critical_items: inventory.filter(i => i.status === 'critical').slice(0, 20),
        overstocked_items: inventory.filter(i => i.status === 'overstocked').slice(0, 20)
      }
    };
  } catch (error) {
    console.error('get_inventory_status error:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Tool 23: Analyze seasonality patterns in sales data
 * Shows monthly sales patterns to identify peak/low seasons
 * @param {Object} args - { brandId, locationId?, category?, months? }
 * @param {Object} context - { userId }
 * @returns {Object} Monthly sales patterns with seasonality analysis
 */
async function analyze_seasonality(args, context) {
  const { brandId, locationId, category, months = 24 } = args;

  if (!brandId) {
    return { error: true, message: 'brandId is required' };
  }

  try {
    // Get brand name for BigQuery query
    const brandResult = await pool.query('SELECT name FROM brands WHERE id = $1', [brandId]);
    if (brandResult.rows.length === 0) {
      return { error: true, message: 'Brand not found' };
    }
    const brandName = brandResult.rows[0].name;

    const { LOCATION_TO_FACILITY, bigquery } = require('./bigquery');

    // Build facility filter if location specified
    let facilityFilter = '';
    if (locationId) {
      const facilityId = LOCATION_TO_FACILITY[locationId];
      if (facilityId) {
        facilityFilter = `AND p.facility_id_true = '${facilityId}'`;
      }
    }

    // Build category filter if specified
    let categoryFilter = '';
    if (category) {
      categoryFilter = `AND LOWER(p.DISP_CATEGORY) LIKE '%${category.toLowerCase()}%'`;
    }

    // Query monthly sales patterns
    const query = `
      WITH monthly_sales AS (
        SELECT
          FORMAT_DATE('%Y-%m', DATE(i.POSTDATE)) as year_month,
          EXTRACT(MONTH FROM DATE(i.POSTDATE)) as month_num,
          FORMAT_DATE('%B', DATE(i.POSTDATE)) as month_name,
          EXTRACT(YEAR FROM DATE(i.POSTDATE)) as year,
          SUM(ii.QUANTITY) as units_sold,
          SUM(ii.QUANTITY * ii.PRICE) as revenue,
          COUNT(DISTINCT i.INVOICE_ID) as transactions,
          COUNT(DISTINCT p.BARCODE) as unique_products
        FROM \`front-data-production.rgp_cleaned_zone.invoice_items_all\` ii
        JOIN \`front-data-production.rgp_cleaned_zone.invoices_all\` i ON ii.invoice_concat = i.invoice_concat
        JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON ii.product_concat = p.product_concat
        LEFT JOIN \`front-data-production.rgp_cleaned_zone.vendors_all\` v ON p.vendor_concat = v.vendor_concat
        WHERE DATE(i.POSTDATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${months} MONTH)
          AND LOWER(v.VENDOR_NAME) LIKE '%${brandName.toLowerCase()}%'
          AND ii.QUANTITY > 0
          AND p.BARCODE IS NOT NULL
          ${facilityFilter}
          ${categoryFilter}
        GROUP BY year_month, month_num, month_name, year
        ORDER BY year_month
      ),
      monthly_averages AS (
        SELECT
          month_num,
          month_name,
          AVG(units_sold) as avg_units,
          AVG(revenue) as avg_revenue,
          COUNT(*) as data_points
        FROM monthly_sales
        GROUP BY month_num, month_name
      )
      SELECT
        ms.*,
        ma.avg_units as month_avg_units,
        ma.avg_revenue as month_avg_revenue,
        ROUND(SAFE_DIVIDE(ms.units_sold, ma.avg_units) * 100, 1) as vs_month_avg_pct
      FROM monthly_sales ms
      JOIN monthly_averages ma ON ms.month_num = ma.month_num
      ORDER BY ms.year_month
    `;

    const [rows] = await bigquery.query({ query });

    if (rows.length === 0) {
      return { success: true, message: 'No sales data found for this brand', monthly_data: [] };
    }

    // Calculate overall average
    const totalUnits = rows.reduce((sum, r) => sum + parseInt(r.units_sold), 0);
    const totalRevenue = rows.reduce((sum, r) => sum + parseFloat(r.revenue), 0);
    const overallAvgUnits = totalUnits / rows.length;
    const overallAvgRevenue = totalRevenue / rows.length;

    // Build monthly patterns (aggregate by month across years)
    const monthlyPatterns = {};
    rows.forEach(row => {
      const monthNum = parseInt(row.month_num);
      if (!monthlyPatterns[monthNum]) {
        monthlyPatterns[monthNum] = {
          month_num: monthNum,
          month_name: row.month_name,
          total_units: 0,
          total_revenue: 0,
          data_points: 0
        };
      }
      monthlyPatterns[monthNum].total_units += parseInt(row.units_sold);
      monthlyPatterns[monthNum].total_revenue += parseFloat(row.revenue);
      monthlyPatterns[monthNum].data_points += 1;
    });

    // Calculate seasonality index for each month
    const patterns = Object.values(monthlyPatterns).map(m => {
      const avgUnits = m.total_units / m.data_points;
      const avgRevenue = m.total_revenue / m.data_points;
      const seasonalityIndex = overallAvgUnits > 0 ? (avgUnits / overallAvgUnits) : 1;

      let season;
      if (seasonalityIndex >= 1.3) season = 'peak';
      else if (seasonalityIndex >= 1.1) season = 'high';
      else if (seasonalityIndex <= 0.7) season = 'low';
      else if (seasonalityIndex <= 0.9) season = 'slow';
      else season = 'normal';

      return {
        month_num: m.month_num,
        month_name: m.month_name,
        avg_units: Math.round(avgUnits),
        avg_revenue: Math.round(avgRevenue),
        seasonality_index: seasonalityIndex.toFixed(2),
        season,
        recommendation: seasonalityIndex >= 1.2
          ? `Order ${Math.round((seasonalityIndex - 1) * 100)}% more for this month`
          : seasonalityIndex <= 0.8
          ? `Order ${Math.round((1 - seasonalityIndex) * 100)}% less for this month`
          : 'Normal ordering'
      };
    }).sort((a, b) => a.month_num - b.month_num);

    // Identify peak and low months
    const peakMonths = patterns.filter(p => p.season === 'peak').map(p => p.month_name);
    const lowMonths = patterns.filter(p => p.season === 'low').map(p => p.month_name);

    // Format monthly data with trend
    const monthlyData = rows.map(row => ({
      year_month: row.year_month,
      month_name: row.month_name,
      year: parseInt(row.year),
      units_sold: parseInt(row.units_sold),
      revenue: parseFloat(row.revenue).toFixed(2),
      transactions: parseInt(row.transactions),
      unique_products: parseInt(row.unique_products),
      vs_month_avg_pct: row.vs_month_avg_pct ? `${row.vs_month_avg_pct}%` : 'N/A'
    }));

    return {
      success: true,
      brand: brandName,
      location: locationId ? 'filtered' : 'all locations',
      category: category || 'all categories',
      analysis_period_months: months,
      summary: {
        total_months_analyzed: rows.length,
        overall_avg_monthly_units: Math.round(overallAvgUnits),
        overall_avg_monthly_revenue: Math.round(overallAvgRevenue),
        peak_months: peakMonths.length > 0 ? peakMonths : ['None identified'],
        low_months: lowMonths.length > 0 ? lowMonths : ['None identified'],
        seasonality_range: {
          highest: patterns.reduce((max, p) => parseFloat(p.seasonality_index) > parseFloat(max.seasonality_index) ? p : max).month_name,
          lowest: patterns.reduce((min, p) => parseFloat(p.seasonality_index) < parseFloat(min.seasonality_index) ? p : min).month_name
        }
      },
      monthly_patterns: patterns,
      monthly_data: monthlyData,
      lead_time_note: 'Assuming 1 month lead time - order 1 month before peak demand periods'
    };
  } catch (error) {
    console.error('analyze_seasonality error:', error);
    return { error: true, message: error.message };
  }
}

// Update get_inventory_status to factor in 1-month lead time
// (The existing function already calculates months_coverage, which implicitly
// handles this - items with <1 month coverage are flagged as critical,
// meaning you need to order NOW given 1-month lead time)

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
  get_seasons,
  get_locations,
  get_suggested_items,
  get_finalized_history,
  compare_to_last_year,
  analyze_by_category,
  get_inventory_status,
  analyze_seasonality
};
