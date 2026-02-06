const pool = require('../config/database');

/**
 * Analyze ordering adjustment patterns for a brand across multiple seasons
 * @param {number} brandId - The brand ID to analyze
 * @param {number} seasonCount - Number of past seasons to analyze (default 4)
 * @returns {Object} Pattern analysis with breakdown by category, size, gender, location
 */
async function analyzeBrandPatterns(brandId, seasonCount = 4) {
  try {
    // Get brand name
    const brandResult = await pool.query(
      'SELECT name FROM brands WHERE id = $1',
      [brandId]
    );

    if (brandResult.rows.length === 0) {
      return {
        error: 'Brand not found',
        brand_name: null,
        seasons_analyzed: 0,
        overall_avg_adjustment_pct: 0,
        by_category: [],
        by_size: [],
        by_gender: [],
        by_location: []
      };
    }

    const brandName = brandResult.rows[0].name;

    // Get the most recent N finalized seasons for this brand
    const seasonQuery = `
      SELECT DISTINCT s.id, s.name
      FROM seasons s
      JOIN finalized_adjustments fa ON fa.season_id = s.id
      WHERE fa.brand_id = $1
      AND s.status = 'finalized'
      ORDER BY s.id DESC
      LIMIT $2
    `;

    const seasonsResult = await pool.query(seasonQuery, [brandId, seasonCount]);

    if (seasonsResult.rows.length === 0) {
      return {
        brand_name: brandName,
        seasons_analyzed: 0,
        overall_avg_adjustment_pct: 0,
        by_category: [],
        by_size: [],
        by_gender: [],
        by_location: []
      };
    }

    const seasonIds = seasonsResult.rows.map(s => s.id);
    const seasonsAnalyzed = seasonsResult.rows.length;

    // Query finalized adjustments for these seasons
    const adjustmentsQuery = `
      SELECT
        fa.original_quantity,
        fa.adjusted_quantity,
        p.category,
        p.size,
        p.gender,
        l.name as location_name
      FROM finalized_adjustments fa
      JOIN products p ON fa.product_id = p.id
      JOIN locations l ON fa.location_id = l.id
      WHERE fa.brand_id = $1
      AND fa.season_id = ANY($2)
    `;

    const adjustmentsResult = await pool.query(adjustmentsQuery, [
      brandId,
      seasonIds
    ]);

    if (adjustmentsResult.rows.length === 0) {
      return {
        brand_name: brandName,
        seasons_analyzed: seasonsAnalyzed,
        overall_avg_adjustment_pct: 0,
        by_category: [],
        by_size: [],
        by_gender: [],
        by_location: []
      };
    }

    // Calculate overall adjustment percentage
    let totalOriginal = 0;
    let totalAdjusted = 0;
    const categoryMap = {};
    const sizeMap = {};
    const genderMap = {};
    const locationMap = {};

    for (const row of adjustmentsResult.rows) {
      const original = parseInt(row.original_quantity) || 0;
      const adjusted = parseInt(row.adjusted_quantity) || 0;

      totalOriginal += original;
      totalAdjusted += adjusted;

      // Track by category
      if (!categoryMap[row.category]) {
        categoryMap[row.category] = { total_original: 0, total_adjusted: 0, count: 0 };
      }
      categoryMap[row.category].total_original += original;
      categoryMap[row.category].total_adjusted += adjusted;
      categoryMap[row.category].count++;

      // Track by size
      if (!sizeMap[row.size]) {
        sizeMap[row.size] = { total_original: 0, total_adjusted: 0, count: 0 };
      }
      sizeMap[row.size].total_original += original;
      sizeMap[row.size].total_adjusted += adjusted;
      sizeMap[row.size].count++;

      // Track by gender
      if (!genderMap[row.gender]) {
        genderMap[row.gender] = { total_original: 0, total_adjusted: 0, count: 0 };
      }
      genderMap[row.gender].total_original += original;
      genderMap[row.gender].total_adjusted += adjusted;
      genderMap[row.gender].count++;

      // Track by location
      if (!locationMap[row.location_name]) {
        locationMap[row.location_name] = { total_original: 0, total_adjusted: 0, count: 0 };
      }
      locationMap[row.location_name].total_original += original;
      locationMap[row.location_name].total_adjusted += adjusted;
      locationMap[row.location_name].count++;
    }

    const overallAdjustmentPct = totalOriginal > 0
      ? Math.round(((totalAdjusted - totalOriginal) / totalOriginal) * 10000) / 100
      : 0;

    // Build response objects
    const byCategory = Object.entries(categoryMap).map(([category, data]) => ({
      category,
      avg_pct: data.total_original > 0
        ? Math.round(((data.total_adjusted - data.total_original) / data.total_original) * 10000) / 100
        : 0,
      item_count: data.count
    })).sort((a, b) => b.item_count - a.item_count);

    const bySize = Object.entries(sizeMap).map(([size, data]) => ({
      size,
      avg_pct: data.total_original > 0
        ? Math.round(((data.total_adjusted - data.total_original) / data.total_original) * 10000) / 100
        : 0,
      item_count: data.count
    })).sort((a, b) => b.item_count - a.item_count);

    const byGender = Object.entries(genderMap).map(([gender, data]) => ({
      gender,
      avg_pct: data.total_original > 0
        ? Math.round(((data.total_adjusted - data.total_original) / data.total_original) * 10000) / 100
        : 0,
      item_count: data.count
    })).sort((a, b) => b.item_count - a.item_count);

    const byLocation = Object.entries(locationMap).map(([location_name, data]) => ({
      location_name,
      avg_pct: data.total_original > 0
        ? Math.round(((data.total_adjusted - data.total_original) / data.total_original) * 10000) / 100
        : 0,
      item_count: data.count
    })).sort((a, b) => b.item_count - a.item_count);

    return {
      brand_name: brandName,
      seasons_analyzed: seasonsAnalyzed,
      overall_avg_adjustment_pct: overallAdjustmentPct,
      by_category: byCategory,
      by_size: bySize,
      by_gender: byGender,
      by_location: byLocation
    };
  } catch (error) {
    console.error('[PatternService] analyzeBrandPatterns error:', error);
    return {
      error: error.message,
      brand_name: null,
      seasons_analyzed: 0,
      overall_avg_adjustment_pct: 0,
      by_category: [],
      by_size: [],
      by_gender: [],
      by_location: []
    };
  }
}

