const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Configure multer for template uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/templates');
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
    if (allowedTypes.includes(file.mimetype) ||
        file.originalname.match(/\.(xlsx|xls)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel files (.xlsx, .xls) are allowed.'));
    }
  }
});

// Available fields for mapping
const AVAILABLE_FIELDS = [
  { key: 'sku', label: 'SKU' },
  { key: 'upc', label: 'UPC' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'product_name', label: 'Product Name' },
  { key: 'style_name', label: 'Style Name' },
  { key: 'color', label: 'Color' },
  { key: 'size', label: 'Size' },
  { key: 'wholesale_cost', label: 'Wholesale Cost' },
  { key: 'msrp', label: 'MSRP' },
  { key: 'order_number', label: 'Order Number' },
  { key: 'ship_date', label: 'Ship Date' },
  { key: 'location_name', label: 'Location Name' },
  { key: 'location_code', label: 'Location Code' },
  { key: 'season_name', label: 'Season Name' },
  { key: 'brand_name', label: 'Brand Name' },
  { key: 'category', label: 'Category' },
  { key: 'gender', label: 'Gender' },
  { key: 'line_total', label: 'Line Total' },
  { key: 'item_notes', label: 'Item Notes' }
];

// GET /api/brand-templates - List all templates
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { brandId } = req.query;

    let query = `
      SELECT t.*, b.name as brand_name
      FROM brand_order_templates t
      LEFT JOIN brands b ON t.brand_id = b.id
      WHERE t.active = true
    `;
    const params = [];

    if (brandId) {
      query += ' AND t.brand_id = $1';
      params.push(brandId);
    }

    query += ' ORDER BY b.name, t.name';

    const result = await pool.query(query, params);
    res.json({
      templates: result.rows,
      availableFields: AVAILABLE_FIELDS
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/brand-templates/:id - Get single template
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT t.*, b.name as brand_name
      FROM brand_order_templates t
      LEFT JOIN brands b ON t.brand_id = b.id
      WHERE t.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({
      template: result.rows[0],
      availableFields: AVAILABLE_FIELDS
    });
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/brand-templates/preview - Preview uploaded template
router.post('/preview', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheetNames = workbook.SheetNames;
    const firstSheet = workbook.Sheets[sheetNames[0]];

    // Get the range of the sheet
    const range = XLSX.utils.decode_range(firstSheet['!ref'] || 'A1');

    // Extend column range to at least column Z (25) to allow mapping to empty columns
    const maxCol = Math.max(range.e.c, 25); // Column Z = index 25

    // Get column letters
    const columns = [];
    for (let c = range.s.c; c <= maxCol; c++) {
      columns.push(XLSX.utils.encode_col(c));
    }

    // Get first 10 rows as preview
    const previewRows = [];
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 9); r++) {
      const row = {};
      for (let c = range.s.c; c <= maxCol; c++) {
        const cellAddress = XLSX.utils.encode_cell({ r, c });
        const cell = firstSheet[cellAddress];
        row[XLSX.utils.encode_col(c)] = cell ? cell.v : '';
      }
      previewRows.push(row);
    }

    // Clean up the uploaded file after preview
    fs.unlinkSync(req.file.path);

    res.json({
      columns,
      sheetNames,
      previewRows,
      totalRows: range.e.r - range.s.r + 1,
      availableFields: AVAILABLE_FIELDS
    });
  } catch (error) {
    console.error('Error previewing template:', error);
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to preview template file' });
  }
});

// POST /api/brand-templates - Create new template
router.post('/', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { brandId, name, description, columnMappings, dataStartRow, sheetName, shipDateColumns } = req.body;

    if (!brandId || !name) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Brand ID and name are required' });
    }

    // Parse column mappings if it's a string
    let mappings = columnMappings;
    if (typeof columnMappings === 'string') {
      try {
        mappings = JSON.parse(columnMappings);
      } catch (e) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid column mappings format' });
      }
    }

    // Parse ship date columns if it's a string
    let shipDateCols = shipDateColumns;
    if (typeof shipDateColumns === 'string') {
      try {
        shipDateCols = JSON.parse(shipDateColumns);
      } catch (e) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid ship date columns format' });
      }
    }

    const result = await pool.query(`
      INSERT INTO brand_order_templates
        (brand_id, name, description, file_path, original_filename, column_mappings, data_start_row, sheet_name, ship_date_columns, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      brandId,
      name,
      description || null,
      req.file.path,
      req.file.originalname,
      JSON.stringify(mappings || {}),
      parseInt(dataStartRow) || 2,
      sheetName || null,
      JSON.stringify(shipDateCols || {}),
      req.user.id
    ]);

    res.status(201).json({
      message: 'Template created successfully',
      template: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating template:', error);
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A template with this name already exists for this brand' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/brand-templates/:id - Update template
router.put('/:id', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, columnMappings, dataStartRow, sheetName, active, shipDateColumns } = req.body;

    // Get existing template
    const existing = await pool.query('SELECT * FROM brand_order_templates WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Template not found' });
    }

    const oldFilePath = existing.rows[0].file_path;

    // Parse column mappings if it's a string
    let mappings = columnMappings;
    if (typeof columnMappings === 'string') {
      try {
        mappings = JSON.parse(columnMappings);
      } catch (e) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid column mappings format' });
      }
    }

    // Parse ship date columns if it's a string
    let shipDateCols = shipDateColumns;
    if (typeof shipDateColumns === 'string') {
      try {
        shipDateCols = JSON.parse(shipDateColumns);
      } catch (e) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid ship date columns format' });
      }
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (mappings !== undefined) {
      updates.push(`column_mappings = $${paramIndex++}`);
      values.push(JSON.stringify(mappings));
    }
    if (dataStartRow !== undefined) {
      updates.push(`data_start_row = $${paramIndex++}`);
      values.push(parseInt(dataStartRow));
    }
    if (sheetName !== undefined) {
      updates.push(`sheet_name = $${paramIndex++}`);
      values.push(sheetName || null);
    }
    if (active !== undefined) {
      updates.push(`active = $${paramIndex++}`);
      values.push(active === 'true' || active === true);
    }
    if (shipDateCols !== undefined) {
      updates.push(`ship_date_columns = $${paramIndex++}`);
      values.push(JSON.stringify(shipDateCols));
    }
    if (req.file) {
      updates.push(`file_path = $${paramIndex++}`);
      values.push(req.file.path);
      updates.push(`original_filename = $${paramIndex++}`);
      values.push(req.file.originalname);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await pool.query(`
      UPDATE brand_order_templates
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, values);

    // Delete old file if new file was uploaded
    if (req.file && oldFilePath && fs.existsSync(oldFilePath)) {
      fs.unlinkSync(oldFilePath);
    }

    res.json({
      message: 'Template updated successfully',
      template: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating template:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A template with this name already exists for this brand' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/brand-templates/:id - Delete template
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get existing template to find file path
    const existing = await pool.query('SELECT * FROM brand_order_templates WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const filePath = existing.rows[0].file_path;

    // Delete from database
    await pool.query('DELETE FROM brand_order_templates WHERE id = $1', [id]);

    // Delete file
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/brand-templates/:id/download - Download original template file
router.get('/:id/download', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('SELECT * FROM brand_order_templates WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const template = result.rows[0];
    const filePath = template.file_path;

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Template file not found' });
    }

    res.download(filePath, template.original_filename);
  } catch (error) {
    console.error('Error downloading template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
