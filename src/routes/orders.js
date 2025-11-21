const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// GET /api/orders - List orders with filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { seasonId, brandId, locationId, status, userId } = req.query;

    let query = `
      SELECT
        o.*,
        s.name as season_name,
        b.name as brand_name,
        l.name as location_name,
        l.code as location_code,
        u.email as created_by_email,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
      FROM orders o
      LEFT JOIN seasons s ON o.season_id = s.id
      LEFT JOIN brands b ON o.brand_id = b.id
      LEFT JOIN locations l ON o.location_id = l.id
      LEFT JOIN users u ON o.created_by = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (seasonId) {
      query += ` AND o.season_id = $${paramIndex}`;
      params.push(seasonId);
      paramIndex++;
    }

    if (brandId) {
      query += ` AND o.brand_id = $${paramIndex}`;
      params.push(brandId);
      paramIndex++;
    }

    if (locationId) {
      query += ` AND o.location_id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }

    if (status) {
      query += ` AND o.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (userId) {
      query += ` AND o.created_by = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    query += ` ORDER BY o.created_at DESC`;

    const result = await pool.query(query, params);

    res.json({ orders: result.rows });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orders - Create new order
router.post('/', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const {
      season_id,
      brand_id,
      location_id,
      ship_date,
      order_type,
      notes,
      budget_total
    } = req.body;

    const userId = req.user.id;

    // Validate required fields
    if (!season_id || !brand_id || !location_id) {
      return res.status(400).json({
        error: 'Season, brand, and location are required'
      });
    }

    // Generate order number
    const orderNumber = `${new Date().getFullYear()}-${Date.now()}`;

    const result = await pool.query(
      `INSERT INTO orders (
        order_number,
        season_id,
        brand_id,
        location_id,
        ship_date,
        order_type,
        notes,
        budget_total,
        created_by,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        orderNumber,
        season_id,
        brand_id,
        location_id,
        ship_date || null,
        order_type || 'preseason',
        notes || null,
        budget_total || null,
        userId,
        'draft'
      ]
    );

    res.status(201).json({
      message: 'Order created successfully',
      order: result.rows[0]
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/:id - Get order with items
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get order details
    const orderResult = await pool.query(`
      SELECT
        o.*,
        s.name as season_name,
        b.name as brand_name,
        l.name as location_name,
        l.code as location_code,
        u.email as created_by_email
      FROM orders o
      LEFT JOIN seasons s ON o.season_id = s.id
      LEFT JOIN brands b ON o.brand_id = b.id
      LEFT JOIN locations l ON o.location_id = l.id
      LEFT JOIN users u ON o.created_by = u.id
      WHERE o.id = $1
    `, [id]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Get order items
    const itemsResult = await pool.query(`
      SELECT
        oi.*,
        oi.unit_cost as unit_price,
        p.name as product_name,
        p.sku,
        p.upc,
        p.base_name,
        p.size,
        p.color,
        p.wholesale_cost,
        p.msrp
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      ORDER BY p.base_name, p.name
    `, [id]);

    res.json({
      order: orderResult.rows[0],
      items: itemsResult.rows
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/:id/family-groups - Get items grouped by product family
router.get('/:id/family-groups', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT
        p.base_name,
        p.color,
        json_agg(
          json_build_object(
            'id', oi.id,
            'product_id', oi.product_id,
            'product_name', p.name,
            'size', p.size,
            'color', p.color,
            'quantity', oi.quantity,
            'unit_price', oi.unit_cost,
            'line_total', oi.line_total
          ) ORDER BY p.size
        ) as items
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      GROUP BY p.base_name, p.color
      ORDER BY p.base_name, p.color
    `, [id]);

    res.json({ families: result.rows });
  } catch (error) {
    console.error('Get order family groups error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orders/:id/items - Add item to order
router.post('/:id/items', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { id } = req.params;
    const { product_id, quantity, unit_price, notes } = req.body;

    if (!product_id || !quantity) {
      return res.status(400).json({ error: 'Product ID and quantity are required' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get product details
      const productResult = await client.query(
        'SELECT * FROM products WHERE id = $1',
        [product_id]
      );

      if (productResult.rows.length === 0) {
        throw new Error('Product not found');
      }

      const product = productResult.rows[0];
      const price = unit_price || product.wholesale_cost || 0;
      const lineTotal = parseFloat(price) * parseInt(quantity);

      // Insert order item
      const itemResult = await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_cost, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, product_id, quantity, price, notes || null]
      );

      // Update order total
      await client.query(
        `UPDATE orders
         SET current_total = (
           SELECT COALESCE(SUM(line_total), 0)
           FROM order_items
           WHERE order_id = $1
         ),
         updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id]
      );

      await client.query('COMMIT');

      res.status(201).json({
        message: 'Item added successfully',
        item: itemResult.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Add order item error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/orders/:id/copy - Copy order to another location with variant mapping
router.post('/:id/copy', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { id } = req.params;
    const { targetLocationId, variantMapping, shipDate, notes } = req.body;

    if (!targetLocationId) {
      return res.status(400).json({ error: 'Target location ID is required' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get source order
      const sourceOrderResult = await client.query(
        'SELECT * FROM orders WHERE id = $1',
        [id]
      );

      if (sourceOrderResult.rows.length === 0) {
        throw new Error('Source order not found');
      }

      const sourceOrder = sourceOrderResult.rows[0];

      // Create new order
      const newOrderNumber = `${new Date().getFullYear()}-${Date.now()}`;
      const newOrderResult = await client.query(
        `INSERT INTO orders (
          order_number,
          season_id,
          brand_id,
          location_id,
          ship_date,
          order_type,
          notes,
          budget_total,
          created_by,
          duplicated_from_order_id,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          newOrderNumber,
          sourceOrder.season_id,
          sourceOrder.brand_id,
          targetLocationId,
          shipDate || sourceOrder.ship_date,
          sourceOrder.order_type,
          notes || `Copied from order ${sourceOrder.order_number}`,
          sourceOrder.budget_total,
          req.user.id,
          sourceOrder.id,
          'draft'
        ]
      );

      const newOrder = newOrderResult.rows[0];

      // Get source order items
      const sourceItemsResult = await client.query(`
        SELECT
          oi.*,
          oi.unit_cost as unit_price,
          p.base_name,
          p.size,
          p.color,
          p.name as product_name
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = $1
      `, [id]);

      // Copy items with variant mapping
      for (const sourceItem of sourceItemsResult.rows) {
        let targetProductId = sourceItem.product_id;

        // Check if variant mapping exists for this product family
        if (variantMapping && sourceItem.base_name in variantMapping) {
          const familyMapping = variantMapping[sourceItem.base_name];
          const sizeMapping = familyMapping[sourceItem.size];

          if (sizeMapping) {
            // Find product with same base_name, size, but different color
            const targetColor = sizeMapping.to;
            const targetProductResult = await client.query(`
              SELECT id FROM products
              WHERE base_name = $1
              AND brand_id = $2
              AND size = $3
              AND (color = $4 OR name ILIKE $5)
              AND active = true
              LIMIT 1
            `, [
              sourceItem.base_name,
              sourceOrder.brand_id,
              sourceItem.size,
              targetColor,
              `%${targetColor}%`
            ]);

            if (targetProductResult.rows.length > 0) {
              targetProductId = targetProductResult.rows[0].id;
            }
          }
        }

        // Insert item into new order
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_cost, notes)
           VALUES ($1, $2, $3, $4, $5)`,
          [newOrder.id, targetProductId, sourceItem.quantity, sourceItem.unit_cost, sourceItem.notes]
        );
      }

      // Update new order total
      await client.query(
        `UPDATE orders
         SET current_total = (
           SELECT COALESCE(SUM(line_total), 0)
           FROM order_items
           WHERE order_id = $1
         )
         WHERE id = $1`,
        [newOrder.id]
      );

      await client.query('COMMIT');

      // Return new order with items
      const newOrderWithItems = await client.query(`
        SELECT
          o.*,
          s.name as season_name,
          b.name as brand_name,
          l.name as location_name,
          (SELECT json_agg(
            json_build_object(
              'id', oi.id,
              'product_id', oi.product_id,
              'product_name', p.name,
              'quantity', oi.quantity,
              'unit_price', oi.unit_cost,
              'line_total', oi.line_total
            )
          ) FROM order_items oi
          JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = o.id) as items
        FROM orders o
        JOIN seasons s ON o.season_id = s.id
        JOIN brands b ON o.brand_id = b.id
        JOIN locations l ON o.location_id = l.id
        WHERE o.id = $1
      `, [newOrder.id]);

      res.status(201).json({
        message: 'Order copied successfully',
        order: newOrderWithItems.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Copy order error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PATCH /api/orders/:id - Update order
router.patch('/:id', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { id } = req.params;
    const { ship_date, notes, status, budget_total } = req.body;

    const result = await pool.query(
      `UPDATE orders
       SET ship_date = COALESCE($1, ship_date),
           notes = COALESCE($2, notes),
           status = COALESCE($3, status),
           budget_total = COALESCE($4, budget_total),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [ship_date, notes, status, budget_total, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({
      message: 'Order updated successfully',
      order: result.rows[0]
    });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/orders/:id - Delete order
router.delete('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ message: 'Order deleted successfully' });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
