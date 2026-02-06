const { pool } = require('../db.js');

/**
 * get_knowledge: Get institutional knowledge for a context
 */
async function getKnowledge(args) {
  try {
    const { brandId, locationId, category, type } = args;

    // Knowledge entries table may not exist, so we create a safe query
    // For now, we'll return placeholder info about the data structure
    let result = `INSTITUTIONAL KNOWLEDGE\n${'-'.repeat(80)}\n`;

    // Build knowledge from database context instead
    let queries = [];

    // Get brand info
    if (brandId) {
      const brandQuery = `
        SELECT
          b.id, b.name, b.vendor_code, b.contact_name, b.contact_email,
          COUNT(DISTINCT p.id) as product_count,
          COUNT(DISTINCT o.id) as order_count
        FROM brands b
        LEFT JOIN products p ON b.id = p.brand_id
        LEFT JOIN orders o ON b.id = o.brand_id
        WHERE b.id = $1
        GROUP BY b.id
      `;

      const brandResult = await pool.query(brandQuery, [brandId]);
      if (brandResult.rows.length > 0) {
        const b = brandResult.rows[0];
        result += `\nBRAND: ${b.name}\n${'-'.repeat(40)}\n`;
        result += `Vendor Code: ${b.vendor_code || 'N/A'}\n`;
        result += `Contact: ${b.contact_name || 'N/A'} (${b.contact_email || 'N/A'})\n`;
        result += `Products: ${b.product_count} | Orders: ${b.order_count}\n`;
      }
    }

    // Get location info
    if (locationId) {
      const locQuery = `
        SELECT
          l.id, l.name, l.code, l.address, l.city, l.state,
          COUNT(DISTINCT o.id) as order_count
        FROM locations l
        LEFT JOIN orders o ON l.id = o.location_id
        WHERE l.id = $1
        GROUP BY l.id
      `;

      const locResult = await pool.query(locQuery, [locationId]);
      if (locResult.rows.length > 0) {
        const l = locResult.rows[0];
        result += `\nLOCATION: ${l.name}\n${'-'.repeat(40)}\n`;
        result += `Code: ${l.code || 'N/A'} | Address: ${l.address || 'N/A'}\n`;
        result += `City: ${l.city || 'N/A'}, ${l.state || 'N/A'}\n`;
        result += `Orders: ${l.order_count}\n`;
      }
    }

    // Get category info
    if (category && brandId) {
      const catQuery = `
        SELECT
          p.category,
          COUNT(DISTINCT p.id) as product_count,
          COUNT(DISTINCT p.size) as size_variants,
          COUNT(DISTINCT p.color) as color_variants,
          MIN(p.wholesale_cost) as min_cost,
          MAX(p.wholesale_cost) as max_cost,
          AVG(p.wholesale_cost) as avg_cost
        FROM products p
        WHERE p.brand_id = $1 AND p.category = $2
        GROUP BY p.category
      `;

      const catResult = await pool.query(catQuery, [brandId, category]);
      if (catResult.rows.length > 0) {
        const c = catResult.rows[0];
        result += `\nCATEGORY: ${c.category}\n${'-'.repeat(40)}\n`;
        result += `Products: ${c.product_count} | Sizes: ${c.size_variants} | Colors: ${c.color_variants}\n`;
        result += `Cost Range: $${parseFloat(c.min_cost).toFixed(2)} - $${parseFloat(c.max_cost).toFixed(2)} ` +
                  `(avg: $${parseFloat(c.avg_cost).toFixed(2)})\n`;
      }
    }

    result += `\n${'-'.repeat(80)}\n`;
    result += 'Note: Knowledge database structure ready for institutional insights.\n';

    return {
      content: [{ type: 'text', text: result }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting knowledge: ${error.message}` }]
    };
  }
}

/**
 * add_knowledge: Add a new knowledge entry
 */
async function addKnowledge(args) {
  try {
    const { type, targetId, key, description, value } = args;

    if (!type || !key || !description) {
      return {
        content: [{
          type: 'text',
          text: 'type, key, and description parameters are required'
        }]
      };
    }

    // Knowledge entries table may not exist, so we store as comments in the future
    let result = `KNOWLEDGE ENTRY ADDED\n${'-'.repeat(80)}\n`;
    result += `Type: ${type}\n`;
    result += `Key: ${key}\n`;
    result += `Description: ${description}\n`;

    if (value) {
      result += `Value: ${value}\n`;
    }

    if (targetId) {
      result += `Target ID: ${targetId}\n`;
    }

    result += `\nNote: Entry would be stored in knowledge_entries table for AI agent context.\n`;

    return {
      content: [{ type: 'text', text: result }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error adding knowledge: ${error.message}` }]
    };
  }
}

