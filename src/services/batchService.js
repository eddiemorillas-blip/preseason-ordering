const pool = require('../config/database');

/**
 * Generate a unique batch operation ID
 */
function generateBatchId() {
  return 'batch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Preview a batch operation without applying changes
 * Calculates what quantities would be adjusted for matching items
 *
 * @param {number} orderId - The order ID to preview
 * @param {Object} operation - Operation details: { type, filters, config }
 *   type: 'percentage' | 'size_curve' | 'threshold'
 *   filters: { category?, gender?, subcategory?, color? }
 *   config: varies by type
 * @returns {Object} Preview with items_affected and changes array
 */
async function previewBatchOperation(orderId, operation) {
  try {
    const { type, filters = {}, config = {} } = operation;

    if (!type || !['percentage', 'size_curve', 'threshold'].includes(type)) {
      throw new Error('Invalid operation type. Must be: percentage, size_curve, or threshold');
    }

    // Query order items with product details
    const query = `
      SELECT
        oi.id as order_item_id,
        oi.order_id,
        oi.product_id,
        oi.quantity,
        oi.adjusted_quantity,
        oi.unit_cost,
        p.id,
        p.name as product_name,
        p.base_name,
        p.size,
        p.color,
        p.category,
        p.gender,
        p.subcategory,
        p.sku,
        p.upc
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      ORDER BY oi.id
    `;

    const result = await pool.query(query, [orderId]);
    const items = result.rows;

    if (items.length === 0) {
      return {
        preview_id: generateBatchId(),
        order_id: orderId,
        operation,
        items_affected: 0,
        changes: [],
        summary: {
          total_current_qty: 0,
          total_new_qty: 0,
          total_change_pct: 0,
          budget_impact: 0
        }
      };
    }

    // Apply filters
    const filtered = items.filter(item => {
      if (filters.category && item.category !== filters.category) return false;
      if (filters.gender && item.gender !== filters.gender) return false;
      if (filters.subcategory && item.subcategory !== filters.subcategory) return false;
      if (filters.color && item.color !== filters.color) return false;
      return true;
    });

    // Calculate changes for each filtered item
    const changes = [];
    let totalCurrentQty = 0;
    let totalNewQty = 0;
    let budgetImpact = 0;

    for (const item of filtered) {
      const currentQty = item.adjusted_quantity !== null ? item.adjusted_quantity : item.quantity;
      let newQty;

      // Calculate new quantity based on operation type
      if (type === 'percentage') {
        const percentage = config.percentage || 0;
        newQty = Math.round(currentQty * (1 + percentage / 100));
        newQty = Math.max(0, newQty);
      } else if (type === 'size_curve') {
        const sizeAdjustments = config.size_adjustments || {};
        const normalizedSize = (item.size || '').toLowerCase().trim();
        const sizeAdjustment = sizeAdjustments[normalizedSize] || 0;
        newQty = Math.round(currentQty * (1 + sizeAdjustment / 100));
        newQty = Math.max(0, newQty);
      } else if (type === 'threshold') {
        newQty = currentQty;
        if (config.min_units !== undefined) {
          newQty = Math.max(newQty, config.min_units);
        }
        if (config.max_units !== undefined) {
          newQty = Math.min(newQty, config.max_units);
        }
      }

      const changePct = currentQty > 0 ? ((newQty - currentQty) / currentQty) * 100 : 0;
      const itemBudgetImpact = (newQty - currentQty) * (item.unit_cost || 0);

      changes.push({
        item_id: item.order_item_id,
        order_item_id: item.order_item_id,
        product_id: item.product_id,
        product_name: item.product_name,
        base_name: item.base_name,
        size: item.size,
        color: item.color,
        category: item.category,
        gender: item.gender,
        current_qty: currentQty,
        new_qty: newQty,
        change_pct: Math.round(changePct * 10) / 10
      });

      totalCurrentQty += currentQty;
      totalNewQty += newQty;
      budgetImpact += itemBudgetImpact;
    }

    const totalChangePct = totalCurrentQty > 0 ? ((totalNewQty - totalCurrentQty) / totalCurrentQty) * 100 : 0;

    return {
      preview_id: generateBatchId(),
      order_id: orderId,
      operation,
      items_affected: changes.length,
      changes,
      summary: {
        total_current_qty: totalCurrentQty,
        total_new_qty: totalNewQty,
        total_change_pct: Math.round(totalChangePct * 10) / 10,
        budget_impact: Math.round(budgetImpact * 100) / 100
      }
    };
  } catch (error) {
    throw new Error(`Failed to preview batch operation: ${error.message}`);
  }
}

/**
 * Apply a batch operation and record changes in adjustment_history
 *
 * @param {number} orderId - The order ID
 * @param {Array} changes - Array of { order_item_id, new_qty }
 * @param {number} userId - User applying the operation
 * @param {Object} operation - The original operation object
 * @returns {Object} Result with batch_operation_id and summary
 */
async function applyBatchOperation(orderId, changes, userId, operation) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const batchId = generateBatchId();
    const adjustmentType = operation.type; // 'percentage', 'size_curve', or 'threshold'

    // Get current order items for context
    const itemQuery = `
      SELECT
        oi.id as order_item_id,
        oi.quantity,
        oi.adjusted_quantity,
        oi.product_id,
        p.name as product_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `;
    const itemResult = await client.query(itemQuery, [orderId]);
    const itemMap = {};
    itemResult.rows.forEach(row => {
      itemMap[row.order_item_id] = row;
    });

    // Update each order item
    let updatedCount = 0;
    const historyInserts = [];

    for (const change of changes) {
      const { order_item_id, new_qty } = change;
      const item = itemMap[order_item_id];

      if (!item) {
        throw new Error(`Order item ${order_item_id} not found in order ${orderId}`);
      }

      const currentQty = item.adjusted_quantity !== null ? item.adjusted_quantity : item.quantity;

      // Update the order item
      await client.query(
        'UPDATE order_items SET adjusted_quantity = $1 WHERE id = $2 AND order_id = $3',
        [new_qty, order_item_id, orderId]
      );

      // Prepare history record
      historyInserts.push({
        order_id: orderId,
        order_item_id: order_item_id,
        product_id: item.product_id,
        applied_rule_id: null,
        batch_operation_id: batchId,
        original_quantity: currentQty,
        new_quantity: new_qty,
        adjustment_type: adjustmentType,
        reasoning: JSON.stringify(operation),
        applied_by: userId,
        applied_at: new Date()
      });

      updatedCount++;
    }

    // Insert adjustment history records
    for (const record of historyInserts) {
      await client.query(
        `INSERT INTO adjustment_history
         (order_id, order_item_id, product_id, applied_rule_id, batch_operation_id,
          original_quantity, new_quantity, adjustment_type, reasoning, applied_by, applied_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          record.order_id,
          record.order_item_id,
          record.product_id,
          record.applied_rule_id,
          record.batch_operation_id,
          record.original_quantity,
          record.new_quantity,
          record.adjustment_type,
          record.reasoning,
          record.applied_by,
          record.applied_at
        ]
      );
    }

    await client.query('COMMIT');

    // Calculate summary
    let totalOriginal = 0;
    let totalNew = 0;
    for (const record of historyInserts) {
      totalOriginal += record.original_quantity;
      totalNew += record.new_quantity;
    }

    return {
      batch_operation_id: batchId,
      items_updated: updatedCount,
      summary: {
        total_original_qty: totalOriginal,
        total_new_qty: totalNew,
        total_qty_change: totalNew - totalOriginal
      }
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`Failed to apply batch operation: ${error.message}`);
  } finally {
    client.release();
  }
}

/**
 * Preview copying quantities from a source season to target order
 * Matches products by base_name + size + color
 *
 * @param {number} targetOrderId - Target order to copy quantities to
 * @param {number} sourceSeasonId - Source season to copy quantities from
 * @param {number} scalingFactor - Multiplier for source quantities (default 1.0)
 * @param {Object} filters - Optional filters
 * @returns {Object} Preview with matched and unmatched items
 */
async function previewCopySeason(targetOrderId, sourceSeasonId, scalingFactor = 1.0, filters = {}) {
  try {
    // Get target order details
    const targetOrderQuery = `
      SELECT brand_id, location_id, season_id
      FROM orders
      WHERE id = $1
    `;
    const targetResult = await pool.query(targetOrderQuery, [targetOrderId]);
    if (targetResult.rows.length === 0) {
      throw new Error(`Target order ${targetOrderId} not found`);
    }

    const targetOrder = targetResult.rows[0];

    // Get target order items
    const targetItemsQuery = `
      SELECT
        oi.id as order_item_id,
        p.id as product_id,
        p.base_name,
        p.size,
        p.color,
        p.upc,
        oi.quantity,
        oi.adjusted_quantity
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      ORDER BY p.base_name, p.size, p.color
    `;
    const targetResult2 = await pool.query(targetItemsQuery, [targetOrderId]);
    const targetItems = targetResult2.rows;

    // Get source season items from same brand and location
    const sourceItemsQuery = `
      SELECT
        oi.id as order_item_id,
        p.id as product_id,
        p.base_name,
        p.size,
        p.color,
        p.upc,
        p.name as product_name,
        oi.quantity,
        oi.adjusted_quantity
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.season_id = $1
        AND o.brand_id = $2
        AND o.location_id = $3
      ORDER BY p.base_name, p.size, p.color
    `;
    const sourceResult = await pool.query(sourceItemsQuery, [
      sourceSeasonId,
      targetOrder.brand_id,
      targetOrder.location_id
    ]);
    const sourceItems = sourceResult.rows;

    // Get source season name
    const seasonQuery = 'SELECT name FROM seasons WHERE id = $1';
    const seasonResult = await pool.query(seasonQuery, [sourceSeasonId]);
    const sourceSeasonName = seasonResult.rows[0]?.name || `Season ${sourceSeasonId}`;

    // Match items and prepare changes
    const matched = [];
    const unmatched = [];
    const sourceUsed = new Set();

    for (const targetItem of targetItems) {
      const key = `${targetItem.base_name}|${targetItem.size}|${targetItem.color}`;

      // Try to find matching source item
      let sourceItem = sourceItems.find(
        s => s.base_name === targetItem.base_name &&
             s.size === targetItem.size &&
             s.color === targetItem.color
      );

      // Fall back to UPC match if available
      if (!sourceItem && targetItem.upc) {
        sourceItem = sourceItems.find(s => s.upc === targetItem.upc);
      }

      if (sourceItem) {
        const sourceQty = sourceItem.adjusted_quantity !== null ? sourceItem.adjusted_quantity : sourceItem.quantity;
        const suggestedQty = Math.round(sourceQty * scalingFactor);

        matched.push({
          target_item_id: targetItem.order_item_id,
          target_product_id: targetItem.product_id,
          source_item_id: sourceItem.order_item_id,
          source_product_id: sourceItem.product_id,
          product_name: sourceItem.product_name,
          base_name: targetItem.base_name,
          size: targetItem.size,
          color: targetItem.color,
          source_qty: sourceQty,
          suggested_qty: suggestedQty,
          scaling_factor: scalingFactor
        });

        sourceUsed.add(sourceItem.order_item_id);
      } else {
        unmatched.push({
          target_item_id: targetItem.order_item_id,
          target_product_id: targetItem.product_id,
          base_name: targetItem.base_name,
          size: targetItem.size,
          color: targetItem.color,
          reason: 'No matching product in source season'
        });
      }
    }

    return {
      source_season_id: sourceSeasonId,
      source_season_name: sourceSeasonName,
      target_order_id: targetOrderId,
      scaling_factor: scalingFactor,
      matched_items: matched.length,
      unmatched_items: unmatched.length,
      changes: matched,
      unmatched: unmatched,
      summary: {
        total_matched: matched.length,
        total_unmatched: unmatched.length,
        total_target_items: targetItems.length,
        match_rate: targetItems.length > 0 ? ((matched.length / targetItems.length) * 100).toFixed(1) + '%' : '0%'
      }
    };
  } catch (error) {
    throw new Error(`Failed to preview copy season: ${error.message}`);
  }
}

/**
 * Apply copy season operation
 *
 * @param {number} targetOrderId - Target order ID
 * @param {Array} changes - Matched items to apply: [{ target_item_id, suggested_qty }]
 * @param {number} userId - User applying the operation
 * @returns {Object} Result with batch_operation_id and summary
 */
async function applyCopySeason(targetOrderId, changes, userId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const batchId = generateBatchId();

    // Get current order items for context
    const itemQuery = `
      SELECT
        oi.id as order_item_id,
        oi.order_id,
        oi.quantity,
        oi.adjusted_quantity,
        oi.product_id
      FROM order_items oi
      WHERE oi.order_id = $1
    `;
    const itemResult = await client.query(itemQuery, [targetOrderId]);
    const itemMap = {};
    itemResult.rows.forEach(row => {
      itemMap[row.order_item_id] = row;
    });

    // Update each order item
    let updatedCount = 0;
    const historyInserts = [];

    for (const change of changes) {
      const { target_item_id, suggested_qty } = change;
      const item = itemMap[target_item_id];

      if (!item) {
        throw new Error(`Target item ${target_item_id} not found`);
      }

      const currentQty = item.adjusted_quantity !== null ? item.adjusted_quantity : item.quantity;

      // Update the order item
      await client.query(
        'UPDATE order_items SET adjusted_quantity = $1 WHERE id = $2',
        [suggested_qty, target_item_id]
      );

      // Prepare history record
      historyInserts.push({
        order_id: item.order_id,
        order_item_id: target_item_id,
        product_id: item.product_id,
        batch_operation_id: batchId,
        original_quantity: currentQty,
        new_quantity: suggested_qty,
        adjustment_type: 'copy_season',
        applied_by: userId,
        applied_at: new Date()
      });

      updatedCount++;
    }

    // Insert adjustment history records
    for (const record of historyInserts) {
      await client.query(
        `INSERT INTO adjustment_history
         (order_id, order_item_id, product_id, applied_rule_id, batch_operation_id,
          original_quantity, new_quantity, adjustment_type, reasoning, applied_by, applied_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          record.order_id,
          record.order_item_id,
          record.product_id,
          null,
          record.batch_operation_id,
          record.original_quantity,
          record.new_quantity,
          record.adjustment_type,
          'Copied from source season',
          record.applied_by,
          record.applied_at
        ]
      );
    }

    await client.query('COMMIT');

    // Calculate summary
    let totalOriginal = 0;
    let totalNew = 0;
    for (const record of historyInserts) {
      totalOriginal += record.original_quantity;
      totalNew += record.new_quantity;
    }

    return {
      batch_operation_id: batchId,
      items_updated: updatedCount,
      summary: {
        total_original_qty: totalOriginal,
        total_new_qty: totalNew,
        total_qty_change: totalNew - totalOriginal
      }
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`Failed to apply copy season: ${error.message}`);
  } finally {
    client.release();
  }
}

