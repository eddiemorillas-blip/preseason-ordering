/**
 * Revision Engine — Target-Quantity Based Decision Logic
 *
 * Pure function. No DB calls. Callers load data and pass enrichment maps in.
 */

/**
 * Compute ship/cancel decisions for a set of order items based on target quantities.
 *
 * @param {Object} params
 * @param {Array}  params.items - Order items, each with: { product_id, location_id, upc, original_qty, product_name, size, color, category, location_name, order_item_id?, order_id?, unit_cost? }
 * @param {Object} params.targetMap - Map of "productId|locationId" -> target_qty (number)
 * @param {Object} params.inventoryMap - Map of "upc|locationId" -> on_hand (number)
 * @param {Object} params.salesMap - Map of "upc|locationId" -> { qtySold, transactions?, lastSale? }
 * @param {Object} params.priorRevisionMap - Map of orderItemId -> { decision, reason, date, onHand }
 * @param {Set}    params.discontinuedUPCs - Set of lowercase UPC strings (and product names) that are discontinued
 * @param {Array}  [params.overrides] - Optional array of { upc, locationId, decision, adjustedQty, reason } to force
 * @returns {{ decisions: Array, summary: Object }}
 */
function computeDecisions({ items, targetMap, inventoryMap, salesMap, priorRevisionMap, discontinuedUPCs, overrides }) {
  const overrideMap = {};
  if (overrides && overrides.length) {
    for (const o of overrides) {
      const key = `${o.upc}|${o.locationId}`;
      overrideMap[key] = o;
    }
  }

  const decisions = [];
  let shipCount = 0, cancelCount = 0, keepOpenCount = 0;
  let totalOriginalQty = 0, totalAdjustedQty = 0;

  for (const item of items) {
    const targetKey = `${item.product_id}|${item.location_id}`;
    const invKey = `${item.upc}|${item.location_id}`;
    const target = targetMap[targetKey] ?? 0;
    const onHand = inventoryMap[invKey] ?? 0;
    const sales = salesMap[invKey] || null;
    const priorRevision = priorRevisionMap[item.order_item_id] || null;

    const isDiscontinued = item.upc && (
      discontinuedUPCs.has(item.upc.toLowerCase()) ||
      discontinuedUPCs.has((item.product_name || '').toLowerCase())
    );
    const hasRecentSales = sales && sales.qtySold > 0;
    const receivedNotInventoried = onHand <= 0 && hasRecentSales;

    totalOriginalQty += item.original_qty;

    let decision, adjustedQty, reason;

    // Check for user/chat override first
    const ovKey = `${item.upc}|${item.location_id}`;
    const override = overrideMap[ovKey];
    if (override) {
      decision = override.decision;
      adjustedQty = override.adjustedQty != null ? override.adjustedQty : (override.decision === 'cancel' ? 0 : item.original_qty);
      reason = override.reason || 'user_override';
    } else {
      // PHASE 1: Base decision from target_qty vs on_hand
      if (onHand >= target) {
        decision = 'cancel';
        adjustedQty = 0;
        reason = 'at_or_above_target';
      } else {
        decision = 'ship';
        adjustedQty = Math.min(item.original_qty, target - onHand);
        reason = 'below_target';
      }

      // PHASE 2: Reason-code resolution (most specific wins, priority order)
      if (isDiscontinued) {
        decision = 'cancel';
        adjustedQty = 0;
        reason = 'discontinued_product';
      } else if (onHand <= 0 && hasRecentSales) {
        // Received but not inventoried — probably have it, cancel
        decision = 'cancel';
        adjustedQty = 0;
        reason = 'received_not_inventoried';
      } else if (onHand <= 0 && (!sales || sales.qtySold === 0)) {
        // Genuine zero stock
        if (decision === 'ship') {
          reason = 'zero_stock';
        }
        // else keep at_or_above_target (target=0 case)
      } else if (onHand > 0 && onHand >= target) {
        reason = 'positive_stock_cancel';
      }
      // else: below_target stays as-is (onHand > 0 but below target)
    }

    if (decision === 'ship') shipCount++;
    else if (decision === 'cancel') cancelCount++;
    else if (decision === 'keep_open_bo') keepOpenCount++;

    totalAdjustedQty += adjustedQty;

    decisions.push({
      orderItemId: item.order_item_id || null,
      orderId: item.order_id || null,
      productId: item.product_id,
      upc: item.upc,
      productName: item.product_name,
      size: item.size,
      color: item.color,
      category: item.category,
      location: item.location_name,
      locationId: item.location_id,
      originalQty: item.original_qty,
      targetQty: target,
      onHand,
      decision,
      adjustedQty,
      reason,
      isDiscontinued: !!isDiscontinued,
      recentSales: sales ? { qtySold: sales.qtySold, transactions: sales.transactions, lastSale: sales.lastSale } : null,
      receivedNotInventoried,
      priorRevision: priorRevision ? {
        decision: priorRevision.decision,
        reason: priorRevision.reason,
        date: priorRevision.date,
        onHand: priorRevision.onHand,
      } : null,
    });
  }

  const reductionPct = totalOriginalQty > 0
    ? parseFloat((((totalOriginalQty - totalAdjustedQty) / totalOriginalQty) * 100).toFixed(1))
    : 0;

  const summary = {
    totalItems: decisions.length,
    ship: shipCount,
    cancel: cancelCount,
    keepOpen: keepOpenCount,
    originalTotalQty: totalOriginalQty,
    adjustedTotalQty: totalAdjustedQty,
    reductionPct,
  };

  return { decisions, summary };
}

module.exports = { computeDecisions };
