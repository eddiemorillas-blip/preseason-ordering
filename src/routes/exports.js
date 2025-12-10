const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const XLSX = require('xlsx');

// Helper to format date for NuOrder (MM/DD/YYYY)
function formatDateNuOrder(date) {
  if (!date) return '';
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

// Get order items for export (single or multiple orders)
async function getOrderItemsForExport(orderIds) {
  const placeholders = orderIds.map((_, i) => `$${i + 1}`).join(', ');

  const result = await pool.query(`
    SELECT
      o.id as order_id,
      o.order_number,
      o.ship_date,
      o.notes as order_notes,
      o.status,
      s.name as season_name,
      b.name as brand_name,
      l.name as location_name,
      l.code as location_code,
      oi.quantity,
      oi.unit_cost,
      oi.line_total,
      oi.notes as item_notes,
      p.sku,
      p.upc,
      p.name as product_name,
      p.base_name as style_name,
      p.color,
      p.size,
      p.wholesale_cost,
      p.msrp,
      p.category,
      p.gender
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    JOIN products p ON oi.product_id = p.id
    LEFT JOIN seasons s ON o.season_id = s.id
    LEFT JOIN brands b ON o.brand_id = b.id
    LEFT JOIN locations l ON o.location_id = l.id
    WHERE o.id IN (${placeholders})
    ORDER BY o.order_number, p.base_name, p.color, p.size
  `, orderIds);

  return result.rows;
}

// Get season summary for export
async function getSeasonSummaryForExport(seasonId) {
  const result = await pool.query(`
    SELECT
      o.id as order_id,
      o.order_number,
      o.ship_date,
      o.notes as order_notes,
      o.status,
      o.current_total,
      s.name as season_name,
      b.name as brand_name,
      l.name as location_name,
      l.code as location_code,
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count,
      (SELECT SUM(quantity) FROM order_items WHERE order_id = o.id) as total_units
    FROM orders o
    LEFT JOIN seasons s ON o.season_id = s.id
    LEFT JOIN brands b ON o.brand_id = b.id
    LEFT JOIN locations l ON o.location_id = l.id
    WHERE o.season_id = $1 AND o.status != 'cancelled'
    ORDER BY b.name, o.ship_date, l.name
  `, [seasonId]);

  return result.rows;
}

// Transform items to NuOrder format
function toNuOrderFormat(items) {
  return items.map(item => ({
    'STYLE_NUMBER': item.sku || '',
    'SEASON': item.season_name || '',
    'COLOR': item.color || '',
    'SIZE': item.size || '',
    'UPC': item.upc || '',
    'QUANTITY': item.quantity,
    'WHOLESALE': item.unit_cost || item.wholesale_cost || 0,
    'MSRP': item.msrp || 0,
    'SHIP_START': formatDateNuOrder(item.ship_date),
    'SHIP_END': formatDateNuOrder(item.ship_date),
    'NOTES': item.item_notes || '',
    'PRODUCT_NAME': item.product_name || '',
    'ORDER_NUMBER': item.order_number,
    'LOCATION': `${item.location_name} (${item.location_code})`,
    'BRAND': item.brand_name
  }));
}

// Transform items to Elastic format
function toElasticFormat(items) {
  return items.map(item => ({
    'UPC': item.upc || '',
    'SKU': item.sku || '',
    'QUANTITY': item.quantity,
    'COLOR': item.color || '',
    'SIZE': item.size || '',
    'PRODUCT_NAME': item.product_name || '',
    'WHOLESALE_PRICE': item.unit_cost || item.wholesale_cost || 0,
    'MSRP': item.msrp || 0,
    'ORDER_NUMBER': item.order_number,
    'SHIP_DATE': item.ship_date ? new Date(item.ship_date).toISOString().split('T')[0] : '',
    'LOCATION': `${item.location_name} (${item.location_code})`,
    'BRAND': item.brand_name,
    'SEASON': item.season_name || '',
    'NOTES': item.item_notes || ''
  }));
}

// Transform items to standard format (all fields)
function toStandardFormat(items) {
  return items.map(item => ({
    'Order Number': item.order_number,
    'Status': item.status,
    'Brand': item.brand_name,
    'Season': item.season_name,
    'Location': item.location_name,
    'Location Code': item.location_code,
    'Ship Date': item.ship_date ? new Date(item.ship_date).toLocaleDateString() : '',
    'SKU': item.sku || '',
    'UPC': item.upc || '',
    'Product Name': item.product_name,
    'Style Name': item.style_name || '',
    'Color': item.color || '',
    'Size': item.size || '',
    'Category': item.category || '',
    'Gender': item.gender || '',
    'Quantity': item.quantity,
    'Unit Cost': item.unit_cost || item.wholesale_cost || 0,
    'Line Total': item.line_total,
    'MSRP': item.msrp || 0,
    'Notes': item.item_notes || ''
  }));
}

// Transform season summary
function toSeasonSummaryFormat(orders) {
  return orders.map(order => ({
    'Order Number': order.order_number,
    'Brand': order.brand_name,
    'Location': order.location_name,
    'Location Code': order.location_code,
    'Ship Date': order.ship_date ? new Date(order.ship_date).toLocaleDateString() : '',
    'Status': order.status,
    'Items': order.item_count,
    'Units': order.total_units,
    'Order Total': order.current_total,
    'Notes': order.order_notes || ''
  }));
}

// Generate Excel workbook
function createExcelBuffer(data, sheetName = 'Orders') {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

// Generate CSV string
function createCSVString(data) {
  if (!data || data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const csvRows = [headers.join(',')];

  for (const row of data) {
    const values = headers.map(header => {
      let value = row[header];
      if (value === null || value === undefined) value = '';
      value = String(value);
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        value = '"' + value.replace(/"/g, '""') + '"';
      }
      return value;
    });
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
}

// GET /api/exports/orders/:id - Export single order
router.get('/orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'xlsx', template = 'standard' } = req.query;

    const items = await getOrderItemsForExport([id]);

    if (items.length === 0) {
      return res.status(404).json({ error: 'Order not found or has no items' });
    }

    let data;
    switch (template) {
      case 'nuorder':
        data = toNuOrderFormat(items);
        break;
      case 'elastic':
        data = toElasticFormat(items);
        break;
      default:
        data = toStandardFormat(items);
    }

    const orderNumber = items[0].order_number;
    const filename = `order_${orderNumber}_${template}`;

    if (format === 'csv') {
      const csv = createCSVString(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(csv);
    } else {
      const buffer = createExcelBuffer(data, 'Order Items');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      return res.send(buffer);
    }
  } catch (error) {
    console.error('Export order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/exports/orders/bulk - Export multiple orders
router.post('/orders/bulk', authenticateToken, async (req, res) => {
  try {
    const { orderIds, format = 'xlsx', template = 'standard' } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: 'Order IDs array is required' });
    }

    const items = await getOrderItemsForExport(orderIds);

    if (items.length === 0) {
      return res.status(404).json({ error: 'No items found for the specified orders' });
    }

    let data;
    switch (template) {
      case 'nuorder':
        data = toNuOrderFormat(items);
        break;
      case 'elastic':
        data = toElasticFormat(items);
        break;
      default:
        data = toStandardFormat(items);
    }

    const filename = `orders_bulk_${template}_${new Date().toISOString().split('T')[0]}`;

    if (format === 'csv') {
      const csv = createCSVString(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(csv);
    } else {
      const buffer = createExcelBuffer(data, 'Order Items');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      return res.send(buffer);
    }
  } catch (error) {
    console.error('Export bulk orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/exports/seasons/:id - Export season summary
router.get('/seasons/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'xlsx', includeItems = 'false' } = req.query;

    // Get season info
    const seasonResult = await pool.query('SELECT name FROM seasons WHERE id = $1', [id]);
    if (seasonResult.rows.length === 0) {
      return res.status(404).json({ error: 'Season not found' });
    }
    const seasonName = seasonResult.rows[0].name;

    if (includeItems === 'true') {
      // Get all order IDs for the season
      const orderIdsResult = await pool.query(
        "SELECT id FROM orders WHERE season_id = $1 AND status != 'cancelled'",
        [id]
      );
      const orderIds = orderIdsResult.rows.map(r => r.id);

      if (orderIds.length === 0) {
        return res.status(404).json({ error: 'No orders found for this season' });
      }

      const items = await getOrderItemsForExport(orderIds);
      const data = toStandardFormat(items);

      const filename = `season_${seasonName.replace(/[^a-zA-Z0-9]/g, '_')}_items_${new Date().toISOString().split('T')[0]}`;

      if (format === 'csv') {
        const csv = createCSVString(data);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        return res.send(csv);
      } else {
        const buffer = createExcelBuffer(data, 'Season Items');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
        return res.send(buffer);
      }
    } else {
      // Export summary only
      const orders = await getSeasonSummaryForExport(id);

      if (orders.length === 0) {
        return res.status(404).json({ error: 'No orders found for this season' });
      }

      const data = toSeasonSummaryFormat(orders);
      const filename = `season_${seasonName.replace(/[^a-zA-Z0-9]/g, '_')}_summary_${new Date().toISOString().split('T')[0]}`;

      if (format === 'csv') {
        const csv = createCSVString(data);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        return res.send(csv);
      } else {
        const buffer = createExcelBuffer(data, 'Season Summary');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
        return res.send(buffer);
      }
    }
  } catch (error) {
    console.error('Export season error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/exports/seasons/:id/by-template - Export season with platform template
router.get('/seasons/:id/by-template', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'xlsx', template = 'standard', brandId } = req.query;

    // Get season info
    const seasonResult = await pool.query('SELECT name FROM seasons WHERE id = $1', [id]);
    if (seasonResult.rows.length === 0) {
      return res.status(404).json({ error: 'Season not found' });
    }
    const seasonName = seasonResult.rows[0].name;

    // Get brand name if filtering by brand
    let brandName = null;
    if (brandId) {
      const brandResult = await pool.query('SELECT name FROM brands WHERE id = $1', [brandId]);
      if (brandResult.rows.length > 0) {
        brandName = brandResult.rows[0].name;
      }
    }

    // Get order IDs for the season (optionally filtered by brand)
    let orderIdsQuery = "SELECT id FROM orders WHERE season_id = $1 AND status != 'cancelled'";
    const queryParams = [id];
    if (brandId) {
      orderIdsQuery += " AND brand_id = $2";
      queryParams.push(brandId);
    }
    const orderIdsResult = await pool.query(orderIdsQuery, queryParams);
    const orderIds = orderIdsResult.rows.map(r => r.id);

    if (orderIds.length === 0) {
      return res.status(404).json({ error: 'No orders found for this season' });
    }

    const items = await getOrderItemsForExport(orderIds);

    let data;
    switch (template) {
      case 'nuorder':
        data = toNuOrderFormat(items);
        break;
      case 'elastic':
        data = toElasticFormat(items);
        break;
      default:
        data = toStandardFormat(items);
    }

    const brandPart = brandName ? `_${brandName.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
    const filename = `season_${seasonName.replace(/[^a-zA-Z0-9]/g, '_')}${brandPart}_${template}_${new Date().toISOString().split('T')[0]}`;

    if (format === 'csv') {
      const csv = createCSVString(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(csv);
    } else {
      const buffer = createExcelBuffer(data, 'Season Items');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      return res.send(buffer);
    }
  } catch (error) {
    console.error('Export season by template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to get field value from item
function getFieldValue(item, fieldName) {
  const fieldMap = {
    'sku': item.sku || '',
    'upc': item.upc || '',
    'quantity': item.quantity,
    'product_name': item.product_name || '',
    'style_name': item.style_name || '',
    'color': item.color || '',
    'size': item.size || '',
    'wholesale_cost': item.unit_cost || item.wholesale_cost || 0,
    'msrp': item.msrp || 0,
    'order_number': item.order_number || '',
    'ship_date': item.ship_date ? new Date(item.ship_date).toLocaleDateString() : '',
    'location_name': item.location_name || '',
    'location_code': item.location_code || '',
    'season_name': item.season_name || '',
    'brand_name': item.brand_name || '',
    'category': item.category || '',
    'gender': item.gender || '',
    'line_total': item.line_total || 0,
    'item_notes': item.item_notes || '',
    'order_notes': item.order_notes || ''
  };
  return fieldMap[fieldName] !== undefined ? fieldMap[fieldName] : '';
}

// Helper function to determine cell type
function getCellType(value) {
  if (typeof value === 'number') return 'n';
  if (value instanceof Date) return 'd';
  return 's'; // string
}

// Helper function to build a ship date to ship number mapping from order items
// Returns { 'YYYY-MM-DD': 'ship_1', ... } based on chronological order of unique ship dates
function buildShipDateMapping(items) {
  // Get unique ship dates and sort chronologically
  const uniqueDates = [...new Set(items.map(item => {
    if (!item.ship_date) return null;
    const d = new Date(item.ship_date);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  }).filter(Boolean))].sort();

  // Map each date to ship_1, ship_2, etc.
  const dateToShipNum = {};
  uniqueDates.forEach((date, index) => {
    if (index < 6) { // Only support up to 6 ship windows
      dateToShipNum[date] = `ship_${index + 1}`;
    }
  });

  return dateToShipNum;
}

// Helper function to find the column for an item based on its ship date
function findShipColumn(itemShipDate, shipDateColumns, dateToShipNum) {
  if (!shipDateColumns || Object.keys(shipDateColumns).length === 0) {
    return null;
  }

  if (!itemShipDate) return null;
  const d = new Date(itemShipDate);
  if (isNaN(d.getTime())) return null;
  const normalizedDate = d.toISOString().split('T')[0];

  // Get the ship number for this date
  const shipNum = dateToShipNum[normalizedDate];
  if (!shipNum) return null;

  // Find the column mapped to this ship number
  for (const [column, mappedShipNum] of Object.entries(shipDateColumns)) {
    if (mappedShipNum === shipNum) {
      return column;
    }
  }

  return null;
}

// POST /api/exports/orders/brand-template - Export using brand template
router.post('/orders/brand-template', authenticateToken, async (req, res) => {
  try {
    const { orderIds, templateId } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: 'Order IDs array is required' });
    }

    if (!templateId) {
      return res.status(400).json({ error: 'Template ID is required' });
    }

    // Fetch template metadata
    const templateResult = await pool.query(
      'SELECT * FROM brand_order_templates WHERE id = $1 AND active = true',
      [templateId]
    );

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const template = templateResult.rows[0];
    const columnMappings = template.column_mappings;
    const dataStartRow = template.data_start_row;
    const filePath = template.file_path;
    const shipDateColumns = template.ship_date_columns || {};
    const hasShipDateColumns = Object.keys(shipDateColumns).length > 0;

    // Check if template file exists
    const fs = require('fs');
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Template file not found' });
    }

    // Read the template Excel file
    const workbook = XLSX.readFile(filePath);
    const sheetName = template.sheet_name || workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Get order items data
    const items = await getOrderItemsForExport(orderIds);

    if (items.length === 0) {
      return res.status(404).json({ error: 'No items found for the specified orders' });
    }

    // If using ship date columns, we need to aggregate items by UPC
    // Each unique UPC gets one row, with quantities in different columns by ship window
    if (hasShipDateColumns) {
      // Build the date-to-ship-number mapping based on chronological order
      const dateToShipNum = buildShipDateMapping(items);

      // Group items by UPC to consolidate into single rows
      const groupedItems = new Map();

      items.forEach(item => {
        const key = item.upc || '';

        if (!groupedItems.has(key)) {
          groupedItems.set(key, {
            ...item,
            shipDateQuantities: {} // { columnLetter: quantity }
          });
        }

        const group = groupedItems.get(key);

        // Find which column this item's ship date maps to
        const shipCol = findShipColumn(item.ship_date, shipDateColumns, dateToShipNum);
        if (shipCol) {
          group.shipDateQuantities[shipCol] = (group.shipDateQuantities[shipCol] || 0) + item.quantity;
        }
      });

      // Convert map to array
      const consolidatedItems = Array.from(groupedItems.values());

      // Fill in data starting at dataStartRow
      consolidatedItems.forEach((item, index) => {
        const rowNum = dataStartRow + index;

        // For each mapped field (except quantity), write to the corresponding cell
        Object.entries(columnMappings).forEach(([fieldName, columnLetter]) => {
          // Skip quantity field when using ship date columns
          if (fieldName === 'quantity') return;

          const cellAddress = `${columnLetter}${rowNum}`;
          const value = getFieldValue(item, fieldName);
          worksheet[cellAddress] = { v: value, t: getCellType(value) };
        });

        // Write quantities to their respective ship date columns
        Object.entries(item.shipDateQuantities).forEach(([columnLetter, quantity]) => {
          const cellAddress = `${columnLetter}${rowNum}`;
          worksheet[cellAddress] = { v: quantity, t: 'n' };
        });
      });

      // Update sheet range
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      const lastDataRow = dataStartRow + consolidatedItems.length - 1;
      if (lastDataRow > range.e.r) {
        range.e.r = lastDataRow;
      }
      // Also extend column range if needed
      const maxCol = Math.max(
        range.e.c,
        ...Object.keys(shipDateColumns).map(col => XLSX.utils.decode_col(col))
      );
      range.e.c = maxCol;
      worksheet['!ref'] = XLSX.utils.encode_range(range);

    } else {
      // Original logic: one row per item, no ship date column consolidation
      items.forEach((item, index) => {
        const rowNum = dataStartRow + index;

        // For each mapped field, write to the corresponding cell
        Object.entries(columnMappings).forEach(([fieldName, columnLetter]) => {
          const cellAddress = `${columnLetter}${rowNum}`;
          const value = getFieldValue(item, fieldName);
          worksheet[cellAddress] = { v: value, t: getCellType(value) };
        });
      });

      // Update sheet range to include new data
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      const lastDataRow = dataStartRow + items.length - 1;
      if (lastDataRow > range.e.r) {
        range.e.r = lastDataRow;
      }
      worksheet['!ref'] = XLSX.utils.encode_range(range);
    }

    // Generate the modified workbook as buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Get brand name for filename
    const brandResult = await pool.query('SELECT name FROM brands WHERE id = $1', [template.brand_id]);
    const brandName = brandResult.rows[0]?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'export';
    const templateName = template.name.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${brandName}_${templateName}_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    console.error('Export with brand template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
