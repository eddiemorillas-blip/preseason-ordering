const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Helper function to extract size from product name
function extractSize(productName) {
  const sizePatterns = [
    /\b(XXS|XSmall|XS|Small|S|Medium|M|Large|L|XLarge|XL|XXL|XXXL)\b/i,
    /\b(\d+(?:\.\d+)?)\b/  // Numeric sizes like 9, 9.5, 10
  ];

  for (const pattern of sizePatterns) {
    const match = productName.match(pattern);
    if (match) return match[1];
  }

  return null;
}

// Helper function to extract color from product name
function extractColor(productName) {
  const colorPattern = /\b(Black|White|Blue|Red|Green|Yellow|Gray|Grey|Orange|Purple|Pink|Brown|Tan|Beige|Navy|Teal|Olive|Maroon|Lime|Cyan|Magenta)\b/i;
  const match = productName.match(colorPattern);
  return match ? match[1] : null;
}

// GET /api/product-families - Get product families for a brand
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { brandId, search } = req.query;

    if (!brandId) {
      return res.status(400).json({ error: 'Brand ID is required' });
    }

    let query = `
      SELECT DISTINCT base_name
      FROM products
      WHERE brand_id = $1
      AND active = true
      AND base_name IS NOT NULL
    `;
    const params = [brandId];

    if (search) {
      query += ` AND base_name ILIKE $2`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY base_name`;

    const result = await pool.query(query, params);

    res.json({ families: result.rows.map(r => r.base_name) });
  } catch (error) {
    console.error('Get product families error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/product-families/variants - Get all variants of a product family
router.get('/variants', authenticateToken, async (req, res) => {
  try {
    const { brandId, baseName } = req.query;

    if (!brandId || !baseName) {
      return res.status(400).json({ error: 'Brand ID and base name are required' });
    }

    const result = await pool.query(`
      SELECT
        p.*,
        b.name as brand_name
      FROM products p
      JOIN brands b ON p.brand_id = b.id
      WHERE p.brand_id = $1
      AND p.base_name = $2
      AND p.active = true
      ORDER BY p.name
    `, [brandId, baseName]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product family not found' });
    }

    // Extract size and color for each variant
    const variants = result.rows.map(product => ({
      ...product,
      extracted_size: extractSize(product.name),
      extracted_color: extractColor(product.name)
    }));

    // Group by color if multiple colors exist
    const colorGroups = {};
    variants.forEach(variant => {
      const color = variant.color || variant.extracted_color || 'default';
      if (!colorGroups[color]) {
        colorGroups[color] = [];
      }
      colorGroups[color].push(variant);
    });

    res.json({
      baseName,
      variants,
      colorGroups
    });
  } catch (error) {
    console.error('Get product variants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/product-families/find-variant - Find matching variant
// Body: { sourceProductId, targetColor?, targetSize? }
router.post('/find-variant', authenticateToken, async (req, res) => {
  try {
    const { sourceProductId, targetColor, targetSize } = req.body;

    if (!sourceProductId) {
      return res.status(400).json({ error: 'Source product ID is required' });
    }

    // Get source product
    const sourceResult = await pool.query(
      'SELECT * FROM products WHERE id = $1',
      [sourceProductId]
    );

    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Source product not found' });
    }

    const sourceProduct = sourceResult.rows[0];
    const sourceSize = sourceProduct.size || extractSize(sourceProduct.name);
    const sourceColor = sourceProduct.color || extractColor(sourceProduct.name);

    // Build query to find matching variant
    let query = `
      SELECT * FROM products
      WHERE brand_id = $1
      AND base_name = $2
      AND active = true
    `;
    const params = [sourceProduct.brand_id, sourceProduct.base_name];
    let paramIndex = 3;

    // Match the target size if provided, otherwise use source size
    const searchSize = targetSize || sourceSize;
    if (searchSize) {
      query += ` AND (size = $${paramIndex} OR name ILIKE $${paramIndex + 1})`;
      params.push(searchSize, `%${searchSize}%`);
      paramIndex += 2;
    }

    // Match the target color if provided, otherwise use source color
    const searchColor = targetColor || sourceColor;
    if (searchColor) {
      query += ` AND (color = $${paramIndex} OR name ILIKE $${paramIndex + 1})`;
      params.push(searchColor, `%${searchColor}%`);
      paramIndex += 2;
    }

    query += ` LIMIT 1`;

    const targetResult = await pool.query(query, params);

    if (targetResult.rows.length === 0) {
      return res.status(404).json({
        error: 'No matching variant found',
        searchCriteria: {
          baseName: sourceProduct.base_name,
          size: searchSize,
          color: searchColor
        }
      });
    }

    res.json({
      sourceProduct,
      targetProduct: targetResult.rows[0],
      mapping: {
        size: { from: sourceSize, to: searchSize },
        color: { from: sourceColor, to: searchColor }
      }
    });
  } catch (error) {
    console.error('Find variant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
