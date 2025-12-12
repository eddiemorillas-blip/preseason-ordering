const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Month abbreviations for order numbers
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Generate readable order number: MAR26-PRA-SLC
function generateOrderNumber(shipDate, brandCode, locationCode) {
  // Use ship date if provided, otherwise use current date
  const date = shipDate ? new Date(shipDate) : new Date();
  const month = MONTHS[date.getMonth()];
  const year = String(date.getFullYear()).slice(-2);
  return `${month}${year}-${brandCode}-${locationCode}`;
}

// GET /api/orders/product-breakdown - Get product breakdown across all orders
router.get('/product-breakdown', authenticateToken, async (req, res) => {
  try {
    let { brandId, seasonId } = req.query;

    // Handle multiple brandIds (can be array or single value)
    const brandIds = Array.isArray(brandId) ? brandId : (brandId ? [brandId] : []);

    // Build WHERE clause with optional filters
    let whereClause = "o.status != 'cancelled'";
    const params = [];
    let paramIndex = 1;

    if (brandIds.length > 0) {
      const placeholders = brandIds.map((_, i) => `$${paramIndex + i}`).join(', ');
      whereClause += ` AND o.brand_id IN (${placeholders})`;
      params.push(...brandIds);
      paramIndex += brandIds.length;
    }

    if (seasonId) {
      whereClause += ` AND o.season_id = $${paramIndex}`;
      params.push(seasonId);
      paramIndex++;
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

    // Get brand and location codes for order number
    const [brandResult, locationResult] = await Promise.all([
      pool.query('SELECT code, name FROM brands WHERE id = $1', [brand_id]),
      pool.query('SELECT code FROM locations WHERE id = $1', [location_id])
    ]);

    const brandCode = brandResult.rows[0]?.code || brandResult.rows[0]?.name?.substring(0, 3).toUpperCase() || 'UNK';
    const locationCode = locationResult.rows[0]?.code || 'UNK';

    // Generate order number
    const orderNumber = generateOrderNumber(ship_date, brandCode, locationCode);

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
        `INSERT INTO order_items (order_id, product_id, quantity, unit_cost, line_total, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [id, product_id, quantity, price, lineTotal, notes || null]
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
    const { targetLocationId, variantMapping, shipDate, notes, skipFamilies } = req.body;

    // skipFamilies is an array of base_name strings to exclude from the copy

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

      // Get brand and location codes for order number
      const [brandResult, locationResult] = await Promise.all([
        client.query('SELECT code, name FROM brands WHERE id = $1', [sourceOrder.brand_id]),
        client.query('SELECT code FROM locations WHERE id = $1', [targetLocationId])
      ]);

      const brandCode = brandResult.rows[0]?.code || brandResult.rows[0]?.name?.substring(0, 3).toUpperCase() || 'UNK';
      const locationCode = locationResult.rows[0]?.code || 'UNK';

      // Create new order
      const effectiveShipDate = shipDate || sourceOrder.ship_date;
      const newOrderNumber = generateOrderNumber(effectiveShipDate, brandCode, locationCode);
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
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          newOrderNumber,
          sourceOrder.season_id,
          sourceOrder.brand_id,
          targetLocationId,
          effectiveShipDate,
          sourceOrder.order_type,
          notes || `Copied from order ${sourceOrder.order_number}`,
          sourceOrder.budget_total,
          req.user.id,
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
      const skipSet = new Set(skipFamilies || []);

      for (const sourceItem of sourceItemsResult.rows) {
        // Skip this family if it's in the skip list
        if (skipSet.has(sourceItem.base_name)) {
          continue;
        }

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

        // Calculate line_total
        const lineTotal = parseFloat(sourceItem.unit_cost || 0) * parseInt(sourceItem.quantity || 0);

        // Insert item into new order with line_total
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_cost, line_total, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newOrder.id, targetProductId, sourceItem.quantity, sourceItem.unit_cost, lineTotal, sourceItem.notes]
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

// PATCH /api/orders/:orderId/items/:itemId - Update order item
router.patch('/:orderId/items/:itemId', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const client = await pool.connect();

  try {
    const { orderId, itemId } = req.params;
    const { quantity, unit_price, notes } = req.body;

    // Verify order exists and is editable (draft status)
    const orderResult = await client.query(
      'SELECT * FROM orders WHERE id = $1',
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Verify item exists and belongs to this order
    const itemResult = await client.query(
      'SELECT * FROM order_items WHERE id = $1 AND order_id = $2',
      [itemId, orderId]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order item not found' });
    }

    await client.query('BEGIN');

    // Get current item to calculate line_total
    const currentItem = itemResult.rows[0];
    const newQuantity = quantity !== undefined ? quantity : currentItem.quantity;
    const newUnitCost = unit_price !== undefined ? unit_price : currentItem.unit_cost;
    const newLineTotal = parseFloat(newUnitCost || 0) * parseInt(newQuantity || 0);

    // Update the item
    const updateResult = await client.query(
      `UPDATE order_items
       SET quantity = COALESCE($1, quantity),
           unit_cost = COALESCE($2, unit_cost),
           line_total = $3,
           notes = COALESCE($4, notes)
       WHERE id = $5
       RETURNING *`,
      [quantity, unit_price, newLineTotal, notes, itemId]
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
      [orderId]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Item updated successfully',
      item: updateResult.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update order item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/orders/:orderId/items/:itemId - Remove item from order
router.delete('/:orderId/items/:itemId', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const client = await pool.connect();

  try {
    const { orderId, itemId } = req.params;

    // Verify order exists and is editable (draft status)
    const orderResult = await client.query(
      'SELECT * FROM orders WHERE id = $1',
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Verify item exists and belongs to this order
    const itemResult = await client.query(
      'SELECT * FROM order_items WHERE id = $1 AND order_id = $2',
      [itemId, orderId]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order item not found' });
    }

    await client.query('BEGIN');

    // Delete the item
    await client.query('DELETE FROM order_items WHERE id = $1', [itemId]);

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
      [orderId]
    );

    await client.query('COMMIT');

    res.json({ message: 'Item removed successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete order item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
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
