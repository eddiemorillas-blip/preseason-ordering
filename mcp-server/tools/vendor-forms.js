const { pool } = require('../db.js');

/**
 * import_vendor_form: Ingest a vendor order form and match items to internal order_items
 */
async function importVendorForm(args) {
  const client = await pool.connect();
  try {
    const { brandId, vendorFormType, items, orderId, notes } = args;

    if (!brandId || !items || items.length === 0) {
      return { content: [{ type: 'text', text: 'brandId and items array are required' }] };
    }

    await client.query('BEGIN');

    // Create import record
    const importResult = await client.query(`
      INSERT INTO vendor_form_imports (brand_id, form_type, imported_at, item_count, notes)
      VALUES ($1, $2, NOW(), $3, $4)
      RETURNING id
    `, [brandId, vendorFormType || null, items.length, notes || null]);

    const importId = importResult.rows[0].id;
    let matchedCount = 0;
    let unmatchedCount = 0;
    const results = [];

    for (const item of items) {
      let orderItemId = null;
      let matched = false;

      if (item.upc) {
        // Match by UPC + location within the specified order (or any order for this brand)
        let matchQuery;
        let matchParams;

        if (orderId) {
          // Match within specific order
          matchQuery = `
            SELECT oi.id AS order_item_id
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = $1 AND p.upc = $2
            LIMIT 1
          `;
          matchParams = [orderId, item.upc];
        } else if (item.locationName) {
          // Match by UPC + location name across orders for this brand
          matchQuery = `
            SELECT oi.id AS order_item_id
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            JOIN orders o ON oi.order_id = o.id
            JOIN locations l ON o.location_id = l.id
            WHERE o.brand_id = $1 AND p.upc = $2
              AND (LOWER(l.name) LIKE '%' || LOWER($3) || '%' OR LOWER(l.city) LIKE '%' || LOWER($3) || '%')
            ORDER BY o.created_at DESC
            LIMIT 1
          `;
          matchParams = [brandId, item.upc, item.locationName];
        } else {
          // Match by UPC only across orders for this brand
          matchQuery = `
            SELECT oi.id AS order_item_id
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            JOIN orders o ON oi.order_id = o.id
            WHERE o.brand_id = $1 AND p.upc = $2
            ORDER BY o.created_at DESC
            LIMIT 1
          `;
          matchParams = [brandId, item.upc];
        }

        const matchResult = await client.query(matchQuery, matchParams);
        if (matchResult.rows.length > 0) {
          orderItemId = matchResult.rows[0].order_item_id;
          matched = true;
          matchedCount++;
        } else {
          unmatchedCount++;
        }
      } else {
        unmatchedCount++;
      }

      await client.query(`
        INSERT INTO vendor_form_items (
          import_id, order_item_id, upc, vendor_po, vendor_so,
          location_name, ordered_qty, committed_qty, backorder_qty, eta, matched
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        importId, orderItemId, item.upc || null,
        item.vendorPO || null, item.vendorSO || null,
        item.locationName || null, item.orderedQty || null,
        item.committedQty || null, item.backorderQty || null,
        item.eta || null, matched
      ]);

      results.push({
        upc: item.upc,
        locationName: item.locationName,
        orderItemId,
        matched,
        vendorPO: item.vendorPO
      });
    }

    await client.query('COMMIT');

    let output = `VENDOR FORM IMPORTED\n${'='.repeat(60)}\n`;
    output += `Import ID: ${importId}\n`;
    output += `Brand: ${brandId} | Form Type: ${vendorFormType || 'N/A'}\n`;
    output += `Total Items: ${items.length} | Matched: ${matchedCount} | Unmatched: ${unmatchedCount}\n`;

    if (unmatchedCount > 0) {
      output += `\nUNMATCHED ITEMS:\n${'─'.repeat(40)}\n`;
      for (const r of results.filter(r => !r.matched)) {
        output += `  UPC: ${r.upc || 'N/A'} | Location: ${r.locationName || 'N/A'} | PO: ${r.vendorPO || 'N/A'}\n`;
      }
    }

    output += `\nMATCHED ITEMS:\n${'─'.repeat(40)}\n`;
    for (const r of results.filter(r => r.matched)) {
      output += `  UPC: ${r.upc} → orderItemId: ${r.orderItemId} | Location: ${r.locationName || 'N/A'}\n`;
    }

    return { content: [{ type: 'text', text: output }] };
  } catch (err) {
    await client.query('ROLLBACK');
    return { content: [{ type: 'text', text: `Error importing vendor form: ${err.message}` }] };
  } finally {
    client.release();
  }
}

/**
 * save_vendor_form_template: Store/update a vendor form column mapping template
 * Uses the existing brand_order_templates table (extended with new columns)
 */
async function saveVendorFormTemplate(args) {
  try {
    const {
      brandId, name, sheetName, headerRow, dataStartRow,
      columns, dropdownOptions, poPattern, locationMapping,
      fillRules, notes
    } = args;

    if (!brandId || !name) {
      return { content: [{ type: 'text', text: 'brandId and name are required' }] };
    }

    // Upsert on brand_id + name (unique constraint exists)
    const result = await pool.query(`
      INSERT INTO brand_order_templates (
        brand_id, name, sheet_name, data_start_row, header_row,
        column_mappings, dropdown_options, po_pattern, location_mapping,
        fill_rules, notes, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (brand_id, name) DO UPDATE SET
        sheet_name = EXCLUDED.sheet_name,
        data_start_row = EXCLUDED.data_start_row,
        header_row = EXCLUDED.header_row,
        column_mappings = EXCLUDED.column_mappings,
        dropdown_options = EXCLUDED.dropdown_options,
        po_pattern = EXCLUDED.po_pattern,
        location_mapping = EXCLUDED.location_mapping,
        fill_rules = EXCLUDED.fill_rules,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING id
    `, [
      brandId, name, sheetName || null, dataStartRow || 2, headerRow || null,
      JSON.stringify(columns || {}),
      JSON.stringify(dropdownOptions || {}),
      poPattern || null,
      JSON.stringify(locationMapping || {}),
      JSON.stringify(fillRules || {}),
      notes || null
    ]);

    const templateId = result.rows[0].id;

    let output = `VENDOR FORM TEMPLATE SAVED\n${'='.repeat(60)}\n`;
    output += `Template ID: ${templateId}\n`;
    output += `Brand: ${brandId} | Name: ${name}\n`;
    output += `Sheet: ${sheetName || 'default'} | Header Row: ${headerRow || 'N/A'} | Data Start: ${dataStartRow || 2}\n`;
    if (columns) output += `Columns: ${Object.keys(columns).length} mapped\n`;
    if (poPattern) output += `PO Pattern: ${poPattern}\n`;

    return { content: [{ type: 'text', text: output }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error saving template: ${error.message}` }] };
  }
}

