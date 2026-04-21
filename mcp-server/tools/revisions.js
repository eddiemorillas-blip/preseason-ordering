const { pool, bigquery, LOCATION_TO_FACILITY, FACILITY_TO_LOCATION } = require('../db.js');
const crypto = require('crypto');
const { computeDecisions } = require('../../src/services/revisionEngine');

function formatCurrency(num) {
  if (num === null || num === undefined) return 'N/A';
  return '$' + parseFloat(num).toFixed(2);
}

/**
 * get_revision_history: Query revision records from adjustment_history
 */
async function getRevisionHistory(args) {
  try {
    const { brandId, revisionId, orderItemId, upc, limit } = args;
    const resultLimit = limit || 10;

    let query = `
      SELECT
        ah.id,
        ah.revision_id,
        ah.order_id,
        ah.order_item_id,
        ah.brand_id,
        ah.location_id,
        ah.upc,
        ah.product_name,
        ah.size,
        ah.original_quantity AS original_qty,
        ah.new_quantity AS adjusted_qty,
        ah.decision,
        ah.decision_reason,
        ah.on_hand_at_revision,
        ah.was_flipped,
        ah.reasoning,
        ah.created_by,
        ah.applied_at,
        b.name AS brand_name,
        l.name AS location_name
      FROM adjustment_history ah
      LEFT JOIN brands b ON ah.brand_id = b.id
      LEFT JOIN locations l ON ah.location_id = l.id
      WHERE ah.revision_id IS NOT NULL
    `;

    const params = [];
    let p = 1;

    if (brandId) {
      query += ` AND ah.brand_id = $${p++}`;
      params.push(brandId);
    }
    if (revisionId) {
      query += ` AND ah.revision_id = $${p++}`;
      params.push(revisionId);
    }
    if (orderItemId) {
      query += ` AND ah.order_item_id = $${p++}`;
      params.push(orderItemId);
    }
    if (upc) {
      query += ` AND ah.upc = $${p++}`;
      params.push(upc);
    }

    query += ` ORDER BY ah.applied_at DESC LIMIT $${p}`;
    params.push(resultLimit);

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return { content: [{ type: 'text', text: 'No revision history found for the specified criteria.' }] };
    }

    let output = `REVISION HISTORY (${result.rows.length} records)\n${'='.repeat(80)}\n`;

    // Group by revision_id
    const grouped = {};
    for (const row of result.rows) {
      const rid = row.revision_id;
      if (!grouped[rid]) grouped[rid] = [];
      grouped[rid].push(row);
    }

    for (const [rid, rows] of Object.entries(grouped)) {
      const first = rows[0];
      output += `\nRevision: ${rid}\n`;
      output += `Brand: ${first.brand_name || 'N/A'} | Date: ${first.applied_at ? first.applied_at.toISOString().split('T')[0] : 'N/A'}\n`;
      output += `${'─'.repeat(80)}\n`;
      output += `${'Product'.padEnd(28)} ${'Size'.padEnd(6)} ${'Location'.padEnd(14)} ${'Orig'.padEnd(6)} ${'Adj'.padEnd(6)} ${'OnHand'.padEnd(7)} ${'Decision'.padEnd(10)} Reason\n`;
      output += `${'─'.repeat(80)}\n`;

      for (const r of rows) {
        output += `${(r.product_name || 'N/A').substring(0, 27).padEnd(28)} ` +
          `${(r.size || '-').padEnd(6)} ` +
          `${(r.location_name || '-').padEnd(14)} ` +
          `${String(r.original_qty).padEnd(6)} ` +
          `${String(r.adjusted_qty).padEnd(6)} ` +
          `${String(r.on_hand_at_revision ?? '-').padEnd(7)} ` +
          `${(r.decision || '-').padEnd(10)} ` +
          `${r.decision_reason || ''}\n`;
      }
    }

    return { content: [{ type: 'text', text: output }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error getting revision history: ${error.message}` }] };
  }
}

/**
 * compare_revisions: Summary of all revisions for a brand/season
 */
async function compareRevisions(args) {
  try {
    const { brandId, seasonId } = args;

    if (!brandId) {
      return { content: [{ type: 'text', text: 'brandId is required' }] };
    }

    let query = `
      SELECT
        r.revision_id,
        r.revision_type,
        r.total_items,
        r.ship_count,
        r.cancel_count,
        r.keep_open_count,
        r.original_total_qty,
        r.adjusted_total_qty,
        r.reduction_pct,
        r.max_reduction_pct,
        r.logic_applied,
        r.notes,
        r.created_at,
        b.name AS brand_name
      FROM revisions r
      LEFT JOIN brands b ON r.brand_id = b.id
      WHERE r.brand_id = $1
    `;

    const params = [brandId];
    let p = 2;

    if (seasonId) {
      query += ` AND r.season_id = $${p++}`;
      params.push(seasonId);
    }

    query += ` ORDER BY r.created_at DESC`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return { content: [{ type: 'text', text: `No revisions found for brand ${brandId}` }] };
    }

    const brand = result.rows[0].brand_name || `Brand ${brandId}`;
    let output = `REVISION COMPARISON: ${brand}\n${'='.repeat(80)}\n`;
    output += `Total revisions: ${result.rows.length}\n\n`;

    output += `${'Date'.padEnd(12)} ${'Type'.padEnd(22)} ${'Items'.padEnd(7)} ${'Ship'.padEnd(6)} ${'Cancel'.padEnd(8)} ${'KeepOpen'.padEnd(9)} ${'OrigQty'.padEnd(9)} ${'AdjQty'.padEnd(9)} ${'Red%'.padEnd(8)}\n`;
    output += `${'─'.repeat(90)}\n`;

    let totalOriginal = 0;
    let totalAdjusted = 0;
    let totalCancelled = 0;
    let totalShipped = 0;

    for (const r of result.rows) {
      const date = r.created_at ? r.created_at.toISOString().split('T')[0] : 'N/A';
      output += `${date.padEnd(12)} ` +
        `${(r.revision_type || '-').padEnd(22)} ` +
        `${String(r.total_items).padEnd(7)} ` +
        `${String(r.ship_count).padEnd(6)} ` +
        `${String(r.cancel_count).padEnd(8)} ` +
        `${String(r.keep_open_count).padEnd(9)} ` +
        `${String(r.original_total_qty).padEnd(9)} ` +
        `${String(r.adjusted_total_qty).padEnd(9)} ` +
        `${r.reduction_pct != null ? r.reduction_pct + '%' : '-'}\n`;

      totalOriginal += r.original_total_qty || 0;
      totalAdjusted += r.adjusted_total_qty || 0;
      totalCancelled += r.cancel_count || 0;
      totalShipped += r.ship_count || 0;
    }

    output += `${'─'.repeat(90)}\n`;
    output += `CUMULATIVE: ${result.rows.length} revisions | ` +
      `Total shipped decisions: ${totalShipped} | Total cancelled: ${totalCancelled}\n`;

    return { content: [{ type: 'text', text: output }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error comparing revisions: ${error.message}` }] };
  }
}

