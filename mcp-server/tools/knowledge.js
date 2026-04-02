const { pool } = require('../db.js');

/**
 * get_knowledge: Get institutional knowledge entries from the database
 */
async function getKnowledge(args) {
  try {
    const { brandId, locationId, category, type, key } = args;

    let query = `
      SELECT
        ke.id, ke.type, ke.target_id, ke.target_name,
        ke.key, ke.value, ke.description,
        ke.season_id, ke.priority, ke.active,
        ke.created_at, ke.updated_at
      FROM knowledge_entries ke
      WHERE ke.active = TRUE
    `;

    const params = [];
    let p = 1;

    if (type) {
      query += ` AND ke.type = $${p++}`;
      params.push(type);
    }
    if (brandId) {
      query += ` AND ke.target_id = $${p++}`;
      params.push(brandId);
    }
    if (locationId) {
      query += ` AND ke.target_id = $${p++}`;
      params.push(locationId);
    }
    if (key) {
      query += ` AND ke.key = $${p++}`;
      params.push(key);
    }

    query += ` ORDER BY ke.priority DESC, ke.updated_at DESC`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return {
        content: [{ type: 'text', text: 'No knowledge entries found for the specified criteria.' }]
      };
    }

    let output = `KNOWLEDGE ENTRIES (${result.rows.length})\n${'='.repeat(80)}\n`;

    for (const row of result.rows) {
      output += `\n${'─'.repeat(60)}\n`;
      output += `[${row.type}] ${row.key}\n`;
      output += `Description: ${row.description}\n`;
      if (row.target_id) output += `Target: ${row.target_name || ''} (ID: ${row.target_id})\n`;
      if (row.value && Object.keys(row.value).length > 0) {
        output += `Value: ${JSON.stringify(row.value)}\n`;
      }
      output += `Priority: ${row.priority} | Updated: ${row.updated_at ? row.updated_at.toISOString().split('T')[0] : 'N/A'}\n`;
    }

    return {
      content: [{ type: 'text', text: output }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting knowledge: ${error.message}` }]
    };
  }
}

/**
 * add_knowledge: Add or update a knowledge entry (upsert on type+key)
 */
async function addKnowledge(args) {
  try {
    const { type, targetId, targetName, key, description, value, priority } = args;

    if (!type || !key || !description) {
      return {
        content: [{
          type: 'text',
          text: 'type, key, and description parameters are required'
        }]
      };
    }

    // Parse value as JSON if it's a string
    let jsonValue = {};
    if (value) {
      if (typeof value === 'string') {
        try { jsonValue = JSON.parse(value); } catch { jsonValue = { data: value }; }
      } else {
        jsonValue = value;
      }
    }

    // Resolve target_name if targetId provided but no targetName
    let resolvedTargetName = targetName || null;
    if (targetId && !targetName) {
      // Try brands first, then locations
      const brandResult = await pool.query('SELECT name FROM brands WHERE id = $1', [targetId]);
      if (brandResult.rows.length > 0) {
        resolvedTargetName = brandResult.rows[0].name;
      } else {
        const locResult = await pool.query('SELECT name FROM locations WHERE id = $1', [targetId]);
        if (locResult.rows.length > 0) {
          resolvedTargetName = locResult.rows[0].name;
        }
      }
    }

    // Upsert: update if same type+key exists, otherwise insert
    const result = await pool.query(`
      INSERT INTO knowledge_entries (type, target_id, target_name, key, value, description, priority, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (type, key) WHERE type IS NOT NULL AND key IS NOT NULL
      DO UPDATE SET
        target_id = COALESCE(EXCLUDED.target_id, knowledge_entries.target_id),
        target_name = COALESCE(EXCLUDED.target_name, knowledge_entries.target_name),
        value = EXCLUDED.value,
        description = EXCLUDED.description,
        priority = COALESCE(EXCLUDED.priority, knowledge_entries.priority),
        active = TRUE,
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS is_insert
    `, [type, targetId || null, resolvedTargetName, key, JSON.stringify(jsonValue), description, priority || 0]);

    const row = result.rows[0];
    const action = row.is_insert ? 'CREATED' : 'UPDATED';

    let output = `KNOWLEDGE ENTRY ${action}\n${'─'.repeat(60)}\n`;
    output += `ID: ${row.id}\n`;
    output += `Type: ${type} | Key: ${key}\n`;
    output += `Description: ${description}\n`;
    if (targetId) output += `Target: ${resolvedTargetName || ''} (ID: ${targetId})\n`;
    if (value) output += `Value: ${JSON.stringify(jsonValue)}\n`;

    return {
      content: [{ type: 'text', text: output }]
    };
  } catch (error) {
    // If the upsert fails due to missing unique index, try plain insert
    if (error.message.includes('ON CONFLICT') || error.message.includes('constraint')) {
      try {
        const { type, targetId, targetName, key, description, value, priority } = args;
        let jsonValue = {};
        if (value) {
          if (typeof value === 'string') {
            try { jsonValue = JSON.parse(value); } catch { jsonValue = { data: value }; }
          } else {
            jsonValue = value;
          }
        }

        const result = await pool.query(`
          INSERT INTO knowledge_entries (type, target_id, target_name, key, value, description, priority, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
          RETURNING id
        `, [type, targetId || null, targetName || null, key, JSON.stringify(jsonValue), description, priority || 0]);

        let output = `KNOWLEDGE ENTRY CREATED\n${'─'.repeat(60)}\n`;
        output += `ID: ${result.rows[0].id}\n`;
        output += `Type: ${type} | Key: ${key}\n`;
        output += `Description: ${description}\n`;

        return { content: [{ type: 'text', text: output }] };
      } catch (fallbackError) {
        return { content: [{ type: 'text', text: `Error adding knowledge: ${fallbackError.message}` }] };
      }
    }
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
    description: 'Get institutional knowledge entries. Filter by type, brandId (target_id), key, or locationId.',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'integer', description: 'Filter by target_id (brand ID)' },
        locationId: { type: 'integer', description: 'Filter by target_id (location ID)' },
        category: { type: 'string', description: 'Product category' },
        type: { type: 'string', description: 'Knowledge type (e.g., "workflow", "discontinued_product", "sizing_preference")' },
        key: { type: 'string', description: 'Exact key match' }
      },
      required: []
    },
    handler: getKnowledge
  },
  {
    name: 'add_knowledge',
    description: 'Add or update an institutional knowledge entry. Upserts on type+key — if same type+key exists, it updates the entry.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Knowledge type (freeform, e.g., "workflow", "discontinued_product", "sizing_preference", "demand_pattern", "max_stock_level")' },
        targetId: { type: 'integer', description: 'Optional: Brand ID, Location ID, or Product ID' },
        targetName: { type: 'string', description: 'Optional: Name of the target (auto-resolved from targetId if omitted)' },
        key: { type: 'string', description: 'Knowledge key/identifier (unique within type)' },
        description: { type: 'string', description: 'Human-readable description of the knowledge' },
        value: { type: 'string', description: 'Optional: JSON string or plain value for structured data' },
        priority: { type: 'integer', description: 'Priority (higher = shown first, default 0)' }
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
