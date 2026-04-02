const { pool } = require('../db.js');
const crypto = require('crypto');

function formatCurrency(num) {
  if (num === null || num === undefined) return 'N/A';
  return '$' + parseFloat(num).toFixed(2);
}

/**
 * update_order_decisions: Push SHIP/CANCEL/Keep Open decisions to existing order items
 * Now logs all changes to adjustment_history and creates a revisions summary record.
 */
async function updateOrderDecisions(args) {
  const client = await pool.connect();
  try {
    const { orderId, decisions, revisionNotes, maxReductionPct } = args;
    if (!orderId || !decisions || !decisions.length) {
      return { content: [{ type: 'text', text: 'orderId and decisions array are required' }] };
    }

    await client.query('BEGIN');

    // Get order metadata for revision record
    const orderMeta = await client.query(
      'SELECT brand_id, season_id, location_id FROM orders WHERE id = $1', [orderId]
    );
    const brandId = orderMeta.rows.length > 0 ? orderMeta.rows[0].brand_id : null;
    const seasonId = orderMeta.rows.length > 0 ? orderMeta.rows[0].season_id : null;
    const locationId = orderMeta.rows.length > 0 ? orderMeta.rows[0].location_id : null;

    const revisionId = crypto.randomUUID();
    let shipped = 0, cancelled = 0, keepOpen = 0, errors = 0;
    let originalTotalQty = 0, adjustedTotalQty = 0;

    for (const d of decisions) {
      const { orderItemId, decision, adjustedQty, reason } = d;
      if (!orderItemId || !decision) { errors++; continue; }

      // Snapshot current values before overwriting
      const snapshot = await client.query(
        `SELECT oi.quantity, oi.adjusted_quantity, oi.vendor_decision,
                p.upc, p.name AS product_name, p.size
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.id = $1 AND oi.order_id = $2`,
        [orderItemId, orderId]
      );

      const normalizedDecision = decision.toLowerCase().replace(/[^a-z_]/g, '');
      let vendorDecision, adjQty, receiptStatus;

      if (normalizedDecision.includes('cancel')) {
        vendorDecision = 'cancel';
        adjQty = 0;
        receiptStatus = 'cancelled';
        cancelled++;
      } else if (normalizedDecision.includes('keep') || normalizedDecision.includes('bo')) {
        vendorDecision = 'keep_open_bo';
        adjQty = adjustedQty !== undefined ? adjustedQty : null;
        receiptStatus = 'backordered';
        keepOpen++;
      } else {
        vendorDecision = 'ship';
        adjQty = adjustedQty !== undefined ? adjustedQty : null;
        receiptStatus = 'pending';
        shipped++;
      }

      await client.query(`
        UPDATE order_items
        SET vendor_decision = $1,
            adjusted_quantity = COALESCE($2, quantity),
            receipt_status = $3,
            notes = COALESCE(notes, '') || ' [Decision: ' || $1 || ']'
        WHERE id = $4 AND order_id = $5
      `, [vendorDecision, adjQty, receiptStatus, orderItemId, orderId]);

      // Log to adjustment_history
      if (snapshot.rows.length > 0) {
        const s = snapshot.rows[0];
        const origQty = s.quantity || 0;
        const newQty = adjQty !== null ? adjQty : origQty;
        originalTotalQty += origQty;
        adjustedTotalQty += newQty;

        await client.query(`
          INSERT INTO adjustment_history (
            order_id, order_item_id, original_quantity, new_quantity,
            adjustment_type, reasoning,
            revision_id, brand_id, location_id,
            upc, product_name, size,
            decision, decision_reason,
            created_by, applied_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        `, [
          orderId, orderItemId, origQty, newQty,
          'revision', reason || revisionNotes || null,
          revisionId, brandId, locationId,
          s.upc, s.product_name, s.size,
          vendorDecision, reason || null,
          'ai_agent'
        ]);
      }
    }

    // Create revisions summary record
    const reductionPct = originalTotalQty > 0
      ? parseFloat((((originalTotalQty - adjustedTotalQty) / originalTotalQty) * 100).toFixed(2))
      : 0;

    await client.query(`
      INSERT INTO revisions (
        revision_id, brand_id, season_id, revision_type,
        total_items, ship_count, cancel_count, keep_open_count,
        original_total_qty, adjusted_total_qty, reduction_pct,
        max_reduction_pct, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    `, [
      revisionId, brandId, seasonId, 'monthly_adjustment',
      decisions.length - errors, shipped, cancelled, keepOpen,
      originalTotalQty, adjustedTotalQty, reductionPct,
      maxReductionPct || null, revisionNotes || null
    ]);

    // Update order timestamp
    await client.query(`UPDATE orders SET updated_at = NOW() WHERE id = $1`, [orderId]);

    await client.query('COMMIT');

    const text = `ORDER DECISIONS UPDATED\n` +
      `Order: ${orderId}\n` +
      `Revision ID: ${revisionId}\n` +
      `Total: ${decisions.length} items\n` +
      `  Ship: ${shipped}\n` +
      `  Cancel: ${cancelled}\n` +
      `  Keep Open B/O: ${keepOpen}\n` +
      (errors > 0 ? `  Errors: ${errors}\n` : '') +
      `Original Qty: ${originalTotalQty} → Adjusted: ${adjustedTotalQty} (${reductionPct}% reduction)\n`;

    return { content: [{ type: 'text', text }] };
  } catch (err) {
    await client.query('ROLLBACK');
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  } finally {
    client.release();
  }
}

