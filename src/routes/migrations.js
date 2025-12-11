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

module.exports = router;
