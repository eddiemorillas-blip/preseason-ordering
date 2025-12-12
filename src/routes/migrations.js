const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Run migration to add gender column
router.post('/add-gender-column', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    // Add gender column if it doesn't exist
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS gender VARCHAR(50);
    `);

    // Add index for better query performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_products_gender ON products(gender);
    `);

    res.json({
      success: true,
      message: 'Gender column added successfully'
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add gender column',
      message: error.message
    });
  }
});

// Run migration to add UPC to sales_data
router.post('/add-upc-to-sales-data', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    // Add original_upc column if it doesn't exist
    await pool.query(`
      ALTER TABLE sales_data ADD COLUMN IF NOT EXISTS original_upc VARCHAR(50);
    `);

    // Add index for better query performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sales_data_upc ON sales_data(original_upc);
    `);

    res.json({
      success: true,
      message: 'UPC column added to sales_data successfully'
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add UPC column to sales_data',
      message: error.message
    });
  }
});

// Run migration to add season_id columns
router.post('/add-season-id-columns', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    // Add season_id column to products if it doesn't exist
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(id);
    `);

    // Add season_id column to catalog_uploads if it doesn't exist
    await pool.query(`
      ALTER TABLE catalog_uploads ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(id);
    `);

    // Add index for better query performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_products_season ON products(season_id);
    `);

    res.json({
      success: true,
      message: 'Season ID columns added successfully'
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add season_id columns',
      message: error.message
    });
  }
});

// Run migration to add all missing product columns
router.post('/add-missing-product-columns', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    // Add all potentially missing columns to products table
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory VARCHAR(255);
    `);
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS inseam VARCHAR(50);
    `);
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS gender VARCHAR(50);
    `);
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS color VARCHAR(255);
    `);
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS size VARCHAR(100);
    `);
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(255);
    `);
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_cost DECIMAL(10, 2);
    `);
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS msrp DECIMAL(10, 2);
    `);
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
    `);
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(id);
    `);

    res.json({
      success: true,
      message: 'All missing product columns added successfully'
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add missing product columns',
      message: error.message
    });
  }
});

// Run migration to add unique constraint on upc
router.post('/add-upc-constraint', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    // First check if constraint exists
    const checkResult = await pool.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'products' AND constraint_type = 'UNIQUE' AND constraint_name = 'products_upc_key'
    `);

    if (checkResult.rows.length === 0) {
      // Add unique constraint on upc column
      await pool.query(`
        ALTER TABLE products ADD CONSTRAINT products_upc_key UNIQUE (upc);
      `);
    }

    res.json({
      success: true,
      message: 'UPC unique constraint added successfully'
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add UPC constraint',
      message: error.message
    });
  }
});

