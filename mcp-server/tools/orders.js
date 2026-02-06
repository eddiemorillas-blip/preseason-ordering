const { pool } = require('../db.js');

/**
 * Format a number as currency
 */
function formatCurrency(num) {
  if (num === null || num === undefined) return 'N/A';
  return '$' + parseFloat(num).toFixed(2);
}

/**
 * Format a number with commas and decimals
 */
function formatNumber(num, decimals = 1) {
  if (num === null || num === undefined) return 'N/A';
  return parseFloat(num).toFixed(decimals);
}

/**
 * list_orders: Find orders by season/brand/location
 */
async function listOrders(args) {
  try {
    const { seasonId, brandId, locationId, status } = args;

    let query = `
      SELECT
        o.id,
        o.order_number,
        s.name AS season,
        b.name AS brand,
        l.name AS location,
        o.ship_date,
        o.status,
        o.finalized_at,
        COUNT(oi.id) AS item_count,
        COALESCE(SUM(COALESCE(oi.adjusted_quantity, oi.quantity)), 0) AS total_units,
        COALESCE(SUM(oi.line_total), 0) AS total_wholesale,
        o.created_at,
        o.updated_at
      FROM orders o
      JOIN seasons s ON o.season_id = s.id
      LEFT JOIN brands b ON o.brand_id = b.id
      LEFT JOIN locations l ON o.location_id = l.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (seasonId) {
      query += ` AND o.season_id = $${paramCount}`;
      params.push(seasonId);
      paramCount++;
    }

    if (brandId) {
      query += ` AND o.brand_id = $${paramCount}`;
      params.push(brandId);
      paramCount++;
    }

    if (locationId) {
      query += ` AND o.location_id = $${paramCount}`;
      params.push(locationId);
      paramCount++;
    }

    if (status) {
      query += ` AND o.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    query += ` GROUP BY o.id, s.name, b.name, l.name, o.ship_date, o.status, o.finalized_at
               ORDER BY o.created_at DESC`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No orders found matching the specified criteria.'
        }]
      };
    }

    // Format results
    const formatted = result.rows.map(row => ({
      id: row.id,
      orderNumber: row.order_number,
      season: row.season,
      brand: row.brand || 'N/A',
      location: row.location || 'N/A',
      shipDate: row.ship_date ? row.ship_date.toISOString().split('T')[0] : 'N/A',
      status: row.status,
      itemCount: row.item_count,
      totalUnits: parseInt(row.total_units),
      totalWholesale: formatCurrency(row.total_wholesale),
      finalized: row.finalized_at ? 'Yes' : 'No'
    }));

    const summary = `Found ${result.rows.length} order(s):\n\n${formatted.map((o, i) =>
      `${i + 1}. ${o.orderNumber} (${o.season} - ${o.brand})\n` +
      `   Location: ${o.location} | Status: ${o.status}\n` +
      `   Ship Date: ${o.shipDate} | Items: ${o.itemCount} | Total Units: ${o.totalUnits}\n` +
      `   Wholesale Total: ${o.totalWholesale} | Finalized: ${o.finalized}`
    ).join('\n\n')}`;

    return {
      content: [{ type: 'text', text: summary }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error listing orders: ${error.message}` }]
    };
  }
}

/**
 * get_order_details: Full order with all items
 */
async function getOrderDetails(args) {
  try {
    const { orderId } = args;

    if (!orderId) {
      return {
        content: [{ type: 'text', text: 'orderId parameter is required' }]
      };
    }

    // Get order header
    const orderQuery = `
      SELECT
        o.id,
        o.order_number,
        s.name AS season,
        b.name AS brand,
        l.name AS location,
        o.ship_date,
        o.status,
        o.created_at,
        o.updated_at,
        COALESCE(SUM(oi.line_total), 0) AS total_wholesale
      FROM orders o
      JOIN seasons s ON o.season_id = s.id
      LEFT JOIN brands b ON o.brand_id = b.id
      LEFT JOIN locations l ON o.location_id = l.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.id = $1
      GROUP BY o.id, s.name, b.name, l.name
    `;

    const orderResult = await pool.query(orderQuery, [orderId]);

    if (orderResult.rows.length === 0) {
      return {
        content: [{ type: 'text', text: `Order not found (ID: ${orderId})` }]
      };
    }

    const order = orderResult.rows[0];

    // Get order items with product details
    const itemsQuery = `
      SELECT
        oi.id AS item_id,
        p.name AS product_name,
        p.sku,
        p.upc,
        p.size,
        p.color,
        p.category,
        p.gender,
        oi.quantity AS original_qty,
        COALESCE(oi.adjusted_quantity, oi.quantity) AS adjusted_qty,
        oi.unit_cost,
        oi.line_total
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      ORDER BY p.category, p.size
    `;

    const itemsResult = await pool.query(itemsQuery, [orderId]);

    // Format results
    let details = `ORDER DETAILS\n${'-'.repeat(80)}\n`;
    details += `Order Number: ${order.order_number}\n`;
    details += `Season: ${order.season} | Brand: ${order.brand || 'N/A'} | Location: ${order.location || 'N/A'}\n`;
    details += `Ship Date: ${order.ship_date ? order.ship_date.toISOString().split('T')[0] : 'N/A'}\n`;
    details += `Status: ${order.status}\n`;
    details += `Created: ${new Date(order.created_at).toISOString().split('T')[0]}\n\n`;

    details += `ITEMS (${itemsResult.rows.length} total)\n${'-'.repeat(80)}\n`;

    itemsResult.rows.forEach((item, i) => {
      details += `${i + 1}. ${item.product_name}\n`;
      details += `   SKU: ${item.sku || 'N/A'} | UPC: ${item.upc || 'N/A'}\n`;
      details += `   Size: ${item.size || 'N/A'} | Color: ${item.color || 'N/A'} | Category: ${item.category || 'N/A'}\n`;
      details += `   Original Qty: ${item.original_qty} | Adjusted Qty: ${item.adjusted_qty}\n`;
      details += `   Unit Cost: ${formatCurrency(item.unit_cost)} | Line Total: ${formatCurrency(item.line_total)}\n\n`;
    });

    details += `${'-'.repeat(80)}\n`;
    details += `TOTAL WHOLESALE: ${formatCurrency(order.total_wholesale)}\n`;

    return {
      content: [{ type: 'text', text: details }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting order details: ${error.message}` }]
    };
  }
}