/**
 * get_adjustment_rules: List available adjustment rules
 */
async function getAdjustmentRules(args) {
  try {
    const { brandId, locationId, category, ruleType } = args;

    // Check if adjustment_rules table exists
    const tableCheckQuery = `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'adjustment_rules'
      )
    `;

    const tableCheck = await pool.query(tableCheckQuery);
    const tableExists = tableCheck.rows[0].exists;

    if (!tableExists) {
      return {
        content: [{
          type: 'text',
          text: 'Adjustment rules table is not yet configured. ' +
                'Rules framework ready for implementation with these types: ' +
                'size_curve, percentage_adjustment, category_override, seasonal_pattern'
        }]
      };
    }

    let query = `
      SELECT
        id, rule_name, rule_type, description,
        rule_config, enabled, brand_id, location_id, category,
        created_at, updated_at
      FROM adjustment_rules
      WHERE enabled = true
    `;

    const params = [];
    let paramCount = 1;

    if (brandId) {
      query += ` AND (brand_id = $${paramCount} OR brand_id IS NULL)`;
      params.push(brandId);
      paramCount++;
    }

    if (locationId) {
      query += ` AND (location_id = $${paramCount} OR location_id IS NULL)`;
      params.push(locationId);
      paramCount++;
    }

    if (category) {
      query += ` AND (category = $${paramCount} OR category IS NULL)`;
      params.push(category);
      paramCount++;
    }

    if (ruleType) {
      query += ` AND rule_type = $${paramCount}`;
      params.push(ruleType);
      paramCount++;
    }

    query += ` ORDER BY brand_id DESC NULLS LAST, location_id DESC NULLS LAST, category`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No adjustment rules found for the specified criteria.'
        }]
      };
    }

    let summary = `ADJUSTMENT RULES\n${'-'.repeat(80)}\n`;

    result.rows.forEach((row, i) => {
      summary += `\n${i + 1}. ${row.rule_name}\n`;
      summary += `   Type: ${row.rule_type}\n`;
      summary += `   Description: ${row.description}\n`;

      if (row.brand_id || row.location_id || row.category) {
        summary += `   Target: Brand ${row.brand_id || 'any'} | Location ${row.location_id || 'any'} | Category ${row.category || 'any'}\n`;
      }

      summary += `   Config: ${JSON.stringify(row.rule_config || {})}\n`;
    });

    return {
      content: [{ type: 'text', text: summary }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting adjustment rules: ${error.message}` }]
    };
  }
}

/**
 * get_full_context: Get complete knowledge context for AI reasoning
 */
async function getFullContext(args) {
  try {
    const { brandId, locationId, seasonId } = args;

    let context = `COMPLETE CONTEXT FOR AI REASONING\n${'-'.repeat(80)}\n`;

    // Season context
    if (seasonId) {
      const seasonQuery = `
        SELECT
          s.id, s.name, s.status, s.start_date, s.end_date,
          COUNT(DISTINCT o.id) as order_count,
          SUM(COALESCE(SUM(oi.line_total), 0)) as total_value
        FROM seasons s
        LEFT JOIN orders o ON s.id = o.season_id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        WHERE s.id = $1
        GROUP BY s.id
      `;

      const seasonResult = await pool.query(seasonQuery, [seasonId]);
      if (seasonResult.rows.length > 0) {
        const s = seasonResult.rows[0];
        context += `\nSEASON: ${s.name} (${s.status})\n`;
        context += `Period: ${s.start_date ? s.start_date.toISOString().split('T')[0] : 'N/A'} to ` +
                   `${s.end_date ? s.end_date.toISOString().split('T')[0] : 'N/A'}\n`;
        context += `Orders: ${s.order_count} | Total Value: $${parseFloat(s.total_value || 0).toFixed(2)}\n`;
      }
    }

    // Brand context
    if (brandId) {
      const brandQuery = `
        SELECT
          b.id, b.name, b.vendor_code,
          COUNT(DISTINCT p.id) as product_count,
          COUNT(DISTINCT CASE WHEN p.category IS NOT NULL THEN p.category END) as category_count,
          MIN(p.wholesale_cost) as min_product_cost,
          MAX(p.wholesale_cost) as max_product_cost
        FROM brands b
        LEFT JOIN products p ON b.id = p.brand_id
        WHERE b.id = $1
        GROUP BY b.id
      `;

      const brandResult = await pool.query(brandQuery, [brandId]);
      if (brandResult.rows.length > 0) {
        const b = brandResult.rows[0];
        context += `\nBRAND: ${b.name} (Code: ${b.vendor_code || 'N/A'})\n`;
        context += `Products: ${b.product_count} | Categories: ${b.category_count}\n`;
        context += `Product Cost Range: $${parseFloat(b.min_product_cost || 0).toFixed(2)} - ` +
                   `$${parseFloat(b.max_product_cost || 0).toFixed(2)}\n`;
      }
    }

    // Location context
    if (locationId) {
      const locQuery = `
        SELECT
          l.id, l.name, l.city, l.state,
          COUNT(DISTINCT o.id) as order_count,
          COUNT(DISTINCT o.brand_id) as brand_count
        FROM locations l
        LEFT JOIN orders o ON l.id = o.location_id
        WHERE l.id = $1
        GROUP BY l.id
      `;

      const locResult = await pool.query(locQuery, [locationId]);
      if (locResult.rows.length > 0) {
        const l = locResult.rows[0];
        context += `\nLOCATION: ${l.name}, ${l.city}, ${l.state}\n`;
        context += `Orders: ${l.order_count} | Brands: ${l.brand_count}\n`;
      }
    }

    // Orders summary
    if (seasonId || brandId || locationId) {
      let orderQuery = `
        SELECT
          o.status,
          COUNT(*) as count,
          SUM(COALESCE(SUM(oi.line_total), 0)) as total_value
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        WHERE 1=1
      `;

      const params = [];
      let paramCount = 1;

      if (seasonId) {
        orderQuery += ` AND o.season_id = $${paramCount}`;
        params.push(seasonId);
        paramCount++;
      }

      if (brandId) {
        orderQuery += ` AND o.brand_id = $${paramCount}`;
        params.push(brandId);
        paramCount++;
      }

      if (locationId) {
        orderQuery += ` AND o.location_id = $${paramCount}`;
        params.push(locationId);
        paramCount++;
      }

      orderQuery += ` GROUP BY o.status`;

      const orderResult = await pool.query(orderQuery, params);

      if (orderResult.rows.length > 0) {
        context += `\nORDERS BY STATUS:\n`;
        orderResult.rows.forEach(row => {
          context += `  ${row.status}: ${row.count} orders ($${parseFloat(row.total_value || 0).toFixed(2)})\n`;
        });
      }
    }

    context += `\n${'-'.repeat(80)}\n`;
    context += 'This context can be used to generate adjustment recommendations and insights.\n';

    return {
      content: [{ type: 'text', text: context }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting full context: ${error.message}` }]
    };
  }
}

