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
    const { brandId, locationId, vendorName } = args;

    if (!brandId && !vendorName) {
      return { content: [{ type: 'text', text: 'brandId or vendorName is required' }] };
    }

    if (!bigquery) {
      return { content: [{ type: 'text', text: 'BigQuery is not configured. Live inventory data is unavailable.' }] };
    }

    // Get brand name from DB or use vendorName directly
    let brandName;
    if (vendorName) {
      brandName = vendorName;
    } else {
      const brandResult = await pool.query('SELECT name FROM brands WHERE id = $1', [brandId]);
      if (brandResult.rows.length === 0) {
        return { content: [{ type: 'text', text: `Brand ${brandId} not found` }] };
      }
      brandName = brandResult.rows[0].name;
    }

    // Get location name if provided
    let locationName = 'All Locations';
    let facilityFilter = '';
    if (locationId) {
      const locResult = await pool.query('SELECT name FROM locations WHERE id = $1', [locationId]);
      locationName = locResult.rows.length > 0 ? locResult.rows[0].name : `Location ${locationId}`;
      const facilityId = LOCATION_TO_FACILITY[locationId];
      if (facilityId) {
        facilityFilter = `AND i.facility_id = ${facilityId}`;
      }
    }

    // First: discover column names with a schema query
    const schemaQuery = `
      SELECT column_name
      FROM \`front-data-production.dataform.INFORMATION_SCHEMA.COLUMNS\`
      WHERE table_name = 'INVENTORY_on_hand_report'
    `;

    let columns = [];
    try {
      const [schemaRows] = await bigquery.query({ query: schemaQuery });
      columns = schemaRows.map(r => r.column_name);
    } catch (e) {
      // Schema query failed, proceed with known columns
    }

    const query = `
      SELECT i.*, v.VENDOR_NAME
      FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
      JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON i.barcode = p.BARCODE
      LEFT JOIN \`front-data-production.rgp_cleaned_zone.vendors_all\` v ON p.vendor_concat = v.vendor_concat
      WHERE LOWER(v.VENDOR_NAME) LIKE '%${brandName.toLowerCase()}%'
        ${facilityFilter}
      ORDER BY i.on_hand_qty DESC
      LIMIT 5000
    `;

    const [rows] = await bigquery.query({ query });

    if (rows.length === 0) {
      return { content: [{ type: 'text', text: `No inventory found for ${brandName} at ${locationName}` }] };
    }

    // Log discovered columns for debugging
    const sampleKeys = rows.length > 0 ? Object.keys(rows[0]) : [];

    // Map facility IDs to location names
    const enrichedRows = rows.map(row => {
      const locId = FACILITY_TO_LOCATION[row.facility_id];
      return {
        ...row,
        location: locId ? ['SLC', 'South Main', 'Ogden'][locId - 1] : row.facility_name || 'Unknown'
      };
    });

    const totalOnHand = rows.reduce((s, r) => s + (parseInt(r.on_hand_qty) || 0), 0);

    let summary = `LIVE INVENTORY - ${brandName}\n${'='.repeat(70)}\n`;
    summary += `Location: ${locationName}\n`;
    summary += `Total SKUs with stock: ${rows.length}\n`;
    summary += `Total units on hand: ${totalOnHand}\n`;
    summary += `Columns found: ${sampleKeys.join(', ')}\n`;
    if (columns.length > 0) {
      summary += `Table schema: ${columns.join(', ')}\n`;
    }
    summary += '\n';

    summary += 'Barcode        | Description                | Location    | On Hand\n';
    summary += '-'.repeat(70) + '\n';

    enrichedRows.slice(0, 200).forEach(row => {
      const desc = row.product_description || row.description || row.item_description || row.barcode || '';
      summary += `${String(row.barcode || '').padEnd(15)}| ${String(String(desc).substring(0, 27)).padEnd(27)} | ` +
                 `${String(row.location).padEnd(12)}| ${row.on_hand_qty}\n`;
    });

    if (rows.length > 200) {
      summary += `\n... and ${rows.length - 200} more SKUs\n`;
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
          i.barcode AS product_name,
          i.on_hand_qty AS stock_on_hand
        FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
        JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON i.barcode = p.BARCODE
        LEFT JOIN \`front-data-production.rgp_cleaned_zone.vendors_all\` v ON p.vendor_concat = v.vendor_concat
        WHERE i.facility_id = ${facilityId}
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
          AND p.facility_id_true = ${facilityId}
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

/**
 * lookup_barcodes: Query BigQuery for specific barcodes across all locations
 */
async function lookupBarcodes(args) {
  try {
    const { barcodes } = args;
    if (!barcodes || barcodes.length === 0) {
      return { content: [{ type: 'text', text: 'barcodes array is required' }] };
    }

    const barcodeList = barcodes.map(b => `'${b}'`).join(',');

    const query = `
      SELECT DISTINCT
        i.facility_id,
        i.barcode,
        i.description,
        i.color,
        i.size,
        i.on_hand_qty
      FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
      WHERE i.barcode IN (${barcodeList})
        AND i.facility_id IN (41185, 1003, 1000)
      ORDER BY i.barcode, i.facility_id
    `;

    const [rows] = await bigquery.query({ query });

    const FACILITY_NAMES = { '41185': 'SLC', '1003': 'South Main', '1000': 'Ogden' };

    // Deduplicate (same barcode+facility can appear multiple times)
    const seen = {};
    for (const row of rows) {
      const key = `${row.barcode}|${row.facility_id}`;
      if (!seen[key]) {
        seen[key] = row;
      }
    }
    const unique = Object.values(seen);

    // Build JSON-like output for easy parsing
    let output = `BARCODE_LOOKUP_RESULTS\n`;
    output += `Queried: ${barcodes.length} barcodes | Found: ${unique.length} results\n`;
    output += `---DATA_START---\n`;

    for (const row of unique) {
      const loc = FACILITY_NAMES[row.facility_id] || row.facility_id;
      output += `${row.barcode}|${loc}|${row.on_hand_qty}|${row.description || ''}|${row.color || ''}|${row.size || ''}\n`;
    }

    output += `---DATA_END---\n`;

    // Also show barcodes NOT found (0 stock everywhere)
    const foundBarcodes = new Set(unique.map(r => String(r.barcode)));
    const notFound = barcodes.filter(b => !foundBarcodes.has(String(b)));
    output += `\nNOT IN INVENTORY (0 on hand): ${notFound.length} barcodes\n`;
    for (const b of notFound) {
      output += `  ${b}\n`;
    }

    return { content: [{ type: 'text', text: output }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error looking up barcodes: ${error.message}` }] };
  }
}