// Comprehensive migration to sync all missing columns
router.post('/sync-all-schema', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const results = [];

  try {
    // 1. Brands table - extended fields
    await pool.query(`ALTER TABLE brands ADD COLUMN IF NOT EXISTS vendor_code VARCHAR(100)`);
    results.push('brands.vendor_code');
    await pool.query(`ALTER TABLE brands ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255)`);
    results.push('brands.contact_name');
    await pool.query(`ALTER TABLE brands ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255)`);
    results.push('brands.contact_email');
    await pool.query(`ALTER TABLE brands ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50)`);
    results.push('brands.contact_phone');
    await pool.query(`ALTER TABLE brands ADD COLUMN IF NOT EXISTS notes TEXT`);
    results.push('brands.notes');
    await pool.query(`ALTER TABLE brands ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true`);
    results.push('brands.active');

    // 2. Locations table - code field and zip fix
    await pool.query(`ALTER TABLE locations ADD COLUMN IF NOT EXISTS code VARCHAR(50)`);
    results.push('locations.code');
    // Check if zip_code exists but zip doesn't
    const zipCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'locations' AND column_name = 'zip'
    `);
    if (zipCheck.rows.length === 0) {
      // Try to add zip column
      await pool.query(`ALTER TABLE locations ADD COLUMN IF NOT EXISTS zip VARCHAR(20)`);
      results.push('locations.zip');
    }

    // 3. Order items table - unit_cost and line_total
    await pool.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(10, 2)`);
    results.push('order_items.unit_cost');
    await pool.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS line_total DECIMAL(10, 2)`);
    results.push('order_items.line_total');

    // 4. Orders table - all columns needed
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(id)`);
    results.push('orders.season_id');
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(id)`);
    results.push('orders.brand_id');
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_date DATE`);
    results.push('orders.ship_date');
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type VARCHAR(50) DEFAULT 'preseason'`);
    results.push('orders.order_type');
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS budget_total DECIMAL(12, 2)`);
    results.push('orders.budget_total');
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS current_total DECIMAL(10, 2) DEFAULT 0`);
    results.push('orders.current_total');

    // 5. Products table - all expected columns
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory VARCHAR(255)`);
    results.push('products.subcategory');
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS inseam VARCHAR(50)`);
    results.push('products.inseam');
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS gender VARCHAR(50)`);
    results.push('products.gender');
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS color VARCHAR(255)`);
    results.push('products.color');
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS size VARCHAR(100)`);
    results.push('products.size');
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(255)`);
    results.push('products.category');
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_cost DECIMAL(10, 2)`);
    results.push('products.wholesale_cost');
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS msrp DECIMAL(10, 2)`);
    results.push('products.msrp');
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true`);
    results.push('products.active');
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(id)`);
    results.push('products.season_id');
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS base_name VARCHAR(500)`);
    results.push('products.base_name');

    // 6. Catalog uploads table
    await pool.query(`ALTER TABLE catalog_uploads ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(id)`);
    results.push('catalog_uploads.season_id');
    await pool.query(`ALTER TABLE catalog_uploads ADD COLUMN IF NOT EXISTS products_added INTEGER DEFAULT 0`);
    results.push('catalog_uploads.products_added');
    await pool.query(`ALTER TABLE catalog_uploads ADD COLUMN IF NOT EXISTS products_updated INTEGER DEFAULT 0`);
    results.push('catalog_uploads.products_updated');
    await pool.query(`ALTER TABLE catalog_uploads ADD COLUMN IF NOT EXISTS products_deactivated INTEGER DEFAULT 0`);
    results.push('catalog_uploads.products_deactivated');
    await pool.query(`ALTER TABLE catalog_uploads ADD COLUMN IF NOT EXISTS upload_status VARCHAR(50)`);
    results.push('catalog_uploads.upload_status');
    await pool.query(`ALTER TABLE catalog_uploads ADD COLUMN IF NOT EXISTS error_count INTEGER DEFAULT 0`);
    results.push('catalog_uploads.error_count');

    // 7. Create indexes for performance
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_season ON products(season_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_upc ON products(upc)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_season ON orders(season_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_brand ON orders(brand_id)`);
    results.push('indexes created');

    // 8. Add unique constraint on products.upc if not exists
    const upcConstraint = await pool.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'products' AND constraint_type = 'UNIQUE' AND constraint_name = 'products_upc_key'
    `);
    if (upcConstraint.rows.length === 0) {
      try {
        await pool.query(`ALTER TABLE products ADD CONSTRAINT products_upc_key UNIQUE (upc)`);
        results.push('products.upc unique constraint');
      } catch (e) {
        results.push('products.upc constraint skipped (may have duplicates)');
      }
    }

    res.json({
      success: true,
      message: 'Schema sync completed',
      columnsAdded: results
    });
  } catch (error) {
    console.error('Schema sync error:', error);
    res.status(500).json({
      success: false,
      error: 'Schema sync failed',
      message: error.message,
      columnsAddedBeforeError: results
    });
  }
});

// Populate base_name for all products
router.post('/populate-base-names', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    // Set base_name to the product name for all products where it's NULL
    // This creates product families based on the product name
    const result = await pool.query(`
      UPDATE products
      SET base_name = name
      WHERE base_name IS NULL
    `);

    res.json({
      success: true,
      message: `Populated base_name for ${result.rowCount} products`
    });
  } catch (error) {
    console.error('Populate base names error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to populate base names',
      message: error.message
    });
  }
});

