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

module.exports = router;