/**
 * Apply a predefined adjustment rule to an order
 *
 * @param {number} orderId - Order ID
 * @param {number} ruleId - Adjustment rule ID
 * @param {number} userId - User applying the rule
 * @returns {Object} Result from applyBatchOperation
 */
async function applyRule(orderId, ruleId, userId) {
  try {
    // Fetch the rule
    const ruleQuery = `
      SELECT id, name, rule_type, rule_config
      FROM adjustment_rules
      WHERE id = $1 AND enabled = true
    `;
    const ruleResult = await pool.query(ruleQuery, [ruleId]);

    if (ruleResult.rows.length === 0) {
      throw new Error(`Adjustment rule ${ruleId} not found or is disabled`);
    }

    const rule = ruleResult.rows[0];

    // Build operation from rule
    const operation = {
      type: rule.rule_type,
      filters: {},
      config: rule.rule_config || {}
    };

    // Preview the operation
    const preview = await previewBatchOperation(orderId, operation);

    if (preview.changes.length === 0) {
      return {
        batch_operation_id: null,
        items_updated: 0,
        summary: {
          total_original_qty: 0,
          total_new_qty: 0,
          total_qty_change: 0
        },
        note: 'No items matched the rule criteria'
      };
    }

    // Convert preview changes to apply format
    const changes = preview.changes.map(change => ({
      order_item_id: change.order_item_id,
      new_qty: change.new_qty
    }));

    // Apply the operation
    const result = await applyBatchOperation(orderId, changes, userId, operation);

    // Link to the rule by updating adjustment_history
    await pool.query(
      `UPDATE adjustment_history
       SET applied_rule_id = $1
       WHERE batch_operation_id = $2`,
      [ruleId, result.batch_operation_id]
    );

    return result;
  } catch (error) {
    throw new Error(`Failed to apply rule: ${error.message}`);
  }
}

