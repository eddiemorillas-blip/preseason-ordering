const { pool } = require('../db.js');

/**
 * Format a number as currency
 */
function formatCurrency(num) {
  if (num === null || num === undefined) return 'N/A';
  return '$' + parseFloat(num).toFixed(2);
}

/**
 * Format a number with decimals
 */
function formatNumber(num, decimals = 1) {
  if (num === null || num === undefined) return 'N/A';
  return parseFloat(num).toFixed(decimals);
}

/**
 * adjust_item: Adjust a single order item's quantity
 */
async function adjustItem(args) {
  try {
    const { orderItemId, newQuantity, reasoning } = args;

    if (!orderItemId || newQuantity === null || newQuantity === undefined) {
      return {
        content: [{
          type: 'text',
          text: 'Both orderItemId and newQuantity parameters are required'
        }]
      };
    }

    if (newQuantity < 0) {
      return {
        content: [{
          type: 'text',
          text: 'newQuantity cannot be negative'
        }]
      };
    }

    // Get current item details
    const getQuery = `
      SELECT
        oi.id,
        oi.order_id,
        oi.product_id,
        oi.quantity AS original_qty,
        COALESCE(oi.adjusted_quantity, oi.quantity) AS current_adjusted_qty,
        oi.unit_cost,
        oi.line_total,
        p.name AS product_name,
        p.sku,
        o.order_number
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      WHERE oi.id = $1
    `;

    const getResult = await pool.query(getQuery, [orderItemId]);

    if (getResult.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `Order item not found (ID: ${orderItemId})`
        }]
      };
    }

    const item = getResult.rows[0];
    const oldAdjustedQty = item.current_adjusted_qty;
    const newLineTotal = newQuantity * item.unit_cost;
    const qtyDiff = newQuantity - oldAdjustedQty;
    const costDiff = newLineTotal - item.line_total;

    // Update the item in a transaction
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Update order_items
      await client.query(
        'UPDATE order_items SET adjusted_quantity = $1, line_total = $2, updated_at = NOW() WHERE id = $3',
        [newQuantity, newLineTotal, orderItemId]
      );

      // Log to adjustment history (if the table exists, otherwise we'll just update)
      const historyQuery = `
        INSERT INTO adjustment_history (
          order_id, order_item_id, product_id, original_quantity, adjusted_quantity,
          previous_adjusted_quantity, reasoning, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT DO NOTHING
      `;

      try {
        await client.query(historyQuery, [
          item.order_id,
          orderItemId,
          item.product_id,
          item.original_qty,
          newQuantity,
          oldAdjustedQty,
          reasoning || ''
        ]);
      } catch (e) {
        // adjustment_history table may not exist, continue anyway
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Format result
    let result = `ITEM ADJUSTED\n${'-'.repeat(80)}\n`;
    result += `Order: ${item.order_number} | Item: ${item.product_name}\n`;
    result += `SKU: ${item.sku || 'N/A'}\n\n`;
    result += `Quantity Change:\n`;
    result += `  Original:        ${item.original_qty}\n`;
    result += `  Previous Adjust: ${oldAdjustedQty}\n`;
    result += `  New Adjust:      ${newQuantity} (${qtyDiff > 0 ? '+' : ''}${qtyDiff})\n\n`;
    result += `Cost Impact:\n`;
    result += `  Old Line Total:  ${formatCurrency(item.line_total)}\n`;
    result += `  New Line Total:  ${formatCurrency(newLineTotal)}\n`;
    result += `  Difference:      ${formatCurrency(costDiff)}\n`;

    if (reasoning) {
      result += `\nReasoning: ${reasoning}\n`;
    }

    return {
      content: [{ type: 'text', text: result }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error adjusting item: ${error.message}` }]
    };
  }
}

/**
 * batch_adjust: Adjust multiple items at once
 */
async function batchAdjust(args) {
  try {
    const { orderId, adjustments, reasoning } = args;

    if (!orderId || !Array.isArray(adjustments) || adjustments.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'orderId and adjustments (array of {itemId, newQuantity}) are required'
        }]
      };
    }

    const client = await pool.connect();
    let itemsUpdated = 0;
    let totalCostImpact = 0;
    const details = [];

    try {
      await client.query('BEGIN');

      for (const adj of adjustments) {
        const { itemId, newQuantity } = adj;

        if (!itemId || newQuantity === null || newQuantity === undefined) {
          continue;
        }

        // Get current item
        const getResult = await client.query(
          'SELECT quantity, adjusted_quantity, unit_cost, line_total FROM order_items WHERE id = $1',
          [itemId]
        );

        if (getResult.rows.length === 0) {
          continue;
        }

        const item = getResult.rows[0];
        const newLineTotal = newQuantity * item.unit_cost;
        const costDiff = newLineTotal - item.line_total;

        // Update item
        await client.query(
          'UPDATE order_items SET adjusted_quantity = $1, line_total = $2, updated_at = NOW() WHERE id = $3',
          [newQuantity, newLineTotal, itemId]
        );

        itemsUpdated++;
        totalCostImpact += costDiff;

        details.push({
          itemId,
          originalQty: item.quantity,
          newQty: newQuantity,
          qtyDiff: newQuantity - (item.adjusted_quantity || item.quantity),
          costDiff
        });
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Format result
    let result = `BATCH ADJUSTMENT COMPLETE\n${'-'.repeat(80)}\n`;
    result += `Order ID: ${orderId}\n`;
    result += `Items Updated: ${itemsUpdated}\n\n`;

    result += `CHANGES:\n${'-'.repeat(40)}\n`;
    details.forEach((d, i) => {
      result += `${i + 1}. Item ${d.itemId}: ${d.originalQty} → ${d.newQty} ` +
                `(${d.qtyDiff > 0 ? '+' : ''}${d.qtyDiff}) | Cost: ${formatCurrency(d.costDiff)}\n`;
    });

    result += `\n${'-'.repeat(80)}\n`;
    result += `TOTAL COST IMPACT: ${formatCurrency(totalCostImpact)}\n`;

    if (reasoning) {
      result += `\nReasoning: ${reasoning}\n`;
    }

    return {
      content: [{ type: 'text', text: result }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error in batch adjustment: ${error.message}` }]
    };
  }
}