/**
 * run_revision: Automated revision workflow using target-qty engine
 * 1. Fetch order items
 * 2. Load on-hand from BigQuery, targets, sales, discontinued
 * 3. Call computeDecisions (target-qty based)
 * 4. Optionally persist
 */
async function runRevision(args) {
  try {
    const { brandId, orderIds, dryRun, revisionNotes } = args;

    if (!brandId || !orderIds || orderIds.length === 0) {
      return { content: [{ type: 'text', text: 'brandId and orderIds are required' }] };
    }

    if (!bigquery) {
      return { content: [{ type: 'text', text: 'BigQuery is not available. run_revision requires live inventory data.' }] };
    }

    const isDryRun = dryRun !== undefined ? dryRun : true;

    // Get all order items
    const orderPlaceholders = orderIds.map((_, i) => `$${i + 1}`).join(',');
    const itemsResult = await pool.query(`
      SELECT
        oi.id AS order_item_id,
        oi.order_id,
        oi.product_id,
        COALESCE(oi.adjusted_quantity, oi.quantity) AS original_qty,
        oi.unit_cost,
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
        AND COALESCE(oi.adjusted_quantity, oi.quantity) > 0
      ORDER BY o.location_id, p.name, p.size
    `, orderIds);

    if (itemsResult.rows.length === 0) {
      return { content: [{ type: 'text', text: 'No order items found for the specified orders.' }] };
    }

    const items = itemsResult.rows;

    // Bulk fetch on-hand from BigQuery
    const upcs = [...new Set(items.map(i => i.upc).filter(Boolean))];
    const upcList = upcs.map(u => `'${u}'`).join(',');

    const [bqRows] = await bigquery.query({
      query: `
        SELECT DISTINCT i.barcode AS upc, i.facility_id, i.on_hand_qty
        FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
        WHERE i.barcode IN (${upcList}) AND i.facility_id IN (41185, 1003, 1000)
      `
    });

    const inventoryMap = {};
    for (const row of bqRows) {
      const locationId = FACILITY_TO_LOCATION[String(row.facility_id)];
      if (locationId) inventoryMap[`${row.upc}|${locationId}`] = parseInt(row.on_hand_qty) || 0;
    }

    // Load targets
    const productIds = [...new Set(items.map(i => i.product_id))];
    const targetMap = {};
    if (productIds.length > 0) {
      const tPlaceholders = productIds.map((_, i) => `$${i + 1}`).join(',');
      const targetResult = await pool.query(
        `SELECT product_id, location_id, target_qty FROM product_location_targets WHERE product_id IN (${tPlaceholders})`,
        productIds
      );
      for (const row of targetResult.rows) {
        targetMap[`${row.product_id}|${row.location_id}`] = row.target_qty;
      }
    }

    // Get discontinued products
    const discontinuedUPCs = new Set();
    try {
      const discResult = await pool.query(
        `SELECT key, value FROM knowledge_entries WHERE type = 'discontinued_product' AND active = TRUE AND ($1::int IS NULL OR target_id = $1)`,
        [brandId]
      );
      for (const row of discResult.rows) {
        if (row.key) discontinuedUPCs.add(row.key.toLowerCase());
        if (row.value && row.value.upc) discontinuedUPCs.add(String(row.value.upc));
        if (row.value && Array.isArray(row.value.upcs)) row.value.upcs.forEach(u => discontinuedUPCs.add(String(u)));
      }
    } catch (e) { /* */ }

    // Check prior revisions
    const priorRevisionMap = {};
    try {
      const priorResult = await pool.query(`
        SELECT DISTINCT ON (ah.order_item_id)
          ah.order_item_id, ah.decision, ah.decision_reason, ah.applied_at, ah.on_hand_at_revision
        FROM adjustment_history ah
        WHERE ah.brand_id = $1 AND ah.revision_id IS NOT NULL AND ah.order_item_id = ANY($2::int[])
        ORDER BY ah.order_item_id, ah.applied_at DESC
      `, [brandId, items.map(i => i.order_item_id)]);
      for (const row of priorResult.rows) {
        priorRevisionMap[row.order_item_id] = {
          decision: row.decision, reason: row.decision_reason, date: row.applied_at, onHand: row.on_hand_at_revision
        };
      }
    } catch (e) { /* */ }

    // Check sales data
    const salesMap = {};
    try {
      const facilityIds = [...new Set(items.map(i => LOCATION_TO_FACILITY[i.location_id]).filter(Boolean))];
      const facList = facilityIds.join(',');
      const [salesRows] = await bigquery.query({
        query: `
          SELECT p.BARCODE AS upc, p.facility_id_true AS facility_id,
            SUM(ii.QUANTITY) AS qty_sold, COUNT(DISTINCT i.invoice_concat) AS transaction_count,
            MAX(DATE(i.POSTDATE)) AS last_sale
          FROM \`front-data-production.rgp_cleaned_zone.invoice_items_all\` ii
          JOIN \`front-data-production.rgp_cleaned_zone.invoices_all\` i ON ii.invoice_concat = i.invoice_concat
          JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON ii.product_concat = p.product_concat
          WHERE DATE(i.POSTDATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
            AND ii.QUANTITY > 0 AND p.BARCODE IN (${upcList}) AND p.facility_id_true IN (${facList})
          GROUP BY p.BARCODE, p.facility_id_true
        `
      });
      for (const row of salesRows) {
        const locationId = FACILITY_TO_LOCATION[String(row.facility_id)];
        if (locationId) {
          salesMap[`${row.upc}|${locationId}`] = {
            qtySold: parseInt(row.qty_sold) || 0, transactions: parseInt(row.transaction_count) || 0, lastSale: row.last_sale
          };
        }
      }
    } catch (e) { /* non-fatal */ }

    // Run decision engine
    const { decisions, summary } = computeDecisions({
      items,
      targetMap,
      inventoryMap,
      salesMap,
      priorRevisionMap,
      discontinuedUPCs,
    });

    // Write if not dry run
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
            logic_applied, notes, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
        `, [
          revisionId, brandId, seasonId, 'monthly_adjustment',
          summary.totalItems, summary.ship, summary.cancel, summary.keepOpen,
          summary.originalTotalQty, summary.adjustedTotalQty, summary.reductionPct,
          'target_qty', revisionNotes || null
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
            d.decision, d.reason, d.onHand, false,
            'ai_agent'
          ]);

          let vendorDecision, receiptStatus;
          if (d.decision === 'cancel') { vendorDecision = 'cancel'; receiptStatus = 'cancelled'; }
          else if (d.decision === 'keep_open_bo') { vendorDecision = 'keep_open_bo'; receiptStatus = 'backordered'; }
          else { vendorDecision = 'ship'; receiptStatus = 'pending'; }

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

    // Build response
    let output = `${isDryRun ? 'DRY RUN — ' : ''}REVISION ${isDryRun ? 'PREVIEW' : 'APPLIED'}\n${'='.repeat(80)}\n`;
    if (revisionId) output += `Revision ID: ${revisionId}\n`;
    output += `Brand: ${brandId} | Orders: ${orderIds.join(', ')}\n\n`;

    output += `SUMMARY\n${'─'.repeat(40)}\n`;
    output += `Total Items: ${summary.totalItems}\n`;
    output += `Ship: ${summary.ship} | Cancel: ${summary.cancel} | Keep Open: ${summary.keepOpen}\n`;
    output += `Original Qty: ${summary.originalTotalQty} → Adjusted: ${summary.adjustedTotalQty}\n`;
    output += `Reduction: ${summary.reductionPct}%\n`;

    output += `\nDECISIONS\n${'─'.repeat(90)}\n`;
    output += `${'Product'.padEnd(28)} ${'Size'.padEnd(6)} ${'Location'.padEnd(14)} ${'Orig'.padEnd(5)} ${'OnHand'.padEnd(7)} ${'Target'.padEnd(7)} ${'Dec'.padEnd(8)} ${'Adj'.padEnd(5)} Reason\n`;
    output += `${'─'.repeat(90)}\n`;

    for (const d of decisions) {
      output += `${(d.productName || 'N/A').substring(0, 27).padEnd(28)} ` +
        `${(d.size || '-').padEnd(6)} ` +
        `${(d.location || '-').padEnd(14)} ` +
        `${String(d.originalQty).padEnd(5)} ` +
        `${String(d.onHand).padEnd(7)} ` +
        `${String(d.targetQty).padEnd(7)} ` +
        `${d.decision.padEnd(8)} ` +
        `${String(d.adjustedQty).padEnd(5)} ` +
        `${d.reason}\n`;
    }

    return { content: [{ type: 'text', text: output }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error running revision: ${error.message}` }] };
  }
}