/**
 * get_zero_stock: Find all items for a vendor with 0 or negative on-hand at any location.
 * Returns compact barcode|location|on_hand|description|color|size format.
 */
async function getZeroStock(args) {
  try {
    const { vendorName, shoeModels } = args;
    if (!vendorName) {
      return { content: [{ type: 'text', text: 'vendorName is required' }] };
    }

    // Build shoe model filter if provided
    let modelFilter = '';
    if (shoeModels && shoeModels.length > 0) {
      const modelClauses = shoeModels.map(m => `LOWER(i.description) LIKE '%${m.toLowerCase()}%'`).join(' OR ');
      modelFilter = `AND (${modelClauses})`;
    }

    const query = `
      SELECT DISTINCT
        i.facility_id,
        i.barcode,
        i.description,
        i.color,
        i.size,
        i.on_hand_qty
      FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
      JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON i.barcode = p.BARCODE
      LEFT JOIN \`front-data-production.rgp_cleaned_zone.vendors_all\` v ON p.vendor_concat = v.vendor_concat
      WHERE LOWER(v.VENDOR_NAME) LIKE '%${vendorName.toLowerCase()}%'
        AND i.facility_id IN (41185, 1003, 1000)
        AND i.on_hand_qty <= 0
        ${modelFilter}
      ORDER BY i.description, i.size, i.facility_id
    `;

    const [rows] = await bigquery.query({ query });
    const FACILITY_NAMES = { '41185': 'SLC', '1003': 'South Main', '1000': 'Ogden' };

    // Deduplicate
    const seen = {};
    for (const row of rows) {
      const key = `${row.barcode}|${row.facility_id}`;
      if (!seen[key]) seen[key] = row;
    }
    const unique = Object.values(seen);

    let output = `ZERO_STOCK_RESULTS for ${vendorName}\n`;
    output += `Found: ${unique.length} barcode+location combos with on_hand <= 0\n`;
    output += `---DATA_START---\n`;
    for (const row of unique) {
      const loc = FACILITY_NAMES[row.facility_id] || row.facility_id;
      output += `${row.barcode}|${loc}|${row.on_hand_qty}|${row.description || ''}|${row.color || ''}|${row.size || ''}\n`;
    }
    output += `---DATA_END---\n`;

    // Summary by description
    const byCat = {};
    for (const row of unique) {
      const d = row.description || 'Unknown';
      byCat[d] = (byCat[d] || 0) + 1;
    }
    output += `\nSUMMARY BY PRODUCT:\n`;
    for (const [desc, count] of Object.entries(byCat).sort()) {
      output += `  ${desc}: ${count} zero-stock location combos\n`;
    }

    return { content: [{ type: 'text', text: output }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
  }
}

/**
 * find_sold_not_in_inventory: Find items that have recent sales but 0 inventory.
 * These are items that were received but not properly added to inventory,
 * yet have been sold through the POS and may need reordering.
 */
async function findSoldNotInInventory(args) {
  try {
    const { vendorName, orderId, days = 90, locationId } = args;

    if (!vendorName && !orderId) {
      return { content: [{ type: 'text', text: 'Either vendorName or orderId is required' }] };
    }

    if (!bigquery) {
      return { content: [{ type: 'text', text: 'BigQuery is not configured. This tool requires BigQuery access.' }] };
    }

    let upcsToCheck = [];
    let brandName = vendorName;

    // If orderId is provided, get UPCs from that order
    if (orderId) {
      const orderQuery = `
        SELECT DISTINCT p.upc, p.name, p.base_name, p.size, p.color, b.name as brand_name
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        JOIN orders o ON oi.order_id = o.id
        JOIN brands b ON o.brand_id = b.id
        WHERE o.id = $1 AND p.upc IS NOT NULL
      `;
      const orderResult = await pool.query(orderQuery, [orderId]);
      upcsToCheck = orderResult.rows.map(r => r.upc);
      if (orderResult.rows.length > 0) {
        brandName = orderResult.rows[0].brand_name;
      }
    }

    // Build facility filter
    let facilityFilter = 'i.facility_id IN (41185, 1003, 1000)';
    let salesFacilityFilter = 'p.facility_id_true IN (41185, 1003, 1000)';
    if (locationId) {
      const facilityId = LOCATION_TO_FACILITY[locationId];
      if (facilityId) {
        facilityFilter = `i.facility_id = ${facilityId}`;
        salesFacilityFilter = `p.facility_id_true = ${facilityId}`;
      }
    }

    // Query: Find items with sales in last N days but 0 or negative inventory
    let query;
    if (upcsToCheck.length > 0) {
      // Query specific UPCs from the order
      const upcList = upcsToCheck.map(u => `'${u}'`).join(',');
      query = `
        WITH recent_sales AS (
          SELECT
            p.BARCODE AS upc,
            p.ITEM_DESCRIPTION AS description,
            p.facility_id_true AS facility_id,
            SUM(ii.QUANTITY) AS qty_sold,
            COUNT(DISTINCT i.invoice_concat) AS transaction_count,
            MIN(DATE(i.POSTDATE)) AS first_sale,
            MAX(DATE(i.POSTDATE)) AS last_sale
          FROM \`front-data-production.rgp_cleaned_zone.invoice_items_all\` ii
          JOIN \`front-data-production.rgp_cleaned_zone.invoices_all\` i ON ii.invoice_concat = i.invoice_concat
          JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON ii.product_concat = p.product_concat
          WHERE DATE(i.POSTDATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY)
            AND ii.QUANTITY > 0
            AND p.BARCODE IN (${upcList})
            AND ${salesFacilityFilter}
          GROUP BY p.BARCODE, p.ITEM_DESCRIPTION, p.facility_id_true
        ),
        current_inventory AS (
          SELECT
            i.barcode,
            i.facility_id,
            i.on_hand_qty,
            i.description AS inv_description
          FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
          WHERE i.barcode IN (${upcList})
            AND ${facilityFilter}
        )
        SELECT
          s.upc,
          s.description,
          s.facility_id,
          s.qty_sold,
          s.transaction_count,
          s.first_sale,
          s.last_sale,
          COALESCE(inv.on_hand_qty, 0) AS on_hand_qty,
          CASE WHEN inv.barcode IS NULL THEN 'NOT_IN_INVENTORY' ELSE 'IN_INVENTORY' END AS inventory_status
        FROM recent_sales s
        LEFT JOIN current_inventory inv ON s.upc = inv.barcode AND s.facility_id = inv.facility_id
        WHERE COALESCE(inv.on_hand_qty, 0) <= 0
        ORDER BY s.qty_sold DESC
      `;
    } else {
      // Query by vendor name
      query = `
        WITH recent_sales AS (
          SELECT
            p.BARCODE AS upc,
            p.ITEM_DESCRIPTION AS description,
            p.facility_id_true AS facility_id,
            SUM(ii.QUANTITY) AS qty_sold,
            COUNT(DISTINCT i.invoice_concat) AS transaction_count,
            MIN(DATE(i.POSTDATE)) AS first_sale,
            MAX(DATE(i.POSTDATE)) AS last_sale
          FROM \`front-data-production.rgp_cleaned_zone.invoice_items_all\` ii
          JOIN \`front-data-production.rgp_cleaned_zone.invoices_all\` i ON ii.invoice_concat = i.invoice_concat
          JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON ii.product_concat = p.product_concat
          LEFT JOIN \`front-data-production.rgp_cleaned_zone.vendors_all\` v ON p.vendor_concat = v.vendor_concat
          WHERE DATE(i.POSTDATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY)
            AND ii.QUANTITY > 0
            AND LOWER(v.VENDOR_NAME) LIKE '%${brandName.toLowerCase()}%'
            AND ${salesFacilityFilter}
          GROUP BY p.BARCODE, p.ITEM_DESCRIPTION, p.facility_id_true
        ),
        current_inventory AS (
          SELECT
            i.barcode,
            i.facility_id,
            i.on_hand_qty,
            i.description AS inv_description
          FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
          JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON i.barcode = p.BARCODE
          LEFT JOIN \`front-data-production.rgp_cleaned_zone.vendors_all\` v ON p.vendor_concat = v.vendor_concat
          WHERE LOWER(v.VENDOR_NAME) LIKE '%${brandName.toLowerCase()}%'
            AND ${facilityFilter}
        )
        SELECT
          s.upc,
          s.description,
          s.facility_id,
          s.qty_sold,
          s.transaction_count,
          s.first_sale,
          s.last_sale,
          COALESCE(inv.on_hand_qty, 0) AS on_hand_qty,
          CASE WHEN inv.barcode IS NULL THEN 'NOT_IN_INVENTORY' ELSE 'IN_INVENTORY' END AS inventory_status
        FROM recent_sales s
        LEFT JOIN current_inventory inv ON s.upc = inv.barcode AND s.facility_id = inv.facility_id
        WHERE COALESCE(inv.on_hand_qty, 0) <= 0
        ORDER BY s.qty_sold DESC
        LIMIT 500
      `;
    }

    const [rows] = await bigquery.query({ query });

    const FACILITY_NAMES = { '41185': 'SLC', '1003': 'South Main', '1000': 'Ogden' };

    if (rows.length === 0) {
      return { content: [{ type: 'text', text: `No items found with recent sales and zero inventory for ${brandName}` }] };
    }

    // Group by UPC for summary
    const byUpc = {};
    for (const row of rows) {
      if (!byUpc[row.upc]) {
        byUpc[row.upc] = { description: row.description, locations: [] };
      }
      byUpc[row.upc].locations.push({
        location: FACILITY_NAMES[row.facility_id] || row.facility_id,
        qty_sold: parseInt(row.qty_sold) || 0,
        transactions: parseInt(row.transaction_count) || 0,
        last_sale: row.last_sale,
        on_hand: parseInt(row.on_hand_qty) || 0,
        inventory_status: row.inventory_status
      });
    }

    let output = `SOLD BUT NOT IN INVENTORY - ${brandName}\n${'='.repeat(70)}\n`;
    output += `Period: Last ${days} days\n`;
    output += `Found: ${Object.keys(byUpc).length} UPCs with sales but 0 inventory\n`;
    output += `These items were sold but show 0 stock - may need reordering or inventory correction.\n\n`;

    // Calculate totals
    let totalSold = 0;
    for (const row of rows) {
      totalSold += parseInt(row.qty_sold) || 0;
    }
    output += `Total Units Sold (zero inventory items): ${totalSold}\n\n`;

    output += `---DATA_START---\n`;
    output += `UPC|Location|Qty Sold|Transactions|Last Sale|On Hand|Status\n`;

    for (const row of rows) {
      const loc = FACILITY_NAMES[row.facility_id] || row.facility_id;
      const lastSale = row.last_sale ? row.last_sale.value || row.last_sale : 'N/A';
      output += `${row.upc}|${loc}|${row.qty_sold}|${row.transaction_count}|${lastSale}|${row.on_hand_qty}|${row.inventory_status}\n`;
    }
    output += `---DATA_END---\n\n`;

    // Summary by product
    output += `SUMMARY BY PRODUCT:\n${'-'.repeat(50)}\n`;
    const sortedUpcs = Object.entries(byUpc)
      .map(([upc, data]) => ({
        upc,
        description: data.description,
        total_sold: data.locations.reduce((sum, l) => sum + l.qty_sold, 0),
        locations: data.locations
      }))
      .sort((a, b) => b.total_sold - a.total_sold);

    for (const item of sortedUpcs.slice(0, 50)) {
      const locSummary = item.locations.map(l => `${l.location}:${l.qty_sold}`).join(', ');
      output += `${item.upc} | ${(item.description || '').substring(0, 30)} | Sold: ${item.total_sold} | ${locSummary}\n`;
    }

    if (sortedUpcs.length > 50) {
      output += `\n... and ${sortedUpcs.length - 50} more products\n`;
    }

    output += `\n${'='.repeat(70)}\n`;
    output += `ACTION: These items need attention - either:\n`;
    output += `  1. Correct inventory if items are actually in stock\n`;
    output += `  2. Add to reorder list if they truly sold out\n`;
    output += `  3. Check receiving logs for unreceived shipments\n`;

    return { content: [{ type: 'text', text: output }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error finding sold items: ${error.message}` }] };
  }
}

/**
 * get_recent_sales_by_upc: Get recent sales transactions for specific UPCs
 * Useful for checking if newly received items have started selling
 */
async function getRecentSalesByUpc(args) {
  try {
    const { upcs, days = 30 } = args;

    if (!upcs || upcs.length === 0) {
      return { content: [{ type: 'text', text: 'upcs array is required' }] };
    }

    if (!bigquery) {
      return { content: [{ type: 'text', text: 'BigQuery is not configured. This tool requires BigQuery access.' }] };
    }

    const upcList = upcs.map(u => `'${u}'`).join(',');

    const query = `
      SELECT
        p.BARCODE AS upc,
        p.ITEM_DESCRIPTION AS description,
        p.facility_id_true AS facility_id,
        DATE(i.POSTDATE) AS sale_date,
        SUM(ii.QUANTITY) AS qty_sold,
        SUM(ii.EXTENDED_AMOUNT) AS revenue
      FROM \`front-data-production.rgp_cleaned_zone.invoice_items_all\` ii
      JOIN \`front-data-production.rgp_cleaned_zone.invoices_all\` i ON ii.invoice_concat = i.invoice_concat
      JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON ii.product_concat = p.product_concat
      WHERE DATE(i.POSTDATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY)
        AND p.BARCODE IN (${upcList})
        AND ii.QUANTITY > 0
        AND p.facility_id_true IN (41185, 1003, 1000)
      GROUP BY p.BARCODE, p.ITEM_DESCRIPTION, p.facility_id_true, DATE(i.POSTDATE)
      ORDER BY p.BARCODE, DATE(i.POSTDATE) DESC
    `;

    const [rows] = await bigquery.query({ query });

    const FACILITY_NAMES = { '41185': 'SLC', '1003': 'South Main', '1000': 'Ogden' };

    if (rows.length === 0) {
      return { content: [{ type: 'text', text: `No sales found for the specified UPCs in the last ${days} days` }] };
    }

    // Group by UPC
    const byUpc = {};
    for (const row of rows) {
      if (!byUpc[row.upc]) {
        byUpc[row.upc] = { description: row.description, sales: [] };
      }
      byUpc[row.upc].sales.push({
        location: FACILITY_NAMES[row.facility_id] || row.facility_id,
        date: row.sale_date ? (row.sale_date.value || row.sale_date) : 'N/A',
        qty: parseInt(row.qty_sold) || 0,
        revenue: parseFloat(row.revenue) || 0
      });
    }

    let output = `RECENT SALES BY UPC\n${'='.repeat(70)}\n`;
    output += `Period: Last ${days} days\n`;
    output += `UPCs queried: ${upcs.length} | UPCs with sales: ${Object.keys(byUpc).length}\n\n`;

    for (const [upc, data] of Object.entries(byUpc)) {
      const totalQty = data.sales.reduce((sum, s) => sum + s.qty, 0);
      const totalRev = data.sales.reduce((sum, s) => sum + s.revenue, 0);

      output += `${upc} - ${(data.description || '').substring(0, 40)}\n`;
      output += `  Total: ${totalQty} units | ${formatCurrency(totalRev)}\n`;

      // Show last 5 sales
      const recentSales = data.sales.slice(0, 5);
      for (const sale of recentSales) {
        output += `    ${sale.date} | ${sale.location} | ${sale.qty} units | ${formatCurrency(sale.revenue)}\n`;
      }
      if (data.sales.length > 5) {
        output += `    ... and ${data.sales.length - 5} more transactions\n`;
      }
      output += '\n';
    }

    // Show UPCs with no sales
    const noSales = upcs.filter(u => !byUpc[u]);
    if (noSales.length > 0) {
      output += `NO SALES FOUND FOR:\n`;
      noSales.forEach(u => { output += `  ${u}\n`; });
    }

    return { content: [{ type: 'text', text: output }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error querying sales: ${error.message}` }] };
  }
}

/**
 * get_total_inventory_value: Sum up total retail inventory value from BigQuery
 */
async function getTotalInventoryValue(args) {
  try {
    const { locationId, vendorName, includeInactive } = args || {};

    if (!bigquery) {
      return { content: [{ type: 'text', text: 'BigQuery is not configured. Live inventory data is unavailable.' }] };
    }

    let facilityFilter = 'i.facility_id IN (41185, 1003, 1000)';
    if (locationId) {
      const facilityId = LOCATION_TO_FACILITY[locationId];
      if (facilityId) {
        facilityFilter = `i.facility_id = ${facilityId}`;
      }
    }

    let vendorFilter = '';
    if (vendorName) {
      vendorFilter = `AND LOWER(v.VENDOR_NAME) LIKE '%${vendorName.toLowerCase()}%'`;
    }

    // Default: active only. Set includeInactive=true to see everything.
    const activeFilter = includeInactive ? '' : `AND LOWER(CAST(i.active AS STRING)) IN ('true', '1', 'yes', 'y')`;

    // First query: breakdown by active status and facility
    const query = `
      SELECT
        CASE WHEN LOWER(CAST(i.active AS STRING)) IN ('true', '1', 'yes', 'y') THEN 'Active' ELSE 'Inactive' END as status,
        i.facility_id,
        SUM(i.on_hand_qty) AS total_units,
        COUNT(DISTINCT i.barcode) AS unique_skus,
        SUM(CASE WHEN i.unitcost IS NOT NULL AND i.unitcost > 0 THEN i.on_hand_qty * i.unitcost ELSE 0 END) AS total_value_unitcost,
        SUM(CASE WHEN i.cost IS NOT NULL AND i.cost > 0 THEN i.cost ELSE 0 END) AS total_value_cost,
        SUM(CASE WHEN (i.unitcost IS NULL OR i.unitcost = 0) AND (i.cost IS NULL OR i.cost = 0) THEN i.on_hand_qty ELSE 0 END) AS units_missing_cost
      FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
      LEFT JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON i.barcode = p.BARCODE
      LEFT JOIN \`front-data-production.rgp_cleaned_zone.vendors_all\` v ON p.vendor_concat = v.vendor_concat
      WHERE ${facilityFilter}
        AND i.on_hand_qty > 0
        ${vendorFilter}
      GROUP BY status, i.facility_id
      ORDER BY status, i.facility_id
    `;

    const [rows] = await bigquery.query({ query });

    if (rows.length === 0) {
      return { content: [{ type: 'text', text: 'No inventory data found.' }] };
    }

    const FACILITY_NAMES = { '41185': 'SLC', '1003': 'South Main', '1000': 'Ogden' };

    let activeUnits = 0, activeValue = 0, activeSkus = 0, activeMissing = 0;
    let inactiveUnits = 0, inactiveValue = 0, inactiveSkus = 0, inactiveMissing = 0;

    // Group rows by status
    const activeRows = rows.filter(r => r.status === 'Active');
    const inactiveRows = rows.filter(r => r.status === 'Inactive');

    let summary = `TOTAL INVENTORY VALUE (WHOLESALE COST)${vendorName ? ' - ' + vendorName : ''}\n${'='.repeat(70)}\n`;

    // Active items section
    summary += '\nACTIVE ITEMS:\n';
    summary += 'Location     | SKUs   | Units   | Value (cost)\n';
    summary += '-'.repeat(55) + '\n';

    for (const row of activeRows) {
      const loc = FACILITY_NAMES[row.facility_id] || row.facility_id;
      const units = parseInt(row.total_units) || 0;
      const skus = parseInt(row.unique_skus) || 0;
      const val = parseFloat(row.total_value_unitcost) || 0;
      const missing = parseInt(row.units_missing_cost) || 0;
      activeUnits += units; activeValue += val; activeSkus += skus; activeMissing += missing;
      summary += `${String(loc).padEnd(13)}| ${String(skus).padEnd(7)}| ${String(units).padEnd(8)}| $${val.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n`;
    }
    summary += '-'.repeat(55) + '\n';
    summary += `${'ACTIVE TOTAL'.padEnd(13)}| ${String(activeSkus).padEnd(7)}| ${String(activeUnits).padEnd(8)}| $${activeValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n`;

    // Inactive items section
    if (inactiveRows.length > 0) {
      summary += '\nINACTIVE ITEMS:\n';
      summary += 'Location     | SKUs   | Units   | Value (cost)\n';
      summary += '-'.repeat(55) + '\n';
      for (const row of inactiveRows) {
        const loc = FACILITY_NAMES[row.facility_id] || row.facility_id;
        const units = parseInt(row.total_units) || 0;
        const skus = parseInt(row.unique_skus) || 0;
        const val = parseFloat(row.total_value_unitcost) || 0;
        const missing = parseInt(row.units_missing_cost) || 0;
        inactiveUnits += units; inactiveValue += val; inactiveSkus += skus; inactiveMissing += missing;
        summary += `${String(loc).padEnd(13)}| ${String(skus).padEnd(7)}| ${String(units).padEnd(8)}| $${val.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n`;
      }
      summary += '-'.repeat(55) + '\n';
      summary += `${'INACTIVE TOT'.padEnd(13)}| ${String(inactiveSkus).padEnd(7)}| ${String(inactiveUnits).padEnd(8)}| $${inactiveValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n`;
    }

    // Grand total
    const grandUnits = activeUnits + inactiveUnits;
    const grandValue = activeValue + inactiveValue;
    const grandSkus = activeSkus + inactiveSkus;
    summary += `\n${'='.repeat(55)}\n`;
    summary += `COMBINED TOTAL: ${grandSkus} SKUs | ${grandUnits} units | $${grandValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n`;
    if (activeMissing + inactiveMissing > 0) {
      summary += `(${activeMissing + inactiveMissing} units missing cost data, not included in totals)\n`;
    }

    // Top 20 vendors by value (active only by default)
    const vendorQuery = `
      SELECT
        v.VENDOR_NAME,
        SUM(i.on_hand_qty) AS total_units,
        COUNT(DISTINCT i.barcode) AS unique_skus,
        SUM(CASE WHEN i.unitcost IS NOT NULL AND i.unitcost > 0 THEN i.on_hand_qty * i.unitcost ELSE 0 END) AS total_value
      FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
      LEFT JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON i.barcode = p.BARCODE
      LEFT JOIN \`front-data-production.rgp_cleaned_zone.vendors_all\` v ON p.vendor_concat = v.vendor_concat
      WHERE i.facility_id IN (41185, 1003, 1000)
        AND i.on_hand_qty > 0
        ${activeFilter}
        ${vendorFilter}
      GROUP BY v.VENDOR_NAME
      ORDER BY total_value DESC
      LIMIT 20
    `;

    try {
      const [vendorRows] = await bigquery.query({ query: vendorQuery });
      if (vendorRows.length > 0) {
        summary += `\nTOP 20 VENDORS BY INVENTORY VALUE${includeInactive ? '' : ' (active only)'}:\n`;
        summary += 'Vendor                         | SKUs  | Units  | Value\n';
        summary += '-'.repeat(70) + '\n';
        for (const vr of vendorRows) {
          const val = parseFloat(vr.total_value) || 0;
          summary += `${String(vr.VENDOR_NAME || 'Unknown').substring(0, 30).padEnd(31)}| ${String(vr.unique_skus).padEnd(6)}| ${String(vr.total_units).padEnd(7)}| $${val.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n`;
        }
      }
    } catch (e) {
      // vendor breakdown failed, no big deal
    }

    return { content: [{ type: 'text', text: summary }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error calculating inventory value: ${error.message}` }] };
  }
}

module.exports = [
  {
    name: 'get_total_inventory_value',
    description: 'Calculate total dollar value of retail inventory currently on hand from BigQuery. Breaks down by location and top vendors. Can optionally filter by location or vendor.',
    inputSchema: {
      type: 'object',
      properties: {
        locationId: { type: 'integer', description: 'Optional: filter to a specific location (1=SLC, 2=South Main, 3=Ogden)' },
        vendorName: { type: 'string', description: 'Optional: filter to a specific vendor/brand name' },
        includeInactive: { type: 'boolean', description: 'If true, include inactive products in results. By default, only active products are shown.' }
      }
    },
    handler: getTotalInventoryValue
  },
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
        locationId: { type: 'integer', description: 'Optional: filter to a specific location (1=SLC, 2=South Main, 3=Ogden)' },
        vendorName: { type: 'string', description: 'Optional: vendor/brand name to search directly in BigQuery (use when brand is not in the database)' }
      }
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
  },
  {
    name: 'lookup_barcodes',
    description: 'Look up specific barcodes/UPCs in BigQuery inventory across all locations. Returns exact on-hand quantities per barcode per location.',
    inputSchema: {
      type: 'object',
      properties: {
        barcodes: { type: 'array', items: { type: 'string' }, description: 'Array of barcode/UPC strings to look up' }
      },
      required: ['barcodes']
    },
    handler: lookupBarcodes
  },
  {
    name: 'get_zero_stock',
    description: 'Find all items for a vendor with 0 or negative on-hand inventory at any location. Returns compact data for identifying restock needs.',
    inputSchema: {
      type: 'object',
      properties: {
        vendorName: { type: 'string', description: 'Vendor/brand name to search in BigQuery' },
        shoeModels: { type: 'array', items: { type: 'string' }, description: 'Optional: filter to specific product descriptions (e.g. ["Skwama", "Solution"])' }
      },
      required: ['vendorName']
    },
    handler: getZeroStock
  },
  {
    name: 'find_sold_not_in_inventory',
    description: 'Find items that have recent sales but show 0 or negative inventory. These are items that may have been received but not properly added to inventory, yet have been sold through POS. Use this to identify items needing reorder or inventory correction.',
    inputSchema: {
      type: 'object',
      properties: {
        vendorName: { type: 'string', description: 'Vendor/brand name to search (e.g., "La Sportiva")' },
        orderId: { type: 'integer', description: 'Optional: check specific UPCs from this order' },
        days: { type: 'integer', description: 'Number of days to look back for sales (default: 90)' },
        locationId: { type: 'integer', description: 'Optional: filter to specific location (1=SLC, 2=South Main, 3=Ogden)' }
      }
    },
    handler: findSoldNotInInventory
  },
  {
    name: 'get_recent_sales_by_upc',
    description: 'Get recent sales transactions for specific UPCs. Useful for checking if newly received items have started selling, or verifying sales activity for items being considered for reorder.',
    inputSchema: {
      type: 'object',
      properties: {
        upcs: { type: 'array', items: { type: 'string' }, description: 'Array of UPC/barcode strings to check' },
        days: { type: 'integer', description: 'Number of days to look back (default: 30)' }
      },
      required: ['upcs']
    },
    handler: getRecentSalesByUpc
  }
];