/**
 * preview_percentage_adjustment: Preview a percentage change without applying it
 */
async function previewPercentageAdjustment(args) {
  try {
    const { orderId, percentage, filters } = args;

    if (!orderId || percentage === null || percentage === undefined) {
      return {
        content: [{
          type: 'text',
          text: 'orderId and percentage parameters are required'
        }]
      };
    }

    let query = `
      SELECT
        oi.id,
        p.name AS product_name,
        p.category,
        p.gender,
        p.size,
        oi.quantity AS original_qty,
        COALESCE(oi.adjusted_quantity, oi.quantity) AS current_qty,
        oi.unit_cost,
        oi.line_total
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `;

    const params = [orderId];
    let paramCount = 2;

    if (filters) {
      if (filters.category) {
        query += ` AND p.category = $${paramCount}`;
        params.push(filters.category);
        paramCount++;
      }
      if (filters.gender) {
        query += ` AND p.gender = $${paramCount}`;
        params.push(filters.gender);
        paramCount++;
      }
      if (filters.size) {
        query += ` AND p.size = $${paramCount}`;
        params.push(filters.size);
        paramCount++;
      }
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No items found matching the specified filters'
        }]
      };
    }

    // Calculate preview
    let preview = `PERCENTAGE ADJUSTMENT PREVIEW\n${'-'.repeat(80)}\n`;
    preview += `Order ID: ${orderId} | Percentage: ${percentage > 0 ? '+' : ''}${formatNumber(percentage, 1)}%\n\n`;

    let totalCurrentQty = 0;
    let totalNewQty = 0;
    let totalCurrentCost = 0;
    let totalNewCost = 0;

    const changes = [];

    result.rows.forEach(item => {
      const multiplier = 1 + (percentage / 100);
      const newQty = Math.round(item.current_qty * multiplier);
      const newLineTotal = newQty * item.unit_cost;
      const costDiff = newLineTotal - item.line_total;

      totalCurrentQty += item.current_qty;
      totalNewQty += newQty;
      totalCurrentCost += item.line_total;
      totalNewCost += newLineTotal;

      changes.push({
        itemId: item.id,
        productName: item.product_name,
        category: item.category,
        size: item.size,
        currentQty: item.current_qty,
        newQty,
        qtyDiff: newQty - item.current_qty,
        currentCost: item.line_total,
        newCost: newLineTotal,
        costDiff
      });
    });

    preview += `AFFECTED ITEMS (${changes.length}):\n${'-'.repeat(40)}\n`;
    preview += 'Product | Size | Current → New | Cost Impact\n';

    changes.forEach(c => {
      preview += `${String(c.productName.substring(0, 25)).padEnd(25)} | ${String((c.size || '-').substring(0, 6)).padEnd(6)} | ` +
                 `${c.currentQty} → ${c.newQty} (${c.qtyDiff > 0 ? '+' : ''}${c.qtyDiff}) | ` +
                 `${formatCurrency(c.costDiff)}\n`;
    });

    preview += `\n${'-'.repeat(80)}\n`;
    preview += `SUMMARY:\n`;
    preview += `  Total Quantity: ${totalCurrentQty} → ${totalNewQty} (${totalNewQty - totalCurrentQty > 0 ? '+' : ''}${totalNewQty - totalCurrentQty} units)\n`;
    preview += `  Total Cost:     ${formatCurrency(totalCurrentCost)} → ${formatCurrency(totalNewCost)} ` +
               `(${formatCurrency(totalNewCost - totalCurrentCost)})\n`;

    return {
      content: [{ type: 'text', text: preview }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error previewing adjustment: ${error.message}` }]
    };
  }
}

/**
 * apply_percentage_adjustment: Apply a percentage change
 */
async function applyPercentageAdjustment(args) {
  try {
    const { orderId, percentage, filters, reasoning } = args;

    if (!orderId || percentage === null || percentage === undefined) {
      return {
        content: [{
          type: 'text',
          text: 'orderId and percentage parameters are required'
        }]
      };
    }

    // Get items that match criteria
    let query = `
      SELECT
        oi.id,
        oi.quantity AS original_qty,
        COALESCE(oi.adjusted_quantity, oi.quantity) AS current_qty,
        oi.unit_cost,
        oi.line_total
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `;

    const params = [orderId];
    let paramCount = 2;

    if (filters) {
      if (filters.category) {
        query += ` AND p.category = $${paramCount}`;
        params.push(filters.category);
        paramCount++;
      }
      if (filters.gender) {
        query += ` AND p.gender = $${paramCount}`;
        params.push(filters.gender);
        paramCount++;
      }
      if (filters.size) {
        query += ` AND p.size = $${paramCount}`;
        params.push(filters.size);
        paramCount++;
      }
    }

    const selectResult = await pool.query(query, params);

    if (selectResult.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No items found matching the specified filters'
        }]
      };
    }

    // Apply adjustments in transaction
    const client = await pool.connect();
    let itemsUpdated = 0;
    let totalCostImpact = 0;

    try {
      await client.query('BEGIN');

      for (const item of selectResult.rows) {
        const multiplier = 1 + (percentage / 100);
        const newQty = Math.round(item.current_qty * multiplier);
        const newLineTotal = newQty * item.unit_cost;

        await client.query(
          'UPDATE order_items SET adjusted_quantity = $1, line_total = $2, updated_at = NOW() WHERE id = $3',
          [newQty, newLineTotal, item.id]
        );

        itemsUpdated++;
        totalCostImpact += (newLineTotal - item.line_total);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    let result = `PERCENTAGE ADJUSTMENT APPLIED\n${'-'.repeat(80)}\n`;
    result += `Order ID: ${orderId}\n`;
    result += `Percentage: ${percentage > 0 ? '+' : ''}${formatNumber(percentage, 1)}%\n`;
    result += `Items Updated: ${itemsUpdated}\n\n`;
    result += `Budget Impact: ${formatCurrency(totalCostImpact)}\n`;

    if (reasoning) {
      result += `\nReasoning: ${reasoning}\n`;
    }

    return {
      content: [{ type: 'text', text: result }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error applying percentage adjustment: ${error.message}` }]
    };
  }
}