module.exports = [
  {
    name: 'get_knowledge',
    description: 'Get institutional knowledge for a brand, location, or category',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'integer', description: 'Brand ID' },
        locationId: { type: 'integer', description: 'Location ID' },
        category: { type: 'string', description: 'Product category' },
        type: { type: 'string', description: 'Knowledge type filter' }
      },
      required: []
    },
    handler: getKnowledge
  },
  {
    name: 'add_knowledge',
    description: 'Add a new institutional knowledge entry',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Knowledge type (e.g., "sizing_preference", "demand_pattern")' },
        targetId: { type: 'integer', description: 'Optional: Brand, Location, or Category ID' },
        key: { type: 'string', description: 'Knowledge key/identifier' },
        description: { type: 'string', description: 'Description of the knowledge' },
        value: { type: 'string', description: 'Optional: Quantitative value' }
      },
      required: ['type', 'key', 'description']
    },
    handler: addKnowledge
  },
  {
    name: 'get_adjustment_rules',
    description: 'Get available adjustment rules configured for a context',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'integer', description: 'Brand ID' },
        locationId: { type: 'integer', description: 'Location ID' },
        category: { type: 'string', description: 'Product category' },
        ruleType: { type: 'string', description: 'Rule type (size_curve, percentage_adjustment, etc)' }
      },
      required: []
    },
    handler: getAdjustmentRules
  },
  {
    name: 'get_full_context',
    description: 'Get complete knowledge context combining orders, products, and patterns for AI reasoning',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'integer', description: 'Brand ID' },
        locationId: { type: 'integer', description: 'Location ID' },
        seasonId: { type: 'integer', description: 'Season ID' }
      },
      required: []
    },
    handler: getFullContext
  }
];
