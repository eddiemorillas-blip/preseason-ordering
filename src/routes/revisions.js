const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../config/database');
const { bigquery, FACILITY_TO_LOCATION, LOCATION_TO_FACILITY } = require('../services/bigquery');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// All revision routes require authentication
router.use(authenticateToken);

/**
 * POST /api/revisions/run
 * Run automated revision workflow (dry run or commit)
 */
router.post('/run', authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const {
      brandId, orderIds, maxReductionPct, dryRun,
      includeAdditions, brandName, revisionNotes
    } = req.body;

    if (!brandId || !orderIds || orderIds.length === 0) {
      return res.status(400).json({ error: 'brandId and orderIds are required' });
    }

    if (!bigquery) {
      return res.status(503).json({ error: 'BigQuery is not available. Revision requires live inventory data.' });
    }

    const maxReduction = maxReductionPct !== undefined ? maxReductionPct : 0.20;
    const isDryRun = dryRun !== undefined ? dryRun : true;
    const withAdditions = includeAdditions !== undefined ? includeAdditions : true;

    // Get all order items for specified orders
    const orderPlaceholders = orderIds.map((_, i) => `$${i + 1}`).join(',');
    const itemsResult = await pool.query(`
      SELECT
        oi.id AS order_item_id,
        oi.order_id,
        oi.product_id,
        oi.quantity AS original_qty,
        COALESCE(oi.adjusted_quantity, oi.quantity) AS current_qty,
        oi.unit_cost,
        oi.vendor_decision,
        p.upc,
        p.name AS product_name,
        p.size,
        p.color,
        p.category,
        o.location_id,
        l.name AS location_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      JOIN locations l ON o.location_id = l.id
      WHERE oi.order_id IN (${orderPlaceholders})
      ORDER BY o.location_id, p.name, p.size
    `, orderIds);

    if (itemsResult.rows.length === 0) {
      return res.json({ summary: { totalItems: 0 }, decisions: [] });
    }

    const items = itemsResult.rows;

    // Bulk fetch on-hand from BigQuery
    const upcs = [...new Set(items.map(i => i.upc).filter(Boolean))];
    const upcList = upcs.map(u => `'${u}'`).join(',');

    const bqQuery = `
      SELECT DISTINCT
        i.barcode AS upc,
        i.facility_id,
        i.on_hand_qty
      FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
      WHERE i.barcode IN (${upcList})
        AND i.facility_id IN (41185, 1003, 1000)
    `;

    const [bqRows] = await bigquery.query({ query: bqQuery });

    // Build lookup: upc+locationId -> on_hand
    const inventoryMap = {};
    for (const row of bqRows) {
      const locationId = FACILITY_TO_LOCATION[String(row.facility_id)];
      if (locationId) {
        inventoryMap[`${row.upc}|${locationId}`] = parseInt(row.on_hand_qty) || 0;
      }
    }

    // Get discontinued products from knowledge
    const discontinuedUPCs = new Set();
    try {
      const discResult = await pool.query(
        `SELECT key, value FROM knowledge_entries WHERE type = 'discontinued_product' AND active = TRUE AND ($1::int IS NULL OR target_id = $1)`,
        [brandId]
      );
      for (const row of discResult.rows) {
        if (row.key) discontinuedUPCs.add(row.key.toLowerCase());
        if (row.value && row.value.upc) discontinuedUPCs.add(String(row.value.upc));
        if (row.value && Array.isArray(row.value.upcs)) {
          row.value.upcs.forEach(u => discontinuedUPCs.add(String(u)));
        }
      }
    } catch (e) { /* knowledge table may be empty */ }

    // Check prior revisions for these items
    const priorRevisionMap = {};
    try {
      const priorResult = await pool.query(`
        SELECT DISTINCT ON (ah.order_item_id)
          ah.order_item_id, ah.decision, ah.decision_reason, ah.revision_id,
          ah.applied_at, ah.on_hand_at_revision
        FROM adjustment_history ah
        WHERE ah.brand_id = $1 AND ah.revision_id IS NOT NULL
          AND ah.order_item_id = ANY($2::int[])
        ORDER BY ah.order_item_id, ah.applied_at DESC
      `, [brandId, items.map(i => i.order_item_id)]);

      for (const row of priorResult.rows) {
        priorRevisionMap[row.order_item_id] = {
          decision: row.decision,
          reason: row.decision_reason,
          revisionId: row.revision_id,
          date: row.applied_at,
          onHand: row.on_hand_at_revision
        };
      }
    } catch (e) { /* no prior revisions */ }

    // Check sales data — items with on_hand=0 but recent sales were received but not inventoried
    const salesMap = {};
    try {
      const facilityIds = [...new Set(items.map(i => LOCATION_TO_FACILITY[i.location_id]).filter(Boolean))];
      const facList = facilityIds.join(',');

      const salesQuery = `
        SELECT
          p.BARCODE AS upc,
          p.facility_id_true AS facility_id,
          SUM(ii.QUANTITY) AS qty_sold,
          COUNT(DISTINCT i.invoice_concat) AS transaction_count,
          MAX(DATE(i.POSTDATE)) AS last_sale
        FROM \`front-data-production.rgp_cleaned_zone.invoice_items_all\` ii
        JOIN \`front-data-production.rgp_cleaned_zone.invoices_all\` i ON ii.invoice_concat = i.invoice_concat
        JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON ii.product_concat = p.product_concat
        WHERE DATE(i.POSTDATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
          AND ii.QUANTITY > 0
          AND p.BARCODE IN (${upcList})
          AND p.facility_id_true IN (${facList})
        GROUP BY p.BARCODE, p.facility_id_true
      `;

      const [salesRows] = await bigquery.query({ query: salesQuery });
      for (const row of salesRows) {
        const locationId = FACILITY_TO_LOCATION[String(row.facility_id)];
        if (locationId) {
          salesMap[`${row.upc}|${locationId}`] = {
            qtySold: parseInt(row.qty_sold) || 0,
            transactions: parseInt(row.transaction_count) || 0,
            lastSale: row.last_sale
          };
        }
      }
    } catch (e) {
      console.error('Sales lookup error (non-fatal):', e.message);
    }

    // Apply decision logic
    const decisions = [];
    let totalOriginalQty = 0;
    let shipCount = 0, cancelCount = 0, keepOpenCount = 0;

    for (const item of items) {
      const invKey = `${item.upc}|${item.location_id}`;
      const onHand = inventoryMap[invKey] || 0;
      const sales = salesMap[invKey] || null;
      const priorRevision = priorRevisionMap[item.order_item_id] || null;
      totalOriginalQty += item.original_qty;

      const isDiscontinued = item.upc && (
        discontinuedUPCs.has(item.upc.toLowerCase()) ||
        discontinuedUPCs.has((item.product_name || '').toLowerCase())
      );

      // Items with 0 inventory BUT recent sales → received but not inventoried → cancel
      const hasRecentSales = sales && sales.qtySold > 0;
      const receivedNotInventoried = onHand <= 0 && hasRecentSales;

      let decision, adjustedQty, reason;

      if (isDiscontinued) {
        decision = 'cancel'; adjustedQty = 0; reason = 'discontinued_product'; cancelCount++;
      } else if (onHand > 0) {
        decision = 'cancel'; adjustedQty = 0; reason = 'positive_stock_cancel'; cancelCount++;
      } else if (receivedNotInventoried) {
        decision = 'cancel'; adjustedQty = 0; reason = 'received_not_inventoried'; cancelCount++;
      } else {
        decision = 'ship'; adjustedQty = item.original_qty; reason = 'zero_stock'; shipCount++;
      }

      decisions.push({
        orderItemId: item.order_item_id,
        orderId: item.order_id,
        productId: item.product_id,
        upc: item.upc,
        productName: item.product_name,
        size: item.size,
        color: item.color,
        category: item.category,
        location: item.location_name,
        locationId: item.location_id,
        originalQty: item.original_qty,
        onHand,
        decision,
        adjustedQty,
        reason,
        wasFlipped: false,
        isDiscontinued,
        // Sales data
        recentSales: sales ? { qtySold: sales.qtySold, transactions: sales.transactions, lastSale: sales.lastSale } : null,
        receivedNotInventoried,
        // Prior revision data
        priorRevision: priorRevision ? {
          decision: priorRevision.decision,
          reason: priorRevision.reason,
          date: priorRevision.date,
          onHand: priorRevision.onHand
        } : null
      });
    }

    // Check reduction cap
    let totalAdjustedQty = decisions.reduce((s, d) => s + d.adjustedQty, 0);
    let reductionPct = totalOriginalQty > 0
      ? (totalOriginalQty - totalAdjustedQty) / totalOriginalQty
      : 0;

    let flippedBack = 0;

    if (reductionPct > maxReduction) {
      const flippable = decisions
        .filter(d => d.decision === 'cancel' && !d.isDiscontinued && !d.receivedNotInventoried)
        .sort((a, b) => a.onHand - b.onHand);

      for (const d of flippable) {
        if (reductionPct <= maxReduction) break;
        d.decision = 'ship';
        d.adjustedQty = d.originalQty;
        d.reason = 'flipped_back_cap';
        d.wasFlipped = true;
        flippedBack++;
        cancelCount--;
        shipCount++;
        totalAdjustedQty += d.originalQty;
        reductionPct = totalOriginalQty > 0
          ? (totalOriginalQty - totalAdjustedQty) / totalOriginalQty : 0;
      }
    }

    // If not dry run, commit
    let revisionId = null;

    if (!isDryRun) {
      revisionId = crypto.randomUUID();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const seasonResult = await client.query('SELECT season_id FROM orders WHERE id = $1', [orderIds[0]]);
        const seasonId = seasonResult.rows.length > 0 ? seasonResult.rows[0].season_id : null;

        await client.query(`
          INSERT INTO revisions (
            revision_id, brand_id, season_id, revision_type,
            total_items, ship_count, cancel_count, keep_open_count,
            original_total_qty, adjusted_total_qty, reduction_pct,
            max_reduction_pct, logic_applied, notes, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
        `, [
          revisionId, brandId, seasonId, 'monthly_adjustment',
          decisions.length, shipCount, cancelCount, keepOpenCount,
          totalOriginalQty, totalAdjustedQty,
          parseFloat((reductionPct * 100).toFixed(2)),
          maxReduction, 'zero_stock_with_cap',
          revisionNotes || null
        ]);

        for (const d of decisions) {
          await client.query(`
            INSERT INTO adjustment_history (
              order_id, order_item_id, product_id,
              original_quantity, new_quantity, adjustment_type, reasoning,
              revision_id, brand_id, location_id, upc, product_name, size,
              decision, decision_reason, on_hand_at_revision, was_flipped,
              created_by, applied_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
          `, [
            d.orderId, d.orderItemId, d.productId,
            d.originalQty, d.adjustedQty, 'revision', d.reason,
            revisionId, brandId, d.locationId, d.upc, d.productName, d.size,
            d.decision, d.reason, d.onHand, d.wasFlipped,
            `web_user:${req.user.id}`
          ]);

          let vendorDecision, receiptStatus;
          if (d.decision === 'cancel') {
            vendorDecision = 'cancel'; receiptStatus = 'cancelled';
          } else if (d.decision === 'keep_open_bo') {
            vendorDecision = 'keep_open_bo'; receiptStatus = 'backordered';
          } else {
            vendorDecision = 'ship'; receiptStatus = 'pending';
          }

          await client.query(`
            UPDATE order_items SET vendor_decision = $1, adjusted_quantity = $2,
              receipt_status = $3, updated_at = NOW() WHERE id = $4
          `, [vendorDecision, d.adjustedQty, receiptStatus, d.orderItemId]);
        }

        for (const oid of orderIds) {
          await client.query('UPDATE orders SET updated_at = NOW() WHERE id = $1', [oid]);
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    res.json({
      revisionId,
      dryRun: isDryRun,
      summary: {
        totalItems: decisions.length,
        ship: shipCount,
        cancel: cancelCount,
        keepOpen: keepOpenCount,
        originalTotalQty: totalOriginalQty,
        adjustedTotalQty: totalAdjustedQty,
        reductionPct: parseFloat((reductionPct * 100).toFixed(1)),
        flippedBack
      },
      decisions
    });
  } catch (error) {
    console.error('Revision error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/revisions/apply
 * Apply user-modified decisions (after dry run with overrides)
 */
router.post('/apply', authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { brandId, orderIds, decisions, revisionNotes, maxReductionPct } = req.body;

    if (!brandId || !decisions || decisions.length === 0) {
      return res.status(400).json({ error: 'brandId and decisions are required' });
    }

    const revisionId = crypto.randomUUID();
    const client = await pool.connect();

    let shipCount = 0, cancelCount = 0, keepOpenCount = 0;
    let totalOriginalQty = 0, totalAdjustedQty = 0;

    try {
      await client.query('BEGIN');

      const seasonResult = await client.query(
        'SELECT season_id FROM orders WHERE id = $1', [orderIds?.[0] || decisions[0]?.orderId]
      );
      const seasonId = seasonResult.rows.length > 0 ? seasonResult.rows[0].season_id : null;

      for (const d of decisions) {
        totalOriginalQty += d.originalQty || 0;
        totalAdjustedQty += d.adjustedQty || 0;

        if (d.decision === 'cancel') cancelCount++;
        else if (d.decision === 'keep_open_bo') keepOpenCount++;
        else shipCount++;

        // Log to adjustment_history
        await client.query(`
          INSERT INTO adjustment_history (
            order_id, order_item_id, product_id,
            original_quantity, new_quantity, adjustment_type, reasoning,
            revision_id, brand_id, location_id, upc, product_name, size,
            decision, decision_reason, on_hand_at_revision, was_flipped,
            created_by, applied_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
        `, [
          d.orderId, d.orderItemId, d.productId,
          d.originalQty, d.adjustedQty, 'revision', d.reason || null,
          revisionId, brandId, d.locationId, d.upc, d.productName, d.size,
          d.decision, d.reason || null, d.onHand || null, d.wasFlipped || false,
          `web_user:${req.user.id}`
        ]);

        // Update order_items
        let vendorDecision, receiptStatus;
        if (d.decision === 'cancel') {
          vendorDecision = 'cancel'; receiptStatus = 'cancelled';
        } else if (d.decision === 'keep_open_bo') {
          vendorDecision = 'keep_open_bo'; receiptStatus = 'backordered';
        } else {
          vendorDecision = 'ship'; receiptStatus = 'pending';
        }

        await client.query(`
          UPDATE order_items SET vendor_decision = $1, adjusted_quantity = $2,
            receipt_status = $3, updated_at = NOW() WHERE id = $4
        `, [vendorDecision, d.adjustedQty, receiptStatus, d.orderItemId]);
      }

      const reductionPct = totalOriginalQty > 0
        ? parseFloat((((totalOriginalQty - totalAdjustedQty) / totalOriginalQty) * 100).toFixed(2))
        : 0;

      await client.query(`
        INSERT INTO revisions (
          revision_id, brand_id, season_id, revision_type,
          total_items, ship_count, cancel_count, keep_open_count,
          original_total_qty, adjusted_total_qty, reduction_pct,
          max_reduction_pct, notes, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
      `, [
        revisionId, brandId, seasonId, 'monthly_adjustment',
        decisions.length, shipCount, cancelCount, keepOpenCount,
        totalOriginalQty, totalAdjustedQty, reductionPct,
        maxReductionPct || null, revisionNotes || null
      ]);

      // Update order timestamps
      const uniqueOrderIds = [...new Set(decisions.map(d => d.orderId))];
      for (const oid of uniqueOrderIds) {
        await client.query('UPDATE orders SET updated_at = NOW() WHERE id = $1', [oid]);
      }

      await client.query('COMMIT');

      res.json({
        revisionId,
        summary: {
          totalItems: decisions.length,
          ship: shipCount,
          cancel: cancelCount,
          keepOpen: keepOpenCount,
          originalTotalQty: totalOriginalQty,
          adjustedTotalQty: totalAdjustedQty,
          reductionPct
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Apply revision error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/revisions/history
 */
router.get('/history', async (req, res) => {
  try {
    const { brandId, revisionId, orderItemId, upc, limit } = req.query;
    const resultLimit = parseInt(limit) || 50;

    let query = `
      SELECT
        ah.id, ah.revision_id, ah.order_id, ah.order_item_id,
        ah.brand_id, ah.location_id, ah.upc, ah.product_name, ah.size,
        ah.original_quantity, ah.new_quantity,
        ah.decision, ah.decision_reason, ah.on_hand_at_revision,
        ah.was_flipped, ah.reasoning, ah.created_by, ah.applied_at,
        b.name AS brand_name, l.name AS location_name
      FROM adjustment_history ah
      LEFT JOIN brands b ON ah.brand_id = b.id
      LEFT JOIN locations l ON ah.location_id = l.id
      WHERE ah.revision_id IS NOT NULL
    `;
    const params = [];
    let p = 1;

    if (brandId) { query += ` AND ah.brand_id = $${p++}`; params.push(brandId); }
    if (revisionId) { query += ` AND ah.revision_id = $${p++}`; params.push(revisionId); }
    if (orderItemId) { query += ` AND ah.order_item_id = $${p++}`; params.push(orderItemId); }
    if (upc) { query += ` AND ah.upc = $${p++}`; params.push(upc); }

    query += ` ORDER BY ah.applied_at DESC LIMIT $${p}`;
    params.push(resultLimit);

    const result = await pool.query(query, params);
    res.json({ history: result.rows });
  } catch (error) {
    console.error('Revision history error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/revisions/compare
 */
router.get('/compare', async (req, res) => {
  try {
    const { brandId, seasonId } = req.query;
    if (!brandId) return res.status(400).json({ error: 'brandId is required' });

    let query = `
      SELECT
        r.revision_id, r.revision_type, r.total_items,
        r.ship_count, r.cancel_count, r.keep_open_count,
        r.original_total_qty, r.adjusted_total_qty, r.reduction_pct,
        r.max_reduction_pct, r.notes, r.created_at,
        b.name AS brand_name
      FROM revisions r
      LEFT JOIN brands b ON r.brand_id = b.id
      WHERE r.brand_id = $1
    `;
    const params = [brandId];
    let p = 2;

    if (seasonId) { query += ` AND r.season_id = $${p++}`; params.push(seasonId); }
    query += ` ORDER BY r.created_at DESC`;

    const result = await pool.query(query, params);
    res.json({ revisions: result.rows });
  } catch (error) {
    console.error('Compare revisions error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