module.exports = [
  {
    name: 'get_revision_history',
    description: 'Query revision history showing original vs adjusted values with decision reasons. Filter by brand, revision ID, order item, or UPC.',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'number', description: 'Filter by brand ID' },
        revisionId: { type: 'string', description: 'Filter by specific revision ID' },
        orderItemId: { type: 'number', description: 'Filter by order item ID' },
        upc: { type: 'string', description: 'Filter by UPC' },
        limit: { type: 'number', description: 'Max records to return (default 10)' }
      }
    },
    handler: getRevisionHistory
  },
  {
    name: 'compare_revisions',
    description: 'Compare all revisions for a brand/season. Shows original vs adjusted totals, reduction %, ship/cancel counts across all revision sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'number', description: 'Brand ID (required)' },
        seasonId: { type: 'number', description: 'Optional season filter' }
      },
      required: ['brandId']
    },
    handler: compareRevisions
  },
  {
    name: 'run_revision',
    description: 'Automated target-qty revision workflow: fetches live inventory from BigQuery, loads target quantities per product/location, and runs the decision engine (cancel if on_hand >= target, ship if below). Checks discontinued products and received-not-inventoried. Use dryRun=true (default) to preview before committing.',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'number', description: 'Brand ID (required)' },
        orderIds: {
          type: 'array',
          items: { type: 'number' },
          description: 'Array of internal order IDs to revise'
        },
        dryRun: { type: 'boolean', description: 'If true (default), preview decisions without writing' },
        revisionNotes: { type: 'string', description: 'Notes for this revision session' }
      },
      required: ['brandId', 'orderIds']
    },
    handler: runRevision
  }
];