/**
 * Undo a batch operation by restoring original quantities
 *
 * @param {string} batchOperationId - Batch operation ID to undo
 * @param {number} userId - User undoing the operation
 * @returns {Object} Result with items_restored
 */
async function undoBatchOperation(batchOperationId, userId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get all adjustment history records for this batch
    const historyQuery = `
      SELECT
        id,
        order_item_id,
        original_quantity,
        new_quantity,
        order_id
      FROM adjustment_history
      WHERE batch_operation_id = $1
      ORDER BY id
    `;
    const historyResult = await client.query(historyQuery, [batchOperationId]);

    if (historyResult.rows.length === 0) {
      throw new Error(`Batch operation ${batchOperationId} not found`);
    }

    let restoredCount = 0;

    // Restore each order item to original quantity
    for (const record of historyResult.rows) {
      // Restore the adjusted_quantity back to original
      await client.query(
        `UPDATE order_items
         SET adjusted_quantity = $1
         WHERE id = $2`,
        [record.original_quantity, record.order_item_id]
      );

      // Mark the history record as undone (optional: could add an undo_at column)
      // For now, we'll delete the history record
      await client.query(
        `DELETE FROM adjustment_history
         WHERE batch_operation_id = $1`,
        [batchOperationId]
      );

      restoredCount++;
    }

    await client.query('COMMIT');

    return {
      batch_operation_id: batchOperationId,
      items_restored: restoredCount,
      note: `Restored ${restoredCount} items to their original quantities`
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`Failed to undo batch operation: ${error.message}`);
  } finally {
    client.release();
  }
}

