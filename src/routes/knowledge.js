const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const router = require('express').Router();

// ============================================
// KNOWLEDGE ENTRIES ENDPOINTS
// ============================================

// GET /api/knowledge - List all active knowledge entries with filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { type, target_id, key, season_id } = req.query;

    let query = `
      SELECT ke.*,
        COALESCE(b.name, l.name, p.name, ke.target_name) as resolved_target_name
      FROM knowledge_entries ke
      LEFT JOIN brands b ON ke.type = 'brand' AND ke.target_id = b.id
      LEFT JOIN locations l ON ke.type = 'location' AND ke.target_id = l.id
      LEFT JOIN products p ON ke.type = 'product' AND ke.target_id = p.id
      WHERE ke.active = true
    `;

    const params = [];
    let paramCount = 1;

    if (type) {
      query += ` AND ke.type = $${paramCount}`;
      params.push(type);
      paramCount++;
    }

    if (target_id) {
      query += ` AND ke.target_id = $${paramCount}`;
      params.push(target_id);
      paramCount++;
    }

    if (key) {
      query += ` AND ke.key = $${paramCount}`;
      params.push(key);
      paramCount++;
    }

    if (season_id) {
      query += ` AND ke.season_id = $${paramCount}`;
      params.push(season_id);
      paramCount++;
    }

    query += ' ORDER BY ke.priority DESC, ke.created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      count: result.rows.length,
      entries: result.rows
    });
  } catch (error) {
    console.error('Get knowledge entries error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/knowledge/:id - Get single knowledge entry
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT ke.*,
        COALESCE(b.name, l.name, p.name, ke.target_name) as resolved_target_name
      FROM knowledge_entries ke
      LEFT JOIN brands b ON ke.type = 'brand' AND ke.target_id = b.id
      LEFT JOIN locations l ON ke.type = 'location' AND ke.target_id = l.id
      LEFT JOIN products p ON ke.type = 'product' AND ke.target_id = p.id
      WHERE ke.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Knowledge entry not found' });
    }

    res.json({ entry: result.rows[0] });
  } catch (error) {
    console.error('Get knowledge entry error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/knowledge - Create new knowledge entry
router.post('/', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { type, target_id, key, value, description, season_id, priority } = req.body;

    // Validate required fields
    if (!type || !key || value === undefined) {
      return res.status(400).json({ error: 'type, key, and value are required' });
    }

    // Resolve target_name by looking up the target_id
    let target_name = null;
    if (target_id) {
      if (type === 'brand') {
        const brandResult = await pool.query('SELECT name FROM brands WHERE id = $1', [target_id]);
        target_name = brandResult.rows[0]?.name || null;
      } else if (type === 'location') {
        const locationResult = await pool.query('SELECT name FROM locations WHERE id = $1', [target_id]);
        target_name = locationResult.rows[0]?.name || null;
      } else if (type === 'product') {
        const productResult = await pool.query('SELECT name FROM products WHERE id = $1', [target_id]);
        target_name = productResult.rows[0]?.name || null;
      }
    }

    const result = await pool.query(`
      INSERT INTO knowledge_entries (type, target_id, target_name, key, value, description, season_id, priority, active, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)
      RETURNING *
    `, [
      type,
      target_id || null,
      target_name,
      key,
      value,
      description || null,
      season_id || null,
      priority || 0,
      req.user.id
    ]);

    res.status(201).json({
      message: 'Knowledge entry created successfully',
      entry: result.rows[0]
    });
  } catch (error) {
    console.error('Create knowledge entry error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/knowledge/:id - Update knowledge entry
router.put('/:id', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { id } = req.params;
    const { type, target_id, key, value, description, season_id, priority, active } = req.body;

    // Check if entry exists
    const entryExists = await pool.query('SELECT * FROM knowledge_entries WHERE id = $1', [id]);
    if (entryExists.rows.length === 0) {
      return res.status(404).json({ error: 'Knowledge entry not found' });
    }

    // Resolve target_name if target_id is being updated
    let target_name = entryExists.rows[0].target_name;
    if (target_id && target_id !== entryExists.rows[0].target_id) {
      if (type) {
        if (type === 'brand') {
          const brandResult = await pool.query('SELECT name FROM brands WHERE id = $1', [target_id]);
          target_name = brandResult.rows[0]?.name || null;
        } else if (type === 'location') {
          const locationResult = await pool.query('SELECT name FROM locations WHERE id = $1', [target_id]);
          target_name = locationResult.rows[0]?.name || null;
        } else if (type === 'product') {
          const productResult = await pool.query('SELECT name FROM products WHERE id = $1', [target_id]);
          target_name = productResult.rows[0]?.name || null;
        }
      }
    }

    const result = await pool.query(`
      UPDATE knowledge_entries SET
        type = COALESCE($1, type),
        target_id = COALESCE($2, target_id),
        target_name = COALESCE($3, target_name),
        key = COALESCE($4, key),
        value = COALESCE($5, value),
        description = COALESCE($6, description),
        season_id = COALESCE($7, season_id),
        priority = COALESCE($8, priority),
        active = COALESCE($9, active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING *
    `, [
      type,
      target_id,
      target_name,
      key,
      value,
      description,
      season_id,
      priority,
      active,
      id
    ]);

    res.json({
      message: 'Knowledge entry updated successfully',
      entry: result.rows[0]
    });
  } catch (error) {
    console.error('Update knowledge entry error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/knowledge/:id - Soft delete knowledge entry
router.delete('/:id', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { id } = req.params;

    const entryExists = await pool.query('SELECT * FROM knowledge_entries WHERE id = $1', [id]);
    if (entryExists.rows.length === 0) {
      return res.status(404).json({ error: 'Knowledge entry not found' });
    }

    await pool.query(
      'UPDATE knowledge_entries SET active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );

    res.json({ message: 'Knowledge entry deleted successfully' });
  } catch (error) {
    console.error('Delete knowledge entry error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADJUSTMENT RULES ENDPOINTS
// ============================================

// GET /api/knowledge/rules - List all enabled adjustment rules
router.get('/rules', authenticateToken, async (req, res) => {
  try {
    const { brand_id, location_id, category, rule_type } = req.query;

    let query = `
      SELECT ar.*,
        b.name as brand_name,
        l.name as location_name
      FROM adjustment_rules ar
      LEFT JOIN brands b ON ar.brand_id = b.id
      LEFT JOIN locations l ON ar.location_id = l.id
      WHERE ar.enabled = true
    `;

    const params = [];
    let paramCount = 1;

    if (brand_id) {
      query += ` AND ar.brand_id = $${paramCount}`;
      params.push(brand_id);
      paramCount++;
    }

    if (location_id) {
      query += ` AND ar.location_id = $${paramCount}`;
      params.push(location_id);
      paramCount++;
    }

    if (category) {
      query += ` AND ar.category = $${paramCount}`;
      params.push(category);
      paramCount++;
    }

    if (rule_type) {
      query += ` AND ar.rule_type = $${paramCount}`;
      params.push(rule_type);
      paramCount++;
    }

    query += ' ORDER BY ar.created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      count: result.rows.length,
      rules: result.rows
    });
  } catch (error) {
    console.error('Get adjustment rules error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/knowledge/rules/:id - Get single adjustment rule
router.get('/rules/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT ar.*,
        b.name as brand_name,
        l.name as location_name
      FROM adjustment_rules ar
      LEFT JOIN brands b ON ar.brand_id = b.id
      LEFT JOIN locations l ON ar.location_id = l.id
      WHERE ar.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Adjustment rule not found' });
    }

    res.json({ rule: result.rows[0] });
  } catch (error) {
    console.error('Get adjustment rule error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/knowledge/rules - Create new adjustment rule
router.post('/rules', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { name, description, rule_type, brand_id, location_id, category, subcategory, gender, season_id, rule_config } = req.body;

    if (!name || !rule_type || !rule_config) {
      return res.status(400).json({ error: 'name, rule_type, and rule_config are required' });
    }

    const result = await pool.query(`
      INSERT INTO adjustment_rules (name, description, rule_type, brand_id, location_id, category, subcategory, gender, season_id, rule_config, enabled, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11)
      RETURNING *
    `, [
      name,
      description || null,
      rule_type,
      brand_id || null,
      location_id || null,
      category || null,
      subcategory || null,
      gender || null,
      season_id || null,
      rule_config,
      req.user.id
    ]);

    res.status(201).json({
      message: 'Adjustment rule created successfully',
      rule: result.rows[0]
    });
  } catch (error) {
    console.error('Create adjustment rule error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/knowledge/rules/:id - Update adjustment rule
router.put('/rules/:id', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, rule_type, brand_id, location_id, category, subcategory, gender, season_id, rule_config, enabled } = req.body;

    const ruleExists = await pool.query('SELECT * FROM adjustment_rules WHERE id = $1', [id]);
    if (ruleExists.rows.length === 0) {
      return res.status(404).json({ error: 'Adjustment rule not found' });
    }

    const result = await pool.query(`
      UPDATE adjustment_rules SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        rule_type = COALESCE($3, rule_type),
        brand_id = COALESCE($4, brand_id),
        location_id = COALESCE($5, location_id),
        category = COALESCE($6, category),
        subcategory = COALESCE($7, subcategory),
        gender = COALESCE($8, gender),
        season_id = COALESCE($9, season_id),
        rule_config = COALESCE($10, rule_config),
        enabled = COALESCE($11, enabled),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $12
      RETURNING *
    `, [
      name,
      description,
      rule_type,
      brand_id,
      location_id,
      category,
      subcategory,
      gender,
      season_id,
      rule_config,
      enabled,
      id
    ]);

    res.json({
      message: 'Adjustment rule updated successfully',
      rule: result.rows[0]
    });
  } catch (error) {
    console.error('Update adjustment rule error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/knowledge/rules/:id - Soft delete adjustment rule
router.delete('/rules/:id', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { id } = req.params;

    const ruleExists = await pool.query('SELECT * FROM adjustment_rules WHERE id = $1', [id]);
    if (ruleExists.rows.length === 0) {
      return res.status(404).json({ error: 'Adjustment rule not found' });
    }

    await pool.query(
      'UPDATE adjustment_rules SET enabled = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );

    res.json({ message: 'Adjustment rule deleted successfully' });
  } catch (error) {
    console.error('Delete adjustment rule error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/knowledge/rules/:id/preview - Preview rule impact on an order
router.post('/rules/:id/preview', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    // Get the rule
    const ruleResult = await pool.query('SELECT * FROM adjustment_rules WHERE id = $1', [id]);
    if (ruleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Adjustment rule not found' });
    }

    const rule = ruleResult.rows[0];

    // Get order items
    const itemsResult = await pool.query(`
      SELECT oi.*, p.name as product_name, p.category, p.subcategory, p.gender, p.size
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `, [orderId]);

    const items = itemsResult.rows;
    const itemsAffected = [];
    const changes = [];

    let totalCurrent = 0;
    let totalNew = 0;

    // Apply rule logic based on rule_type
    for (const item of items) {
      totalCurrent += item.quantity;

      let newQuantity = item.quantity;
      let shouldApply = true;

      // Check if rule applies to this item
      if (rule.category && item.category !== rule.category) shouldApply = false;
      if (rule.subcategory && item.subcategory !== rule.subcategory) shouldApply = false;
      if (rule.gender && item.gender !== rule.gender) shouldApply = false;

      if (!shouldApply) {
        totalNew += item.quantity;
        continue;
      }

      // Apply rule based on type
      if (rule.rule_type === 'percentage') {
        const percentage = rule.rule_config.percentage || 0;
        newQuantity = Math.round(item.quantity * (1 + percentage / 100));
        itemsAffected.push(item.id);
      } else if (rule.rule_type === 'size_curve') {
        const sizeKey = item.size || 'default';
        const percentage = rule.rule_config[sizeKey] || rule.rule_config.default || 0;
        newQuantity = Math.round(item.quantity * (1 + percentage / 100));
        itemsAffected.push(item.id);
      } else if (rule.rule_type === 'threshold') {
        const minUnits = rule.rule_config.min_units || 0;
        const maxMonthsCoverage = rule.rule_config.max_months_coverage || Infinity;

        if (item.quantity < minUnits) {
          newQuantity = minUnits;
          itemsAffected.push(item.id);
        } else if (maxMonthsCoverage < Infinity && item.quantity > maxMonthsCoverage) {
          newQuantity = maxMonthsCoverage;
          itemsAffected.push(item.id);
        }
      }

      totalNew += newQuantity;

      if (newQuantity !== item.quantity) {
        const changePct = ((newQuantity - item.quantity) / item.quantity * 100).toFixed(2);
        changes.push({
          item_id: item.id,
          product_name: item.product_name,
          size: item.size,
          current_qty: item.quantity,
          new_qty: newQuantity,
          change_pct: parseFloat(changePct)
        });
      }
    }

    const totalChangePct = totalCurrent > 0 ? ((totalNew - totalCurrent) / totalCurrent * 100).toFixed(2) : 0;

    res.json({
      rule_id: rule.id,
      rule_name: rule.name,
      items_affected: itemsAffected.length,
      changes,
      summary: {
        total_current: totalCurrent,
        total_new: totalNew,
        total_change_pct: parseFloat(totalChangePct),
        budget_impact: totalNew - totalCurrent
      }
    });
  } catch (error) {
    console.error('Preview rule error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CONTEXT ENDPOINT FOR AI AGENT
// ============================================

// GET /api/knowledge/context - Query context for AI system prompts
router.get('/context', authenticateToken, async (req, res) => {
  try {
    const { brandId, locationId, seasonId, category } = req.query;

    const sections = [];
    let entryCount = 0;
    let ruleCount = 0;

    // Get brand knowledge
    if (brandId) {
      const brandResult = await pool.query(`
        SELECT b.name FROM brands b WHERE b.id = $1
      `, [brandId]);

      if (brandResult.rows.length > 0) {
        const brandName = brandResult.rows[0].name;
        const brandEntriesResult = await pool.query(`
          SELECT description, priority FROM knowledge_entries
          WHERE type = 'brand' AND target_id = $1 AND active = true
          ORDER BY priority DESC, created_at DESC
        `, [brandId]);

        if (brandEntriesResult.rows.length > 0) {
          const bullets = brandEntriesResult.rows
            .map(e => e.description)
            .filter(Boolean)
            .map(d => `- ${d}`);

          if (bullets.length > 0) {
            sections.push(`BRAND KNOWLEDGE: ${brandName}\n${bullets.join('\n')}`);
            entryCount += brandEntriesResult.rows.length;
          }
        }
      }
    }

    // Get location knowledge
    if (locationId) {
      const locationResult = await pool.query(`
        SELECT l.name FROM locations l WHERE l.id = $1
      `, [locationId]);

      if (locationResult.rows.length > 0) {
        const locationName = locationResult.rows[0].name;
        const locationEntriesResult = await pool.query(`
          SELECT description, priority FROM knowledge_entries
          WHERE type = 'location' AND target_id = $1 AND active = true
          ORDER BY priority DESC, created_at DESC
        `, [locationId]);

        if (locationEntriesResult.rows.length > 0) {
          const bullets = locationEntriesResult.rows
            .map(e => e.description)
            .filter(Boolean)
            .map(d => `- ${d}`);

          if (bullets.length > 0) {
            sections.push(`LOCATION KNOWLEDGE: ${locationName}\n${bullets.join('\n')}`);
            entryCount += locationEntriesResult.rows.length;
          }
        }
      }
    }

    // Get category rules
    if (category) {
      const categoryEntriesResult = await pool.query(`
        SELECT description, priority FROM knowledge_entries
        WHERE type = 'category' AND key = $1 AND active = true
        ORDER BY priority DESC, created_at DESC
      `, [category]);

      if (categoryEntriesResult.rows.length > 0) {
        const bullets = categoryEntriesResult.rows
          .map(e => e.description)
          .filter(Boolean)
          .map(d => `- ${d}`);

        if (bullets.length > 0) {
          sections.push(`CATEGORY RULES: ${category}\n${bullets.join('\n')}`);
          entryCount += categoryEntriesResult.rows.length;
        }
      }
    }

    // Get general knowledge entries
    const generalEntriesResult = await pool.query(`
      SELECT description, priority FROM knowledge_entries
      WHERE type = 'general' AND active = true
      ORDER BY priority DESC, created_at DESC
      LIMIT 10
    `);

    if (generalEntriesResult.rows.length > 0) {
      const bullets = generalEntriesResult.rows
        .map(e => e.description)
        .filter(Boolean)
        .map(d => `- ${d}`);

      if (bullets.length > 0) {
        sections.push(`GENERAL KNOWLEDGE\n${bullets.join('\n')}`);
        entryCount += generalEntriesResult.rows.length;
      }
    }

    // Get relevant adjustment rules
    const rulesQuery = 'SELECT name, description FROM adjustment_rules WHERE enabled = true';
    const ruleParams = [];
    let ruleParamCount = 1;

    let rulesSubquery = ' WHERE enabled = true';
    if (brandId) {
      rulesSubquery += ` AND (brand_id = $${ruleParamCount} OR brand_id IS NULL)`;
      ruleParams.push(brandId);
      ruleParamCount++;
    }
    if (locationId) {
      rulesSubquery += ` AND (location_id = $${ruleParamCount} OR location_id IS NULL)`;
      ruleParams.push(locationId);
      ruleParamCount++;
    }
    if (seasonId) {
      rulesSubquery += ` AND (season_id = $${ruleParamCount} OR season_id IS NULL)`;
      ruleParams.push(seasonId);
      ruleParamCount++;
    }

    const adjustmentRulesResult = await pool.query(
      `SELECT name, description FROM adjustment_rules ${rulesSubquery} ORDER BY created_at DESC`,
      ruleParams
    );

    if (adjustmentRulesResult.rows.length > 0) {
      const ruleBullets = adjustmentRulesResult.rows
        .map(r => {
          const desc = r.description ? `: ${r.description}` : '';
          return `- ${r.name}${desc}`;
        })
        .join('\n');

      sections.push(`AVAILABLE ADJUSTMENT RULES\n${ruleBullets}`);
      ruleCount = adjustmentRulesResult.rows.length;
    }

    const contextText = sections.join('\n\n');

    res.json({
      context_text: contextText,
      entry_count: entryCount,
      rule_count: ruleCount
    });
  } catch (error) {
    console.error('Get context error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
