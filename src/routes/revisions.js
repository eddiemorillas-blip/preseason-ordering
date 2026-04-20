const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../config/database');
const XLSX = require('xlsx');
const XlsxPopulate = require('xlsx-populate');
const multer = require('multer');
const { bigquery, FACILITY_TO_LOCATION, LOCATION_TO_FACILITY } = require('../services/bigquery');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

/**
 * Parse a PDF file into rows of data (like a spreadsheet).
 * Extracts text, splits into lines, then tokenizes each line.
 * Looks for lines containing UPC-like numbers and tries to build a table.
 */
async function parsePdfToRows(buffer) {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  const lines = data.text.split('\n').map(l => l.trim()).filter(Boolean);

  // Try to detect header line and data lines
  // Look for a line that contains "UPC" or "Barcode" to identify the header
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    if (/\b(upc|barcode|ean|item.?code)\b/i.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }

  // Tokenize lines by splitting on 2+ spaces or tabs (common in PDF table extraction)
  const tokenize = (line) => line.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);

  const headers = headerIdx >= 0 ? tokenize(lines[headerIdx]) : [];
  const dataLines = [];

  const startIdx = headerIdx >= 0 ? headerIdx + 1 : 0;
  for (let i = startIdx; i < lines.length; i++) {
    const tokens = tokenize(lines[i]);
    // A valid data line should have a UPC-like token (8-14 digit number)
    const hasUPC = tokens.some(t => /^\d{8,14}$/.test(t.replace(/[^0-9]/g, '')));
    if (hasUPC && tokens.length >= 2) {
      dataLines.push(tokens);
    }
  }

  return { headers, rows: dataLines, rawLines: lines };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

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
        COALESCE(oi.adjusted_quantity, oi.quantity) AS original_qty,
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
        AND COALESCE(oi.adjusted_quantity, oi.quantity) > 0
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

    // Calculate reduction
    let totalAdjustedQty = decisions.reduce((s, d) => s + d.adjustedQty, 0);
    let reductionPct = totalOriginalQty > 0
      ? (totalOriginalQty - totalAdjustedQty) / totalOriginalQty
      : 0;

    const exceedsCap = reductionPct > maxReduction;

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
        exceedsCap,
        maxReductionPct: parseFloat((maxReduction * 100).toFixed(0))
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

/**
 * GET /api/revisions/templates
 */
