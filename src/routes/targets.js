const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

router.use(authenticateToken);

/**
 * GET /api/targets?brandId=&seasonId=
 * Returns target quantities joined with products and locations.
 */
router.get('/', authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { brandId, seasonId } = req.query;
    if (!brandId) return res.status(400).json({ error: 'brandId is required' });

    let query = `
      SELECT
        p.id AS product_id,
        p.upc,
        p.name AS product_name,
        p.size,
        p.color,
        p.category,
        l.id AS location_id,
        l.name AS location_name,
        COALESCE(plt.target_qty, 0) AS target_qty,
        plt.updated_at,
        plt.updated_by
      FROM products p
      CROSS JOIN locations l
      LEFT JOIN product_location_targets plt
        ON plt.product_id = p.id AND plt.location_id = l.id
      WHERE p.brand_id = $1
    `;
    const params = [brandId];
    let p = 2;

    if (seasonId) {
      query += ` AND p.season_id = $${p++}`;
      params.push(seasonId);
    }

    query += ` ORDER BY p.name, p.size, l.id`;

    const result = await pool.query(query, params);
    res.json({ targets: result.rows });
  } catch (error) {
    console.error('Targets list error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/targets
 * Batch upsert target quantities.
 * Body: { targets: [{ productId, locationId, targetQty }] }
 */
router.put('/', authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { targets } = req.body;
    if (!targets || !Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ error: 'targets array is required' });
    }

    const client = await pool.connect();
    let updated = 0;
    try {
      await client.query('BEGIN');
      for (const t of targets) {
        if (t.productId == null || t.locationId == null || t.targetQty == null) continue;
        await client.query(`
          INSERT INTO product_location_targets (product_id, location_id, target_qty, updated_at, updated_by)
          VALUES ($1, $2, $3, NOW(), $4)
          ON CONFLICT (product_id, location_id) DO UPDATE SET
            target_qty = EXCLUDED.target_qty,
            updated_at = NOW(),
            updated_by = EXCLUDED.updated_by
        `, [t.productId, t.locationId, t.targetQty, `web_user:${req.user.id}`]);
        updated++;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ updated });
  } catch (error) {
    console.error('Targets upsert error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
