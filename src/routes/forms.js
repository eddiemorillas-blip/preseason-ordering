const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = global.UPLOADS_DIR || path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel files are allowed.'));
    }
  }
});

// Helper: Parse Excel file using template configuration
const parseExcelWithTemplate = (filePath, template, quantityColumns) => {
  const workbook = XLSX.readFile(filePath);
  const sheetName = template.sheet_name || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Get raw data as array of arrays
  const range = XLSX.utils.decode_range(worksheet['!ref']);
  const rows = [];

  for (let rowNum = range.s.r; rowNum <= range.e.r; rowNum++) {
    const row = [];
    for (let colNum = range.s.c; colNum <= range.e.c; colNum++) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowNum, c: colNum });
      const cell = worksheet[cellAddress];
      row.push(cell ? (cell.v !== undefined ? cell.v : '') : '');
    }
    rows.push(row);
  }

  return { rows, workbook, worksheet, sheetName };
};

// Helper: Convert Excel column letter to index (A=0, B=1, etc.)
const columnLetterToIndex = (letter) => {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index = index * 26 + letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1;
  }
  return index - 1;
};

// Helper: Match products by UPC/EAN/SKU
const matchProducts = async (productIds, idType, brandId, seasonId) => {
  const matches = [];

  for (const productId of productIds) {
    if (!productId || productId.trim() === '') {
      matches.push(null);
      continue;
    }

    let query, params;
    const cleanId = productId.toString().trim();

    if (idType === 'upc') {
      query = `
        SELECT id, name, upc, sku, size, color, wholesale_price
        FROM products
        WHERE brand_id = $1 AND season_id = $2 AND upc = $3
        LIMIT 1
      `;
      params = [brandId, seasonId, cleanId];
    } else if (idType === 'ean') {
      query = `
        SELECT id, name, upc as ean, sku, size, color, wholesale_price
        FROM products
        WHERE brand_id = $1 AND season_id = $2 AND upc = $3
        LIMIT 1
      `;
      params = [brandId, seasonId, cleanId];
    } else {
      query = `
        SELECT id, name, upc, sku, size, color, wholesale_price
        FROM products
        WHERE brand_id = $1 AND season_id = $2 AND sku = $3
        LIMIT 1
      `;
      params = [brandId, seasonId, cleanId];
    }

    const result = await pool.query(query, params);
    matches.push(result.rows.length > 0 ? result.rows[0] : null);
  }

  return matches;
};

// POST /api/forms/upload - Upload and preview Excel file
router.post('/upload', authenticateToken, authorizeRoles('admin', 'buyer'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { brandId, seasonId } = req.body;

    if (!brandId || !seasonId) {
      fs.unlinkSync(req.file.path); // Clean up uploaded file
      return res.status(400).json({ error: 'brandId and seasonId are required' });
    }

    // Check for existing template for this brand
    const templateResult = await pool.query(
      'SELECT * FROM brand_form_templates WHERE brand_id = $1 LIMIT 1',
      [brandId]
    );

    const workbook = XLSX.readFile(req.file.path);
    const sheetNames = workbook.SheetNames;

    // If template exists, parse using template
    if (templateResult.rows.length > 0) {
      const template = templateResult.rows[0];

      // Get quantity columns
      const quantityColumnsResult = await pool.query(
        'SELECT * FROM form_template_quantity_columns WHERE template_id = $1 ORDER BY column_order ASC',
        [template.id]
      );

      const { rows } = parseExcelWithTemplate(req.file.path, template, quantityColumnsResult.rows);

      // Extract headers
      const headers = rows[template.header_row] || [];

      // Extract product IDs from data rows
      const productIdColIndex = columnLetterToIndex(template.product_id_column);
      const dataRows = rows.slice(template.data_start_row);
      const productIds = dataRows.map(row => row[productIdColIndex]);

      // Match products
      const matches = await matchProducts(productIds, template.product_id_type, brandId, seasonId);

      // Build preview data
      const preview = dataRows.slice(0, 20).map((row, idx) => ({
        rowNumber: template.data_start_row + idx,
        productId: productIds[idx],
        matched: matches[idx] !== null,
        product: matches[idx],
        rowData: row
      }));

      const matchedCount = matches.filter(m => m !== null).length;

      res.json({
        hasTemplate: true,
        template: template,
        quantityColumns: quantityColumnsResult.rows,
        sheetNames,
        headers,
        preview,
        totalRows: dataRows.length,
        matchedCount,
        uploadedFilePath: req.file.path,
        originalFilename: req.file.originalname
      });
    } else {
      // No template - return sheet structure for mapping
      const firstSheet = workbook.Sheets[sheetNames[0]];
      const range = XLSX.utils.decode_range(firstSheet['!ref']);
      const rows = [];

      for (let rowNum = range.s.r; rowNum <= Math.min(range.s.r + 10, range.e.r); rowNum++) {
        const row = [];
        for (let colNum = range.s.c; colNum <= range.e.c; colNum++) {
          const cellAddress = XLSX.utils.encode_cell({ r: rowNum, c: colNum });
          const cell = firstSheet[cellAddress];
          row.push(cell ? (cell.v !== undefined ? cell.v : '') : '');
        }
        rows.push(row);
      }

      res.json({
        hasTemplate: false,
        sheetNames,
        previewRows: rows,
        uploadedFilePath: req.file.path,
        originalFilename: req.file.originalname
      });
    }
  } catch (error) {
    console.error('Upload form error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to process uploaded file' });
  }
});