// Fix order items line_total for existing items
router.post('/fix-order-item-totals', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    // Update all order items to calculate line_total from unit_cost * quantity
    const result = await pool.query(`
      UPDATE order_items
      SET line_total = COALESCE(unit_cost, 0) * quantity
      WHERE line_total IS NULL OR line_total = 0
    `);

    // Also update order current_total from sum of line_totals
    await pool.query(`
      UPDATE orders o
      SET current_total = (
        SELECT COALESCE(SUM(line_total), 0)
        FROM order_items oi
        WHERE oi.order_id = o.id
      )
    `);

    res.json({
      success: true,
      message: `Fixed ${result.rowCount} order items and updated order totals`
    });
  } catch (error) {
    console.error('Fix order item totals error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fix order item totals',
      message: error.message
    });
  }
});

// Fix products constraint - remove brand_id+sku unique constraint
router.post('/fix-products-constraints', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    // Drop the brand_id+sku unique constraint if it exists (UPC is the true unique identifier)
    await pool.query(`
      ALTER TABLE products DROP CONSTRAINT IF EXISTS products_brand_id_sku_key
    `);

    res.json({
      success: true,
      message: 'Products constraints fixed - brand_id+sku unique constraint removed'
    });
  } catch (error) {
    console.error('Fix constraints error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fix constraints',
      message: error.message
    });
  }
});

// Add source_order_id column to track copied orders
router.post('/add-source-order-tracking', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    // Add source_order_id column to orders table
    await pool.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL
    `);

    // Add index for finding copies of an order
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source_order_id)
    `);

    res.json({
      success: true,
      message: 'Source order tracking column added successfully'
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add source order tracking',
      message: error.message
    });
  }
});

// Delete brand and all its products (admin utility)
router.post('/delete-brand-with-products', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { brandId } = req.body;

    if (!brandId) {
      return res.status(400).json({ error: 'Brand ID is required' });
    }

    // Delete products first
    const productsResult = await pool.query('DELETE FROM products WHERE brand_id = $1', [brandId]);

    // Delete catalog uploads for this brand
    await pool.query('DELETE FROM catalog_uploads WHERE brand_id = $1', [brandId]);

    // Delete brand templates for this brand
    await pool.query('DELETE FROM brand_order_templates WHERE brand_id = $1', [brandId]);

    // Delete the brand
    const brandResult = await pool.query('DELETE FROM brands WHERE id = $1 RETURNING name', [brandId]);

    if (brandResult.rows.length === 0) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    res.json({
      success: true,
      message: `Brand "${brandResult.rows[0].name}" and ${productsResult.rowCount} products deleted successfully`
    });
  } catch (error) {
    console.error('Delete brand error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete brand',
      message: error.message
    });
  }
});

// Fix order numbers to match their ship dates
router.post('/fix-order-numbers', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const fixed = [];

  try {
    // Get all orders with ship dates and brand/location info
    const orders = await pool.query(`
      SELECT o.id, o.order_number, o.ship_date, b.code as brand_code, b.name as brand_name, l.code as location_code
      FROM orders o
      LEFT JOIN brands b ON o.brand_id = b.id
      LEFT JOIN locations l ON o.location_id = l.id
      WHERE o.ship_date IS NOT NULL
    `);

    for (const order of orders.rows) {
      // Parse date with noon time to avoid timezone issues
      const dateStr = order.ship_date instanceof Date
        ? order.ship_date.toISOString().substring(0, 10)
        : String(order.ship_date).substring(0, 10);
      const date = new Date(dateStr + 'T12:00:00');

      const month = MONTHS[date.getMonth()];
      const year = String(date.getFullYear()).slice(-2);
      const brandCode = order.brand_code || order.brand_name?.substring(0, 3).toUpperCase() || 'UNK';
      const locationCode = order.location_code || 'UNK';
      const expectedOrderNumber = `${month}${year}-${brandCode}-${locationCode}`;

      if (order.order_number !== expectedOrderNumber) {
        await pool.query('UPDATE orders SET order_number = $1 WHERE id = $2', [expectedOrderNumber, order.id]);
        fixed.push({
          id: order.id,
          old: order.order_number,
          new: expectedOrderNumber
        });
      }
    }

    res.json({
      success: true,
      message: `Fixed ${fixed.length} order numbers`,
      fixed
    });
  } catch (error) {
    console.error('Fix order numbers error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fix order numbers',
      message: error.message
    });
  }
});

module.exports = router;