/**
 * get_vendor_form_template: Retrieve vendor form templates by brand or name
 */
async function getVendorFormTemplate(args) {
  try {
    const { brandId, name } = args;

    let query = `
      SELECT
        bot.id, bot.brand_id, bot.name, bot.sheet_name,
        bot.data_start_row, bot.header_row,
        bot.column_mappings, bot.dropdown_options,
        bot.po_pattern, bot.location_mapping, bot.fill_rules,
        bot.notes, bot.active, bot.updated_at,
        b.name AS brand_name
      FROM brand_order_templates bot
      LEFT JOIN brands b ON bot.brand_id = b.id
      WHERE bot.active = true
    `;

    const params = [];
    let p = 1;

    if (brandId) {
      query += ` AND bot.brand_id = $${p++}`;
      params.push(brandId);
    }
    if (name) {
      query += ` AND LOWER(bot.name) LIKE '%' || LOWER($${p++}) || '%'`;
      params.push(name);
    }

    query += ` ORDER BY bot.brand_id, bot.name`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return { content: [{ type: 'text', text: 'No vendor form templates found.' }] };
    }

    let output = `VENDOR FORM TEMPLATES (${result.rows.length})\n${'='.repeat(80)}\n`;

    for (const t of result.rows) {
      output += `\n${'─'.repeat(60)}\n`;
      output += `Template #${t.id}: ${t.name}\n`;
      output += `Brand: ${t.brand_name || t.brand_id} | Sheet: ${t.sheet_name || 'default'}\n`;
      output += `Header Row: ${t.header_row || 'N/A'} | Data Start Row: ${t.data_start_row}\n`;

      if (t.column_mappings && Object.keys(t.column_mappings).length > 0) {
        output += `\nColumn Mappings:\n`;
        for (const [field, col] of Object.entries(t.column_mappings)) {
          output += `  ${field}: column ${col}\n`;
        }
      }

      if (t.dropdown_options && Object.keys(t.dropdown_options).length > 0) {
        output += `\nDropdown Options:\n`;
        for (const [field, options] of Object.entries(t.dropdown_options)) {
          output += `  ${field}: ${JSON.stringify(options)}\n`;
        }
      }

      if (t.fill_rules && Object.keys(t.fill_rules).length > 0) {
        output += `\nFill Rules:\n`;
        for (const [field, rule] of Object.entries(t.fill_rules)) {
          output += `  ${field}: ${JSON.stringify(rule)}\n`;
        }
      }

      if (t.po_pattern) output += `\nPO Pattern: ${t.po_pattern}\n`;

      if (t.location_mapping && Object.keys(t.location_mapping).length > 0) {
        output += `Location Mapping: ${JSON.stringify(t.location_mapping)}\n`;
      }

      if (t.notes) output += `Notes: ${t.notes}\n`;
      output += `Updated: ${t.updated_at ? t.updated_at.toISOString().split('T')[0] : 'N/A'}\n`;
    }

    return { content: [{ type: 'text', text: output }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error getting templates: ${error.message}` }] };
  }
}

module.exports = [
  {
    name: 'import_vendor_form',
    description: 'Import a vendor order confirmation form. Matches items by UPC (+location) to internal order_items. Use orderId to match within a specific order. Creates vendor_form_imports record with matched item mappings.',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'number', description: 'Brand ID (required)' },
        orderId: { type: 'number', description: 'Specific order ID to match items against (recommended)' },
        vendorFormType: { type: 'string', description: 'Form type identifier (e.g., "la_sportiva_4.15")' },
        items: {
          type: 'array',
          description: 'Array of vendor form line items',
          items: {
            type: 'object',
            properties: {
              upc: { type: 'string', description: 'UPC barcode (used for matching)' },
              vendorPO: { type: 'string', description: 'Vendor PO number' },
              vendorSO: { type: 'string', description: 'Vendor sales order number' },
              locationName: { type: 'string', description: 'Store location name' },
              orderedQty: { type: 'number', description: 'Quantity ordered' },
              committedQty: { type: 'number', description: 'Quantity committed by vendor' },
              backorderQty: { type: 'number', description: 'Quantity backordered' },
              eta: { type: 'string', description: 'Expected delivery date' }
            },
            required: ['upc']
          }
        },
        notes: { type: 'string', description: 'Import notes' }
      },
      required: ['brandId', 'items']
    },
    handler: importVendorForm
  },
  {
    name: 'save_vendor_form_template',
    description: 'Store or update a vendor form column mapping template. Saves column positions, dropdown options, fill rules, PO patterns, and location mappings so the AI agent can correctly read and fill vendor Excel forms.',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'number', description: 'Brand ID (required)' },
        name: { type: 'string', description: 'Template name (required, unique per brand)' },
        sheetName: { type: 'string', description: 'Excel sheet name (e.g., "REVISE HERE")' },
        headerRow: { type: 'number', description: 'Row number containing headers (1-indexed)' },
        dataStartRow: { type: 'number', description: 'First data row (1-indexed, default 2)' },
        columns: {
          type: 'object',
          description: 'Column mappings: logical name → column number (e.g., {"upc": 15, "ordered": 16})',
          additionalProperties: { type: 'number' }
        },
        dropdownOptions: {
          type: 'object',
          description: 'Valid dropdown values per column (e.g., {"ship_cancel": ["Ship ASAP", "Cancel"]})',
          additionalProperties: { type: 'array', items: { type: 'string' } }
        },
        poPattern: { type: 'string', description: 'Regex pattern for matching PO numbers' },
        locationMapping: {
          type: 'object',
          description: 'Location name → internal ID mapping',
          additionalProperties: { type: 'number' }
        },
        fillRules: {
          type: 'object',
          description: 'Rules for filling columns based on decisions',
          additionalProperties: { type: 'object' }
        },
        notes: { type: 'string', description: 'Notes about this template' }
      },
      required: ['brandId', 'name']
    },
    handler: saveVendorFormTemplate
  },
  {
    name: 'get_vendor_form_template',
    description: 'Retrieve vendor form templates. Filter by brandId and/or template name. Returns column mappings, dropdown options, fill rules, and all configuration needed to process vendor Excel forms.',
    inputSchema: {
      type: 'object',
      properties: {
        brandId: { type: 'number', description: 'Filter by brand ID' },
        name: { type: 'string', description: 'Search by template name (partial match)' }
      }
    },
    handler: getVendorFormTemplate
  }
];
