const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// GET /api/prices/compare - Side-by-side price comparison between two seasons
router.get('/compare', authenticateToken, async (req, res) => {
  try {
    const { season1, season2, brandId } = req.query;

    if (!season1 || !season2) {
      return res.status(400).json({ error: 'Both season1 and season2 are required' });
    }

    let whereClause = '';
    const params = [season1, season2];

    if (brandId) {
      whereClause = 'AND p.brand_id = $3';
      params.push(brandId);
    }

    const result = await pool.query(`
      SELECT
        p.id as product_id,
        p.upc,
        p.sku,
        p.name,
        p.base_name,
        p.category,
        p.gender,
        b.name as brand_name,
        s1.name as season1_name,
        sp1.wholesale_cost as season1_wholesale,
        sp1.msrp as season1_msrp,
        s2.name as season2_name,
        sp2.wholesale_cost as season2_wholesale,
        sp2.msrp as season2_msrp,
        (sp2.wholesale_cost - sp1.wholesale_cost) as wholesale_diff,
        (sp2.msrp - sp1.msrp) as msrp_diff,
        CASE
          WHEN sp1.wholesale_cost > 0 THEN
            ROUND(((sp2.wholesale_cost - sp1.wholesale_cost) / sp1.wholesale_cost) * 100, 2)
          ELSE NULL
        END as wholesale_pct_change,
        CASE
          WHEN sp1.msrp > 0 THEN
            ROUND(((sp2.msrp - sp1.msrp) / sp1.msrp) * 100, 2)
          ELSE NULL
        END as msrp_pct_change,
        CASE
          WHEN sp1.id IS NOT NULL AND sp2.id IS NOT NULL THEN 'carryover'
          WHEN sp1.id IS NOT NULL THEN 'discontinued'
          WHEN sp2.id IS NOT NULL THEN 'new'
        END as product_status
      FROM products p
      JOIN brands b ON p.brand_id = b.id
      LEFT JOIN season_prices sp1 ON p.id = sp1.product_id AND sp1.season_id = $1
      LEFT JOIN season_prices sp2 ON p.id = sp2.product_id AND sp2.season_id = $2
      LEFT JOIN seasons s1 ON s1.id = $1
      LEFT JOIN seasons s2 ON s2.id = $2
      WHERE (sp1.id IS NOT NULL OR sp2.id IS NOT NULL)
        ${whereClause}
      ORDER BY b.name, p.name
    `, params);

    // Get season names for header
    const seasonsResult = await pool.query(`
      SELECT id, name FROM seasons WHERE id IN ($1, $2)
    `, [season1, season2]);

    const seasons = {};
    seasonsResult.rows.forEach(s => {
      seasons[s.id] = s.name;
    });

    // Calculate summary stats
    const summary = {
      total_products: result.rows.length,
      carryover: result.rows.filter(r => r.product_status === 'carryover').length,
      new_products: result.rows.filter(r => r.product_status === 'new').length,
      discontinued: result.rows.filter(r => r.product_status === 'discontinued').length,
      price_increases: result.rows.filter(r => r.wholesale_diff > 0).length,
      price_decreases: result.rows.filter(r => r.wholesale_diff < 0).length,
      unchanged: result.rows.filter(r => r.wholesale_diff === 0).length
    };

    res.json({
      products: result.rows,
      seasons: {
        season1: seasons[season1],
        season2: seasons[season2]
      },
      summary
    });
  } catch (error) {
    console.error('Compare prices error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// GET /api/prices/product/:productId/history - Get price change history for a product
router.get('/product/:productId/history', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.params;

    // Get product info
    const productResult = await pool.query(`
      SELECT p.*, b.name as brand_name
      FROM products p
      JOIN brands b ON p.brand_id = b.id
      WHERE p.id = $1
    `, [productId]);

    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Get price history
    const historyResult = await pool.query(`
      SELECT
        ph.*,
        s.name as season_name
      FROM price_history ph
      LEFT JOIN seasons s ON ph.season_id = s.id
      WHERE ph.product_id = $1
      ORDER BY ph.changed_at DESC
    `, [productId]);

    // Get all seasonal prices for this product
    const seasonPricesResult = await pool.query(`
      SELECT
        sp.*,
        s.name as season_name,
        s.start_date,
        s.end_date,
        s.status as season_status
      FROM season_prices sp
      JOIN seasons s ON sp.season_id = s.id
      WHERE sp.product_id = $1
      ORDER BY s.start_date DESC
    `, [productId]);

    res.json({
      product: productResult.rows[0],
      history: historyResult.rows,
      season_prices: seasonPricesResult.rows
    });
  } catch (error) {
    console.error('Get product price history error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// GET /api/prices/carryover/:seasonId - Get carry-over products for a season
router.get('/carryover/:seasonId', authenticateToken, async (req, res) => {
  try {
    const { seasonId } = req.params;
    const { brandId } = req.query;

    // Get the previous season
    const prevSeasonResult = await pool.query(`
      SELECT id, name, start_date
      FROM seasons
      WHERE start_date < (SELECT start_date FROM seasons WHERE id = $1)
      ORDER BY start_date DESC
      LIMIT 1
    `, [seasonId]);

    if (prevSeasonResult.rows.length === 0) {
      return res.json({
        message: 'No previous season found for comparison',
        products: [],
        current_season: null,
        previous_season: null
      });
    }

    const prevSeasonId = prevSeasonResult.rows[0].id;

    let whereClause = '';
    const params = [seasonId, prevSeasonId];

    if (brandId) {
      whereClause = 'AND p.brand_id = $3';
      params.push(brandId);
    }

    // Find products that exist in both seasons (matched by UPC)
    const result = await pool.query(`
      SELECT
        p.id as product_id,
        p.upc,
        p.sku,
        p.name,
        p.base_name,
        p.category,
        p.gender,
        b.name as brand_name,
        sp_current.wholesale_cost as current_wholesale,
        sp_current.msrp as current_msrp,
        sp_prev.wholesale_cost as previous_wholesale,
        sp_prev.msrp as previous_msrp,
        (sp_current.wholesale_cost - sp_prev.wholesale_cost) as wholesale_change,
        CASE
          WHEN sp_prev.wholesale_cost > 0 THEN
            ROUND(((sp_current.wholesale_cost - sp_prev.wholesale_cost) / sp_prev.wholesale_cost) * 100, 2)
          ELSE NULL
        END as wholesale_pct_change
      FROM products p
      JOIN brands b ON p.brand_id = b.id
      JOIN season_prices sp_current ON p.id = sp_current.product_id AND sp_current.season_id = $1
      JOIN season_prices sp_prev ON p.id = sp_prev.product_id AND sp_prev.season_id = $2
      WHERE 1=1 ${whereClause}
      ORDER BY b.name, p.name
    `, params);

    // Get season info
    const currentSeasonResult = await pool.query('SELECT * FROM seasons WHERE id = $1', [seasonId]);

    res.json({
      products: result.rows,
      current_season: currentSeasonResult.rows[0],
      previous_season: prevSeasonResult.rows[0],
      summary: {
        total_carryover: result.rows.length,
        price_increases: result.rows.filter(r => r.wholesale_change > 0).length,
        price_decreases: result.rows.filter(r => r.wholesale_change < 0).length,
        unchanged: result.rows.filter(r => r.wholesale_change === 0).length
      }
    });
  } catch (error) {
    console.error('Get carryover products error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// GET /api/prices/season/:seasonId - Get all prices for a season
router.get('/season/:seasonId', authenticateToken, async (req, res) => {
  try {
    const { seasonId } = req.params;
    const { brandId, category, limit = 100, offset = 0 } = req.query;

    let whereClause = 'sp.season_id = $1';
    const params = [seasonId];
    let paramIndex = 2;

    if (brandId) {
      whereClause += ` AND p.brand_id = $${paramIndex}`;
      params.push(brandId);
      paramIndex++;
    }

    if (category) {
      whereClause += ` AND p.category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(`
      SELECT
        sp.id,
        sp.product_id,
        sp.season_id,
        sp.wholesale_cost,
        sp.msrp,
        sp.created_at,
        sp.updated_at,
        p.upc,
        p.sku,
        p.name,
        p.base_name,
        p.category,
        p.subcategory,
        p.gender,
        p.size,
        p.color,
        b.name as brand_name,
        s.name as season_name
      FROM season_prices sp
      JOIN products p ON sp.product_id = p.id
      JOIN brands b ON p.brand_id = b.id
      JOIN seasons s ON sp.season_id = s.id
      WHERE ${whereClause}
      ORDER BY b.name, p.name
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    // Get total count
    const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM season_prices sp
      JOIN products p ON sp.product_id = p.id
      WHERE ${whereClause}
    `, params.slice(0, -2));

    res.json({
      prices: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get season prices error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// POST /api/prices - Create or update a price for a product in a season
router.post('/', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { product_id, season_id, wholesale_cost, msrp } = req.body;

    if (!product_id || !season_id) {
      return res.status(400).json({ error: 'product_id and season_id are required' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get existing price for history tracking
      const existingResult = await client.query(`
        SELECT wholesale_cost, msrp FROM season_prices
        WHERE product_id = $1 AND season_id = $2
      `, [product_id, season_id]);

      const existing = existingResult.rows[0];

      // Upsert the price
      const result = await client.query(`
        INSERT INTO season_prices (product_id, season_id, wholesale_cost, msrp)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (product_id, season_id) DO UPDATE SET
          wholesale_cost = EXCLUDED.wholesale_cost,
          msrp = EXCLUDED.msrp,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [product_id, season_id, wholesale_cost, msrp]);

      // Record price history
      await client.query(`
        INSERT INTO price_history (product_id, season_id, old_wholesale_cost, new_wholesale_cost, old_msrp, new_msrp, change_reason)
        VALUES ($1, $2, $3, $4, $5, $6, 'manual_edit')
      `, [
        product_id,
        season_id,
        existing?.wholesale_cost || null,
        wholesale_cost,
        existing?.msrp || null,
        msrp
      ]);

      await client.query('COMMIT');

      res.json({
        message: existing ? 'Price updated successfully' : 'Price created successfully',
        price: result.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Create/update price error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// GET /api/prices/seasons-with-prices - Get seasons that have prices
router.get('/seasons-with-prices', authenticateToken, async (req, res) => {
  try {
    const { brandId } = req.query;

    let whereClause = '';
    const params = [];

    if (brandId) {
      whereClause = 'WHERE p.brand_id = $1';
      params.push(brandId);
    }

    const result = await pool.query(`
      SELECT DISTINCT
        s.id,
        s.name,
        s.start_date,
        s.end_date,
        s.status,
        COUNT(sp.id) as product_count
      FROM seasons s
      JOIN season_prices sp ON s.id = sp.season_id
      JOIN products p ON sp.product_id = p.id
      ${whereClause}
      GROUP BY s.id, s.name, s.start_date, s.end_date, s.status
      ORDER BY s.start_date DESC
    `, params);

    res.json({ seasons: result.rows });
  } catch (error) {
    console.error('Get seasons with prices error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;
// Trigger redeploy - Mon Dec 15 14:39:59 MST 2025
