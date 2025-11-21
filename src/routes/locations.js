const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// GET /api/locations - List all locations
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM locations
      ORDER BY name
    `);

    res.json({ locations: result.rows });
  } catch (error) {
    console.error('Get locations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/locations - Create new location (admin only)
router.post('/', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { name, code, address, city, state, zip } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: 'Location name and code are required' });
    }

    const result = await pool.query(
      `INSERT INTO locations (name, code, address, city, state, zip)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, code, address || null, city || null, state || null, zip || null]
    );

    res.status(201).json({
      message: 'Location created successfully',
      location: result.rows[0]
    });
  } catch (error) {
    console.error('Create location error:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({ error: 'Location with this code already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/locations/:id - Get location details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('SELECT * FROM locations WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }

    res.json({ location: result.rows[0] });
  } catch (error) {
    console.error('Get location error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/locations/:id - Update location
router.patch('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, address, city, state, zip, active } = req.body;

    const result = await pool.query(
      `UPDATE locations
       SET name = COALESCE($1, name),
           code = COALESCE($2, code),
           address = COALESCE($3, address),
           city = COALESCE($4, city),
           state = COALESCE($5, state),
           zip = COALESCE($6, zip),
           active = COALESCE($7, active),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [name, code, address, city, state, zip, active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }

    res.json({
      message: 'Location updated successfully',
      location: result.rows[0]
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
