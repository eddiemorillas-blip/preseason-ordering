const { pool, bigquery, LOCATION_TO_FACILITY, FACILITY_TO_LOCATION } = require('../db.js');

/**
 * Format a number as currency
 */
function formatCurrency(num) {
  if (num === null || num === undefined) return 'N/A';
  return '$' + parseFloat(num).toFixed(2);
}

/**
 * Format a number with decimals
 */
function formatNumber(num, decimals = 1) {
  if (num === null || num === undefined) return 'N/A';
  return parseFloat(num).toFixed(decimals);
}

/**
 * query_sales: Query sales data from PostgreSQL (not BigQuery for MCP)
 */
async function querySales(args) {
  try {
    const { brandId, locationId, months = 12 } = args;

    if (!brandId) {
      return {
        content: [{
          type: 'text',
          text: 'brandId parameter is required'
        }]
      };
    }

    // Query sales_by_upc table - the PostgreSQL version of BigQuery sales data
    let query = `
      SELECT
        s.upc,
        s.product_name,
        s.rgp_category AS category,
        s.total_qty_sold,
        s.total_revenue,
        s.transaction_count,
        s.first_sale_date,
        s.last_sale_date,
        p.sku,
        p.color,
        p.size,
        CASE
          WHEN s.total_qty_sold > 0 THEN s.total_revenue / s.total_qty_sold
          ELSE 0
        END AS avg_price_per_unit
      FROM sales_by_upc s
      LEFT JOIN products p ON s.upc = p.upc
      WHERE s.rgp_vendor_name = (SELECT name FROM brands WHERE id = $1)
        AND s.period_months = $2
    `;

    const params = [brandId, months];
    let paramCount = 3;

    if (locationId) {
      // If location is provided, try to filter by facility
      // Note: sales_by_upc may have facility_id that maps to location
      query += ` AND s.facility_id IS NOT NULL`;
    }

    query += ` ORDER BY s.total_revenue DESC`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No sales data found for brand ${brandId} in the past ${months} months`
        }]
      };
    }

    // Get brand name
    const brandQuery = 'SELECT name FROM brands WHERE id = $1';
    const brandResult = await pool.query(brandQuery, [brandId]);
    const brandName = brandResult.rows.length > 0 ? brandResult.rows[0].name : `Brand ${brandId}`;

    let summary = `SALES DATA QUERY\n${'-'.repeat(80)}\n`;
    summary += `Brand: ${brandName} | Period: Last ${months} months\n`;
    summary += `Total Products: ${result.rows.length} | Total Revenue: ${formatCurrency(result.rows.reduce((sum, r) => sum + (r.total_revenue || 0), 0))}\n\n`;

    summary += 'UPC | Product | Category | Qty Sold | Revenue | Avg Price\n';
    summary += '-'.repeat(80) + '\n';

    let totalQty = 0;
    let totalRevenue = 0;

    result.rows.forEach(row => {
      totalQty += row.total_qty_sold || 0;
      totalRevenue += row.total_revenue || 0;

      summary += `${String(row.upc || 'N/A').padEnd(15)} | ${String((row.product_name || '').substring(0, 20)).padEnd(20)} | ` +
                 `${String((row.category || '').substring(0, 12)).padEnd(12)} | ${String(row.total_qty_sold || 0).padEnd(8)} | ` +
                 `${formatCurrency(row.total_revenue)} | ${formatCurrency(row.avg_price_per_unit)}\n`;
    });

    summary += `-`.repeat(80) + '\n';
    summary += `TOTALS: ${totalQty} units | ${formatCurrency(totalRevenue)}\n`;

    return {
      content: [{ type: 'text', text: summary }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error querying sales data: ${error.message}` }]
    };
  }
}

/**
 * get_velocity: Get sales velocity metrics
 */
