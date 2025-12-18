const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// GET /api/budgets/season/:seasonId - Get budget for a season
router.get('/season/:seasonId', authenticateToken, async (req, res) => {
  try {
    const { seasonId } = req.params;

    // Get season budget
    const budgetResult = await pool.query(`
      SELECT sb.*, s.name as season_name
      FROM season_budgets sb
      JOIN seasons s ON sb.season_id = s.id
      WHERE sb.season_id = $1
    `, [seasonId]);

    // Get brand allocations
    const allocationsResult = await pool.query(`
      SELECT bba.*, b.name as brand_name
      FROM brand_budget_allocations bba
      LEFT JOIN brands b ON bba.brand_id = b.id
      WHERE bba.season_id = $1
      ORDER BY bba.allocated_amount DESC
    `, [seasonId]);

    // Get committed amounts by brand
    const committedResult = await pool.query(`
      SELECT
        p.brand_id,
        b.name as brand_name,
        SUM(oi.quantity * COALESCE(oi.unit_cost, p.wholesale_cost, 0)) as committed_amount
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN brands b ON p.brand_id = b.id
      WHERE o.season_id = $1 AND o.status != 'cancelled'
      GROUP BY p.brand_id, b.name
    `, [seasonId]);

    // Get total committed
    const totalCommittedResult = await pool.query(`
      SELECT COALESCE(SUM(oi.quantity * COALESCE(oi.unit_cost, p.wholesale_cost, 0)), 0) as total_committed
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.season_id = $1 AND o.status != 'cancelled'
    `, [seasonId]);

    const budget = budgetResult.rows[0] || null;
    const totalCommitted = parseFloat(totalCommittedResult.rows[0].total_committed) || 0;

    res.json({
      budget,
      allocations: allocationsResult.rows,
      committedByBrand: committedResult.rows,
      totalCommitted,
      remaining: budget ? parseFloat(budget.total_budget) - totalCommitted : null
    });
  } catch (error) {
    console.error('Get budget error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/budgets/season/:seasonId - Create or update season budget
router.post('/season/:seasonId', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const { seasonId } = req.params;
  const { total_budget, notes } = req.body;

  try {
    const result = await pool.query(`
      INSERT INTO season_budgets (season_id, total_budget, notes, created_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (season_id) DO UPDATE SET
        total_budget = EXCLUDED.total_budget,
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [seasonId, total_budget, notes, req.user.id]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Create budget error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/budgets/season/:seasonId/allocations - Set brand allocations
router.post('/season/:seasonId/allocations', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const { seasonId } = req.params;
  const { allocations } = req.body; // Array of { brand_id, allocated_amount, notes }
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Clear existing allocations for this season
    await client.query('DELETE FROM brand_budget_allocations WHERE season_id = $1', [seasonId]);

    // Insert new allocations
    for (const alloc of allocations) {
      // Get brand name for record keeping
      const brandResult = await client.query('SELECT name FROM brands WHERE id = $1', [alloc.brand_id]);
      const brandName = brandResult.rows[0]?.name || null;

      await client.query(`
        INSERT INTO brand_budget_allocations
        (season_id, brand_id, brand_name, allocated_amount, last_year_revenue, last_year_pct, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        seasonId,
        alloc.brand_id,
        brandName,
        alloc.allocated_amount,
        alloc.last_year_revenue || null,
        alloc.last_year_pct || null,
        alloc.notes || null
      ]);
    }

    await client.query('COMMIT');

    // Return updated allocations
    const result = await pool.query(`
      SELECT bba.*, b.name as brand_name
      FROM brand_budget_allocations bba
      LEFT JOIN brands b ON bba.brand_id = b.id
      WHERE bba.season_id = $1
      ORDER BY bba.allocated_amount DESC
    `, [seasonId]);

    res.json({ allocations: result.rows });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Set allocations error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// GET /api/budgets/suggest/:seasonId - Suggest allocations based on sales data
router.get('/suggest/:seasonId', authenticateToken, async (req, res) => {
  try {
    const { seasonId } = req.params;
    const { total_budget } = req.query;

    if (!total_budget) {
      return res.status(400).json({ error: 'total_budget query parameter required' });
    }

    // Get sales by brand from last 12 months
    const salesResult = await pool.query(`
      SELECT
        bm.brand_id,
        b.name as brand_name,
        sbc.rgp_vendor_name,
        SUM(sbc.total_revenue) as last_year_revenue
      FROM sales_by_brand_category sbc
      LEFT JOIN brand_mapping bm ON sbc.rgp_vendor_name = bm.rgp_vendor_name
      LEFT JOIN brands b ON bm.brand_id = b.id
      WHERE sbc.period_months = 12
        AND bm.brand_id IS NOT NULL
      GROUP BY bm.brand_id, b.name, sbc.rgp_vendor_name
      ORDER BY last_year_revenue DESC
    `);

    // Calculate total revenue
    const totalRevenue = salesResult.rows.reduce((sum, r) => sum + parseFloat(r.last_year_revenue || 0), 0);

    // Calculate suggested allocations
    const suggestions = salesResult.rows.map(row => {
      const pct = totalRevenue > 0 ? (parseFloat(row.last_year_revenue) / totalRevenue) * 100 : 0;
      return {
        brand_id: row.brand_id,
        brand_name: row.brand_name,
        rgp_vendor_name: row.rgp_vendor_name,
        last_year_revenue: parseFloat(row.last_year_revenue),
        last_year_pct: Math.round(pct * 100) / 100,
        suggested_allocation: Math.round((pct / 100) * parseFloat(total_budget) * 100) / 100
      };
    });

    res.json({
      total_budget: parseFloat(total_budget),
      total_last_year_revenue: totalRevenue,
      suggestions
    });
  } catch (error) {
    console.error('Suggest allocations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/budgets/status - Get budget status for all seasons
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        s.id as season_id,
        s.name as season_name,
        s.status as season_status,
        sb.total_budget,
        COALESCE(SUM(oi.quantity * COALESCE(oi.unit_cost, p.wholesale_cost, 0)), 0) as total_committed,
        sb.total_budget - COALESCE(SUM(oi.quantity * COALESCE(oi.unit_cost, p.wholesale_cost, 0)), 0) as remaining,
        COUNT(DISTINCT o.id) as order_count
      FROM seasons s
      LEFT JOIN season_budgets sb ON s.id = sb.season_id
      LEFT JOIN orders o ON s.id = o.season_id AND o.status != 'cancelled'
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN products p ON oi.product_id = p.id
      GROUP BY s.id, s.name, s.status, sb.total_budget
      ORDER BY s.start_date DESC
    `);

    res.json({ seasons: result.rows });
  } catch (error) {
    console.error('Get budget status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/budgets/season/:seasonId - Delete season budget
router.delete('/season/:seasonId', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete allocations first
    await client.query('DELETE FROM brand_budget_allocations WHERE season_id = $1', [req.params.seasonId]);

    // Delete budget
    await client.query('DELETE FROM season_budgets WHERE season_id = $1', [req.params.seasonId]);

    await client.query('COMMIT');
    res.json({ message: 'Budget deleted' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete budget error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
