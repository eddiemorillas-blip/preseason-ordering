const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Get all brands (all authenticated users)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM brands ORDER BY name ASC'
    );
    res.json({ brands: result.rows });
  } catch (error) {
    console.error('Get brands error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a single brand by ID (all authenticated users)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM brands WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    res.json({ brand: result.rows[0] });
  } catch (error) {
    console.error('Get brand error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new brand (Admin only)
router.post('/', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { name, vendor_code, contact_name, contact_email, contact_phone, notes, active } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Brand name is required' });
    }

    // Check if brand already exists
    const exists = await pool.query(
      'SELECT * FROM brands WHERE name = $1',
      [name]
    );

    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Brand with this name already exists' });
    }

    const result = await pool.query(
      'INSERT INTO brands (name, vendor_code, contact_name, contact_email, contact_phone, notes, active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [name, vendor_code || null, contact_name || null, contact_email || null, contact_phone || null, notes || null, active !== undefined ? active : true]
    );

    res.status(201).json({
      message: 'Brand created successfully',
      brand: result.rows[0]
    });
  } catch (error) {
    console.error('Create brand error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a brand (Admin only)
router.put('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, vendor_code, contact_name, contact_email, contact_phone, notes, active } = req.body;

    // Check if brand exists
    const brandExists = await pool.query(
      'SELECT * FROM brands WHERE id = $1',
      [id]
    );

    if (brandExists.rows.length === 0) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    // If name is being updated, check if new name already exists
    if (name && name !== brandExists.rows[0].name) {
      const nameExists = await pool.query(
        'SELECT * FROM brands WHERE name = $1 AND id != $2',
        [name, id]
      );

      if (nameExists.rows.length > 0) {
        return res.status(409).json({ error: 'Brand with this name already exists' });
      }
    }

    const result = await pool.query(
      `UPDATE brands SET
        name = COALESCE($1, name),
        vendor_code = COALESCE($2, vendor_code),
        contact_name = COALESCE($3, contact_name),
        contact_email = COALESCE($4, contact_email),
        contact_phone = COALESCE($5, contact_phone),
        notes = COALESCE($6, notes),
        active = COALESCE($7, active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8 RETURNING *`,
      [name, vendor_code, contact_name, contact_email, contact_phone, notes, active, id]
    );

    res.json({
      message: 'Brand updated successfully',
      brand: result.rows[0]
    });
  } catch (error) {
    console.error('Update brand error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a brand (Admin only)
router.delete('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if brand exists
    const brandExists = await pool.query(
      'SELECT * FROM brands WHERE id = $1',
      [id]
    );

    if (brandExists.rows.length === 0) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    // Check if brand has associated products
    const hasProducts = await pool.query(
      'SELECT COUNT(*) FROM products WHERE brand_id = $1',
      [id]
    );

    if (parseInt(hasProducts.rows[0].count) > 0) {
      return res.status(409).json({
        error: 'Cannot delete brand with associated products',
        productCount: parseInt(hasProducts.rows[0].count)
      });
    }

    await pool.query('DELETE FROM brands WHERE id = $1', [id]);

    res.json({ message: 'Brand deleted successfully' });
  } catch (error) {
    console.error('Delete brand error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