async function getVelocity(args) {
  try {
    const { brandId, locationId, upcs = [] } = args;

    if (!brandId) {
      return {
        content: [{
          type: 'text',
          text: 'brandId parameter is required'
        }]
      };
    }

    // Get brand name
    const brandQuery = 'SELECT name FROM brands WHERE id = $1';
    const brandResult = await pool.query(brandQuery, [brandId]);
    const brandName = brandResult.rows.length > 0 ? brandResult.rows[0].name : `Brand ${brandId}`;

    // Query sales velocity (units per month)
    let query = `
      SELECT
        s.upc,
        s.product_name,
        s.total_qty_sold,
        s.period_months,
        CASE
          WHEN s.period_months > 0 THEN s.total_qty_sold / s.period_months
          ELSE 0
        END AS units_per_month,
        s.total_revenue,
        CASE
          WHEN s.period_months > 0 THEN s.total_revenue / s.period_months
          ELSE 0
        END AS revenue_per_month,
        s.first_sale_date,
        s.last_sale_date
      FROM sales_by_upc s
      WHERE s.rgp_vendor_name = $1
    `;

    const params = [brandName];

    if (upcs && upcs.length > 0) {
      query += ` AND s.upc = ANY($2)`;
      params.push(upcs);
    }

    query += ` ORDER BY s.total_qty_sold DESC`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No velocity data found for brand ${brandName}`
        }]
      };
    }

    // Calculate overall velocity
    let totalUnits = 0;
    let totalMonths = 0;

    result.rows.forEach(row => {
      totalUnits += row.total_qty_sold || 0;
      if (row.period_months > totalMonths) {
        totalMonths = row.period_months;
      }
    });

    const overallVelocity = totalMonths > 0 ? totalUnits / totalMonths : 0;

    let summary = `SALES VELOCITY METRICS\n${'-'.repeat(80)}\n`;
    summary += `Brand: ${brandName}\n`;
    summary += `Overall Velocity: ${formatNumber(overallVelocity, 1)} units/month\n`;
    summary += `Period: ${totalMonths} months | Total Units: ${totalUnits}\n\n`;

    summary += 'UPC | Product | Units/Month | Units Total | Revenue/Month\n';
    summary += '-'.repeat(80) + '\n';

    result.rows.forEach(row => {
      summary += `${String(row.upc || 'N/A').padEnd(15)} | ${String((row.product_name || '').substring(0, 20)).padEnd(20)} | ` +
                 `${String(formatNumber(row.units_per_month, 1)).padEnd(11)} | ${String(row.total_qty_sold).padEnd(11)} | ` +
                 `${formatCurrency(row.revenue_per_month)}\n`;
    });

    summary += `\nNote: Higher velocity = faster selling products. Use for ordering decisions.\n`;

    return {
      content: [{ type: 'text', text: summary }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting velocity metrics: ${error.message}` }]
    };
  }
}

/**
 * compare_year_over_year: Compare current order to historical sales
 */