router.get('/templates', async (req, res) => {
  try {
    const { brandId } = req.query;
    let query = 'SELECT * FROM brand_order_templates WHERE active = true';
    const params = [];
    if (brandId) { query += ' AND brand_id = $1'; params.push(brandId); }
    query += ' ORDER BY brand_id, name';
    const result = await pool.query(query, params);
    res.json({ templates: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/revisions/templates
 */
router.post('/templates', authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { brand_id, name, sheet_name, header_row, data_start_row,
            column_mappings, dropdown_options, fill_rules, po_pattern,
            location_mapping, notes } = req.body;
    if (!brand_id || !name) return res.status(400).json({ error: 'brand_id and name are required' });

    const result = await pool.query(`
      INSERT INTO brand_order_templates (
        brand_id, name, sheet_name, header_row, data_start_row,
        column_mappings, dropdown_options, fill_rules, po_pattern,
        location_mapping, notes, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      ON CONFLICT (brand_id, name) DO UPDATE SET
        sheet_name=EXCLUDED.sheet_name, header_row=EXCLUDED.header_row,
        data_start_row=EXCLUDED.data_start_row, column_mappings=EXCLUDED.column_mappings,
        dropdown_options=EXCLUDED.dropdown_options, fill_rules=EXCLUDED.fill_rules,
        po_pattern=EXCLUDED.po_pattern, location_mapping=EXCLUDED.location_mapping,
        notes=EXCLUDED.notes, updated_at=NOW()
      RETURNING id
    `, [brand_id, name, sheet_name || null, header_row || null, data_start_row || 2,
        JSON.stringify(column_mappings || {}), JSON.stringify(dropdown_options || {}),
        JSON.stringify(fill_rules || {}), po_pattern || null,
        JSON.stringify(location_mapping || {}), notes || null]);

    res.json({ id: result.rows[0].id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/revisions/templates/:id
 */
router.put('/templates/:id', authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { name, sheet_name, header_row, data_start_row,
            column_mappings, dropdown_options, fill_rules, po_pattern,
            location_mapping, notes } = req.body;

    await pool.query(`
      UPDATE brand_order_templates SET
        name=$1, sheet_name=$2, header_row=$3, data_start_row=$4,
        column_mappings=$5, dropdown_options=$6, fill_rules=$7,
        po_pattern=$8, location_mapping=$9, notes=$10, updated_at=NOW()
      WHERE id = $11
    `, [name, sheet_name || null, header_row || null, data_start_row || 2,
        JSON.stringify(column_mappings || {}), JSON.stringify(dropdown_options || {}),
        JSON.stringify(fill_rules || {}), po_pattern || null,
        JSON.stringify(location_mapping || {}), notes || null, req.params.id]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/revisions/templates/:id
 */
router.delete('/templates/:id', authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    await pool.query('UPDATE brand_order_templates SET active = false WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/revisions/template-preview
 * Upload a sample file to detect sheets and headers
 */
router.post('/template-preview', authorizeRoles('admin', 'buyer'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File is required' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheets = workbook.SheetNames;

    // Get headers from first sheet (or specified sheet)
    const sheetName = req.body.sheetName || sheets[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    // Try to find header row (first row with multiple non-empty cells)
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(data.length, 15); i++) {
      const nonEmpty = (data[i] || []).filter(c => c !== '' && c != null).length;
      if (nonEmpty >= 3) { headerRowIdx = i; break; }
    }

    const headers = (data[headerRowIdx] || []).map(h => h != null ? String(h) : '');
    const sampleRows = data.slice(headerRowIdx + 1, headerRowIdx + 4).map(row =>
      row.map(c => c != null ? String(c) : '')
    );

    // Auto-detect column mappings from header names
    const detectedColumns = {};
    const patterns = {
      upc: /\bupc\b|barcode|ean/i,
      ship_to_location: /ship.?to|location|dealer.?name/i,
      purchase_order: /purchase.?order|po\b|p\.o\./i,
      so_number: /\bso\b|sales.?order/i,
      item_name: /item.?name|product.?name|description|style/i,
      color_name: /color/i,
      vpn: /vpn|vendor.?product|style.?number|item.?number/i,
      ordered: /\bordered\b|order.?qty|qty.?ordered/i,
      committed: /commit|confirmed/i,
      backorder: /back.?order|b\.?o\.?\b/i,
      eta: /\beta\b|ship.?date|expected|arrival/i,
      quantity_adjustment: /qty.?adj|quantity.?adj|revised.?qty|new.?qty|adjustment/i,
      ship_cancel: /ship.*cancel|cancel.*ship|action|decision|disposition/i,
    };

    for (const [field, regex] of Object.entries(patterns)) {
      const idx = headers.findIndex(h => h && regex.test(h));
      if (idx >= 0) detectedColumns[field] = idx + 1; // 1-indexed
    }

    // Detect dropdown values from data in ship_cancel column
    let detectedDropdowns = {};
    if (detectedColumns.ship_cancel) {
      const colIdx = detectedColumns.ship_cancel - 1;
      const values = new Set();
      for (let i = headerRowIdx + 1; i < Math.min(data.length, 200); i++) {
        const val = data[i]?.[colIdx];
        if (val && String(val).trim()) values.add(String(val).trim());
      }
      if (values.size > 0 && values.size <= 10) {
        detectedDropdowns.ship_cancel = [...values].sort();
      }
    }

    // Detect sheet name that looks like a revision sheet
    let suggestedSheet = sheetName;
    for (const s of sheets) {
      if (/revis|adjust|order|edit/i.test(s)) { suggestedSheet = s; break; }
    }

    res.json({
      sheets,
      headers,
      sampleRows,
      detectedHeaderRow: headerRowIdx + 1,
      detectedDataStartRow: headerRowIdx + 2,
      detectedColumns,
      detectedDropdowns,
      suggestedSheet
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/revisions/compare-spreadsheet
 * Upload a vendor spreadsheet and compare against internal orders
 */
router.post('/compare-spreadsheet', authorizeRoles('admin', 'buyer'), upload.single('file'), async (req, res) => {
  try {
    const { brandId, seasonId } = req.body;

    if (!req.file) return res.status(400).json({ error: 'File is required' });
    if (!brandId) return res.status(400).json({ error: 'brandId is required' });

    // Load template
    let template = null;
    const tRes = await pool.query(
      'SELECT * FROM brand_order_templates WHERE brand_id = $1 AND active = true ORDER BY updated_at DESC LIMIT 1',
      [brandId]
    );
    if (tRes.rows.length > 0) template = tRes.rows[0];

    // Parse Excel
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    let sheetName = workbook.SheetNames[0];
    if (template?.sheet_name) {
      const match = workbook.SheetNames.find(s => s.toLowerCase() === template.sheet_name.toLowerCase());
      if (match) sheetName = match;
    }
    const worksheet = workbook.Sheets[sheetName];
    const allData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    const columns = template?.column_mappings || {};
    const headerRow = (template?.header_row || 1) - 1;
    const dataStartRow = (template?.data_start_row || 2) - 1;
    const headers = allData[headerRow] || [];

    // Find UPC column
    let upcCol = columns.upc != null ? columns.upc - 1 : -1;
    if (upcCol < 0) upcCol = headers.findIndex(h => h && /upc|barcode|ean/i.test(h.toString()));
    if (upcCol < 0) return res.status(400).json({ error: 'Could not find UPC column', headers: headers.filter(Boolean) });

    // Find location + qty columns
    let locationCol = columns.ship_to_location != null ? columns.ship_to_location - 1 : -1;
    if (locationCol < 0) locationCol = headers.findIndex(h => h && /location|ship.?to|dealer/i.test(h.toString()));
    let orderedCol = columns.ordered != null ? columns.ordered - 1 : -1;
    let committedCol = columns.committed != null ? columns.committed - 1 : -1;

    // Location mapping
    const locationMapping = template?.location_mapping || {};
    const resolveLocationId = (locName) => {
      if (!locName) return null;
      if (locationMapping[locName]) return locationMapping[locName];
      const lower = locName.toLowerCase();
      if (lower.includes('salt lake') || lower.includes('slc')) return 1;
      if (lower.includes('south main') || lower.includes('millcreek')) return 2;
      if (lower.includes('ogden')) return 3;
      return null;
    };

    // Parse vendor items
    const vendorItems = [];
    for (let r = dataStartRow; r < allData.length; r++) {
      const row = allData[r];
      const upc = row[upcCol]?.toString().trim();
      if (!upc) continue;
      const location = locationCol >= 0 ? row[locationCol]?.toString().trim() : null;
      const locationId = resolveLocationId(location);
      const vendorQty = committedCol >= 0 ? (parseInt(row[committedCol]) || 0) : (orderedCol >= 0 ? (parseInt(row[orderedCol]) || 0) : 0);
      vendorItems.push({ upc, location, locationId, vendorQty });
    }

    // Get system order items for this brand/season
    let systemQuery = `
      SELECT oi.id, p.upc, p.name AS product_name, p.size, p.color,
             oi.quantity, COALESCE(oi.adjusted_quantity, oi.quantity) AS current_qty,
             oi.vendor_decision, o.location_id, l.name AS location_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      JOIN locations l ON o.location_id = l.id
      WHERE o.brand_id = $1
    `;
    const params = [brandId];
    if (seasonId) { systemQuery += ' AND o.season_id = $2'; params.push(seasonId); }

    const systemResult = await pool.query(systemQuery, params);

    // Build system lookup: upc+locationId -> item
    const systemMap = {};
    for (const item of systemResult.rows) {
      const key = `${item.upc}|${item.location_id}`;
      if (!systemMap[key]) systemMap[key] = item;
    }

    // Look up product details for vendor UPCs
    const vendorUPCs = [...new Set(vendorItems.map(v => v.upc))];
    const productMap = {};
    if (vendorUPCs.length > 0) {
      const placeholders = vendorUPCs.map((_, i) => `$${i + 1}`).join(',');
      const prodRes = await pool.query(`SELECT upc, name, size, color FROM products WHERE upc IN (${placeholders})`, vendorUPCs);
      for (const p of prodRes.rows) { if (p.upc) productMap[p.upc] = p; }
    }

    // Compare
    const matched = [];
    const qtyMismatches = [];
    const vendorOnly = [];
    const vendorSeen = new Set();

    for (const v of vendorItems) {
      const key = v.locationId ? `${v.upc}|${v.locationId}` : null;
      const systemItem = key ? systemMap[key] : null;
      const product = productMap[v.upc] || {};

      if (systemItem) {
        vendorSeen.add(key);
        const systemQty = systemItem.current_qty;
        if (v.vendorQty !== systemQty) {
          qtyMismatches.push({
            upc: v.upc,
            productName: systemItem.product_name || product.name,
            size: systemItem.size || product.size,
            location: v.location || systemItem.location_name,
            vendorQty: v.vendorQty,
            systemQty,
            diff: v.vendorQty - systemQty,
            vendorDecision: systemItem.vendor_decision
          });
        } else {
          matched.push({ upc: v.upc, productName: systemItem.product_name, qty: systemQty });
        }
      } else {
        vendorOnly.push({
          upc: v.upc,
          productName: product.name || null,
          size: product.size || null,
          location: v.location,
          vendorQty: v.vendorQty
        });
      }
    }

    // System items not in vendor form
    const systemOnly = [];
    for (const [key, item] of Object.entries(systemMap)) {
      if (!vendorSeen.has(key) && item.current_qty > 0) {
        systemOnly.push({
          upc: item.upc,
          productName: item.product_name,
          size: item.size,
          color: item.color,
          location: item.location_name,
          systemQty: item.current_qty,
          vendorDecision: item.vendor_decision
        });
      }
    }

    res.json({
      summary: {
        vendorItems: vendorItems.length,
        matched: matched.length,
        qtyMismatches: qtyMismatches.length,
        vendorOnly: vendorOnly.length,
        systemOnly: systemOnly.length
      },
      matched,
      qtyMismatches,
      vendorOnly,
      systemOnly
    });
  } catch (error) {
    console.error('Compare spreadsheet error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/revisions/reconcile
 * Compare brand order spreadsheet against system orders and optionally sync.
 * Brand order takes precedence — quantities are updated to match, items only
 * in the brand order are flagged, items only in system are flagged for removal.
 * Run this BEFORE the revision logic so the system reflects the brand's actual order.
 */
router.post('/reconcile', authorizeRoles('admin', 'buyer'), upload.single('file'), async (req, res) => {
  try {
    const { brandId, seasonId, orderIds: orderIdsRaw, dryRun, pastedText, columnOverrides: columnOverridesRaw } = req.body;

    if (!req.file && !pastedText) return res.status(400).json({ error: 'File or pasted text is required' });
    if (!brandId) return res.status(400).json({ error: 'brandId is required' });

    const orderIds = orderIdsRaw ? JSON.parse(orderIdsRaw) : [];
    const isDryRun = dryRun === 'false' ? false : true;
    const isPdf = req.file && (req.file.originalname.toLowerCase().endsWith('.pdf') ||
                  req.file.mimetype === 'application/pdf');
    const isPaste = !req.file && !!pastedText;

    // Load template
    let template = null;
    const tRes = await pool.query(
      'SELECT * FROM brand_order_templates WHERE brand_id = $1 AND active = true ORDER BY updated_at DESC LIMIT 1',
      [brandId]
    );
    if (tRes.rows.length > 0) template = tRes.rows[0];

    // Location mapping
    const locationMapping = template?.location_mapping || {};
    const resolveLocationId = (locName) => {
      if (!locName) return null;
      if (locationMapping[locName]) return locationMapping[locName];
      const lower = locName.toLowerCase();
      if (lower.includes('salt lake') || lower.includes('slc')) return 1;
      if (lower.includes('south main') || lower.includes('millcreek')) return 2;
      if (lower.includes('ogden')) return 3;
      return null;
    };

    let brandItems = [];

    if (isPaste) {
      // --- Pasted text parsing ---
      // Priority: user column overrides > brand template > auto-detect
      const overrides = columnOverridesRaw ? JSON.parse(columnOverridesRaw) : {};
      const columns = template?.column_mappings || {};

      // User overrides are already 0-based; template values are 1-based
      const tplUpcCol = overrides.upc != null ? overrides.upc : (columns.upc != null ? columns.upc - 1 : -1);
      const tplLocCol = overrides.location != null ? overrides.location : (columns.ship_to_location != null ? columns.ship_to_location - 1 : -1);
      const tplQtyCol = overrides.qty != null ? overrides.qty : (columns.committed != null ? columns.committed - 1 : (columns.ordered != null ? columns.ordered - 1 : -1));
      const hasColumns = tplUpcCol >= 0;
      const dataStartRow = (template?.data_start_row || 1) - 1;

      // Split on newlines, tokenize each line by tabs, pipes, or 2+ spaces
      const lines = pastedText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const tokenize = (line) => line.split(/\t|(?:\s{2,})|\|/).map(s => s.trim()).filter(Boolean);

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        // Skip header rows if template says data starts later
        if (hasColumns && lineIdx < dataStartRow) continue;

        const tokens = tokenize(lines[lineIdx]);
        let upc = null, upcTokenIdx = -1;
        let location = null;
        let qty = 0;

        if (hasColumns) {
          // Use template column positions
          if (tplUpcCol >= 0 && tplUpcCol < tokens.length) {
            const cleaned = tokens[tplUpcCol].replace(/[^0-9]/g, '');
            if (/^\d{8,14}$/.test(cleaned)) { upc = cleaned; upcTokenIdx = tplUpcCol; }
          }
          if (!upc) continue;

          if (tplLocCol >= 0 && tplLocCol < tokens.length) {
            location = tokens[tplLocCol];
          }
          if (tplQtyCol >= 0 && tplQtyCol < tokens.length) {
            qty = parseInt(tokens[tplQtyCol]) || 0;
          }
        } else {
          // Auto-detect: find UPC token (8-14 digits)
          for (let i = 0; i < tokens.length; i++) {
            const cleaned = tokens[i].replace(/[^0-9]/g, '');
            if (/^\d{8,14}$/.test(cleaned)) {
              upc = cleaned; upcTokenIdx = i; break;
            }
          }
          if (!upc) continue;

          // Auto-detect location
          for (let i = 0; i < tokens.length; i++) {
            if (i === upcTokenIdx) continue;
            const lower = tokens[i].toLowerCase();
            if (lower.includes('slc') || lower.includes('salt lake') ||
                lower.includes('south main') || lower.includes('millcreek') ||
                lower.includes('ogden')) {
              location = tokens[i]; break;
            }
          }

          // Auto-detect qty: last small numeric token that isn't the UPC
          for (let i = tokens.length - 1; i >= 0; i--) {
            if (i === upcTokenIdx) continue;
            const num = parseInt(tokens[i]);
            if (!isNaN(num) && num >= 0 && num < 10000 && tokens[i].trim().length <= 5) {
              qty = num; break;
            }
          }
        }

        // Also check location against template's location_mapping keys
        if (!location) {
          for (let i = 0; i < tokens.length; i++) {
            if (i === upcTokenIdx) continue;
            if (locationMapping[tokens[i]]) { location = tokens[i]; break; }
          }
        }

        const locationId = resolveLocationId(location);
        brandItems.push({ upc, location, locationId, qty, rowIndex: lineIdx });
      }

      if (brandItems.length === 0) {
        return res.status(400).json({
          error: 'Could not find UPC numbers in pasted text. Paste rows containing UPCs, locations, and quantities.',
          lineCount: lines.length,
          sampleLines: lines.slice(0, 5),
        });
      }
    } else if (isPdf) {
      // --- PDF parsing ---
      const parsed = await parsePdfToRows(req.file.buffer);

      if (parsed.rows.length === 0) {
        return res.status(400).json({
          error: 'Could not extract table data from PDF. Make sure it contains UPC numbers.',
          rawLineCount: parsed.rawLines.length,
          sampleLines: parsed.rawLines.slice(0, 10),
        });
      }

      // Find column positions in PDF header or auto-detect from data
      const pdfHeaders = parsed.headers.map(h => h.toLowerCase());
      let upcIdx = pdfHeaders.findIndex(h => /upc|barcode|ean|item.?code/.test(h));
      let locIdx = pdfHeaders.findIndex(h => /location|ship.?to|dealer|store/.test(h));
      let qtyIdx = pdfHeaders.findIndex(h => /qty|quantity|ordered|committed|units/.test(h));

      for (const row of parsed.rows) {
        // Find UPC token: 8-14 digit number
        let upc = null, upcTokenIdx = -1;
        for (let i = 0; i < row.length; i++) {
          const cleaned = row[i].replace(/[^0-9]/g, '');
          if (/^\d{8,14}$/.test(cleaned)) {
            // Prefer the column we identified as UPC, otherwise take first match
            if (upcIdx >= 0 && i === upcIdx) { upc = cleaned; upcTokenIdx = i; break; }
            if (!upc) { upc = cleaned; upcTokenIdx = i; }
          }
        }
        if (!upc) continue;

        // Find location token
        let location = null;
        if (locIdx >= 0 && locIdx < row.length) {
          location = row[locIdx];
        } else {
          // Scan for known location names
          for (let i = 0; i < row.length; i++) {
            if (i === upcTokenIdx) continue;
            const lower = row[i].toLowerCase();
            if (lower.includes('slc') || lower.includes('salt lake') ||
                lower.includes('south main') || lower.includes('millcreek') ||
                lower.includes('ogden')) {
              location = row[i];
              break;
            }
          }
        }

        // Find qty token
        let qty = 0;
        if (qtyIdx >= 0 && qtyIdx < row.length) {
          qty = parseInt(row[qtyIdx]) || 0;
        } else {
          // Take the last numeric token that isn't the UPC and looks like a small qty
          for (let i = row.length - 1; i >= 0; i--) {
            if (i === upcTokenIdx) continue;
            const num = parseInt(row[i]);
            if (!isNaN(num) && num >= 0 && num < 10000 && row[i].trim().length <= 5) {
              qty = num;
              break;
            }
          }
        }

        const locationId = resolveLocationId(location);
        brandItems.push({ upc, location, locationId, qty, rowIndex: parsed.rows.indexOf(row) });
      }

      if (brandItems.length === 0) {
        return res.status(400).json({
          error: 'Found table rows in PDF but could not extract UPC + quantity pairs.',
          extractedRows: parsed.rows.length,
          sampleRows: parsed.rows.slice(0, 5),
        });
      }
    } else {
      // --- Excel/CSV parsing ---
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      let sheetName = workbook.SheetNames[0];
      if (template?.sheet_name) {
        const match = workbook.SheetNames.find(s => s.toLowerCase() === template.sheet_name.toLowerCase());
        if (match) sheetName = match;
      }
      const worksheet = workbook.Sheets[sheetName];
      const allData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

      const columns = template?.column_mappings || {};
      const headerRow = (template?.header_row || 1) - 1;
      const dataStartRow = (template?.data_start_row || 2) - 1;
      const headers = allData[headerRow] || [];

      // Find UPC column
      let upcCol = columns.upc != null ? columns.upc - 1 : -1;
      if (upcCol < 0) upcCol = headers.findIndex(h => h && /upc|barcode|ean/i.test(h.toString()));
      if (upcCol < 0) return res.status(400).json({ error: 'Could not find UPC column', headers: headers.filter(Boolean) });

      // Find location + qty columns
      let locationCol = columns.ship_to_location != null ? columns.ship_to_location - 1 : -1;
      if (locationCol < 0) locationCol = headers.findIndex(h => h && /location|ship.?to|dealer/i.test(h.toString()));
      let orderedCol = columns.ordered != null ? columns.ordered - 1 : -1;
      let committedCol = columns.committed != null ? columns.committed - 1 : -1;

      for (let r = dataStartRow; r < allData.length; r++) {
        const row = allData[r];
        const upc = row[upcCol]?.toString().trim();
        if (!upc) continue;
        const location = locationCol >= 0 ? row[locationCol]?.toString().trim() : null;
        const locationId = resolveLocationId(location);
        const qty = committedCol >= 0 ? (parseInt(row[committedCol]) || 0) : (orderedCol >= 0 ? (parseInt(row[orderedCol]) || 0) : 0);
        brandItems.push({ upc, location, locationId, qty, rowIndex: r });
      }
    }

    // Get system order items for the selected orders (or all orders for this brand/season)
    let systemQuery, systemParams;
    if (orderIds.length > 0) {
      const placeholders = orderIds.map((_, i) => `$${i + 1}`).join(',');
      systemQuery = `
        SELECT oi.id AS order_item_id, oi.order_id, oi.product_id,
               oi.quantity, COALESCE(oi.adjusted_quantity, oi.quantity) AS current_qty,
               oi.unit_cost, oi.vendor_decision,
               p.upc, p.name AS product_name, p.size, p.color,
               o.location_id, l.name AS location_name
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        JOIN orders o ON oi.order_id = o.id
        JOIN locations l ON o.location_id = l.id
        WHERE oi.order_id IN (${placeholders})
        ORDER BY o.location_id, p.name, p.size
      `;
      systemParams = orderIds;
    } else {
      systemQuery = `
        SELECT oi.id AS order_item_id, oi.order_id, oi.product_id,
               oi.quantity, COALESCE(oi.adjusted_quantity, oi.quantity) AS current_qty,
               oi.unit_cost, oi.vendor_decision,
               p.upc, p.name AS product_name, p.size, p.color,
               o.location_id, l.name AS location_name
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        JOIN orders o ON oi.order_id = o.id
        JOIN locations l ON o.location_id = l.id
        WHERE o.brand_id = $1 ${seasonId ? 'AND o.season_id = $2' : ''}
        ORDER BY o.location_id, p.name, p.size
      `;
      systemParams = seasonId ? [brandId, seasonId] : [brandId];
    }

    const systemResult = await pool.query(systemQuery, systemParams);

    // Build system lookup: upc+locationId -> item
    const systemMap = {};
    for (const item of systemResult.rows) {
      const key = `${item.upc}|${item.location_id}`;
      if (!systemMap[key]) systemMap[key] = item;
    }

    // Look up product info for brand UPCs we don't already know
    const brandUPCs = [...new Set(brandItems.map(v => v.upc))];
    const productMap = {};
    if (brandUPCs.length > 0) {
      const placeholders = brandUPCs.map((_, i) => `$${i + 1}`).join(',');
      const prodRes = await pool.query(`SELECT id, upc, name, size, color FROM products WHERE upc IN (${placeholders})`, brandUPCs);
      for (const p of prodRes.rows) { if (p.upc) productMap[p.upc] = p; }
    }

    // Build reverse lookup: upc -> [keys] for matching without location
    const upcToKeys = {};
    for (const key of Object.keys(systemMap)) {
      const upc = key.split('|')[0];
      if (!upcToKeys[upc]) upcToKeys[upc] = [];
      upcToKeys[upc].push(key);
    }

    // Compare
    const matched = [];       // same qty
    const qtyChanges = [];    // brand has different qty
    const brandOnly = [];     // in brand order but not system
    const systemOnly = [];    // in system but not brand order
    const brandSeen = new Set();

    for (const b of brandItems) {
      const product = productMap[b.upc] || {};

      // Find matching system items:
      // If brand item has a location, match exactly.
      // If no location, match all system items with that UPC.
      let matchKeys = [];
      if (b.locationId) {
        const key = `${b.upc}|${b.locationId}`;
        if (systemMap[key]) matchKeys = [key];
      } else {
        matchKeys = upcToKeys[b.upc] || [];
      }

      if (matchKeys.length > 0) {
        for (const key of matchKeys) {
          const systemItem = systemMap[key];
          brandSeen.add(key);
          if (b.qty !== systemItem.current_qty) {
            qtyChanges.push({
              orderItemId: systemItem.order_item_id,
              orderId: systemItem.order_id,
              productId: systemItem.product_id,
              upc: b.upc,
              productName: systemItem.product_name || product.name,
              size: systemItem.size || product.size,
              color: systemItem.color || product.color,
              location: b.location || systemItem.location_name,
              locationId: systemItem.location_id,
              brandQty: b.qty,
              systemQty: systemItem.current_qty,
              diff: b.qty - systemItem.current_qty,
            });
          } else {
            matched.push({
              upc: b.upc,
              productName: systemItem.product_name,
              size: systemItem.size,
              location: systemItem.location_name,
              qty: systemItem.current_qty,
            });
          }
        }
      } else {
        brandOnly.push({
          upc: b.upc,
          productName: product.name || null,
          productId: product.id || null,
          size: product.size || null,
          color: product.color || null,
          location: b.location,
          locationId: b.locationId,
          brandQty: b.qty,
        });
      }
    }

    // System items not in brand order
    for (const [key, item] of Object.entries(systemMap)) {
      if (!brandSeen.has(key) && item.current_qty > 0) {
        systemOnly.push({
          orderItemId: item.order_item_id,
          orderId: item.order_id,
          upc: item.upc,
          productName: item.product_name,
          size: item.size,
          color: item.color,
          location: item.location_name,
          locationId: item.location_id,
          systemQty: item.current_qty,
        });
      }
    }

    // If not dry run, apply brand's order as source of truth
    const applied = { qtyUpdated: 0, systemItemsCancelled: 0, itemsAdded: 0 };
    if (!isDryRun) {
      // Build order lookup by location for inserting brand-only items
      const orderByLocation = {};
      for (const item of systemResult.rows) {
        if (!orderByLocation[item.location_id]) {
          orderByLocation[item.location_id] = item.order_id;
        }
      }
      // Fallback: if we have selected orderIds, map them to locations
      if (orderIds.length > 0 && Object.keys(orderByLocation).length === 0) {
        const orderLocRes = await pool.query(
          `SELECT id, location_id FROM orders WHERE id = ANY($1::int[])`, [orderIds]
        );
        for (const row of orderLocRes.rows) {
          orderByLocation[row.location_id] = row.id;
        }
      }
      const fallbackOrderId = orderIds[0] || Object.values(orderByLocation)[0];

      // Get product prices for brand-only items we need to insert
      const brandOnlyProductIds = brandOnly.filter(b => b.productId).map(b => b.productId);
      const priceMap = {};
      if (brandOnlyProductIds.length > 0) {
        const pricePlaceholders = brandOnlyProductIds.map((_, i) => `$${i + 1}`).join(',');
        const priceRes = await pool.query(
          `SELECT id, wholesale_cost FROM products WHERE id IN (${pricePlaceholders})`,
          brandOnlyProductIds
        );
        for (const p of priceRes.rows) priceMap[p.id] = parseFloat(p.wholesale_cost) || 0;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Update quantities where brand differs
        for (const change of qtyChanges) {
          await client.query(
            `UPDATE order_items SET quantity = $1, adjusted_quantity = $1 WHERE id = $2`,
            [change.brandQty, change.orderItemId]
          );
          applied.qtyUpdated++;
        }

        // Cancel system-only items (brand removed them)
        for (const item of systemOnly) {
          await client.query(
            `UPDATE order_items SET adjusted_quantity = 0, vendor_decision = 'cancel', receipt_status = 'cancelled' WHERE id = $1`,
            [item.orderItemId]
          );
          applied.systemItemsCancelled++;
        }

        // Add brand-only items as new order_items (if product exists in our system)
        for (const item of brandOnly) {
          if (!item.productId || item.brandQty <= 0) continue;
          const targetOrderId = (item.locationId && orderByLocation[item.locationId])
            ? orderByLocation[item.locationId]
            : fallbackOrderId;
          if (!targetOrderId) continue;

          const unitCost = priceMap[item.productId] || 0;
          await client.query(
            `INSERT INTO order_items (order_id, product_id, quantity, adjusted_quantity, unit_cost, line_total)
             VALUES ($1, $2, $3, $3, $4, $5)`,
            [targetOrderId, item.productId, item.brandQty, unitCost, unitCost * item.brandQty]
          );
          applied.itemsAdded++;
        }

        // Update order timestamps
        const affectedOrderIds = new Set([
          ...qtyChanges.map(c => c.orderId),
          ...systemOnly.map(s => s.orderId),
          ...(applied.itemsAdded > 0 ? Object.values(orderByLocation) : []),
        ]);
        for (const oid of affectedOrderIds) {
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
      dryRun: isDryRun,
      summary: {
        brandItems: brandItems.length,
        matched: matched.length,
        qtyChanges: qtyChanges.length,
        brandOnly: brandOnly.length,
        systemOnly: systemOnly.length,
      },
      matched,
      qtyChanges,
      brandOnly,
      systemOnly,
      ...(isDryRun ? {} : { applied }),
    });
  } catch (error) {
    console.error('Reconcile error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/revisions/spreadsheet
 * Upload a vendor spreadsheet, run revision logic, fill in decisions, return modified file.
 * Also returns a JSON summary for the UI preview.
 */
router.post('/spreadsheet', authorizeRoles('admin', 'buyer'), upload.single('file'), async (req, res) => {
  try {
    const { brandId, templateId, dryRun } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }
    if (!brandId) {
      return res.status(400).json({ error: 'brandId is required' });
    }
    if (!bigquery) {
      return res.status(503).json({ error: 'BigQuery is not available' });
    }

    // Load template for this brand
    let template = null;
    if (templateId) {
      const tRes = await pool.query('SELECT * FROM brand_order_templates WHERE id = $1', [templateId]);
      if (tRes.rows.length > 0) template = tRes.rows[0];
    }
    if (!template) {
      const tRes = await pool.query(
        'SELECT * FROM brand_order_templates WHERE brand_id = $1 AND active = true ORDER BY updated_at DESC LIMIT 1',
        [brandId]
      );
      if (tRes.rows.length > 0) template = tRes.rows[0];
    }

    // Parse the uploaded Excel
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });

    // Find the right sheet
    let sheetName = workbook.SheetNames[0];
    if (template && template.sheet_name) {
      const match = workbook.SheetNames.find(s => s.toLowerCase() === template.sheet_name.toLowerCase());
      if (match) sheetName = match;
    }
    const worksheet = workbook.Sheets[sheetName];
    const allData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    // Determine column positions from template or auto-detect
    const columns = template?.column_mappings || {};
    const fillRules = template?.fill_rules || {};
    const dropdownOpts = template?.dropdown_options || {};
    const headerRow = (template?.header_row || 1) - 1; // Convert to 0-indexed
    const dataStartRow = (template?.data_start_row || 2) - 1;
    const headers = allData[headerRow] || [];

    // Find UPC column
    let upcCol = columns.upc != null ? columns.upc - 1 : -1; // template columns are 1-indexed
    if (upcCol < 0) {
      upcCol = headers.findIndex(h => h && /upc|barcode|ean/i.test(h.toString()));
    }
    if (upcCol < 0) {
      return res.status(400).json({ error: 'Could not find UPC column', headers: headers.filter(Boolean), sheetNames: workbook.SheetNames });
    }

    // Find location column (optional)
    let locationCol = columns.ship_to_location != null ? columns.ship_to_location - 1 : -1;
    if (locationCol < 0) {
      locationCol = headers.findIndex(h => h && /location|ship.?to|dealer/i.test(h.toString()));
    }

    // Find quantity/decision columns to fill
    let qtyAdjCol = columns.quantity_adjustment != null ? columns.quantity_adjustment - 1 : -1;
    let shipCancelCol = columns.ship_cancel != null ? columns.ship_cancel - 1 : -1;
    let orderedCol = columns.ordered != null ? columns.ordered - 1 : -1;
    let committedCol = columns.committed != null ? columns.committed - 1 : -1;

    // Collect all UPCs from the spreadsheet
    const rowUPCs = [];
    for (let r = dataStartRow; r < allData.length; r++) {
      const row = allData[r];
      const upc = row[upcCol]?.toString().trim();
      if (!upc) continue;
      const location = locationCol >= 0 ? row[locationCol]?.toString().trim() : null;
      const orderedQty = orderedCol >= 0 ? parseInt(row[orderedCol]) || 0 : 0;
      const committedQty = committedCol >= 0 ? parseInt(row[committedCol]) || 0 : 0;
      rowUPCs.push({ rowIndex: r, upc, location, orderedQty, committedQty });
    }

    if (rowUPCs.length === 0) {
      return res.status(400).json({ error: 'No data rows with UPCs found in the spreadsheet' });
    }

    // Look up product details by UPC
    const uniqueUPCs = [...new Set(rowUPCs.map(r => r.upc))];
    const productMap = {};
    if (uniqueUPCs.length > 0) {
      const upcPlaceholders = uniqueUPCs.map((_, i) => `$${i + 1}`).join(',');
      const prodResult = await pool.query(
        `SELECT upc, name, color, size FROM products WHERE upc IN (${upcPlaceholders})`,
        uniqueUPCs
      );
      for (const row of prodResult.rows) {
        if (row.upc) productMap[row.upc] = { name: row.name, color: row.color, size: row.size };
      }
    }

    // Bulk fetch on-hand from BigQuery
    const upcList = uniqueUPCs.map(u => `'${u}'`).join(',');

    const [bqRows] = await bigquery.query({
      query: `
        SELECT DISTINCT i.barcode AS upc, i.facility_id, i.on_hand_qty
        FROM \`front-data-production.dataform.INVENTORY_on_hand_report\` i
        WHERE i.barcode IN (${upcList}) AND i.facility_id IN (41185, 1003, 1000)
      `
    });

    const inventoryMap = {};
    for (const row of bqRows) {
      const locId = FACILITY_TO_LOCATION[String(row.facility_id)];
      if (locId) inventoryMap[`${row.upc}|${locId}`] = parseInt(row.on_hand_qty) || 0;
    }

    // Fetch sales data (last 90 days)
    const salesMap = {};
    try {
      const [salesRows] = await bigquery.query({
        query: `
          SELECT p.BARCODE AS upc, p.facility_id_true AS facility_id,
            SUM(ii.QUANTITY) AS qty_sold, COUNT(DISTINCT i.invoice_concat) AS txns
          FROM \`front-data-production.rgp_cleaned_zone.invoice_items_all\` ii
          JOIN \`front-data-production.rgp_cleaned_zone.invoices_all\` i ON ii.invoice_concat = i.invoice_concat
          JOIN \`front-data-production.rgp_cleaned_zone.products_all\` p ON ii.product_concat = p.product_concat
          WHERE DATE(i.POSTDATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
            AND ii.QUANTITY > 0 AND p.BARCODE IN (${upcList})
            AND p.facility_id_true IN (41185, 1003, 1000)
          GROUP BY p.BARCODE, p.facility_id_true
        `
      });
      for (const row of salesRows) {
        const locId = FACILITY_TO_LOCATION[String(row.facility_id)];
        if (locId) salesMap[`${row.upc}|${locId}`] = { qtySold: parseInt(row.qty_sold) || 0, txns: parseInt(row.txns) || 0 };
      }
    } catch (e) { /* non-fatal */ }

    // Match UPCs to internal order items
    const orderItemMap = {};
    if (uniqueUPCs.length > 0) {
      const upcPlaceholders = uniqueUPCs.map((_, i) => `$${i + 2}`).join(',');
      const oiResult = await pool.query(
        `SELECT oi.id AS order_item_id, oi.order_id, oi.quantity, p.upc, o.location_id
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         JOIN orders o ON oi.order_id = o.id
         WHERE o.brand_id = $1 AND p.upc IN (${upcPlaceholders})`,
        [brandId, ...uniqueUPCs]
      );
      for (const row of oiResult.rows) {
        const key = `${row.upc}|${row.location_id}`;
        if (!orderItemMap[key]) orderItemMap[key] = row;
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
        if (row.value?.upc) discontinuedUPCs.add(String(row.value.upc));
        if (row.value?.upcs) row.value.upcs.forEach(u => discontinuedUPCs.add(String(u)));
      }
    } catch (e) { /* */ }

    // Location name → ID mapping (from template or defaults)
    const locationMapping = template?.location_mapping || {};
    const resolveLocationId = (locName) => {
      if (!locName) return null;
      if (locationMapping[locName]) return locationMapping[locName];
      const lower = locName.toLowerCase();
      if (lower.includes('salt lake') || lower.includes('slc')) return 1;
      if (lower.includes('south main') || lower.includes('millcreek')) return 2;
      if (lower.includes('ogden')) return 3;
      return null;
    };

    // Get dropdown values from template
    const shipCancelOptions = dropdownOpts.ship_cancel || [];
    const getShipValue = () => shipCancelOptions.find(o => /ship.*asap/i.test(o)) || 'Ship Product(s) ASAP';
    const getKeepOpenValue = () => shipCancelOptions.find(o => /keep.*open|b.*o/i.test(o)) || 'Keep Open - B/O';
    const getCancelValue = () => shipCancelOptions.find(o => /cancel/i.test(o)) || 'Cancel Product(s)';

    // Process each row
    const decisions = [];
    let shipCount = 0, cancelCount = 0;

    for (const item of rowUPCs) {
      const locId = resolveLocationId(item.location);
      const invKey = locId ? `${item.upc}|${locId}` : null;
      const onHand = invKey ? (inventoryMap[invKey] || 0) : 0;
      const sales = invKey ? (salesMap[invKey] || null) : null;
      const isDiscontinued = discontinuedUPCs.has(item.upc.toLowerCase());
      const hasRecentSales = sales && sales.qtySold > 0;
      const receivedNotInventoried = onHand <= 0 && hasRecentSales;

      let decision, adjustedQty, reason, shipCancelValue;

      if (isDiscontinued) {
        decision = 'cancel'; adjustedQty = 0; reason = 'discontinued_product';
        shipCancelValue = getCancelValue(); cancelCount++;
      } else if (onHand > 0) {
        decision = 'cancel'; adjustedQty = 0; reason = 'positive_stock_cancel';
        shipCancelValue = getCancelValue(); cancelCount++;
      } else if (receivedNotInventoried) {
        decision = 'cancel'; adjustedQty = 0; reason = 'received_not_inventoried';
        shipCancelValue = getCancelValue(); cancelCount++;
      } else {
        decision = 'ship'; adjustedQty = item.committedQty || item.orderedQty || 1; reason = 'zero_stock';
        shipCancelValue = item.committedQty > 0 ? getShipValue() : getKeepOpenValue(); shipCount++;
      }

      const product = productMap[item.upc] || {};
      const oiKey = locId ? `${item.upc}|${locId}` : null;
      const orderItem = oiKey ? (orderItemMap[oiKey] || null) : null;

      decisions.push({
        rowIndex: item.rowIndex,
        orderItemId: orderItem?.order_item_id || null,
        orderId: orderItem?.order_id || null,
        upc: item.upc,
        productName: product.name || null,
        color: product.color || null,
        size: product.size || null,
        location: item.location,
        locationId: locId,
        orderedQty: item.orderedQty,
        committedQty: item.committedQty,
        onHand,
        decision,
        adjustedQty,
        reason,
        shipCancelValue,
        recentSales: sales,
        isDiscontinued,
        receivedNotInventoried
      });

    }

    const isDryRun = dryRun === 'true' || dryRun === true;

    if (isDryRun) {
      // Return JSON preview only
      return res.json({
        dryRun: true,
        sheetName,
        template: template ? { id: template.id, name: template.name } : null,
        columnsDetected: { upc: upcCol + 1, location: locationCol + 1, qtyAdj: qtyAdjCol + 1, shipCancel: shipCancelCol + 1 },
        summary: {
          totalItems: decisions.length,
          ship: shipCount,
          cancel: cancelCount,
          reductionPct: decisions.length > 0 ? parseFloat(((cancelCount / decisions.length) * 100).toFixed(1)) : 0
        },
        decisions
      });
    }

    // Use xlsx-populate to modify the original file (preserves all formatting)
    const popWorkbook = await XlsxPopulate.fromDataAsync(req.file.buffer);

    // Find the right sheet
    let popSheet = popWorkbook.sheets()[0];
    if (template?.sheet_name) {
      const match = popWorkbook.sheets().find(s => s.name().toLowerCase() === template.sheet_name.toLowerCase());
      if (match) popSheet = match;
    }

    // Write decisions into the specific cells only
    for (const d of decisions) {
      // xlsx-populate uses 1-based row/col indexing
      const row = d.rowIndex + 1; // rowIndex is 0-based from SheetJS
      if (qtyAdjCol >= 0) {
        popSheet.cell(row, qtyAdjCol + 1).value(d.adjustedQty);
      }
      if (shipCancelCol >= 0) {
        popSheet.cell(row, shipCancelCol + 1).value(d.shipCancelValue);
      }
    }

    const outputBuffer = await popWorkbook.outputAsync();

    // Use original filename
    const originalName = req.file.originalname || 'revised.xlsx';
    const filename = originalName.replace(/\.xlsx?$/i, '_revised.xlsx');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Revision-Summary', JSON.stringify({
      totalItems: decisions.length, ship: shipCount, cancel: cancelCount
    }));
    res.send(Buffer.from(outputBuffer));

  } catch (error) {
    console.error('Spreadsheet revision error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
