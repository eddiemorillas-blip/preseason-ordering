const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

let bigqueryService;
try {
  bigqueryService = require('../services/bigquery');
} catch (err) {
  console.warn('BigQuery service not available:', err.message);
}

// GET /api/sales/test-connection - Test BigQuery connection
router.get('/test-connection', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    if (!bigqueryService) {
      return res.status(503).json({ error: 'BigQuery service not configured' });
    }
    const result = await bigqueryService.testConnection();
    res.json(result);
  } catch (error) {
    console.error('BigQuery connection test error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sales/sync - Sync sales data from BigQuery
router.post('/sync', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const { months = 12 } = req.body;
  const client = await pool.connect();

  try {
    if (!bigqueryService) {
      return res.status(503).json({ error: 'BigQuery service not configured' });
    }

    // Create sync log entry
    const logResult = await client.query(`
      INSERT INTO bigquery_sync_log (sync_type, period_months, triggered_by, status)
      VALUES ('full_sync', $1, $2, 'running')
      RETURNING id
    `, [months, req.user.id]);
    const syncLogId = logResult.rows[0].id;

    res.json({
      message: 'Sync started',
      syncId: syncLogId,
      note: 'This may take a few minutes. Check /api/sales/sync-status/' + syncLogId
    });

    // Run sync in background
    runFullSync(syncLogId, months, req.user.id).catch(err => {
      console.error('Background sync error:', err);
    });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Background sync function
async function runFullSync(syncLogId, months, userId) {
  const client = await pool.connect();
  let totalRecords = 0;

  try {
    // 1. Sync sales by UPC
    console.log('Syncing sales by UPC...');
    const salesByUpcRaw = await bigqueryService.getSalesByUPC(months);

    // Deduplicate by aggregating rows with same UPC + facility_id
    const upcMap = new Map();
    for (const row of salesByUpcRaw) {
      const key = `${row.upc}|${row.facility_id?.toString() || 'null'}`;
      if (upcMap.has(key)) {
        const existing = upcMap.get(key);
        existing.total_qty_sold += row.total_qty_sold || 0;
        existing.total_revenue += row.total_revenue || 0;
        existing.transaction_count += row.transaction_count || 0;
        // Keep earliest first_sale and latest last_sale
        if (row.first_sale?.value && (!existing.first_sale?.value || row.first_sale.value < existing.first_sale.value)) {
          existing.first_sale = row.first_sale;
        }
        if (row.last_sale?.value && (!existing.last_sale?.value || row.last_sale.value > existing.last_sale.value)) {
          existing.last_sale = row.last_sale;
        }
      } else {
        upcMap.set(key, { ...row });
      }
    }
    const salesByUpc = Array.from(upcMap.values());
    console.log(`Deduplicated ${salesByUpcRaw.length} rows to ${salesByUpc.length} unique UPC/facility combinations`);

    // Clear old data for this period
    await client.query('DELETE FROM sales_by_upc WHERE period_months = $1', [months]);

    // Insert in batches
    for (let i = 0; i < salesByUpc.length; i += 500) {
      const batch = salesByUpc.slice(i, i + 500);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const row of batch) {
        values.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7}, $${paramIdx+8}, $${paramIdx+9}, $${paramIdx+10}, $${paramIdx+11})`);
        params.push(
          row.upc,
          row.product_name,
          row.category,
          row.revenue_category,
          row.vendor_name,
          row.facility_id?.toString(),
          row.total_qty_sold,
          row.total_revenue,
          row.transaction_count,
          row.first_sale?.value || null,
          row.last_sale?.value || null,
          months
        );
        paramIdx += 12;
      }

      if (values.length > 0) {
        await client.query(`
          INSERT INTO sales_by_upc
          (upc, product_name, rgp_category, rgp_revenue_category, rgp_vendor_name,
           facility_id, total_qty_sold, total_revenue, transaction_count,
           first_sale_date, last_sale_date, period_months)
          VALUES ${values.join(', ')}
          ON CONFLICT (upc, facility_id, period_months) DO UPDATE SET
            product_name = EXCLUDED.product_name,
            total_qty_sold = EXCLUDED.total_qty_sold,
            total_revenue = EXCLUDED.total_revenue,
            transaction_count = EXCLUDED.transaction_count,
            synced_at = CURRENT_TIMESTAMP
        `, params);
      }
    }
    totalRecords += salesByUpc.length;
    console.log(`Synced ${salesByUpc.length} UPC records`);

    // 2. Sync sales by brand/category
    console.log('Syncing sales by brand/category...');
    const salesByBrandRaw = await bigqueryService.getSalesByBrandCategory(months);

    // Deduplicate by aggregating rows with same vendor_name + category + facility_id
    const brandMap = new Map();
    for (const row of salesByBrandRaw) {
      const key = `${row.vendor_name || 'null'}|${row.category || 'null'}|${row.facility_id?.toString() || 'null'}`;
      if (brandMap.has(key)) {
        const existing = brandMap.get(key);
        existing.unique_products += row.unique_products || 0;
        existing.total_qty_sold += row.total_qty_sold || 0;
        existing.total_revenue += row.total_revenue || 0;
      } else {
        brandMap.set(key, { ...row });
      }
    }
    const salesByBrand = Array.from(brandMap.values());
    console.log(`Deduplicated ${salesByBrandRaw.length} rows to ${salesByBrand.length} unique brand/category/facility combinations`);

    await client.query('DELETE FROM sales_by_brand_category WHERE period_months = $1', [months]);

    for (let i = 0; i < salesByBrand.length; i += 500) {
      const batch = salesByBrand.slice(i, i + 500);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const row of batch) {
        values.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7})`);
        params.push(
          row.vendor_name,
          row.category,
          row.revenue_category,
          row.facility_id?.toString(),
          row.unique_products,
          row.total_qty_sold,
          row.total_revenue,
          months
        );
        paramIdx += 8;
      }

      if (values.length > 0) {
        await client.query(`
          INSERT INTO sales_by_brand_category
          (rgp_vendor_name, category, revenue_category, facility_id,
           unique_products, total_qty_sold, total_revenue, period_months)
          VALUES ${values.join(', ')}
          ON CONFLICT (rgp_vendor_name, category, facility_id, period_months) DO UPDATE SET
            unique_products = EXCLUDED.unique_products,
            total_qty_sold = EXCLUDED.total_qty_sold,
            total_revenue = EXCLUDED.total_revenue,
            synced_at = CURRENT_TIMESTAMP
        `, params);
      }
    }
    totalRecords += salesByBrand.length;
    console.log(`Synced ${salesByBrand.length} brand/category records`);

    // 3. Sync monthly trends
    console.log('Syncing monthly trends...');
    const monthlyTrendsRaw = await bigqueryService.getMonthlySalesByBrand(months);

    // Deduplicate by aggregating rows with same vendor_name + month
    const trendsMap = new Map();
    for (const row of monthlyTrendsRaw) {
      const key = `${row.vendor_name || 'null'}|${row.month || 'null'}`;
      if (trendsMap.has(key)) {
        const existing = trendsMap.get(key);
        existing.total_qty_sold += row.total_qty_sold || 0;
        existing.total_revenue += row.total_revenue || 0;
      } else {
        trendsMap.set(key, { ...row });
      }
    }
    const monthlyTrends = Array.from(trendsMap.values());
    console.log(`Deduplicated ${monthlyTrendsRaw.length} rows to ${monthlyTrends.length} unique vendor/month combinations`);

    await client.query('DELETE FROM sales_monthly_trends');

    for (let i = 0; i < monthlyTrends.length; i += 500) {
      const batch = monthlyTrends.slice(i, i + 500);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const row of batch) {
        values.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3})`);
        params.push(row.vendor_name, row.month, row.total_qty_sold, row.total_revenue);
        paramIdx += 4;
      }

      if (values.length > 0) {
        await client.query(`
          INSERT INTO sales_monthly_trends
          (rgp_vendor_name, month, total_qty_sold, total_revenue)
          VALUES ${values.join(', ')}
          ON CONFLICT (rgp_vendor_name, month) DO UPDATE SET
            total_qty_sold = EXCLUDED.total_qty_sold,
            total_revenue = EXCLUDED.total_revenue,
            synced_at = CURRENT_TIMESTAMP
        `, params);
      }
    }
    totalRecords += monthlyTrends.length;
    console.log(`Synced ${monthlyTrends.length} monthly trend records`);

    // 4. Auto-create brand mappings for new vendors
    await client.query(`
      INSERT INTO brand_mapping (rgp_vendor_name)
      SELECT DISTINCT rgp_vendor_name FROM sales_by_brand_category
      WHERE rgp_vendor_name IS NOT NULL
      ON CONFLICT (rgp_vendor_name) DO NOTHING
    `);

    // Update sync log
    await client.query(`
      UPDATE bigquery_sync_log
      SET status = 'completed', records_synced = $1, completed_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [totalRecords, syncLogId]);

    console.log(`Sync completed: ${totalRecords} total records`);

  } catch (error) {
    console.error('Sync error:', error);
    await client.query(`
      UPDATE bigquery_sync_log
      SET status = 'failed', error_message = $1, completed_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [error.message, syncLogId]);
  } finally {
    client.release();
  }
}

// GET /api/sales/sync-status/:id - Get sync status
router.get('/sync-status/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM bigquery_sync_log WHERE id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sync not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sales/by-upc/:upc - Get sales data for a specific UPC
router.get('/by-upc/:upc', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM sales_by_upc WHERE upc = $1
      ORDER BY total_revenue DESC
    `, [req.params.upc]);
    res.json({ sales: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sales/debug/vendor/:vendorName - Debug: get all sales for a vendor
router.get('/debug/vendor/:vendorName', authenticateToken, async (req, res) => {
  try {
    const { facility_id } = req.query;
    let query = `
      SELECT
        rgp_vendor_name,
        facility_id,
        upc,
        product_name,
        total_qty_sold,
        total_revenue,
        first_sale_date,
        last_sale_date,
        period_months
      FROM sales_by_upc
      WHERE LOWER(rgp_vendor_name) LIKE $1
    `;
    const params = [`%${req.params.vendorName.toLowerCase()}%`];

    if (facility_id) {
      query += ` AND facility_id = $2`;
      params.push(facility_id);
    }

    query += ` ORDER BY total_qty_sold DESC`;

    const result = await pool.query(query, params);

    // Also get totals
    let totalsQuery = `
      SELECT
        facility_id,
        COUNT(*) as product_count,
        SUM(total_qty_sold) as total_units,
        SUM(total_revenue) as total_revenue
      FROM sales_by_upc
      WHERE LOWER(rgp_vendor_name) LIKE $1
    `;
    const totalsParams = [`%${req.params.vendorName.toLowerCase()}%`];

    if (facility_id) {
      totalsQuery += ` AND facility_id = $2`;
      totalsParams.push(facility_id);
    }

    totalsQuery += ` GROUP BY facility_id ORDER BY facility_id`;

    const totalsResult = await pool.query(totalsQuery, totalsParams);

    res.json({
      products: result.rows,
      totals_by_facility: totalsResult.rows,
      facility_mapping: {
        '41185': 'SLC',
        '1003': 'South Main',
        '1000': 'Ogden'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sales/by-brand - Get sales summary by brand
router.get('/by-brand', authenticateToken, async (req, res) => {
  try {
    const { period_months = 12 } = req.query;
    const result = await pool.query(`
      SELECT
        sbc.rgp_vendor_name,
        bm.brand_id,
        b.name as mapped_brand_name,
        SUM(sbc.total_qty_sold) as total_qty_sold,
        SUM(sbc.total_revenue) as total_revenue,
        SUM(sbc.unique_products) as unique_products
      FROM sales_by_brand_category sbc
      LEFT JOIN brand_mapping bm ON sbc.rgp_vendor_name = bm.rgp_vendor_name
      LEFT JOIN brands b ON bm.brand_id = b.id
      WHERE sbc.period_months = $1
      GROUP BY sbc.rgp_vendor_name, bm.brand_id, b.name
      ORDER BY total_revenue DESC
    `, [period_months]);
    res.json({ sales: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sales/trends/:vendorName - Get monthly trends for a vendor
router.get('/trends/:vendorName', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT month, total_qty_sold, total_revenue
      FROM sales_monthly_trends
      WHERE rgp_vendor_name = $1
      ORDER BY month
    `, [req.params.vendorName]);
    res.json({ trends: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sales/brand-mapping - Get brand mappings
router.get('/brand-mapping', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT bm.*, b.name as brand_name,
        (SELECT SUM(total_revenue) FROM sales_by_brand_category WHERE rgp_vendor_name = bm.rgp_vendor_name) as total_revenue
      FROM brand_mapping bm
      LEFT JOIN brands b ON bm.brand_id = b.id
      ORDER BY total_revenue DESC NULLS LAST
    `);
    res.json({ mappings: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/sales/brand-mapping/:id - Update brand mapping
router.put('/brand-mapping/:id', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { brand_id, is_verified } = req.body;
    const result = await pool.query(`
      UPDATE brand_mapping
      SET brand_id = $1, is_verified = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [brand_id, is_verified || false, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Mapping not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sales/brand-mapping/auto-map - Auto-map vendor names to brands
router.post('/brand-mapping/auto-map', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const client = await pool.connect();

  try {
    // Get all unmapped vendor names
    const unmappedResult = await client.query(`
      SELECT id, rgp_vendor_name FROM brand_mapping WHERE brand_id IS NULL
    `);

    // Get all brands
    const brandsResult = await client.query(`SELECT id, name FROM brands`);
    const brands = brandsResult.rows;

    // Helper to normalize names for comparison
    const normalize = (str) => {
      if (!str) return '';
      return str
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // Remove special chars
        .replace(/\s+(inc|llc|co|corp|corporation|company|ltd|limited|usa|north america|international)\.?\s*$/i, '') // Remove common suffixes
        .replace(/\s+/g, ' ')
        .trim();
    };

    let mapped = 0;
    const mappings = [];

    for (const vendor of unmappedResult.rows) {
      const vendorNorm = normalize(vendor.rgp_vendor_name);
      let bestMatch = null;
      let matchType = null;

      for (const brand of brands) {
        const brandNorm = normalize(brand.name);

        // Exact match (after normalization)
        if (vendorNorm === brandNorm) {
          bestMatch = brand;
          matchType = 'exact';
          break;
        }

        // One contains the other
        if (vendorNorm.includes(brandNorm) || brandNorm.includes(vendorNorm)) {
          // Prefer longer matches (more specific)
          if (!bestMatch || brand.name.length > bestMatch.name.length) {
            bestMatch = brand;
            matchType = 'contains';
          }
        }

        // First word match (e.g., "Scarpa" matches "Scarpa North America")
        const vendorFirst = vendorNorm.split(' ')[0];
        const brandFirst = brandNorm.split(' ')[0];
        if (vendorFirst.length >= 3 && vendorFirst === brandFirst && !bestMatch) {
          bestMatch = brand;
          matchType = 'first-word';
        }
      }

      if (bestMatch) {
        await client.query(`
          UPDATE brand_mapping
          SET brand_id = $1, is_verified = false, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [bestMatch.id, vendor.id]);
        mapped++;
        mappings.push({
          rgp_vendor_name: vendor.rgp_vendor_name,
          mapped_to: bestMatch.name,
          match_type: matchType
        });
      }
    }

    res.json({
      message: `Auto-mapped ${mapped} vendor names`,
      mapped_count: mapped,
      unmapped_remaining: unmappedResult.rows.length - mapped,
      mappings
    });
  } catch (error) {
    console.error('Auto-map error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// GET /api/sales/summary - Get overall sales summary
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const lastSync = await pool.query(`
      SELECT * FROM bigquery_sync_log
      WHERE status = 'completed'
      ORDER BY completed_at DESC LIMIT 1
    `);

    const totalsByBrand = await pool.query(`
      SELECT COUNT(DISTINCT rgp_vendor_name) as brand_count,
             SUM(total_revenue) as total_revenue,
             SUM(total_qty_sold) as total_qty_sold
      FROM sales_by_brand_category
      WHERE period_months = 12
    `);

    const topBrands = await pool.query(`
      SELECT rgp_vendor_name, SUM(total_revenue) as revenue
      FROM sales_by_brand_category
      WHERE period_months = 12
      GROUP BY rgp_vendor_name
      ORDER BY revenue DESC
      LIMIT 10
    `);

    res.json({
      lastSync: lastSync.rows[0] || null,
      totals: totalsByBrand.rows[0],
      topBrands: topBrands.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