/**
 * Get adjustment history for an order, grouped by batch operation
 *
 * @param {number} orderId - Order ID
 * @returns {Array} History records grouped by batch_operation_id
 */
async function getAdjustmentHistory(orderId) {
  try {
    const query = `
      SELECT
        ah.id,
        ah.batch_operation_id,
        ah.order_item_id,
        ah.product_id,
        p.name as product_name,
        p.base_name,
        ah.original_quantity,
        ah.new_quantity,
        ah.adjustment_type,
        ah.reasoning,
        ah.applied_by,
        u.email as applied_by_email,
        ah.applied_at,
        ar.name as rule_name
      FROM adjustment_history ah
      JOIN products p ON ah.product_id = p.id
      LEFT JOIN users u ON ah.applied_by = u.id
      LEFT JOIN adjustment_rules ar ON ah.applied_rule_id = ar.id
      WHERE ah.order_id = $1
      ORDER BY ah.applied_at DESC, ah.batch_operation_id DESC, ah.id
    `;

    const result = await pool.query(query, [orderId]);
    const grouped = {};

    // Group by batch_operation_id
    for (const record of result.rows) {
      const batchId = record.batch_operation_id;
      if (!grouped[batchId]) {
        grouped[batchId] = {
          batch_operation_id: batchId,
          adjustment_type: record.adjustment_type,
          rule_name: record.rule_name,
          applied_by: record.applied_by_email,
          applied_at: record.applied_at,
          items: []
        };
      }

      grouped[batchId].items.push({
        order_item_id: record.order_item_id,
        product_id: record.product_id,
        product_name: record.product_name,
        base_name: record.base_name,
        original_quantity: record.original_quantity,
        new_quantity: record.new_quantity,
        quantity_change: record.new_quantity - record.original_quantity
      });
    }

    return Object.values(grouped);
  } catch (error) {
    throw new Error(`Failed to get adjustment history: ${error.message}`);
  }
}

module.exports = {
  previewBatchOperation,
  applyBatchOperation,
  previewCopySeason,
  applyCopySeason,
  applyRule,
  undoBatchOperation,
  getAdjustmentHistory
};
