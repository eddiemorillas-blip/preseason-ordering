const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// GET /api/product-cases - Get all case mappings (optionally filtered by brand)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { brandId, productId } = req.query;

    let query = `
      SELECT
        pc.id,
        pc.product_id,
        pc.case_sku,
        pc.case_name,
        pc.units_per_case,
        pc.active,
        pc.created_at,
        p.name as product_name,
        p.upc as product_upc,
        p.sku as product_sku,
        b.id as brand_id,
        b.name as brand_name
      FROM product_cases pc
      JOIN products p ON pc.product_id = p.id
      JOIN brands b ON p.brand_id = b.id
      WHERE 1=1
    `;
    const params = [];

    if (brandId) {
      params.push(brandId);
      query += ` AND b.id = $${params.length}`;
    }

    if (productId) {
      params.push(productId);
      query += ` AND pc.product_id = $${params.length}`;
    }

    query += ' ORDER BY b.name, p.name, pc.units_per_case';

    const result = await pool.query(query, params);
    res.json({ cases: result.rows });
  } catch (error) {
    console.error('Get product cases error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/product-cases/by-upc/:upc - Get case mappings for a product by UPC
router.get('/by-upc/:upc', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        pc.id,
        pc.product_id,
        pc.case_sku,
        pc.case_name,
        pc.units_per_case,
        pc.active,
        p.name as product_name,
        p.upc as product_upc
      FROM product_cases pc
      JOIN products p ON pc.product_id = p.id
      WHERE p.upc = $1 AND pc.active = true
      ORDER BY pc.units_per_case
    `, [req.params.upc]);

    res.json({ cases: result.rows });
  } catch (error) {
    console.error('Get cases by UPC error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/product-cases - Create a new case mapping
router.post('/', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { product_id, case_sku, case_name, units_per_case } = req.body;

    if (!product_id || !case_sku || !units_per_case) {
      return res.status(400).json({
        error: 'product_id, case_sku, and units_per_case are required'
      });
    }

    // Verify product exists
    const productCheck = await pool.query('SELECT id FROM products WHERE id = $1', [product_id]);
    if (productCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const result = await pool.query(`
      INSERT INTO product_cases (product_id, case_sku, case_name, units_per_case)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [product_id, case_sku, case_name || null, units_per_case]);

    res.status(201).json({ case: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Case SKU already exists for this product' });
    }
    console.error('Create product case error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/product-cases/bulk - Bulk create/update case mappings
router.post('/bulk', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { cases } = req.body;

    if (!Array.isArray(cases) || cases.length === 0) {
      return res.status(400).json({ error: 'cases array is required' });
    }

    await client.query('BEGIN');

    const results = { created: 0, updated: 0, errors: [] };

    for (const caseData of cases) {
      const { product_id, upc, case_sku, case_name, units_per_case } = caseData;

      // If UPC provided instead of product_id, look up the product
      let productId = product_id;
      if (!productId && upc) {
        const productResult = await client.query(
          'SELECT id FROM products WHERE upc = $1', [upc]
        );
        if (productResult.rows.length > 0) {
          productId = productResult.rows[0].id;
        } else {
          results.errors.push({ upc, error: 'Product not found' });
          continue;
        }
      }

      if (!productId || !case_sku || !units_per_case) {
        results.errors.push({
          case_sku,
          error: 'product_id/upc, case_sku, and units_per_case are required'
        });
        continue;
      }

      // Upsert the case mapping
      const upsertResult = await client.query(`
        INSERT INTO product_cases (product_id, case_sku, case_name, units_per_case)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (product_id, case_sku) DO UPDATE SET
          case_name = EXCLUDED.case_name,
          units_per_case = EXCLUDED.units_per_case,
          updated_at = CURRENT_TIMESTAMP
        RETURNING (xmax = 0) as inserted
      `, [productId, case_sku, case_name || null, units_per_case]);

      if (upsertResult.rows[0].inserted) {
        results.created++;
      } else {
        results.updated++;
      }
    }

    await client.query('COMMIT');

    res.json({
      message: `Processed ${results.created + results.updated} case mappings`,
      ...results
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Bulk create product cases error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PATCH /api/product-cases/:id - Update a case mapping
router.patch('/:id', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { case_sku, case_name, units_per_case, active } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (case_sku !== undefined) {
      updates.push(`case_sku = $${paramIndex++}`);
      params.push(case_sku);
    }
    if (case_name !== undefined) {
      updates.push(`case_name = $${paramIndex++}`);
      params.push(case_name);
    }
    if (units_per_case !== undefined) {
      updates.push(`units_per_case = $${paramIndex++}`);
      params.push(units_per_case);
    }
    if (active !== undefined) {
      updates.push(`active = $${paramIndex++}`);
      params.push(active);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(req.params.id);

    const result = await pool.query(`
      UPDATE product_cases
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Case mapping not found' });
    }

    res.json({ case: result.rows[0] });
  } catch (error) {
    console.error('Update product case error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/product-cases/:id - Delete a case mapping
router.delete('/:id', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM product_cases WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Case mapping not found' });
    }

    res.json({ message: 'Case mapping deleted', case: result.rows[0] });
  } catch (error) {
    console.error('Delete product case error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