/**
 * Analyze ordering adjustment patterns for a location across multiple seasons
 * @param {number} locationId - The location ID to analyze
 * @param {number} seasonCount - Number of past seasons to analyze (default 4)
 * @returns {Object} Pattern analysis with breakdown by brand and category
 */
async function analyzeLocationPatterns(locationId, seasonCount = 4) {
  try {
    // Get location name
    const locationResult = await pool.query(
      'SELECT name FROM locations WHERE id = $1',
      [locationId]
    );

    if (locationResult.rows.length === 0) {
      return {
        error: 'Location not found',
        location_name: null,
        seasons_analyzed: 0,
        overall_avg_adjustment_pct: 0,
        by_brand: [],
        by_category: []
      };
    }

    const locationName = locationResult.rows[0].name;

    // Get the most recent N finalized seasons for this location
    const seasonQuery = `
      SELECT DISTINCT s.id, s.name
      FROM seasons s
      JOIN finalized_adjustments fa ON fa.season_id = s.id
      WHERE fa.location_id = $1
      AND s.status = 'finalized'
      ORDER BY s.id DESC
      LIMIT $2
    `;

    const seasonsResult = await pool.query(seasonQuery, [locationId, seasonCount]);

    if (seasonsResult.rows.length === 0) {
      return {
        location_name: locationName,
        seasons_analyzed: 0,
        overall_avg_adjustment_pct: 0,
        by_brand: [],
        by_category: []
      };
    }

    const seasonIds = seasonsResult.rows.map(s => s.id);
    const seasonsAnalyzed = seasonsResult.rows.length;

    // Query finalized adjustments for these seasons
    const adjustmentsQuery = `
      SELECT
        fa.original_quantity,
        fa.adjusted_quantity,
        b.name as brand_name,
        p.category
      FROM finalized_adjustments fa
      JOIN products p ON fa.product_id = p.id
      JOIN brands b ON fa.brand_id = b.id
      WHERE fa.location_id = $1
      AND fa.season_id = ANY($2)
    `;

    const adjustmentsResult = await pool.query(adjustmentsQuery, [
      locationId,
      seasonIds
    ]);

    if (adjustmentsResult.rows.length === 0) {
      return {
        location_name: locationName,
        seasons_analyzed: seasonsAnalyzed,
        overall_avg_adjustment_pct: 0,
        by_brand: [],
        by_category: []
      };
    }

    // Calculate overall adjustment percentage
    let totalOriginal = 0;
    let totalAdjusted = 0;
    const brandMap = {};
    const categoryMap = {};

    for (const row of adjustmentsResult.rows) {
      const original = parseInt(row.original_quantity) || 0;
      const adjusted = parseInt(row.adjusted_quantity) || 0;

      totalOriginal += original;
      totalAdjusted += adjusted;

      // Track by brand
      if (!brandMap[row.brand_name]) {
        brandMap[row.brand_name] = { total_original: 0, total_adjusted: 0, count: 0 };
      }
      brandMap[row.brand_name].total_original += original;
      brandMap[row.brand_name].total_adjusted += adjusted;
      brandMap[row.brand_name].count++;

      // Track by category
      if (!categoryMap[row.category]) {
        categoryMap[row.category] = { total_original: 0, total_adjusted: 0, count: 0 };
      }
      categoryMap[row.category].total_original += original;
      categoryMap[row.category].total_adjusted += adjusted;
      categoryMap[row.category].count++;
    }

    const overallAdjustmentPct = totalOriginal > 0
      ? Math.round(((totalAdjusted - totalOriginal) / totalOriginal) * 10000) / 100
      : 0;

    // Build response objects
    const byBrand = Object.entries(brandMap).map(([brand_name, data]) => ({
      brand_name,
      avg_pct: data.total_original > 0
        ? Math.round(((data.total_adjusted - data.total_original) / data.total_original) * 10000) / 100
        : 0,
      item_count: data.count
    })).sort((a, b) => b.item_count - a.item_count);

    const byCategory = Object.entries(categoryMap).map(([category, data]) => ({
      category,
      avg_pct: data.total_original > 0
        ? Math.round(((data.total_adjusted - data.total_original) / data.total_original) * 10000) / 100
        : 0,
      item_count: data.count
    })).sort((a, b) => b.item_count - a.item_count);

    return {
      location_name: locationName,
      seasons_analyzed: seasonsAnalyzed,
      overall_avg_adjustment_pct: overallAdjustmentPct,
      by_brand: byBrand,
      by_category: byCategory
    };
  } catch (error) {
    console.error('[PatternService] analyzeLocationPatterns error:', error);
    return {
      error: error.message,
      location_name: null,
      seasons_analyzed: 0,
      overall_avg_adjustment_pct: 0,
      by_brand: [],
      by_category: []
    };
  }
}