// POST /api/forms/import - Import form after preview confirmation
router.post('/import', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { uploadedFilePath, originalFilename, templateId, brandId, seasonId } = req.body;

    if (!uploadedFilePath || !templateId || !brandId || !seasonId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!fs.existsSync(uploadedFilePath)) {
      return res.status(400).json({ error: 'Uploaded file not found' });
    }

    // Get template
    const templateResult = await client.query(
      'SELECT * FROM brand_form_templates WHERE id = $1',
      [templateId]
    );

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const template = templateResult.rows[0];

    // Get quantity columns
    const quantityColumnsResult = await client.query(
      'SELECT * FROM form_template_quantity_columns WHERE template_id = $1 ORDER BY column_order ASC',
      [templateId]
    );

    await client.query('BEGIN');

    // Read file and store as binary
    const fileData = fs.readFileSync(uploadedFilePath);

    // Create imported_forms record
    const formResult = await client.query(`
      INSERT INTO imported_forms (
        template_id, season_id, brand_id, original_filename, file_data, imported_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [templateId, seasonId, brandId, originalFilename, fileData, req.user.id]);

    const formId = formResult.rows[0].id;

    // Parse Excel and match products
    const { rows } = parseExcelWithTemplate(uploadedFilePath, template, quantityColumnsResult.rows);
    const productIdColIndex = columnLetterToIndex(template.product_id_column);
    const dataRows = rows.slice(template.data_start_row);
    const productIds = dataRows.map(row => row[productIdColIndex]);

    // Match products
    const matches = await matchProducts(productIds, template.product_id_type, brandId, seasonId);

    // Create form_row_mappings
    const mappingPromises = [];
    for (let i = 0; i < matches.length; i++) {
      if (matches[i] !== null) {
        const excelRow = template.data_start_row + i;
        const locationId = null; // TODO: extract from location_column if configured

        mappingPromises.push(
          client.query(`
            INSERT INTO form_row_mappings (
              form_id, excel_row, product_id, location_id, matched_by, match_confidence
            ) VALUES ($1, $2, $3, $4, $5, $6)
          `, [formId, excelRow, matches[i].id, locationId, template.product_id_type, 100])
        );
      }
    }

    await Promise.all(mappingPromises);

    // Clean up uploaded file
    fs.unlinkSync(uploadedFilePath);

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Form imported successfully',
      form: formResult.rows[0],
      matchedCount: matches.filter(m => m !== null).length,
      totalRows: dataRows.length
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Import form error:', error);
    if (req.body.uploadedFilePath && fs.existsSync(req.body.uploadedFilePath)) {
      fs.unlinkSync(req.body.uploadedFilePath);
    }
    res.status(500).json({ error: 'Failed to import form' });
  } finally {
    client.release();
  }
});

// GET /api/forms/:id - Get imported form details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const formResult = await pool.query(`
      SELECT
        f.*,
        t.name as template_name,
        b.name as brand_name,
        s.name as season_name
      FROM imported_forms f
      LEFT JOIN brand_form_templates t ON f.template_id = t.id
      LEFT JOIN brands b ON f.brand_id = b.id
      LEFT JOIN seasons s ON f.season_id = s.id
      WHERE f.id = $1
    `, [id]);

    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }

    res.json({ form: formResult.rows[0] });
  } catch (error) {
    console.error('Get form error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/forms/:id/rows - Get form rows with product details and current quantities
router.get('/:id/rows', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get form details
    const formResult = await pool.query(
      'SELECT * FROM imported_forms WHERE id = $1',
      [id]
    );

    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const form = formResult.rows[0];

    // Get template and quantity columns
    const templateResult = await pool.query(
      'SELECT * FROM brand_form_templates WHERE id = $1',
      [form.template_id]
    );

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const template = templateResult.rows[0];

    const quantityColumnsResult = await pool.query(
      'SELECT * FROM form_template_quantity_columns WHERE template_id = $1 ORDER BY column_order ASC',
      [template.id]
    );

    // Get row mappings with product details
    const rowsResult = await pool.query(`
      SELECT
        m.*,
        p.name as product_name,
        p.upc,
        p.sku,
        p.size,
        p.color,
        p.wholesale_price,
        l.name as location_name
      FROM form_row_mappings m
      LEFT JOIN products p ON m.product_id = p.id
      LEFT JOIN locations l ON m.location_id = l.id
      WHERE m.form_id = $1
      ORDER BY m.excel_row ASC
    `, [id]);

    // For each row and quantity column, get current order quantities
    const rowsWithQuantities = [];
    for (const row of rowsResult.rows) {
      const quantities = {};

      for (const qtyCol of quantityColumnsResult.rows) {
        // Find order for this product, location, and ship date
        const orderResult = await pool.query(`
          SELECT oi.quantity, oi.adjusted_quantity, o.id as order_id
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE o.brand_id = $1
            AND o.season_id = $2
            AND o.ship_date = $3
            AND oi.product_id = $4
            ${row.location_id ? 'AND o.location_id = $5' : ''}
        `, row.location_id
          ? [form.brand_id, form.season_id, qtyCol.ship_date, row.product_id, row.location_id]
          : [form.brand_id, form.season_id, qtyCol.ship_date, row.product_id]
        );

        quantities[qtyCol.id] = {
          columnId: qtyCol.id,
          columnLetter: qtyCol.column_letter,
          columnName: qtyCol.column_name,
          shipDate: qtyCol.ship_date,
          quantity: orderResult.rows.length > 0 ? orderResult.rows[0].adjusted_quantity || orderResult.rows[0].quantity : 0,
          orderId: orderResult.rows.length > 0 ? orderResult.rows[0].order_id : null
        };
      }

      rowsWithQuantities.push({
        ...row,
        quantities
      });
    }

    res.json({
      form,
      template,
      quantityColumns: quantityColumnsResult.rows,
      rows: rowsWithQuantities
    });
  } catch (error) {
    console.error('Get form rows error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/forms/:id/export - Export form with updated quantities
router.post('/:id/export', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get form with file data
    const formResult = await pool.query(
      'SELECT * FROM imported_forms WHERE id = $1',
      [id]
    );

    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const form = formResult.rows[0];

    if (!form.file_data) {
      return res.status(400).json({ error: 'Original file data not available' });
    }

    // Get template and quantity columns
    const templateResult = await pool.query(
      'SELECT * FROM brand_form_templates WHERE id = $1',
      [form.template_id]
    );

    const template = templateResult.rows[0];

    const quantityColumnsResult = await pool.query(
      'SELECT * FROM form_template_quantity_columns WHERE template_id = $1 ORDER BY column_order ASC',
      [template.id]
    );

    // Load workbook from binary data
    const workbook = XLSX.read(form.file_data, { type: 'buffer' });
    const sheetName = template.sheet_name || workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Get row mappings
    const rowsResult = await pool.query(`
      SELECT * FROM form_row_mappings
      WHERE form_id = $1
      ORDER BY excel_row ASC
    `, [id]);

    // Update quantities in worksheet
    for (const row of rowsResult.rows) {
      for (const qtyCol of quantityColumnsResult.rows) {
        // Get current quantity from order_items
        const orderResult = await pool.query(`
          SELECT oi.adjusted_quantity, oi.quantity
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE o.brand_id = $1
            AND o.season_id = $2
            AND o.ship_date = $3
            AND oi.product_id = $4
            ${row.location_id ? 'AND o.location_id = $5' : ''}
        `, row.location_id
          ? [form.brand_id, form.season_id, qtyCol.ship_date, row.product_id, row.location_id]
          : [form.brand_id, form.season_id, qtyCol.ship_date, row.product_id]
        );

        const quantity = orderResult.rows.length > 0
          ? (orderResult.rows[0].adjusted_quantity || orderResult.rows[0].quantity)
          : 0;

        // Update cell
        const colIndex = columnLetterToIndex(qtyCol.column_letter);
        const cellAddress = XLSX.utils.encode_cell({ r: row.excel_row, c: colIndex });
        worksheet[cellAddress] = { t: 'n', v: quantity };
      }
    }

    // Generate Excel file
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Send file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${form.original_filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error('Export form error:', error);
    res.status(500).json({ error: 'Failed to export form' });
  }
});

// GET /api/forms - List all imported forms
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { seasonId, brandId } = req.query;

    let query = `
      SELECT
        f.id,
        f.original_filename,
        f.imported_at,
        t.name as template_name,
        b.name as brand_name,
        s.name as season_name,
        u.email as imported_by_username,
        (SELECT COUNT(*) FROM form_row_mappings WHERE form_id = f.id) as row_count
      FROM imported_forms f
      LEFT JOIN brand_form_templates t ON f.template_id = t.id
      LEFT JOIN brands b ON f.brand_id = b.id
      LEFT JOIN seasons s ON f.season_id = s.id
      LEFT JOIN users u ON f.imported_by = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (seasonId) {
      query += ` AND f.season_id = $${paramCount++}`;
      params.push(seasonId);
    }

    if (brandId) {
      query += ` AND f.brand_id = $${paramCount++}`;
      params.push(brandId);
    }

    query += ' ORDER BY f.imported_at DESC';

    const result = await pool.query(query, params);
    res.json({ forms: result.rows });
  } catch (error) {
    console.error('List forms error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/forms/:id - Delete imported form
router.delete('/:id', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { id } = req.params;

    const existsResult = await pool.query(
      'SELECT * FROM imported_forms WHERE id = $1',
      [id]
    );

    if (existsResult.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }

    // Delete form (cascade will delete row mappings)
    await pool.query('DELETE FROM imported_forms WHERE id = $1', [id]);

    res.json({ message: 'Form deleted successfully' });
  } catch (error) {
    console.error('Delete form error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
