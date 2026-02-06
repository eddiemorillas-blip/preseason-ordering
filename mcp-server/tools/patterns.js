const { pool } = require('../db.js');

/**
 * Format a number with decimals
 */
function formatNumber(num, decimals = 1) {
  if (num === null || num === undefined) return 'N/A';
  return parseFloat(num).toFixed(decimals);
}

/**
 * get_brand_patterns: Historical adjustment patterns for a brand
 */
async function getBrandPatterns(args) {
  try {
    const { brandId, seasonCount = 4 } = args;

    if (!brandId) {
      return {
        content: [{
          type: 'text',
          text: 'brandId parameter is required'
        }]
      };
    }

    // Get recent seasons
    const seasonsQuery = `
      SELECT id FROM seasons
      ORDER BY created_at DESC
      LIMIT $1
    `;

    const seasonsResult = await pool.query(seasonsQuery, [seasonCount]);
    const seasonIds = seasonsResult.rows.map(r => r.id);

    if (seasonIds.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No historical seasons found'
        }]
      };
    }

    // Get finalized adjustments by category and size
    const patternsQuery = `
      SELECT
        p.category,
        p.size,
        COALESCE(l.name, 'All Locations') AS location,
        COUNT(DISTINCT oi.id) AS item_count,
        AVG(CASE
          WHEN oi.quantity > 0 AND oi.adjusted_quantity IS NOT NULL
          THEN ((oi.adjusted_quantity - oi.quantity) / oi.quantity) * 100
          ELSE 0
        END) AS avg_pct_change,
        STDDEV(CASE
          WHEN oi.quantity > 0 AND oi.adjusted_quantity IS NOT NULL
          THEN ((oi.adjusted_quantity - oi.quantity) / oi.quantity) * 100
          ELSE 0
        END) AS stddev_pct
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN locations l ON o.location_id = l.id
      WHERE p.brand_id = $1
        AND o.season_id = ANY($2)
        AND oi.adjusted_quantity IS NOT NULL
      GROUP BY p.category, p.size, l.name
      ORDER BY p.category, p.size, l.name
    `;

    const patternsResult = await pool.query(patternsQuery, [
      brandId,
      seasonIds
    ]);

    if (patternsResult.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No finalized adjustment patterns found for this brand in recent seasons'
        }]
      };
    }

    // Calculate overall average
    let totalChange = 0;
    let totalItems = 0;

    patternsResult.rows.forEach(row => {
      if (row.avg_pct_change) {
        totalChange += row.avg_pct_change * row.item_count;
        totalItems += row.item_count;
      }
    });

    const overallAvg = totalItems > 0 ? totalChange / totalItems : 0;

    // Group by category
    const byCategory = {};
    const bySize = {};
    const byLocation = {};

    patternsResult.rows.forEach(row => {
      if (!byCategory[row.category]) {
        byCategory[row.category] = [];
      }
      byCategory[row.category].push(row);

      if (!bySize[row.size]) {
        bySize[row.size] = [];
      }
      bySize[row.size].push(row);

      if (!byLocation[row.location]) {
        byLocation[row.location] = [];
      }
      byLocation[row.location].push(row);
    });

    let summary = `BRAND ADJUSTMENT PATTERNS\n${'-'.repeat(80)}\n`;
    summary += `Brand ID: ${brandId} | Historical Seasons: ${seasonIds.length}\n`;
    summary += `Overall Average Adjustment: ${formatNumber(overallAvg, 1)}%\n\n`;

    // By Category
    summary += `PATTERNS BY CATEGORY\n${'-'.repeat(40)}\n`;
    summary += 'Category | Avg Change | Std Dev | Items\n';

    Object.keys(byCategory).sort().forEach(cat => {
      const rows = byCategory[cat];
      let catAvg = 0;
      let catTotal = 0;

      rows.forEach(row => {
        if (row.avg_pct_change) {
          catAvg += row.avg_pct_change * row.item_count;
          catTotal += row.item_count;
        }
      });

      const avgPct = catTotal > 0 ? catAvg / catTotal : 0;
      const stdDev = rows[0]?.stddev_pct || 0;

      summary += `${String(cat || 'N/A').padEnd(20)} | ${formatNumber(avgPct, 1)}% | ` +
                 `${formatNumber(stdDev, 1)}% | ${catTotal}\n`;
    });

    // By Size
    summary += `\nPATTERNS BY SIZE\n${'-'.repeat(40)}\n`;
    summary += 'Size | Avg Change | Items\n';

    Object.keys(bySize).sort().forEach(size => {
      const rows = bySize[size];
      let sizeAvg = 0;
      let sizeTotal = 0;

      rows.forEach(row => {
        if (row.avg_pct_change) {
          sizeAvg += row.avg_pct_change * row.item_count;
          sizeTotal += row.item_count;
        }
      });

      const avgPct = sizeTotal > 0 ? sizeAvg / sizeTotal : 0;
      summary += `${String(size || 'N/A').padEnd(10)} | ${formatNumber(avgPct, 1)}% | ${sizeTotal}\n`;
    });

    // By Location
    summary += `\nPATTERNS BY LOCATION\n${'-'.repeat(40)}\n`;
    summary += 'Location | Avg Change | Items\n';

    Object.keys(byLocation).sort().forEach(loc => {
      const rows = byLocation[loc];
      let locAvg = 0;
      let locTotal = 0;

      rows.forEach(row => {
        if (row.avg_pct_change) {
          locAvg += row.avg_pct_change * row.item_count;
          locTotal += row.item_count;
        }
      });

      const avgPct = locTotal > 0 ? locAvg / locTotal : 0;
      summary += `${String(loc).padEnd(20)} | ${formatNumber(avgPct, 1)}% | ${locTotal}\n`;
    });

    return {
      content: [{ type: 'text', text: summary }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting brand patterns: ${error.message}` }]
    };
  }
}

/**
 * get_location_patterns: Patterns for a specific location
 */
async function getLocationPatterns(args) {
  try {
    const { locationId, seasonCount = 4 } = args;

    if (!locationId) {
      return {
        content: [{
          type: 'text',
          text: 'locationId parameter is required'
        }]
      };
    }

    // Get recent seasons
    const seasonsQuery = `
      SELECT id FROM seasons
      ORDER BY created_at DESC
      LIMIT $1
    `;

    const seasonsResult = await pool.query(seasonsQuery, [seasonCount]);
    const seasonIds = seasonsResult.rows.map(r => r.id);

    if (seasonIds.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No historical seasons found'
        }]
      };
    }

    // Get finalized adjustments by brand and category
    const patternsQuery = `
      SELECT
        b.name AS brand,
        p.category,
        COUNT(DISTINCT oi.id) AS item_count,
        AVG(CASE
          WHEN oi.quantity > 0 AND oi.adjusted_quantity IS NOT NULL
          THEN ((oi.adjusted_quantity - oi.quantity) / oi.quantity) * 100
          ELSE 0
        END) AS avg_pct_change
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN brands b ON o.brand_id = b.id
      WHERE o.location_id = $1
        AND o.season_id = ANY($2)
        AND oi.adjusted_quantity IS NOT NULL
      GROUP BY b.name, p.category
      ORDER BY b.name, p.category
    `;

    const patternsResult = await pool.query(patternsQuery, [
      locationId,
      seasonIds
    ]);

    if (patternsResult.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No finalized adjustment patterns found for this location in recent seasons'
        }]
      };
    }

    // Get location name
    const locQuery = 'SELECT name FROM locations WHERE id = $1';
    const locResult = await pool.query(locQuery, [locationId]);
    const locationName = locResult.rows.length > 0 ? locResult.rows[0].name : 'Unknown';

    // Calculate overall average
    let totalChange = 0;
    let totalItems = 0;

    patternsResult.rows.forEach(row => {
      if (row.avg_pct_change) {
        totalChange += row.avg_pct_change * row.item_count;
        totalItems += row.item_count;
      }
    });

    const overallAvg = totalItems > 0 ? totalChange / totalItems : 0;

    // Group by brand
    const byBrand = {};
    const byCategory = {};

    patternsResult.rows.forEach(row => {
      if (!byBrand[row.brand]) {
        byBrand[row.brand] = [];
      }
      byBrand[row.brand].push(row);

      if (!byCategory[row.category]) {
        byCategory[row.category] = [];
      }
      byCategory[row.category].push(row);
    });

    let summary = `LOCATION ADJUSTMENT PATTERNS\n${'-'.repeat(80)}\n`;
    summary += `Location: ${locationName} | Historical Seasons: ${seasonIds.length}\n`;
    summary += `Overall Average Adjustment: ${formatNumber(overallAvg, 1)}%\n\n`;

    // By Brand
    summary += `PATTERNS BY BRAND\n${'-'.repeat(40)}\n`;
    summary += 'Brand | Avg Change | Items\n';

    Object.keys(byBrand).sort().forEach(brand => {
      const rows = byBrand[brand];
      let brandAvg = 0;
      let brandTotal = 0;

      rows.forEach(row => {
        if (row.avg_pct_change) {
          brandAvg += row.avg_pct_change * row.item_count;
          brandTotal += row.item_count;
        }
      });

      const avgPct = brandTotal > 0 ? brandAvg / brandTotal : 0;
      summary += `${String(brand || 'N/A').padEnd(20)} | ${formatNumber(avgPct, 1)}% | ${brandTotal}\n`;
    });

    // By Category
    summary += `\nPATTERNS BY CATEGORY\n${'-'.repeat(40)}\n`;
    summary += 'Category | Avg Change | Items\n';

    Object.keys(byCategory).sort().forEach(cat => {
      const rows = byCategory[cat];
      let catAvg = 0;
      let catTotal = 0;

      rows.forEach(row => {
        if (row.avg_pct_change) {
          catAvg += row.avg_pct_change * row.item_count;
          catTotal += row.item_count;
        }
      });

      const avgPct = catTotal > 0 ? catAvg / catTotal : 0;
      summary += `${String(cat || 'N/A').padEnd(20)} | ${formatNumber(avgPct, 1)}% | ${catTotal}\n`;
    });

    return {
      content: [{ type: 'text', text: summary }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting location patterns: ${error.message}` }]
    };
  }
}