/**
 * Generate suggested adjustments for an order based on historical patterns
 * @param {number} orderId - The order ID to generate suggestions for
 * @returns {Object} Suggested adjustments with historical reasoning
 */
async function generateSuggestedAdjustments(orderId) {
  try {
    // Get order details
    const orderQuery = `
      SELECT o.id, o.brand_id, o.location_id, o.season_id, s.name as season_name
      FROM orders o
      JOIN seasons s ON o.season_id = s.id
      WHERE o.id = $1
    `;

    const orderResult = await pool.query(orderQuery, [orderId]);

    if (orderResult.rows.length === 0) {
      return {
        error: 'Order not found',
        source_season: null,
        suggestions: []
      };
    }

    const order = orderResult.rows[0];
    const { brand_id, location_id, season_id } = order;

    // Get the most recent finalized season for this brand+location combo (before current season)
    const previousSeasonQuery = `
      SELECT DISTINCT s.id, s.name
      FROM seasons s
      JOIN finalized_adjustments fa ON fa.season_id = s.id
      WHERE fa.brand_id = $1
      AND fa.location_id = $2
      AND s.id < $3
      AND s.status = 'finalized'
      ORDER BY s.id DESC
      LIMIT 1
    `;

    const previousSeasonResult = await pool.query(previousSeasonQuery, [
      brand_id,
      location_id,
      season_id
    ]);

    const sourceSeason = previousSeasonResult.rows.length > 0
      ? previousSeasonResult.rows[0]
      : null;

    // Get current order items
    const itemsQuery = `
      SELECT
        oi.id,
        oi.product_id,
        oi.quantity as original_qty,
        oi.adjusted_quantity,
        p.name,
        p.base_name,
        p.size,
        p.color,
        p.upc
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `;

    const itemsResult = await pool.query(itemsQuery, [orderId]);

    if (itemsResult.rows.length === 0) {
      return {
        source_season: sourceSeason ? sourceSeason.name : null,
        suggestions: []
      };
    }

    const suggestions = [];

    // For each item, find matching product in previous season and calculate adjustment ratio
    for (const item of itemsResult.rows) {
      let suggestedQty = null;
      let adjustmentRatio = null;
      let reasoning = 'No historical data';

      if (sourceSeason) {
        // Try to find matching product in previous season by base_name, size, color, and upc
        const historyQuery = `
          SELECT
            fa.original_quantity,
            fa.adjusted_quantity,
            p.base_name,
            p.size,
            p.color,
            p.upc
          FROM finalized_adjustments fa
          JOIN products p ON fa.product_id = p.id
          WHERE fa.season_id = $1
          AND fa.brand_id = $2
          AND fa.location_id = $3
          AND (
            (p.upc = $4 AND p.upc IS NOT NULL)
            OR (p.base_name = $5 AND p.size = $6 AND p.color = $7)
          )
          LIMIT 1
        `;

        const historyResult = await pool.query(historyQuery, [
          sourceSeason.id,
          brand_id,
          location_id,
          item.upc,
          item.base_name,
          item.size,
          item.color
        ]);

        if (historyResult.rows.length > 0) {
          const history = historyResult.rows[0];
          const original = parseInt(history.original_quantity) || 0;
          const adjusted = parseInt(history.adjusted_quantity) || 0;

          if (original > 0) {
            adjustmentRatio = adjusted / original;
            suggestedQty = Math.round(parseInt(item.original_qty) * adjustmentRatio);
            reasoning = `Based on ${sourceSeason.name}: adjusted to ${(adjustmentRatio * 100).toFixed(1)}% of original (${adjusted}/${original})`;
          }
        }
      }

      suggestions.push({
        item_id: item.id,
        product_name: item.name,
        base_name: item.base_name,
        size: item.size,
        color: item.color,
        current_qty: parseInt(item.original_qty),
        suggested_qty: suggestedQty,
        adjustment_ratio: adjustmentRatio,
        reasoning
      });
    }

    return {
      source_season: sourceSeason ? sourceSeason.name : null,
      suggestions
    };
  } catch (error) {
    console.error('[PatternService] generateSuggestedAdjustments error:', error);
    return {
      error: error.message,
      source_season: null,
      suggestions: []
    };
  }
}