/**
 * get_order_inventory: Current order items with adjustments summary
 */
async function getOrderInventory(args) {
  try {
    const { seasonId, brandId, locationId, shipDate } = args;

    let query = `
      SELECT
        p.base_name,
        p.category,
        p.size,
        p.color,
        COUNT(DISTINCT oi.id) AS variant_count,
        SUM(oi.quantity) AS original_total,
        SUM(COALESCE(oi.adjusted_quantity, oi.quantity)) AS adjusted_total,
        SUM(COALESCE(oi.adjusted_quantity, oi.quantity) - oi.quantity) AS qty_difference,
        SUM(oi.line_total) AS line_total
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (seasonId) {
      query += ` AND o.season_id = $${paramCount}`;
      params.push(seasonId);
      paramCount++;
    }

    if (brandId) {
      query += ` AND o.brand_id = $${paramCount}`;
      params.push(brandId);
      paramCount++;
    }

    if (locationId) {
      query += ` AND o.location_id = $${paramCount}`;
      params.push(locationId);
      paramCount++;
    }

    if (shipDate) {
      query += ` AND o.ship_date = $${paramCount}`;
      params.push(shipDate);
      paramCount++;
    }

    query += ` GROUP BY p.base_name, p.category, p.size, p.color
               ORDER BY p.category, p.base_name, p.size`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No inventory found matching the specified criteria.'
        }]
      };
    }

    // Group by base product family
    const grouped = {};
    result.rows.forEach(row => {
      const family = row.base_name || 'Unknown';
      if (!grouped[family]) {
        grouped[family] = [];
      }
      grouped[family].push(row);
    });

    let summary = `INVENTORY SUMMARY\n${'-'.repeat(80)}\n`;

    let totalOriginal = 0;
    let totalAdjusted = 0;

    Object.keys(grouped).forEach(family => {
      summary += `\n${family}\n${'-'.repeat(40)}\n`;
      summary += 'Size | Color | Original | Adjusted | Diff | Total $\n';

      grouped[family].forEach(item => {
        const origQty = item.original_total;
        const adjQty = item.adjusted_total;
        const diff = item.qty_difference;

        summary += `${String(item.size || '-').padEnd(8)} | ${String((item.color || '-').substring(0, 12)).padEnd(12)} | ` +
                   `${String(origQty).padEnd(8)} | ${String(adjQty).padEnd(8)} | ${diff > 0 ? '+' : ''}${String(diff).padEnd(4)} | ` +
                   `${formatCurrency(item.line_total)}\n`;

        totalOriginal += origQty;
        totalAdjusted += adjQty;
      });
    });

    summary += `\n${'-'.repeat(80)}\n`;
    summary += `TOTALS: Original ${totalOriginal} units → Adjusted ${totalAdjusted} units ` +
               `(${totalAdjusted - totalOriginal > 0 ? '+' : ''}${totalAdjusted - totalOriginal} units)\n`;

    return {
      content: [{ type: 'text', text: summary }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting order inventory: ${error.message}` }]
    };
  }
}

/**
 * get_ship_dates: Available ship dates for a season/brand
 */