/**
 * create_shipment: Record an inbound shipment (from email or manual)
 */
async function createShipment(args) {
  const client = await pool.connect();
  try {
    const { vendorName, brandId, orderId, trackingNumber, carrier, shipDate,
            invoiceNumber, invoiceDate, totalAmount, emailMessageId, lineItems, notes } = args;

    if (!vendorName) {
      return { content: [{ type: 'text', text: 'vendorName is required' }] };
    }

    await client.query('BEGIN');

    // Check idempotency if email-sourced
    if (emailMessageId) {
      const existing = await client.query(
        'SELECT id FROM email_message_cache WHERE email_message_id = $1', [emailMessageId]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return { content: [{ type: 'text', text: `Email already processed (cache id: ${existing.rows[0].id}). Skipping.` }] };
      }
    }

    const shipResult = await client.query(`
      INSERT INTO vendor_shipments
        (vendor_name, brand_id, order_id, tracking_number, carrier, ship_date,
         invoice_number, invoice_date, total_amount, email_message_id, source_type, status, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
    `, [vendorName, brandId || null, orderId || null, trackingNumber || null,
        carrier || null, shipDate || null, invoiceNumber || null, invoiceDate || null,
        totalAmount || null, emailMessageId || null,
        emailMessageId ? 'email' : 'manual', 'pending', notes || null]);

    const shipmentId = shipResult.rows[0].id;
    let matchedItems = 0;

    if (lineItems && lineItems.length > 0) {
      for (const item of lineItems) {
        // Try to match to order_item by UPC
        let orderItemId = item.orderItemId || null;
        let productId = null;

        if (!orderItemId && item.upc && orderId) {
          const match = await client.query(`
            SELECT oi.id, oi.product_id FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = $1 AND p.upc = $2
            LIMIT 1
          `, [orderId, item.upc]);
          if (match.rows.length > 0) {
            orderItemId = match.rows[0].id;
            productId = match.rows[0].product_id;
            matchedItems++;
          }
        }

        await client.query(`
          INSERT INTO shipment_line_items
            (shipment_id, order_item_id, product_id, upc, sku, product_name,
             size, color, quantity_shipped, quantity_backordered, unit_price, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [shipmentId, orderItemId, productId, item.upc || null, item.sku || null,
            item.productName || null, item.size || null, item.color || null,
            item.quantityShipped || 0, item.quantityBackordered || 0,
            item.unitPrice || null, 'pending']);
      }
    }

    // Cache the email if applicable
    if (emailMessageId) {
      await client.query(`
        INSERT INTO email_message_cache
          (email_message_id, sender_email, sender_name, subject, brand_id,
           shipment_id, is_shipping_notification, is_invoice)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (email_message_id) DO NOTHING
      `, [emailMessageId, args.senderEmail || null, args.senderName || null,
          args.emailSubject || null, brandId || null, shipmentId,
          !!trackingNumber, !!invoiceNumber]);
    }

    await client.query('COMMIT');

    const text = `SHIPMENT CREATED\n` +
      `Shipment ID: ${shipmentId}\n` +
      `Vendor: ${vendorName}\n` +
      (trackingNumber ? `Tracking: ${trackingNumber}\n` : '') +
      (invoiceNumber ? `Invoice: ${invoiceNumber}\n` : '') +
      (lineItems ? `Line Items: ${lineItems.length} (${matchedItems} matched to order)\n` : '') +
      `Status: pending`;

    return { content: [{ type: 'text', text }] };
  } catch (err) {
    await client.query('ROLLBACK');
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  } finally {
    client.release();
  }
}

/**
 * update_receipt_status: Mark items as received/backordered
 */
async function updateReceiptStatus(args) {
  const client = await pool.connect();
  try {
    const { shipmentId, items } = args;

    if (!shipmentId && (!items || !items.length)) {
      return { content: [{ type: 'text', text: 'shipmentId or items array is required' }] };
    }

    await client.query('BEGIN');
    let received = 0, backordered = 0;

    if (shipmentId) {
      // Bulk receive all items in a shipment
      const lineItems = await client.query(
        'SELECT id, order_item_id, quantity_shipped, quantity_backordered FROM shipment_line_items WHERE shipment_id = $1',
        [shipmentId]
      );

      for (const li of lineItems.rows) {
        if (li.order_item_id) {
          const status = li.quantity_backordered > 0 ? 'partial' : 'received';
          await client.query(`
            UPDATE order_items SET
              received_quantity = COALESCE(received_quantity, 0) + $1,
              backordered_quantity = $2,
              receipt_status = $3,
              received_date = NOW()
            WHERE id = $4
          `, [li.quantity_shipped, li.quantity_backordered, status, li.order_item_id]);

          await client.query(
            `UPDATE shipment_line_items SET status = $1, updated_at = NOW() WHERE id = $2`,
            [status, li.id]
          );

          if (status === 'received') received++;
          else backordered++;
        }
      }

      // Update shipment status
      const allStatus = backordered > 0 ? 'partial' : 'received';
      await client.query(
        `UPDATE vendor_shipments SET status = $1, updated_at = NOW() WHERE id = $2`,
        [allStatus, shipmentId]
      );
    } else if (items) {
      for (const item of items) {
        const { orderItemId, quantityReceived, status } = item;
        if (!orderItemId) continue;

        const receiptStatus = status || (quantityReceived > 0 ? 'received' : 'backordered');
        await client.query(`
          UPDATE order_items SET
            received_quantity = $1,
            receipt_status = $2,
            received_date = CASE WHEN $2 = 'received' THEN NOW() ELSE received_date END
          WHERE id = $3
        `, [quantityReceived || 0, receiptStatus, orderItemId]);

        if (receiptStatus === 'received') received++;
        else backordered++;
      }
    }

    await client.query('COMMIT');

    const text = `RECEIPT STATUS UPDATED\n` +
      (shipmentId ? `Shipment: ${shipmentId}\n` : '') +
      `Received: ${received} items\n` +
      `Backordered: ${backordered} items`;

    return { content: [{ type: 'text', text }] };
  } catch (err) {
    await client.query('ROLLBACK');
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  } finally {
    client.release();
  }
}

/**
 * get_pending_shipments: List shipments awaiting receipt
 */
async function getPendingShipments(args) {
  try {
    const { brandId, orderId, status } = args || {};

    let query = `
      SELECT vs.id, vs.vendor_name, vs.tracking_number, vs.carrier,
             vs.ship_date, vs.invoice_number, vs.status, vs.created_at,
             o.order_number, b.name AS brand_name, l.name AS location,
             COUNT(sli.id) AS line_item_count,
             SUM(sli.quantity_shipped) AS total_shipped,
             SUM(sli.quantity_backordered) AS total_backordered
      FROM vendor_shipments vs
      LEFT JOIN orders o ON vs.order_id = o.id
      LEFT JOIN brands b ON vs.brand_id = b.id
      LEFT JOIN locations l ON o.location_id = l.id
      LEFT JOIN shipment_line_items sli ON vs.id = sli.shipment_id
      WHERE 1=1
    `;
    const params = [];
    let p = 1;

    if (brandId) { query += ` AND vs.brand_id = $${p++}`; params.push(brandId); }
    if (orderId) { query += ` AND vs.order_id = $${p++}`; params.push(orderId); }
    if (status) { query += ` AND vs.status = $${p++}`; params.push(status); }
    else { query += ` AND vs.status IN ('pending', 'partial')`; }

    query += ` GROUP BY vs.id, o.order_number, b.name, l.name ORDER BY vs.created_at DESC LIMIT 50`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return { content: [{ type: 'text', text: 'No pending shipments found.' }] };
    }

    let text = `PENDING SHIPMENTS (${result.rows.length})\n${'='.repeat(60)}\n`;
    for (const s of result.rows) {
      text += `\nShipment #${s.id} | ${s.vendor_name}` +
        (s.order_number ? ` | Order: ${s.order_number}` : '') +
        (s.location ? ` | ${s.location}` : '') +
        `\n  Tracking: ${s.tracking_number || 'N/A'}` +
        ` | Carrier: ${s.carrier || 'N/A'}` +
        ` | Ship Date: ${s.ship_date || 'N/A'}` +
        `\n  Items: ${s.line_item_count} | Shipped: ${s.total_shipped || 0}` +
        ` | Backordered: ${s.total_backordered || 0}` +
        ` | Status: ${s.status}\n`;
    }

    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
}

/**
 * get_order_receipt_summary: Overview of what's shipped/received/outstanding for an order
 */
async function getOrderReceiptSummary(args) {
  try {
    const { orderId } = args;
    if (!orderId) {
      return { content: [{ type: 'text', text: 'orderId is required' }] };
    }

    const order = await pool.query(`
      SELECT o.id, o.order_number, b.name AS brand, l.name AS location,
             o.status, o.ship_date
      FROM orders o
      LEFT JOIN brands b ON o.brand_id = b.id
      LEFT JOIN locations l ON o.location_id = l.id
      WHERE o.id = $1
    `, [orderId]);

    if (order.rows.length === 0) {
      return { content: [{ type: 'text', text: `Order ${orderId} not found` }] };
    }

    const o = order.rows[0];

    const items = await pool.query(`
      SELECT
        receipt_status,
        vendor_decision,
        COUNT(*) AS count,
        SUM(COALESCE(adjusted_quantity, quantity)) AS total_qty,
        SUM(line_total) AS total_value
      FROM order_items
      WHERE order_id = $1
      GROUP BY receipt_status, vendor_decision
      ORDER BY receipt_status, vendor_decision
    `, [orderId]);

    let text = `ORDER RECEIPT SUMMARY\n${'='.repeat(50)}\n` +
      `Order: ${o.order_number} | ${o.brand} | ${o.location}\n` +
      `Ship Date: ${o.ship_date || 'N/A'} | Status: ${o.status}\n\n` +
      `${'Status'.padEnd(16)} ${'Decision'.padEnd(16)} ${'Items'.padEnd(8)} ${'Qty'.padEnd(8)} ${'Value'.padEnd(12)}\n` +
      `${'-'.repeat(60)}\n`;

    for (const row of items.rows) {
      text += `${(row.receipt_status || 'pending').padEnd(16)} ` +
        `${(row.vendor_decision || '-').padEnd(16)} ` +
        `${String(row.count).padEnd(8)} ` +
        `${String(row.total_qty || 0).padEnd(8)} ` +
        `${formatCurrency(row.total_value)}\n`;
    }

    // Shipments for this order
    const shipments = await pool.query(
      `SELECT id, tracking_number, status, ship_date FROM vendor_shipments WHERE order_id = $1 ORDER BY created_at DESC`,
      [orderId]
    );

    if (shipments.rows.length > 0) {
      text += `\nSHIPMENTS:\n`;
      for (const s of shipments.rows) {
        text += `  #${s.id} | Tracking: ${s.tracking_number || 'N/A'} | ${s.status} | ${s.ship_date || 'N/A'}\n`;
      }
    }

    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
}

/**
 * check_email_processed: Idempotency check before processing an email
 */
async function checkEmailProcessed(args) {
  try {
    const { emailMessageId } = args;
    if (!emailMessageId) {
      return { content: [{ type: 'text', text: 'emailMessageId is required' }] };
    }

    const result = await pool.query(
      `SELECT emc.*, vs.id AS shipment_id, vs.status AS shipment_status
       FROM email_message_cache emc
       LEFT JOIN vendor_shipments vs ON emc.shipment_id = vs.id
       WHERE emc.email_message_id = $1`,
      [emailMessageId]
    );

    if (result.rows.length === 0) {
      return { content: [{ type: 'text', text: `NOT_PROCESSED|Email ${emailMessageId} has not been processed yet.` }] };
    }

    const r = result.rows[0];
    const text = `ALREADY_PROCESSED\n` +
      `Email: ${r.email_message_id}\n` +
      `Subject: ${r.subject || 'N/A'}\n` +
      `Processed: ${r.processed_at}\n` +
      (r.shipment_id ? `Shipment: #${r.shipment_id} (${r.shipment_status})\n` : '');

    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
}

// ============================================================
// TOOL EXPORTS
// ============================================================
module.exports = [
  {
    name: 'update_order_decisions',
    description: 'Push SHIP/CANCEL/Keep Open decisions to existing order items. Updates vendor_decision, adjusted_quantity, and receipt_status. Logs all changes to revision history with audit trail.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'number', description: 'The order ID to update' },
        decisions: {
          type: 'array',
          description: 'Array of decisions: [{orderItemId, decision ("ship"/"cancel"/"keep_open_bo"), adjustedQty, reason}]',
          items: {
            type: 'object',
            properties: {
              orderItemId: { type: 'number' },
              decision: { type: 'string' },
              adjustedQty: { type: 'number' },
              reason: { type: 'string', description: 'Decision reason (e.g., "zero_stock", "positive_stock_cancel")' }
            },
            required: ['orderItemId', 'decision']
          }
        },
        revisionNotes: { type: 'string', description: 'Notes for this revision session' },
        maxReductionPct: { type: 'number', description: 'Max reduction percentage used (for audit trail)' }
      },
      required: ['orderId', 'decisions']
    },
    handler: updateOrderDecisions
  },
  {
    name: 'create_shipment',
    description: 'Record an inbound shipment from a vendor. Creates vendor_shipments record and optional line items. Matches line items to order items by UPC.',
    inputSchema: {
      type: 'object',
      properties: {
        vendorName: { type: 'string', description: 'Vendor/brand name' },
        brandId: { type: 'number' },
        orderId: { type: 'number' },
        trackingNumber: { type: 'string' },
        carrier: { type: 'string' },
        shipDate: { type: 'string', description: 'YYYY-MM-DD' },
        invoiceNumber: { type: 'string' },
        invoiceDate: { type: 'string' },
        totalAmount: { type: 'number' },
        emailMessageId: { type: 'string', description: 'Outlook message ID for idempotency' },
        senderEmail: { type: 'string' },
        senderName: { type: 'string' },
        emailSubject: { type: 'string' },
        lineItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              upc: { type: 'string' },
              sku: { type: 'string' },
              productName: { type: 'string' },
              size: { type: 'string' },
              color: { type: 'string' },
              quantityShipped: { type: 'number' },
              quantityBackordered: { type: 'number' },
              unitPrice: { type: 'number' },
              orderItemId: { type: 'number' }
            }
          }
        },
        notes: { type: 'string' }
      },
      required: ['vendorName']
    },
    handler: createShipment
  },
  {
    name: 'update_receipt_status',
    description: 'Mark shipment items as received or backordered. Can bulk-receive all items in a shipment, or update individual order items.',
    inputSchema: {
      type: 'object',
      properties: {
        shipmentId: { type: 'number', description: 'Bulk receive all items in this shipment' },
        items: {
          type: 'array',
          description: 'Individual item updates: [{orderItemId, quantityReceived, status}]',
          items: {
            type: 'object',
            properties: {
              orderItemId: { type: 'number' },
              quantityReceived: { type: 'number' },
              status: { type: 'string' }
            },
            required: ['orderItemId']
          }
        }
      }
    },
    handler: updateReceiptStatus
  },
  {
    name: 'get_pending_shipments',
    description: 'List vendor shipments awaiting receipt. Filter by brand, order, or status.',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'number' },
        orderId: { type: 'number' },
        status: { type: 'string', description: 'Filter by status (pending, partial, received)' }
      }
    },
    handler: getPendingShipments
  },
  {
    name: 'get_order_receipt_summary',
    description: 'Get overview of receipt status for an order: what has shipped, been received, is backordered, or cancelled.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'number', description: 'The order ID' }
      },
      required: ['orderId']
    },
    handler: getOrderReceiptSummary
  },
  {
    name: 'check_email_processed',
    description: 'Check if an Outlook email has already been processed for shipment data. Used for idempotency.',
    inputSchema: {
      type: 'object',
      properties: {
        emailMessageId: { type: 'string', description: 'The Outlook message ID' }
      },
      required: ['emailMessageId']
    },
    handler: checkEmailProcessed
  }
];