/**
 * Detect outlier adjustments in an order compared to historical patterns
 * @param {number} orderId - The order ID to analyze for outliers
 * @returns {Object} List of outlier items with deviation analysis
 */
async function detectOutliers(orderId) {
  try {
    // Get order details with brand and location
    const orderQuery = `
      SELECT o.id, o.brand_id, o.location_id, o.season_id
      FROM orders o
      WHERE o.id = $1
    `;

    const orderResult = await pool.query(orderQuery, [orderId]);

    if (orderResult.rows.length === 0) {
      return {
        error: 'Order not found',
        outliers: []
      };
    }

    const order = orderResult.rows[0];
    const { brand_id, location_id } = order;

    // Get historical average adjustment % for this brand/location combo
    const historyQuery = `
      SELECT
        fa.original_quantity,
        fa.adjusted_quantity,
        p.category,
        p.size,
        p.gender
      FROM finalized_adjustments fa
      JOIN products p ON fa.product_id = p.id
      WHERE fa.brand_id = $1
      AND fa.location_id = $2
      LIMIT 10000
    `;

    const historyResult = await pool.query(historyQuery, [brand_id, location_id]);

    if (historyResult.rows.length === 0) {
      return {
        outliers: []
      };
    }

    // Calculate category-level historical averages
    const categoryAverages = {};
    for (const row of historyResult.rows) {
      const original = parseInt(row.original_quantity) || 0;
      const adjusted = parseInt(row.adjusted_quantity) || 0;
      const category = row.category;

      if (!categoryAverages[category]) {
        categoryAverages[category] = { total_pct_change: 0, count: 0 };
      }

      if (original > 0) {
        const pctChange = ((adjusted - original) / original) * 100;
        categoryAverages[category].total_pct_change += pctChange;
        categoryAverages[category].count++;
      }
    }

    // Compute average percentages per category
    for (const category in categoryAverages) {
      const avg = categoryAverages[category];
      avg.avg_pct = avg.count > 0 ? avg.total_pct_change / avg.count : 0;
    }

    // Get current order items with adjustments
    const itemsQuery = `
      SELECT
        oi.id,
        oi.quantity as original_qty,
        oi.adjusted_quantity,
        p.name,
        p.category
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `;

    const itemsResult = await pool.query(itemsQuery, [orderId]);

    const outliers = [];
    const DEVIATION_THRESHOLD = 20; // 20% deviation threshold

    for (const item of itemsResult.rows) {
      const original = parseInt(item.original_qty) || 0;
      const adjusted = item.adjusted_quantity !== null ? parseInt(item.adjusted_quantity) : original;
      const category = item.category;

      if (original <= 0) continue;

      const currentAdjustmentPct = ((adjusted - original) / original) * 100;
      const historicalAvgPct = categoryAverages[category]
        ? categoryAverages[category].avg_pct
        : 0;

      const deviationPct = Math.abs(currentAdjustmentPct - historicalAvgPct);

      if (deviationPct > DEVIATION_THRESHOLD) {
        const direction = currentAdjustmentPct > historicalAvgPct ? 'over' : 'under';

        outliers.push({
          item_id: item.id,
          product_name: item.name,
          current_adjustment_pct: Math.round(currentAdjustmentPct * 100) / 100,
          historical_avg_pct: Math.round(historicalAvgPct * 100) / 100,
          deviation_pct: Math.round(deviationPct * 100) / 100,
          direction
        });
      }
    }

    return {
      outliers: outliers.sort((a, b) => b.deviation_pct - a.deviation_pct)
    };
  } catch (error) {
    console.error('[PatternService] detectOutliers error:', error);
    return {
      error: error.message,
      outliers: []
    };
  }
}

module.exports = {
  analyzeBrandPatterns,
  analyzeLocationPatterns,
  generateSuggestedAdjustments,
  detectOutliers
};