async function getShipDates(args) {
  try {
    const { seasonId, brandId } = args;

    if (!seasonId || !brandId) {
      return {
        content: [{ type: 'text', text: 'Both seasonId and brandId parameters are required' }]
      };
    }

    const query = `
      SELECT
        o.ship_date,
        COUNT(DISTINCT o.id) AS order_count,
        COUNT(DISTINCT o.location_id) AS location_count,
        SUM(COALESCE(SUM(oi.quantity), 0)) AS total_units
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.season_id = $1 AND o.brand_id = $2
      GROUP BY o.ship_date
      ORDER BY o.ship_date
    `;

    const result = await pool.query(query, [seasonId, brandId]);

    if (result.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No ship dates found for this season and brand combination.'
        }]
      };
    }

    let summary = `AVAILABLE SHIP DATES\n${'-'.repeat(80)}\n`;
    summary += 'Ship Date | Orders | Locations | Total Units\n';
    summary += '-'.repeat(80) + '\n';

    result.rows.forEach(row => {
      const shipDate = row.ship_date ? row.ship_date.toISOString().split('T')[0] : 'TBD';
      summary += `${String(shipDate).padEnd(12)} | ${String(row.order_count).padEnd(6)} | ${String(row.location_count).padEnd(9)} | ${row.total_units || 0}\n`;
    });

    return {
      content: [{ type: 'text', text: summary }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting ship dates: ${error.message}` }]
    };
  }
}

/**
 * get_finalized_status: Check what's been finalized
 */
async function getFinalizedStatus(args) {
  try {
    const { seasonId, brandId } = args;

    if (!seasonId) {
      return {
        content: [{ type: 'text', text: 'seasonId parameter is required' }]
      };
    }

    let query = `
      SELECT
        COALESCE(b.name, 'No Brand') AS brand,
        COALESCE(l.name, 'All Locations') AS location,
        COUNT(DISTINCT o.id) AS order_count,
        COUNT(DISTINCT CASE WHEN o.finalized_at IS NOT NULL THEN o.id END) AS finalized_count,
        MAX(o.finalized_at) AS last_finalized
      FROM orders o
      LEFT JOIN brands b ON o.brand_id = b.id
      LEFT JOIN locations l ON o.location_id = l.id
      WHERE o.season_id = $1
    `;

    const params = [seasonId];

    if (brandId) {
      query += ` AND o.brand_id = $2`;
      params.push(brandId);
    }

    query += ` GROUP BY b.name, l.name
               ORDER BY b.name, l.name`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No finalization data found for this season.'
        }]
      };
    }

    let summary = `FINALIZATION STATUS\n${'-'.repeat(80)}\n`;
    summary += 'Brand | Location | Total Orders | Finalized | Last Finalized\n';
    summary += '-'.repeat(80) + '\n';

    let totalOrders = 0;
    let totalFinalized = 0;

    result.rows.forEach(row => {
      summary += `${String(row.brand).padEnd(20)} | ${String(row.location).padEnd(20)} | ${String(row.order_count).padEnd(12)} | ` +
                 `${String(row.finalized_count).padEnd(9)} | ${row.last_finalized ? new Date(row.last_finalized).toISOString().split('T')[0] : 'Never'}\n`;
      totalOrders += row.order_count;
      totalFinalized += row.finalized_count;
    });

    summary += '-'.repeat(80) + '\n';
    summary += `OVERALL: ${totalFinalized} of ${totalOrders} orders finalized (${formatNumber(totalOrders > 0 ? (totalFinalized / totalOrders) * 100 : 0, 1)}%)\n`;

    return {
      content: [{ type: 'text', text: summary }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting finalized status: ${error.message}` }]
    };
  }
}

module.exports = [
  {
    name: 'list_orders',
    description: 'Find orders by season, brand, location, or status',
    inputSchema: {
      type: 'object',
      properties: {
        seasonId: { type: 'integer', description: 'Season ID to filter by' },
        brandId: { type: 'integer', description: 'Brand ID to filter by' },
        locationId: { type: 'integer', description: 'Location ID to filter by' },
        status: {
          type: 'string',
          description: 'Order status to filter by (draft, submitted, approved, ordered, received, cancelled)'
        }
      },
      required: []
    },
    handler: listOrders
  },
  {
    name: 'get_order_details',
    description: 'Get complete order details with all items, product info, and costs',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'integer', description: 'Order ID' }
      },
      required: ['orderId']
    },
    handler: getOrderDetails
  },
  {
    name: 'get_order_inventory',
    description: 'Get inventory summary for orders grouped by product family with adjustment totals',
    inputSchema: {
      type: 'object',
      properties: {
        seasonId: { type: 'integer', description: 'Season ID' },
        brandId: { type: 'integer', description: 'Brand ID' },
        locationId: { type: 'integer', description: 'Location ID' },
        shipDate: { type: 'string', description: 'Ship date (YYYY-MM-DD format)' }
      },
      required: []
    },
    handler: getOrderInventory
  },
  {
    name: 'get_ship_dates',
    description: 'Get available ship dates for a season/brand with order counts',
    inputSchema: {
      type: 'object',
      properties: {
        seasonId: { type: 'integer', description: 'Season ID' },
        brandId: { type: 'integer', description: 'Brand ID' }
      },
      required: ['seasonId', 'brandId']
    },
    handler: getShipDates
  },
  {
    name: 'get_finalized_status',
    description: 'Check finalization status of orders per brand and location',
    inputSchema: {
      type: 'object',
      properties: {
        seasonId: { type: 'integer', description: 'Season ID' },
        brandId: { type: 'integer', description: 'Optional Brand ID filter' }
      },
      required: ['seasonId']
    },
    handler: getFinalizedStatus
  }
];
