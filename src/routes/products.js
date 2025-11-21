const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const Fuse = require('fuse.js');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Get all products with optional filtering (all authenticated users)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { brand_id, category, subcategory, min_wholesale, max_wholesale, min_msrp, max_msrp } = req.query;

    let query = `
      SELECT p.*, b.name as brand_name
      FROM products p
      LEFT JOIN brands b ON p.brand_id = b.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (brand_id) {
      query += ` AND p.brand_id = $${paramCount}`;
      params.push(brand_id);
      paramCount++;
    }

    if (category) {
      query += ` AND p.category = $${paramCount}`;
      params.push(category);
      paramCount++;
    }

    if (subcategory) {
      query += ` AND p.subcategory = $${paramCount}`;
      params.push(subcategory);
      paramCount++;
    }

    if (min_wholesale) {
      query += ` AND p.wholesale_cost >= $${paramCount}`;
      params.push(min_wholesale);
      paramCount++;
    }

    if (max_wholesale) {
      query += ` AND p.wholesale_cost <= $${paramCount}`;
      params.push(max_wholesale);
      paramCount++;
    }

    if (min_msrp) {
      query += ` AND p.msrp >= $${paramCount}`;
      params.push(min_msrp);
      paramCount++;
    }

    if (max_msrp) {
      query += ` AND p.msrp <= $${paramCount}`;
      params.push(max_msrp);
      paramCount++;
    }

    query += ' ORDER BY p.name ASC';

    const result = await pool.query(query, params);
    res.json({ products: result.rows });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Fuzzy search products (all authenticated users) or get all products
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { q, brandId, limit = 50, offset = 0 } = req.query;

    // Build query with optional brand filter
    let query = `
      SELECT p.*, b.name as brand_name
      FROM products p
      LEFT JOIN brands b ON p.brand_id = b.id
      WHERE p.active = true
    `;
    const params = [];

    if (brandId) {
      query += ` AND p.brand_id = $1`;
      params.push(brandId);
    }

    query += ' ORDER BY p.created_at DESC';

    // Get all products with brand names
    const result = await pool.query(query, params);
    let products = result.rows;
    let count = products.length;

    // If search query provided, perform fuzzy search
    if (q && q.trim()) {
      const options = {
        keys: ['name', 'sku', 'upc', 'brand_name', 'category', 'subcategory', 'color', 'size'],
        threshold: 0.4,
        includeScore: true,
        ignoreLocation: true,
        minMatchCharLength: 2
      };

      const fuse = new Fuse(products, options);
      const searchResults = fuse.search(q.trim());
      products = searchResults.map(result => result.item);
      count = products.length;
    }

    // Apply pagination
    const paginatedProducts = products.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    res.json({
      query: q || null,
      count: count,
      products: paginatedProducts
    });
  } catch (error) {
    console.error('Search products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a single product by ID (all authenticated users)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT p.*, b.name as brand_name
      FROM products p
      LEFT JOIN brands b ON p.brand_id = b.id
      WHERE p.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ product: result.rows[0] });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new product (Admin only)
router.post('/', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { name, upc, sku, description, category, subcategory, wholesale_cost, msrp, size, color, brand_id, active } = req.body;

    if (!name || !upc) {
      return res.status(400).json({ error: 'Name and UPC are required' });
    }

    // Verify brand exists if brand_id is provided
    if (brand_id) {
      const brandExists = await pool.query(
        'SELECT * FROM brands WHERE id = $1',
        [brand_id]
      );

      if (brandExists.rows.length === 0) {
        return res.status(404).json({ error: 'Brand not found' });
      }
    }

    // Check if UPC already exists
    const upcExists = await pool.query(
      'SELECT * FROM products WHERE upc = $1',
      [upc]
    );

    if (upcExists.rows.length > 0) {
      return res.status(409).json({ error: 'Product with this UPC already exists' });
    }

    const result = await pool.query(
      'INSERT INTO products (brand_id, upc, sku, name, description, category, subcategory, wholesale_cost, msrp, size, color, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *',
      [brand_id || null, upc, sku || null, name, description || null, category || null, subcategory || null, wholesale_cost || null, msrp || null, size || null, color || null, active !== undefined ? active : true]
    );

    res.status(201).json({
      message: 'Product created successfully',
      product: result.rows[0]
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a product (Admin only)
router.put('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, upc, sku, description, category, subcategory, wholesale_cost, msrp, size, color, brand_id, active } = req.body;

    // Check if product exists
    const productExists = await pool.query(
      'SELECT * FROM products WHERE id = $1',
      [id]
    );

    if (productExists.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // If UPC is being updated, check if new UPC already exists
    if (upc && upc !== productExists.rows[0].upc) {
      const upcExists = await pool.query(
        'SELECT * FROM products WHERE upc = $1 AND id != $2',
        [upc, id]
      );

      if (upcExists.rows.length > 0) {
        return res.status(409).json({ error: 'Product with this UPC already exists' });
      }
    }

    // Verify brand exists if brand_id is provided
    if (brand_id) {
      const brandExists = await pool.query(
        'SELECT * FROM brands WHERE id = $1',
        [brand_id]
      );

      if (brandExists.rows.length === 0) {
        return res.status(404).json({ error: 'Brand not found' });
      }
    }

    const result = await pool.query(
      `UPDATE products SET
        brand_id = COALESCE($1, brand_id),
        upc = COALESCE($2, upc),
        sku = COALESCE($3, sku),
        name = COALESCE($4, name),
        description = COALESCE($5, description),
        category = COALESCE($6, category),
        subcategory = COALESCE($7, subcategory),
        wholesale_cost = COALESCE($8, wholesale_cost),
        msrp = COALESCE($9, msrp),
        size = COALESCE($10, size),
        color = COALESCE($11, color),
        active = COALESCE($12, active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $13 RETURNING *`,
      [brand_id, upc, sku, name, description, category, subcategory, wholesale_cost, msrp, size, color, active, id]
    );

    res.json({
      message: 'Product updated successfully',
      product: result.rows[0]
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a product (Admin only)
router.delete('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if product exists
    const productExists = await pool.query(
      'SELECT * FROM products WHERE id = $1',
      [id]
    );

    if (productExists.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await pool.query('DELETE FROM products WHERE id = $1', [id]);

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
