const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  analyzeBrandPatterns,
  analyzeLocationPatterns,
  generateSuggestedAdjustments,
  detectOutliers
} = require('../services/patternService');

/**
 * GET /api/patterns/brand/:brandId
 * Analyze adjustment patterns for a specific brand across historical seasons
 * Query params:
 *   - seasonCount: Number of past seasons to analyze (default: 4)
 */
router.get('/brand/:brandId', authenticateToken, async (req, res) => {
  try {
    const { brandId } = req.params;
    const seasonCount = req.query.seasonCount ? parseInt(req.query.seasonCount) : 4;

    // Validate brandId
    if (!brandId || isNaN(brandId)) {
      return res.status(400).json({ error: 'Valid brand ID is required' });
    }

    // Validate seasonCount
    if (seasonCount < 1 || seasonCount > 20) {
      return res.status(400).json({ error: 'Season count must be between 1 and 20' });
    }

    const analysis = await analyzeBrandPatterns(parseInt(brandId), seasonCount);

    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    console.error('Brand patterns analysis error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/patterns/location/:locationId
 * Analyze adjustment patterns for a specific location across historical seasons
 * Query params:
 *   - seasonCount: Number of past seasons to analyze (default: 4)
 */
router.get('/location/:locationId', authenticateToken, async (req, res) => {
  try {
    const { locationId } = req.params;
    const seasonCount = req.query.seasonCount ? parseInt(req.query.seasonCount) : 4;

    // Validate locationId
    if (!locationId || isNaN(locationId)) {
      return res.status(400).json({ error: 'Valid location ID is required' });
    }

    // Validate seasonCount
    if (seasonCount < 1 || seasonCount > 20) {
      return res.status(400).json({ error: 'Season count must be between 1 and 20' });
    }

    const analysis = await analyzeLocationPatterns(parseInt(locationId), seasonCount);

    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    console.error('Location patterns analysis error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/patterns/suggestions
 * Generate suggested adjustments for an order based on historical patterns
 * Query params:
 *   - orderId: The order ID to generate suggestions for (required)
 */
router.get('/suggestions', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.query;

    // Validate orderId
    if (!orderId || isNaN(orderId)) {
      return res.status(400).json({ error: 'Valid order ID is required via orderId query parameter' });
    }

    const suggestions = await generateSuggestedAdjustments(parseInt(orderId));

    res.json({
      success: true,
      data: suggestions
    });
  } catch (error) {
    console.error('Generate suggestions error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/patterns/outliers
 * Detect outlier adjustments in an order compared to historical patterns
 * Query params:
 *   - orderId: The order ID to analyze for outliers (required)
 */
router.get('/outliers', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.query;

    // Validate orderId
    if (!orderId || isNaN(orderId)) {
      return res.status(400).json({ error: 'Valid order ID is required via orderId query parameter' });
    }

    const analysis = await detectOutliers(parseInt(orderId));

    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    console.error('Detect outliers error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

module.exports = router;
