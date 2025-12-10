const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// GET /api/seasons - List all seasons
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM seasons
      ORDER BY start_date DESC, created_at DESC
    `);

    res.json({ seasons: result.rows });
  } catch (error) {
    console.error('Get seasons error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/seasons - Create new season (admin only)
router.post('/', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { name, start_date, end_date, status } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Season name is required' });
    }

    const result = await pool.query(
      `INSERT INTO seasons (name, start_date, end_date, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, start_date || null, end_date || null, status || 'planning']
    );

    res.status(201).json({
      message: 'Season created successfully',
      season: result.rows[0]
    });
  } catch (error) {
    console.error('Create season error:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({ error: 'Season with this name already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/seasons/:id - Get season details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('SELECT * FROM seasons WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Season not found' });
    }

    res.json({ season: result.rows[0] });
  } catch (error) {
    console.error('Get season error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/seasons/:id - Update season
router.patch('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, start_date, end_date, status } = req.body;

    const result = await pool.query(
      `UPDATE seasons
       SET name = COALESCE($1, name),
           start_date = COALESCE($2, start_date),
           end_date = COALESCE($3, end_date),
           status = COALESCE($4, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [name, start_date, end_date, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Season not found' });
    }

    res.json({
      message: 'Season updated successfully',
      season: result.rows[0]
    });
  } catch (error) {
    console.error('Update season error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/seasons/:id - Delete season (admin only)
router.delete('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if there are any orders for this season
    const ordersCheck = await pool.query(
      'SELECT COUNT(*) FROM orders WHERE season_id = $1',
      [id]
    );

    if (parseInt(ordersCheck.rows[0].count) > 0) {
      return res.status(400).json({
        error: 'Cannot delete season with existing orders. Delete the orders first.'
      });
    }

    // Delete associated budgets first
    await pool.query('DELETE FROM season_budgets WHERE season_id = $1', [id]);

    // Delete the season
    const result = await pool.query(
      'DELETE FROM seasons WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Season not found' });
    }

    res.json({ message: 'Season deleted successfully' });
  } catch (error) {
    console.error('Delete season error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/seasons/:id/summary - Get budget summary by location/brand
router.get('/:id/summary', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get all budgets for this season with spending
    const result = await pool.query(`
      SELECT
        sb.id,
        sb.season_id,
        sb.brand_id,
        sb.location_id,
        sb.budget_amount,
        b.name as brand_name,
        l.name as location_name,
        l.code as location_code,
        COALESCE(SUM(o.current_total), 0) as total_ordered
      FROM season_budgets sb
      JOIN brands b ON sb.brand_id = b.id
      JOIN locations l ON sb.location_id = l.id
      LEFT JOIN orders o ON o.season_id = sb.season_id
        AND o.brand_id = sb.brand_id
        AND o.location_id = sb.location_id
        AND o.status != 'cancelled'
      WHERE sb.season_id = $1
      GROUP BY sb.id, sb.season_id, sb.brand_id, sb.location_id,
               sb.budget_amount, b.name, l.name, l.code
      ORDER BY l.name, b.name
    `, [id]);

    // Calculate remaining budgets
    const budgets = result.rows.map(row => ({
      ...row,
      remaining: parseFloat(row.budget_amount) - parseFloat(row.total_ordered)
    }));

    res.json({ budgets });
  } catch (error) {
    console.error('Get season summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/seasons/:id/budgets - Get all budgets for season
router.get('/:id/budgets', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT
        sb.*,
        b.name as brand_name,
        l.name as location_name,
        l.code as location_code
      FROM season_budgets sb
      JOIN brands b ON sb.brand_id = b.id
      JOIN locations l ON sb.location_id = l.id
      WHERE sb.season_id = $1
      ORDER BY l.name, b.name
    `, [id]);

    res.json({ budgets: result.rows });
  } catch (error) {
    console.error('Get season budgets error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/seasons/:id/budgets - Set/update brand budgets
router.post('/:id/budgets', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { id } = req.params;
    const { budgets } = req.body; // Array of { brand_id, location_id, budget_amount }

    if (!budgets || !Array.isArray(budgets)) {
      return res.status(400).json({ error: 'Budgets array is required' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (const budget of budgets) {
        const { brand_id, location_id, budget_amount } = budget;

        if (!brand_id || !location_id || budget_amount === undefined) {
          throw new Error('Each budget must have brand_id, location_id, and budget_amount');
        }

        // Upsert budget
        await client.query(`
          INSERT INTO season_budgets (season_id, brand_id, location_id, budget_amount)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (season_id, brand_id, location_id)
          DO UPDATE SET
            budget_amount = EXCLUDED.budget_amount,
            updated_at = CURRENT_TIMESTAMP
        `, [id, brand_id, location_id, budget_amount]);
      }

      await client.query('COMMIT');

      // Return updated budgets
      const result = await client.query(`
        SELECT
          sb.*,
          b.name as brand_name,
          l.name as location_name
        FROM season_budgets sb
        JOIN brands b ON sb.brand_id = b.id
        JOIN locations l ON sb.location_id = l.id
        WHERE sb.season_id = $1
      `, [id]);

      res.json({
        message: 'Budgets updated successfully',
        budgets: result.rows
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Set season budgets error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/seasons/:id/product-breakdown - Get product breakdown by gender, category, color, size
router.get('/:id/product-breakdown', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { brandId } = req.query;

    // Build query with optional brand filter
    let whereClause = 'o.season_id = $1 AND o.status != $2';
    const params = [id, 'cancelled'];

    if (brandId) {
      whereClause += ' AND o.brand_id = $3';
      params.push(brandId);
    }

    // Get breakdown by gender (normalize similar values)
    const genderResult = await pool.query(`
      SELECT
        CASE
          WHEN LOWER(p.gender) IN ('male', 'mens', 'men', 'm', 'man') THEN 'Men'
          WHEN LOWER(p.gender) IN ('female', 'womens', 'women', 'w', 'woman', 'ladies') THEN 'Women'
          WHEN LOWER(p.gender) IN ('unisex', 'uni') THEN 'Unisex'
          WHEN LOWER(p.gender) IN ('kids', 'kid', 'youth', 'boys', 'girls', 'children', 'child') THEN 'Kids'
          WHEN p.gender IS NULL OR TRIM(p.gender) = '' THEN 'Unknown'
          ELSE INITCAP(p.gender)
        END as name,
        SUM(oi.quantity) as quantity,
        SUM(oi.line_total) as value
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE ${whereClause}
      GROUP BY CASE
          WHEN LOWER(p.gender) IN ('male', 'mens', 'men', 'm', 'man') THEN 'Men'
          WHEN LOWER(p.gender) IN ('female', 'womens', 'women', 'w', 'woman', 'ladies') THEN 'Women'
          WHEN LOWER(p.gender) IN ('unisex', 'uni') THEN 'Unisex'
          WHEN LOWER(p.gender) IN ('kids', 'kid', 'youth', 'boys', 'girls', 'children', 'child') THEN 'Kids'
          WHEN p.gender IS NULL OR TRIM(p.gender) = '' THEN 'Unknown'
          ELSE INITCAP(p.gender)
        END
      ORDER BY SUM(oi.quantity) DESC
    `, params);

    // Get breakdown by category
    const categoryResult = await pool.query(`
      SELECT
        COALESCE(p.category, 'Unknown') as name,
        SUM(oi.quantity) as quantity,
        SUM(oi.line_total) as value
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE ${whereClause}
      GROUP BY p.category
      ORDER BY SUM(oi.quantity) DESC
    `, params);

    // Get breakdown by color (top 10)
    const colorResult = await pool.query(`
      SELECT
        COALESCE(p.color, 'Unknown') as name,
        SUM(oi.quantity) as quantity,
        SUM(oi.line_total) as value
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE ${whereClause}
      GROUP BY p.color
      ORDER BY SUM(oi.quantity) DESC
      LIMIT 10
    `, params);

    // Get breakdown by size (top 15)
    const sizeResult = await pool.query(`
      SELECT
        COALESCE(p.size, 'Unknown') as name,
        SUM(oi.quantity) as quantity,
        SUM(oi.line_total) as value
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE ${whereClause}
      GROUP BY p.size
      ORDER BY SUM(oi.quantity) DESC
      LIMIT 15
    `, params);

    // Get totals (wholesale and retail)
    const totalsResult = await pool.query(`
      SELECT
        SUM(oi.quantity) as total_quantity,
        SUM(oi.line_total) as total_wholesale,
        SUM(oi.quantity * COALESCE(p.msrp, 0)) as total_retail
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE ${whereClause}
    `, params);

    const totals = totalsResult.rows[0] || { total_quantity: 0, total_wholesale: 0, total_retail: 0 };

    res.json({
      gender: genderResult.rows,
      category: categoryResult.rows,
      color: colorResult.rows,
      size: sizeResult.rows,
      totals: {
        quantity: parseInt(totals.total_quantity) || 0,
        wholesale: parseFloat(totals.total_wholesale) || 0,
        retail: parseFloat(totals.total_retail) || 0
      }
    });
  } catch (error) {
    console.error('Get product breakdown error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