/**
 * get_suggested_adjustments: Suggest adjustments based on previous seasons
 */
async function getSuggestedAdjustments(args) {
  try {
    const { orderId } = args;

    if (!orderId) {
      return {
        content: [{
          type: 'text',
          text: 'orderId parameter is required'
        }]
      };
    }

    // Get current order details
    const orderQuery = `
      SELECT
        o.season_id, o.brand_id, o.location_id,
        s.name AS season_name
      FROM orders o
      JOIN seasons s ON o.season_id = s.id
      WHERE o.id = $1
    `;

    const orderResult = await pool.query(orderQuery, [orderId]);

    if (orderResult.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `Order not found (ID: ${orderId})`
        }]
      };
    }

    const order = orderResult.rows[0];

    // Find previous season
    const prevSeasonQuery = `
      SELECT id, name FROM seasons
      WHERE created_at < (SELECT created_at FROM seasons WHERE id = $1)
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const prevSeasonResult = await pool.query(prevSeasonQuery, [order.season_id]);

    if (prevSeasonResult.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No previous season found for comparison'
        }]
      };
    }

    const prevSeason = prevSeasonResult.rows[0];

    // Get previous season's finalized data for same brand/location
    const prevOrderQuery = `
      SELECT
        p.base_name, p.size, p.color, p.category,
        SUM(COALESCE(oi.adjusted_quantity, oi.quantity)) AS prev_qty,
        AVG(CASE
          WHEN oi.quantity > 0 AND oi.adjusted_quantity IS NOT NULL
          THEN ((oi.adjusted_quantity - oi.quantity) / oi.quantity) * 100
          ELSE 0
        END) AS avg_adjustment_pct
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.season_id = $1
        AND o.brand_id = $2
        AND o.location_id = $3
        AND oi.adjusted_quantity IS NOT NULL
      GROUP BY p.base_name, p.size, p.color, p.category
    `;

    const prevOrderResult = await pool.query(prevOrderQuery, [
      prevSeason.id,
      order.brand_id,
      order.location_id
    ]);

    // Get current order items
    const currentItemsQuery = `
      SELECT
        oi.id, oi.quantity, p.base_name, p.size, p.color, p.category
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      ORDER BY p.category, p.base_name, p.size
    `;

    const currentItemsResult = await pool.query(currentItemsQuery, [orderId]);

    // Match and suggest
    const suggestions = [];

    currentItemsResult.rows.forEach(currentItem => {
      // Find matching item from previous season
      const prevMatch = prevOrderResult.rows.find(prev =>
        prev.base_name === currentItem.base_name &&
        prev.size === currentItem.size &&
        prev.color === currentItem.color
      );

      if (prevMatch) {
        // Use historical adjustment pattern
        const multiplier = 1 + (prevMatch.avg_adjustment_pct / 100);
        const suggestedQty = Math.round(currentItem.quantity * multiplier);

        suggestions.push({
          itemId: currentItem.id,
          product: currentItem.base_name,
          size: currentItem.size,
          color: currentItem.color,
          currentQty: currentItem.quantity,
          suggestedQty,
          qtyDiff: suggestedQty - currentItem.quantity,
          basedOnPct: formatNumber(prevMatch.avg_adjustment_pct, 1),
          confidence: 'medium'
        });
      }
    });

    if (suggestions.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No suggestions found. ${prevSeason.name} products may not match current order.`
        }]
      };
    }

    let summary = `SUGGESTED ADJUSTMENTS\n${'-'.repeat(80)}\n`;
    summary += `Current Season: ${order.season_name}\n`;
    summary += `Based on: ${prevSeason.name}\n`;
    summary += `Location: ${order.location_id} | Brand: ${order.brand_id}\n\n`;

    summary += 'Product | Size | Color | Current → Suggested | Based on %\n';
    summary += '-'.repeat(80) + '\n';

    suggestions.forEach(s => {
      summary += `${String(s.product.substring(0, 20)).padEnd(20)} | ${String((s.size || '-').substring(0, 6)).padEnd(6)} | ` +
                 `${String((s.color || '-').substring(0, 10)).padEnd(10)} | ${s.currentQty} → ${s.suggestedQty} ` +
                 `(${s.qtyDiff > 0 ? '+' : ''}${s.qtyDiff}) | ${s.basedOnPct}%\n`;
    });

    summary += `\n${'-'.repeat(80)}\n`;
    summary += `Total Suggestions: ${suggestions.length}\n`;

    return {
      content: [{ type: 'text', text: summary }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting suggested adjustments: ${error.message}` }]
    };
  }
}

module.exports = [
  {
    name: 'get_brand_patterns',
    description: 'Get historical adjustment patterns for a brand across locations and categories',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'integer', description: 'Brand ID' },
        seasonCount: { type: 'integer', description: 'Number of past seasons to analyze (default 4)' }
      },
      required: ['brandId']
    },
    handler: getBrandPatterns
  },
  {
    name: 'get_location_patterns',
    description: 'Get historical adjustment patterns for a location across brands and categories',
    inputSchema: {
      type: 'object',
      properties: {
        locationId: { type: 'integer', description: 'Location ID' },
        seasonCount: { type: 'integer', description: 'Number of past seasons to analyze (default 4)' }
      },
      required: ['locationId']
    },
    handler: getLocationPatterns
  },
  {
    name: 'get_suggested_adjustments',
    description: 'Get adjustment suggestions based on previous season patterns',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'integer', description: 'Order ID' }
      },
      required: ['orderId']
    },
    handler: getSuggestedAdjustments
  }
];