/**
 * apply_size_curve: Apply size-based adjustments
 */
async function applySizeCurve(args) {
  try {
    const { orderId, sizeAdjustments, filters, reasoning } = args;

    if (!orderId || !sizeAdjustments || typeof sizeAdjustments !== 'object') {
      return {
        content: [{
          type: 'text',
          text: 'orderId and sizeAdjustments (object like {"xs": -30, "s": -10}) are required'
        }]
      };
    }

    // Get items that match criteria
    let query = `
      SELECT
        oi.id,
        p.size,
        oi.quantity AS original_qty,
        COALESCE(oi.adjusted_quantity, oi.quantity) AS current_qty,
        oi.unit_cost,
        oi.line_total
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `;

    const params = [orderId];
    let paramCount = 2;

    if (filters && filters.category) {
      query += ` AND p.category = $${paramCount}`;
      params.push(filters.category);
      paramCount++;
    }

    const selectResult = await pool.query(query, params);

    if (selectResult.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No items found matching the specified criteria'
        }]
      };
    }

    // Apply size curve adjustments
    const client = await pool.connect();
    let itemsUpdated = 0;
    const sizeChanges = {};

    try {
      await client.query('BEGIN');

      for (const item of selectResult.rows) {
        const sizeKey = (item.size || '').toLowerCase();
        const adjustment = sizeAdjustments[sizeKey];

        if (adjustment === null || adjustment === undefined) {
          continue; // Skip sizes not in the curve
        }

        const multiplier = 1 + (adjustment / 100);
        const newQty = Math.round(item.current_qty * multiplier);
        const newLineTotal = newQty * item.unit_cost;

        await client.query(
          'UPDATE order_items SET adjusted_quantity = $1, line_total = $2, updated_at = NOW() WHERE id = $3',
          [newQty, newLineTotal, item.id]
        );

        itemsUpdated++;

        if (!sizeChanges[sizeKey]) {
          sizeChanges[sizeKey] = { items: 0, qtyDiff: 0, costDiff: 0 };
        }
        sizeChanges[sizeKey].items++;
        sizeChanges[sizeKey].qtyDiff += (newQty - item.current_qty);
        sizeChanges[sizeKey].costDiff += (newLineTotal - item.line_total);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    let result = `SIZE CURVE ADJUSTMENT APPLIED\n${'-'.repeat(80)}\n`;
    result += `Order ID: ${orderId}\n`;
    result += `Items Updated: ${itemsUpdated}\n\n`;

    result += `CHANGES BY SIZE:\n${'-'.repeat(40)}\n`;
    result += 'Size | Adjustment | Items | Qty Change | Cost Impact\n';

    let totalCostDiff = 0;

    Object.keys(sizeAdjustments).forEach(size => {
      const adj = sizeAdjustments[size];
      const changes = sizeChanges[size];

      if (changes) {
        result += `${String(size).padEnd(6)} | ${adj > 0 ? '+' : ''}${formatNumber(adj, 1)}% | ${String(changes.items).padEnd(5)} | ` +
                 `${changes.qtyDiff > 0 ? '+' : ''}${String(changes.qtyDiff).padEnd(9)} | ${formatCurrency(changes.costDiff)}\n`;
        totalCostDiff += changes.costDiff;
      }
    });

    result += `\n${'-'.repeat(80)}\n`;
    result += `TOTAL COST IMPACT: ${formatCurrency(totalCostDiff)}\n`;

    if (reasoning) {
      result += `\nReasoning: ${reasoning}\n`;
    }

    return {
      content: [{ type: 'text', text: result }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error applying size curve: ${error.message}` }]
    };
  }
}

/**
 * modify_decision: Modify revision decisions by UPC — works for paste-mode items without orderItemId.
 * Returns structured JSON that the frontend applies to the local decisions array.
 */
async function modifyDecision(args) {
  try {
    const { items, reasoning } = args;

    if (!Array.isArray(items) || items.length === 0) {
      return { content: [{ type: 'text', text: 'items array is required with at least one entry' }] };
    }

    const changes = [];
    for (const item of items) {
      if (!item.upc && !item.productName) {
        continue;
      }
      changes.push({
        upc: item.upc || null,
        productName: item.productName || null,
        size: item.size || null,
        location: item.location || null,
        decision: item.decision, // 'ship', 'cancel', or 'keep_open_bo'
        adjustedQty: item.adjustedQty != null ? item.adjustedQty : (item.decision === 'cancel' ? 0 : undefined),
        reason: reasoning || 'user_override',
      });
    }

    if (changes.length === 0) {
      return { content: [{ type: 'text', text: 'No valid items to modify' }] };
    }

    // Return structured result — the frontend will interpret __decisionChanges__
    let summary = `DECISION CHANGES (${changes.length} items):\n`;
    for (const c of changes) {
      summary += `  ${c.upc || c.productName}${c.size ? ' ' + c.size : ''}${c.location ? ' @ ' + c.location : ''} → ${c.decision.toUpperCase()}${c.adjustedQty != null ? ' (qty: ' + c.adjustedQty + ')' : ''}\n`;
    }
    if (reasoning) summary += `Reason: ${reasoning}\n`;
    summary += `\n__decisionChanges__${JSON.stringify(changes)}__end__`;

    return { content: [{ type: 'text', text: summary }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
  }
}

/**
 * get_target_qty: Query target quantities for products at locations
 */
async function getTargetQty(args) {
  try {
    const { upc, productId, locationId } = args;

    if (!upc && !productId) {
      return { content: [{ type: 'text', text: 'Either upc or productId is required' }] };
    }

    let query = `
      SELECT plt.product_id, plt.location_id, plt.target_qty, plt.updated_at, plt.updated_by,
             p.upc, p.name AS product_name, p.size, p.color,
             l.name AS location_name
      FROM product_location_targets plt
      JOIN products p ON plt.product_id = p.id
      JOIN locations l ON plt.location_id = l.id
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (upc) {
      query += ` AND p.upc = $${paramIdx++}`;
      params.push(upc);
    }
    if (productId) {
      query += ` AND plt.product_id = $${paramIdx++}`;
      params.push(productId);
    }
    if (locationId) {
      query += ` AND plt.location_id = $${paramIdx++}`;
      params.push(locationId);
    }

    query += ` ORDER BY p.name, p.size, l.id`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      // Try to find the product to give better feedback
      let productInfo = '';
      if (upc) {
        const pRes = await pool.query('SELECT id, name, size FROM products WHERE upc = $1', [upc]);
        if (pRes.rows.length > 0) {
          productInfo = ` Product "${pRes.rows[0].name}" (size ${pRes.rows[0].size}) found but has no targets set.`;
        } else {
          productInfo = ` No product found with UPC ${upc}.`;
        }
      }
      return { content: [{ type: 'text', text: `No targets found.${productInfo} Default target is 0 (do not stock).` }] };
    }

    let output = `TARGET QUANTITIES (${result.rows.length} rows)\n${'─'.repeat(80)}\n`;
    output += `${'Product'.padEnd(30)} ${'Size'.padEnd(6)} ${'Location'.padEnd(14)} ${'Target'.padEnd(7)} Updated\n`;
    output += `${'─'.repeat(80)}\n`;

    for (const r of result.rows) {
      output += `${(r.product_name || '').substring(0, 29).padEnd(30)} ` +
        `${(r.size || '-').padEnd(6)} ` +
        `${(r.location_name || '-').padEnd(14)} ` +
        `${String(r.target_qty).padEnd(7)} ` +
        `${r.updated_at ? r.updated_at.toISOString().split('T')[0] : '-'}\n`;
    }

    return { content: [{ type: 'text', text: output }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
  }
}

/**
 * set_target_qty: Upsert target quantity for a product at a location
 */
async function setTargetQty(args) {
  try {
    const { upc, productId, locationId, targetQty, targets } = args;

    // Bulk mode
    if (targets && Array.isArray(targets) && targets.length > 0) {
      const client = await pool.connect();
      let updated = 0;
      const details = [];
      try {
        await client.query('BEGIN');
        for (const t of targets) {
          let pid = t.productId;
          if (!pid && t.upc) {
            const pRes = await client.query('SELECT id, name, size FROM products WHERE upc = $1', [t.upc]);
            if (pRes.rows.length > 0) pid = pRes.rows[0].id;
            else { details.push(`UPC ${t.upc}: not found`); continue; }
          }
          if (!pid || !t.locationId || t.targetQty == null) continue;
          await client.query(`
            INSERT INTO product_location_targets (product_id, location_id, target_qty, updated_at, updated_by)
            VALUES ($1, $2, $3, NOW(), 'chatbot')
            ON CONFLICT (product_id, location_id) DO UPDATE SET target_qty = EXCLUDED.target_qty, updated_at = NOW(), updated_by = 'chatbot'
          `, [pid, t.locationId, t.targetQty]);
          details.push(`Product ${pid} @ Location ${t.locationId} → target ${t.targetQty}`);
          updated++;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return { content: [{ type: 'text', text: `SET ${updated} TARGET(S)\n${details.join('\n')}` }] };
    }

    // Single mode
    if (targetQty == null || !locationId) {
      return { content: [{ type: 'text', text: 'locationId and targetQty are required' }] };
    }

    let pid = productId;
    let productName = '';
    if (!pid && upc) {
      const pRes = await pool.query('SELECT id, name, size FROM products WHERE upc = $1', [upc]);
      if (pRes.rows.length === 0) return { content: [{ type: 'text', text: `No product found with UPC ${upc}` }] };
      pid = pRes.rows[0].id;
      productName = `${pRes.rows[0].name} (${pRes.rows[0].size})`;
    }
    if (!pid) return { content: [{ type: 'text', text: 'Either upc or productId is required' }] };

    if (!productName) {
      const pRes = await pool.query('SELECT name, size FROM products WHERE id = $1', [pid]);
      if (pRes.rows.length > 0) productName = `${pRes.rows[0].name} (${pRes.rows[0].size})`;
    }

    // Get location name
    const locRes = await pool.query('SELECT name FROM locations WHERE id = $1', [locationId]);
    const locationName = locRes.rows.length > 0 ? locRes.rows[0].name : `Location ${locationId}`;

    // Get old value
    const oldRes = await pool.query(
      'SELECT target_qty FROM product_location_targets WHERE product_id = $1 AND location_id = $2',
      [pid, locationId]
    );
    const oldTarget = oldRes.rows.length > 0 ? oldRes.rows[0].target_qty : 0;

    await pool.query(`
      INSERT INTO product_location_targets (product_id, location_id, target_qty, updated_at, updated_by)
      VALUES ($1, $2, $3, NOW(), 'chatbot')
      ON CONFLICT (product_id, location_id) DO UPDATE SET target_qty = EXCLUDED.target_qty, updated_at = NOW(), updated_by = 'chatbot'
    `, [pid, locationId, targetQty]);

    return { content: [{ type: 'text', text: `TARGET SET: ${productName} at ${locationName}: ${oldTarget} → ${targetQty}` }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
  }
}

module.exports = [
  {
    name: 'get_target_qty',
    description: 'Get target quantities for a product at each location. Target qty determines how many units we want on hand — the revision engine uses this to decide ship/cancel.',
    inputSchema: {
      type: 'object',
      properties: {
        upc: { type: 'string', description: 'Product UPC to look up' },
        productId: { type: 'integer', description: 'Product ID (alternative to UPC)' },
        locationId: { type: 'integer', description: 'Optional: filter to a specific location (1=SLC, 2=South Main, 3=Ogden)' }
      }
    },
    handler: getTargetQty
  },
  {
    name: 'set_target_qty',
    description: 'Set target quantity for a product at a location. Target determines how many units we want on hand — the revision engine ships/cancels to reach this target. Writes directly to the database.',
    inputSchema: {
      type: 'object',
      properties: {
        upc: { type: 'string', description: 'Product UPC' },
        productId: { type: 'integer', description: 'Product ID (alternative to UPC)' },
        locationId: { type: 'integer', description: 'Location ID (1=SLC, 2=South Main, 3=Ogden)' },
        targetQty: { type: 'integer', description: 'Target quantity (>= 0)' },
        targets: {
          type: 'array',
          description: 'Bulk mode: array of {upc?, productId?, locationId, targetQty}',
          items: {
            type: 'object',
            properties: {
              upc: { type: 'string' },
              productId: { type: 'integer' },
              locationId: { type: 'integer' },
              targetQty: { type: 'integer' }
            }
          }
        }
      }
    },
    handler: setTargetQty
  },
  {
    name: 'modify_decision',
    description: 'Modify revision decisions by UPC, product name, size, or location. Works for ALL items including paste-mode items without an orderItemId. Use this instead of adjust_item when items have no orderItemId or when working with pasted brand orders. Returns changes that the frontend applies to the decisions list.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Items to modify. Match by UPC and/or productName + size + location.',
          items: {
            type: 'object',
            properties: {
              upc: { type: 'string', description: 'UPC to match' },
              productName: { type: 'string', description: 'Product name substring to match (case-insensitive)' },
              size: { type: 'string', description: 'Size to match (optional, narrows results)' },
              location: { type: 'string', description: 'Location name to match (optional)' },
              decision: { type: 'string', enum: ['ship', 'cancel', 'keep_open_bo'], description: 'New decision' },
              adjustedQty: { type: 'integer', description: 'New quantity (defaults to 0 for cancel, keeps original for ship)' }
            },
            required: ['decision']
          }
        },
        reasoning: { type: 'string', description: 'Reason for the changes' }
      },
      required: ['items']
    },
    handler: modifyDecision
  },
  {
    name: 'adjust_item',
    description: 'Adjust a single order item quantity by orderItemId. Only works for items that exist in the database (have a real orderItemId). For paste-mode items without orderItemId, use modify_decision instead.',
    inputSchema: {
      type: 'object',
      properties: {
        orderItemId: { type: 'integer', description: 'Order item ID' },
        newQuantity: { type: 'integer', description: 'New quantity' },
        reasoning: { type: 'string', description: 'Optional reason for adjustment' }
      },
      required: ['orderItemId', 'newQuantity']
    },
    handler: adjustItem
  },
  {
    name: 'batch_adjust',
    description: 'Adjust multiple items in an order at once',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'integer', description: 'Order ID' },
        adjustments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              itemId: { type: 'integer' },
              newQuantity: { type: 'integer' }
            }
          },
          description: 'Array of {itemId, newQuantity} adjustments'
        },
        reasoning: { type: 'string', description: 'Optional reason for adjustments' }
      },
      required: ['orderId', 'adjustments']
    },
    handler: batchAdjust
  },
  {
    name: 'preview_percentage_adjustment',
    description: 'Preview what a percentage adjustment would do without applying it',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'integer', description: 'Order ID' },
        percentage: { type: 'number', description: 'Percentage to adjust (-100 to +100)' },
        filters: {
          type: 'object',
          description: 'Optional filters (category, gender, size)',
          properties: {
            category: { type: 'string' },
            gender: { type: 'string' },
            size: { type: 'string' }
          }
        }
      },
      required: ['orderId', 'percentage']
    },
    handler: previewPercentageAdjustment
  },
  {
    name: 'apply_percentage_adjustment',
    description: 'Apply a percentage adjustment to order items',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'integer', description: 'Order ID' },
        percentage: { type: 'number', description: 'Percentage to adjust (-100 to +100)' },
        filters: {
          type: 'object',
          description: 'Optional filters (category, gender, size)',
          properties: {
            category: { type: 'string' },
            gender: { type: 'string' },
            size: { type: 'string' }
          }
        },
        reasoning: { type: 'string', description: 'Reason for adjustment' }
      },
      required: ['orderId', 'percentage']
    },
    handler: applyPercentageAdjustment
  },
  {
    name: 'apply_size_curve',
    description: 'Apply size-based percentage adjustments (e.g., scale down XS, up size L)',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'integer', description: 'Order ID' },
        sizeAdjustments: {
          type: 'object',
          description: 'Size adjustments like {"xs": -30, "s": -10, "m": 0, "l": 10, "xl": 20}',
          additionalProperties: { type: 'number' }
        },
        filters: {
          type: 'object',
          description: 'Optional filters (category)',
          properties: {
            category: { type: 'string' }
          }
        },
        reasoning: { type: 'string', description: 'Reason for adjustment' }
      },
      required: ['orderId', 'sizeAdjustments']
    },
    handler: applySizeCurve
  }
];