async function compareYearOverYear(args) {
  try {
    const { orderId } = args;

    if (!orderId) {
      return {
        content: [{
          type: 'text',
          text: 'orderId parameter is required'
        }]
      };
    }

    // Get order items with UPCs
    const orderItemsQuery = `
      SELECT
        oi.id,
        oi.quantity,
        p.name,
        p.upc,
        p.base_name,
        p.size,
        p.color,
        oi.unit_cost
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      ORDER BY p.base_name, p.size
    `;

    const orderItemsResult = await pool.query(orderItemsQuery, [orderId]);

    if (orderItemsResult.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No items found in this order'
        }]
      };
    }

    // Get sales history for each UPC
    const comparisons = [];
    let totalOrdering = 0;
    let totalHistoricalSales = 0;

    for (const item of orderItemsResult.rows) {
      if (!item.upc) continue;

      const salesQuery = `
        SELECT
          total_qty_sold,
          total_revenue,
          period_months
        FROM sales_by_upc
        WHERE upc = $1
        LIMIT 1
      `;

      const salesResult = await pool.query(salesQuery, [item.upc]);

      const historicalQty = salesResult.rows.length > 0 ? salesResult.rows[0].total_qty_sold : 0;
      const historicalMonths = salesResult.rows.length > 0 ? salesResult.rows[0].period_months : 0;

      totalOrdering += item.quantity;
      totalHistoricalSales += historicalQty;

      const monthlyRate = historicalMonths > 0 ? historicalQty / historicalMonths : 0;
      const comparison = item.quantity > historicalQty * 0.8 ? 'more' :
                         item.quantity < historicalQty * 0.5 ? 'less' : 'similar';

      comparisons.push({
        upc: item.upc,
        product: item.base_name,
        size: item.size,
        orderingQty: item.quantity,
        historicalQty,
        monthlyRate,
        comparison
      });
    }

    let summary = `YEAR-OVER-YEAR COMPARISON\n${'-'.repeat(80)}\n`;
    summary += `Order ID: ${orderId}\n`;
    summary += `Total Ordering: ${totalOrdering} units\n`;
    summary += `Total Historical (12mo): ${totalHistoricalSales} units\n`;
    summary += `Monthly Average: ${formatNumber(totalHistoricalSales / 12, 1)} units/month\n\n`;

    // Categorize comparisons
    const more = comparisons.filter(c => c.comparison === 'more').length;
    const less = comparisons.filter(c => c.comparison === 'less').length;
    const similar = comparisons.filter(c => c.comparison === 'similar').length;

    summary += `Ordering more than historical: ${more} SKUs\n`;
    summary += `Ordering less than historical: ${less} SKUs\n`;
    summary += `Ordering similar to historical: ${similar} SKUs\n\n`;

    summary += 'UPC | Product | Size | Ordering | Historical | Monthly Avg | Status\n';
    summary += '-'.repeat(80) + '\n';

    comparisons.forEach(c => {
      const status = c.comparison === 'more' ? '↑' : c.comparison === 'less' ? '↓' : '→';
      summary += `${String(c.upc || 'N/A').padEnd(15)} | ${String(c.product.substring(0, 15)).padEnd(15)} | ${String(c.size || '-').padEnd(6)} | ` +
                 `${String(c.orderingQty).padEnd(8)} | ${String(c.historicalQty).padEnd(10)} | ${String(formatNumber(c.monthlyRate, 1)).padEnd(11)} | ${status}\n`;
    });

    summary += `\n${'-'.repeat(80)}\n`;
    summary += `RECOMMENDATION:\n`;

    if (more > less && more > similar) {
      summary += `You're ordering significantly more than historical patterns. ` +
                 `Ensure inventory space and demand justify increases.\n`;
    } else if (less > more && less > similar) {
      summary += `You're ordering significantly less than historical patterns. ` +
                 `May indicate expected slower sales or budget constraints.\n`;
    } else {
      summary += `Your ordering aligns reasonably with historical patterns.\n`;
    }

    return {
      content: [{ type: 'text', text: summary }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error comparing year-over-year: ${error.message}` }]
    };
  }
}

/**
 * get_stock_on_hand: Live inventory levels from BigQuery
 */
async function getStockOnHand(args) {
  try {
    const { brandId, locationId } = args;

    if (!brandId) {
      return { content: [{ type: 'text', text: 'brandId is required' }] };
    }

    if (!bigquery) {
      return { content: [{ type: 'text', text: 'BigQuery is not configured. Live inventory data is unavailable. Sales data from PostgreSQL is still available via query_sales tool.' }] };
    }

    // Get brand name
    const brandResult = await pool.query('SELECT name FROM brands WHERE id = $1', [brandId]);
    if (brandResult.rows.length === 0) {
      return { content: [{ type: 'text', text: `Brand ${brandId} not found` }] };
    }
    const brandName = brandResult.rows[0].name;

    // Get location name if provided
    let locationName = 'All Locations';
    let facilityFilter = '';
    if (locationId) {
      const locResult = await pool.query('SELECT name FROM locations WHERE id = $1', [locationId]);
      locationName = locResult.rows.length > 0 ? locResult.rows[0].name : `Location ${locationId}`;
      const facilityId = LOCATION_TO_FACILITY[locationId];
      if (facilityId) {
        facilityFilter = `AND i.facility_id = '${facilityId}'`;
      }
    }

    const query = `
      SELECT
        i.barcode AS upc,
        i.product_description AS product_name,
        i.on_hand_qty AS stock_on_hand,
        i.facility_id,
        i.facility_name
      FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
      JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON i.barcode = p.BARCODE
      LEFT JOIN \`front-data-production.rgp_cleaned_zone.vendors_all\` v ON p.vendor_concat = v.vendor_concat
      WHERE LOWER(v.VENDOR_NAME) LIKE '%${brandName.toLowerCase()}%'
        AND i.on_hand_qty IS NOT NULL
        AND i.on_hand_qty > 0
        ${facilityFilter}
      ORDER BY i.on_hand_qty DESC
      LIMIT 500
    `;

    const [rows] = await bigquery.query({ query });

    if (rows.length === 0) {
      return { content: [{ type: 'text', text: `No inventory found for ${brandName} at ${locationName}` }] };
    }

    // Map facility IDs to location names
    const enrichedRows = rows.map(row => {
      const locId = FACILITY_TO_LOCATION[row.facility_id];
      return {
        ...row,
        location: locId ? ['SLC', 'South Main', 'Ogden'][locId - 1] : row.facility_name || 'Unknown'
      };
    });

    let summary = `LIVE INVENTORY - ${brandName}\n${'='.repeat(70)}\n`;
    summary += `Location: ${locationName}\n`;
    summary += `Total SKUs with stock: ${rows.length}\n`;
    summary += `Total units on hand: ${rows.reduce((s, r) => s + (parseInt(r.stock_on_hand) || 0), 0)}\n\n`;

    summary += 'UPC            | Product                    | Location    | On Hand\n';
    summary += '-'.repeat(70) + '\n';

    enrichedRows.slice(0, 100).forEach(row => {
      summary += `${String(row.upc || '').padEnd(15)}| ${String((row.product_name || '').substring(0, 27)).padEnd(27)} | ` +
                 `${String(row.location).padEnd(12)}| ${row.stock_on_hand}\n`;
    });

    if (rows.length > 100) {
      summary += `\n... and ${rows.length - 100} more SKUs\n`;
    }

    return { content: [{ type: 'text', text: summary }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error getting stock on hand: ${error.message}` }] };
  }
}

/**
 * get_inventory_status: Comprehensive inventory status combining stock + velocity + orders
 */
async function getInventoryStatus(args) {
  try {
    const { brandId, locationId, seasonId } = args;

    if (!brandId || !locationId) {
      return { content: [{ type: 'text', text: 'Both brandId and locationId are required' }] };
    }

    if (!bigquery) {
      return { content: [{ type: 'text', text: 'BigQuery is not configured. Live inventory status is unavailable.' }] };
    }

    // Get names
    const brandResult = await pool.query('SELECT name FROM brands WHERE id = $1', [brandId]);
    const locResult = await pool.query('SELECT name FROM locations WHERE id = $1', [locationId]);
    const brandName = brandResult.rows[0]?.name || `Brand ${brandId}`;
    const locationName = locResult.rows[0]?.name || `Location ${locationId}`;
    const facilityId = LOCATION_TO_FACILITY[locationId];

    if (!facilityId) {
      return { content: [{ type: 'text', text: `Location ${locationName} not mapped to a BigQuery facility` }] };
    }

    // Combined query: inventory + 12-month sales velocity
    const inventoryQuery = `
      WITH inventory AS (
        SELECT
          i.barcode AS upc,
          i.product_description AS product_name,
          i.on_hand_qty AS stock_on_hand
        FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
        JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON i.barcode = p.BARCODE
        LEFT JOIN \`front-data-production.rgp_cleaned_zone.vendors_all\` v ON p.vendor_concat = v.vendor_concat
        WHERE i.facility_id = '${facilityId}'
          AND LOWER(v.VENDOR_NAME) LIKE '%${brandName.toLowerCase()}%'
      ),
      sales AS (
        SELECT
          p.BARCODE AS upc,
          SUM(ii.QUANTITY) AS total_sold_12m,
          COUNT(DISTINCT FORMAT_TIMESTAMP('%Y-%m', i.POSTDATE)) AS months_with_sales
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
        COALESCE(s.total_sold_12m, 0) AS total_sold_12m,
        COALESCE(s.months_with_sales, 0) AS months_with_sales,
        CASE WHEN s.months_with_sales > 0
          THEN ROUND(COALESCE(s.total_sold_12m, 0) / GREATEST(s.months_with_sales, 1), 2)
          ELSE 0
        END AS avg_monthly_sales
      FROM inventory inv
      LEFT JOIN sales s ON inv.upc = s.upc
      ORDER BY inv.stock_on_hand DESC
    `;

    const [inventoryRows] = await bigquery.query({ query: inventoryQuery });

    // Get on-order quantities from PostgreSQL
    let orderQuery = `
      SELECT p.upc,
             SUM(oi.quantity) AS original_order_qty,
             SUM(COALESCE(oi.adjusted_quantity, oi.quantity)) AS effective_order_qty
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.brand_id = $1 AND o.location_id = $2 AND o.status != 'cancelled'
    `;
    const orderParams = [brandId, locationId];
    if (seasonId) {
      orderQuery += ` AND o.season_id = $3`;
      orderParams.push(seasonId);
    }
    orderQuery += ` GROUP BY p.upc`;

    const orderResult = await pool.query(orderQuery, orderParams);
    const ordersByUpc = {};
    orderResult.rows.forEach(r => { ordersByUpc[r.upc] = r; });

    // Build combined status
    const inventory = inventoryRows.map(row => {
      const stock = parseInt(row.stock_on_hand) || 0;
      const avgMonthly = parseFloat(row.avg_monthly_sales) || 0;
      const orders = ordersByUpc[row.upc] || { effective_order_qty: 0 };
      const onOrder = parseInt(orders.effective_order_qty) || 0;
      const totalAvailable = stock + onOrder;
      const monthsCoverage = avgMonthly > 0 ? totalAvailable / avgMonthly : (stock > 0 ? 99 : 0);

      let status = 'healthy';
      if (avgMonthly === 0 && stock > 0) status = 'no_velocity';
      else if (monthsCoverage < 1) status = 'critical';
      else if (monthsCoverage < 2) status = 'low';
      else if (monthsCoverage > 12) status = 'overstocked';

      return { upc: row.upc, product_name: row.product_name, stock_on_hand: stock,
               avg_monthly_sales: avgMonthly, on_order: onOrder,
               months_coverage: monthsCoverage > 99 ? '99+' : monthsCoverage.toFixed(1), status };
    });

    const critical = inventory.filter(i => i.status === 'critical');
    const low = inventory.filter(i => i.status === 'low');
    const overstocked = inventory.filter(i => i.status === 'overstocked');
    const totalStock = inventory.reduce((s, i) => s + i.stock_on_hand, 0);

    let summary = `INVENTORY STATUS - ${brandName} at ${locationName}\n${'='.repeat(70)}\n`;
    summary += `Total SKUs: ${inventory.length} | Total On Hand: ${totalStock}\n`;
    summary += `Critical (<1mo): ${critical.length} | Low (1-2mo): ${low.length} | Overstocked (>12mo): ${overstocked.length}\n\n`;

    if (critical.length > 0) {
      summary += `CRITICAL (need immediate ordering):\n`;
      critical.slice(0, 15).forEach(i => {
        summary += `  ${i.upc} - ${(i.product_name || '').substring(0, 30)} | Stock: ${i.stock_on_hand} | Velocity: ${formatNumber(i.avg_monthly_sales)}/mo | Coverage: ${i.months_coverage}mo\n`;
      });
      summary += '\n';
    }

    if (overstocked.length > 0) {
      summary += `OVERSTOCKED (>12 months coverage):\n`;
      overstocked.slice(0, 10).forEach(i => {
        summary += `  ${i.upc} - ${(i.product_name || '').substring(0, 30)} | Stock: ${i.stock_on_hand} | Velocity: ${formatNumber(i.avg_monthly_sales)}/mo | Coverage: ${i.months_coverage}mo\n`;
      });
      summary += '\n';
    }

    summary += `ALL INVENTORY (top 50 by stock):\n`;
    summary += 'UPC            | Product                    | Stock | Vel/Mo | On Order | Coverage | Status\n';
    summary += '-'.repeat(90) + '\n';

    inventory.slice(0, 50).forEach(i => {
      summary += `${String(i.upc || '').padEnd(15)}| ${String((i.product_name || '').substring(0, 27)).padEnd(27)} | ` +
                 `${String(i.stock_on_hand).padEnd(6)}| ${String(formatNumber(i.avg_monthly_sales)).padEnd(7)}| ` +
                 `${String(i.on_order).padEnd(9)}| ${String(i.months_coverage + 'mo').padEnd(9)}| ${i.status}\n`;
    });

    return { content: [{ type: 'text', text: summary }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error getting inventory status: ${error.message}` }] };
  }
}

module.exports = [
  {
    name: 'query_sales',
    description: 'Query historical sales data for a brand from PostgreSQL sales table',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'integer', description: 'Brand ID' },
        locationId: { type: 'integer', description: 'Optional location ID for filtering' },
        months: { type: 'integer', description: 'Number of months to query (default 12)' }
      },
      required: ['brandId']
    },
    handler: querySales
  },
  {
    name: 'get_velocity',
    description: 'Get sales velocity metrics (units per month) for products',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'integer', description: 'Brand ID' },
        locationId: { type: 'integer', description: 'Optional location ID' },
        upcs: { type: 'array', items: { type: 'string' }, description: 'Optional array of UPCs to filter' }
      },
      required: ['brandId']
    },
    handler: getVelocity
  },
  {
    name: 'compare_year_over_year',
    description: 'Compare current order quantities to historical 12-month sales patterns',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'integer', description: 'Order ID to analyze' }
      },
      required: ['orderId']
    },
    handler: compareYearOverYear
  },
  {
    name: 'get_stock_on_hand',
    description: 'Get LIVE current inventory levels from BigQuery for a brand. Shows on-hand quantities by product and location. Use this to check what is actually in stock right now.',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'integer', description: 'Brand ID' },
        locationId: { type: 'integer', description: 'Optional: filter to a specific location (1=SLC, 2=South Main, 3=Ogden)' }
      },
      required: ['brandId']
    },
    handler: getStockOnHand
  },
  {
    name: 'get_inventory_status',
    description: 'Comprehensive inventory health report combining LIVE stock on hand, sales velocity, and on-order quantities. Shows critical items (need ordering), overstocked items, and months of coverage. This is the most complete view of inventory for a brand/location.',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'integer', description: 'Brand ID' },
        locationId: { type: 'integer', description: 'Location ID (1=SLC, 2=South Main, 3=Ogden)' },
        seasonId: { type: 'integer', description: 'Optional: filter on-order data to a specific season' }
      },
      required: ['brandId', 'locationId']
    },
    handler: getInventoryStatus
  }
];
