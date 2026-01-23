const pool = require('../config/database');
const { LOCATION_TO_FACILITY, bigquery } = require('./bigquery');

/**
 * Weekly inventory alert job
 * Scans all brand/location combinations for critical and low stock items
 * Sends alerts via Power Automate webhook
 */

// Stock status thresholds (in months of coverage)
const THRESHOLDS = {
  CRITICAL: 1,    // Less than 1 month = critical (need to order NOW given 1-month lead time)
  LOW: 2,         // 1-2 months = low (order soon)
  OVERSTOCKED: 6  // More than 6 months = overstocked
};

/**
 * Run the weekly inventory analysis across all brands and locations
 * @returns {Object} Analysis results with critical/low items
 */
async function runWeeklyAnalysis() {
  console.log('[InventoryAlerts] Starting weekly inventory analysis...');
  const startTime = Date.now();

  try {
    // Get all active brands and locations
    const brandsResult = await pool.query('SELECT id, name FROM brands WHERE active = true ORDER BY name');
    const locationsResult = await pool.query('SELECT id, name, code FROM locations WHERE active = true ORDER BY name');

    const brands = brandsResult.rows;
    const locations = locationsResult.rows;

    console.log(`[InventoryAlerts] Analyzing ${brands.length} brands across ${locations.length} locations`);

    const allCriticalItems = [];
    const allLowItems = [];
    const allOverstockedItems = [];
    const brandSummaries = {};

    // Analyze each brand/location combination
    for (const brand of brands) {
      brandSummaries[brand.name] = {
        critical: 0,
        low: 0,
        overstocked: 0,
        healthy: 0
      };

      for (const location of locations) {
        const facilityId = LOCATION_TO_FACILITY[location.id];
        if (!facilityId) {
          console.log(`[InventoryAlerts] Skipping ${location.name} - no facility mapping`);
          continue;
        }

        try {
          const analysis = await analyzeInventoryForBrandLocation(brand, location, facilityId);

          // Collect critical items
          analysis.critical.forEach(item => {
            allCriticalItems.push({
              brand: brand.name,
              brand_id: brand.id,
              location: location.name,
              location_id: location.id,
              ...item
            });
            brandSummaries[brand.name].critical++;
          });

          // Collect low items
          analysis.low.forEach(item => {
            allLowItems.push({
              brand: brand.name,
              brand_id: brand.id,
              location: location.name,
              location_id: location.id,
              ...item
            });
            brandSummaries[brand.name].low++;
          });

          // Collect overstocked items
          analysis.overstocked.forEach(item => {
            allOverstockedItems.push({
              brand: brand.name,
              brand_id: brand.id,
              location: location.name,
              location_id: location.id,
              ...item
            });
            brandSummaries[brand.name].overstocked++;
          });

          brandSummaries[brand.name].healthy += analysis.healthy;

        } catch (err) {
          console.error(`[InventoryAlerts] Error analyzing ${brand.name} at ${location.name}:`, err.message);
        }
      }
    }

    // Sort by severity (lowest coverage first)
    allCriticalItems.sort((a, b) => a.months_coverage - b.months_coverage);
    allLowItems.sort((a, b) => a.months_coverage - b.months_coverage);
    allOverstockedItems.sort((a, b) => b.months_coverage - a.months_coverage);

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[InventoryAlerts] Analysis complete in ${elapsedTime}s`);
    console.log(`[InventoryAlerts] Found ${allCriticalItems.length} critical, ${allLowItems.length} low, ${allOverstockedItems.length} overstocked items`);

    // Build report
    const report = {
      report_date: new Date().toISOString().split('T')[0],
      report_time: new Date().toISOString(),
      analysis_duration_seconds: parseFloat(elapsedTime),
      summary: {
        total_critical_items: allCriticalItems.length,
        total_low_items: allLowItems.length,
        total_overstocked_items: allOverstockedItems.length,
        brands_analyzed: brands.length,
        locations_analyzed: locations.length,
        brands_with_critical: Object.values(brandSummaries).filter(s => s.critical > 0).length
      },
      thresholds: THRESHOLDS,
      brand_summaries: brandSummaries,
      critical_items: allCriticalItems.slice(0, 100), // Top 100 most critical
      low_items: allLowItems.slice(0, 50),            // Top 50 low items
      overstocked_items: allOverstockedItems.slice(0, 50) // Top 50 overstocked
    };

    return report;

  } catch (error) {
    console.error('[InventoryAlerts] Analysis failed:', error);
    throw error;
  }
}

/**
 * Analyze inventory for a single brand/location combination
 */
async function analyzeInventoryForBrandLocation(brand, location, facilityId) {
  const critical = [];
  const low = [];
  const overstocked = [];
  let healthy = 0;

  // Query BigQuery for inventory and velocity
  const query = `
    WITH inventory AS (
      SELECT
        i.barcode as upc,
        i.product_description as product_name,
        i.on_hand_qty as stock_on_hand
      FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
      JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON i.barcode = p.BARCODE
      LEFT JOIN \`front-data-production.rgp_cleaned_zone.vendors_all\` v ON p.vendor_concat = v.vendor_concat
      WHERE i.facility_id = '${facilityId}'
        AND LOWER(v.VENDOR_NAME) LIKE '%${brand.name.toLowerCase()}%'
        AND i.on_hand_qty > 0
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
      COALESCE(s.months_with_sales, 0) as months_with_sales
    FROM inventory inv
    LEFT JOIN sales s ON inv.upc = s.upc
  `;

  const [rows] = await bigquery.query({ query });

  for (const row of rows) {
    const stock = parseInt(row.stock_on_hand) || 0;
    const monthsWithSales = parseInt(row.months_with_sales) || 0;
    const totalSold = parseInt(row.total_sold_12m) || 0;
    const avgMonthlySales = monthsWithSales > 0 ? totalSold / monthsWithSales : 0;

    // Skip items with no sales velocity (can't calculate coverage)
    if (avgMonthlySales <= 0) continue;

    const monthsCoverage = stock / avgMonthlySales;

    const item = {
      upc: row.upc,
      product_name: row.product_name,
      stock_on_hand: stock,
      avg_monthly_sales: Math.round(avgMonthlySales * 10) / 10,
      months_coverage: Math.round(monthsCoverage * 10) / 10,
      suggested_order_qty: Math.max(0, Math.round((avgMonthlySales * 3) - stock)) // Order to get to 3 months coverage
    };

    if (monthsCoverage < THRESHOLDS.CRITICAL) {
      critical.push(item);
    } else if (monthsCoverage < THRESHOLDS.LOW) {
      low.push(item);
    } else if (monthsCoverage > THRESHOLDS.OVERSTOCKED) {
      overstocked.push(item);
    } else {
      healthy++;
    }
  }

  return { critical, low, overstocked, healthy };
}

/**
 * Send alert to Power Automate webhook
 * @param {Object} report - The analysis report
 * @param {string} webhookUrl - Power Automate HTTP trigger URL
 */
async function sendToWebhook(report, webhookUrl) {
  if (!webhookUrl) {
    console.log('[InventoryAlerts] No webhook URL configured, skipping notification');
    return { sent: false, reason: 'No webhook URL' };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(report)
    });

    if (response.ok) {
      console.log('[InventoryAlerts] Successfully sent alert to Power Automate');
      return { sent: true };
    } else {
      const errorText = await response.text();
      console.error('[InventoryAlerts] Webhook failed:', response.status, errorText);
      return { sent: false, reason: `HTTP ${response.status}: ${errorText}` };
    }
  } catch (error) {
    console.error('[InventoryAlerts] Webhook error:', error.message);
    return { sent: false, reason: error.message };
  }
}

/**
 * Store report in database for historical tracking
 */
async function storeReport(report) {
  try {
    await pool.query(`
      INSERT INTO inventory_alert_reports (report_date, report_data, critical_count, low_count, overstocked_count)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      report.report_date,
      JSON.stringify(report),
      report.summary.total_critical_items,
      report.summary.total_low_items,
      report.summary.total_overstocked_items
    ]);
    console.log('[InventoryAlerts] Report stored in database');
    return true;
  } catch (error) {
    // Table might not exist yet, that's OK
    console.log('[InventoryAlerts] Could not store report (table may not exist):', error.message);
    return false;
  }
}

/**
 * Main function to run analysis and send alerts
 */
async function runAndNotify() {
  const report = await runWeeklyAnalysis();

  // Store in database
  await storeReport(report);

  // Send to Power Automate if configured
  const webhookUrl = process.env.POWER_AUTOMATE_WEBHOOK_URL;
  const webhookResult = await sendToWebhook(report, webhookUrl);

  return {
    report,
    webhook: webhookResult
  };
}

module.exports = {
  runWeeklyAnalysis,
  sendToWebhook,
  storeReport,
  runAndNotify,
  THRESHOLDS
};
