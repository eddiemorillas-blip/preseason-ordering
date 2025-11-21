const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  }
});

// POST /api/sales-data/sheets - Get sheet names from Excel file
router.post('/sheets', authenticateToken, authorizeRoles('admin', 'buyer'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Parse Excel file (only read workbook structure, not data)
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer', bookSheets: true });
    const sheets = workbook.SheetNames;

    res.json({
      sheets,
      defaultSheet: sheets[0]
    });
  } catch (error) {
    console.error('Sales data sheets error:', error);
    res.status(500).json({ error: 'Failed to read Excel file' });
  }
});

// POST /api/sales-data/preview - Preview Excel file before uploading
router.post('/preview', authenticateToken, authorizeRoles('admin', 'buyer'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { sheetName } = req.body;

    // Parse Excel file
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheets = workbook.SheetNames;

    // Use selected sheet or default to first sheet
    const selectedSheet = sheetName || sheets[0];
    const sheet = workbook.Sheets[selectedSheet];
    const data = xlsx.utils.sheet_to_json(sheet);

    if (data.length === 0) {
      return res.status(400).json({ error: 'Selected sheet is empty' });
    }

    // Return first 3 rows for preview
    const preview = data.slice(0, 3);
    const headers = Object.keys(data[0]);

    res.json({
      sheets,
      selectedSheet,
      totalRows: data.length,
      headers,
      preview
    });
  } catch (error) {
    console.error('Sales data preview error:', error);
    res.status(500).json({ error: 'Failed to process Excel file' });
  }
});

// Helper function to check if a value is a date
const isDateValue = (value) => {
  if (!value) return false;
  if (value instanceof Date) return true;
  if (typeof value === 'number' && value > 30000 && value < 100000) return true; // Excel serial dates
  if (typeof value === 'string') {
    // Check if string looks like a date
    const datePattern = /^\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}$|^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/;
    return datePattern.test(value.trim());
  }
  return false;
};

// Helper function to extract dates from a row
const extractDatesFromRow = (row) => {
  const dates = [];

  for (const [key, value] of Object.entries(row)) {
    if (isDateValue(value)) {
      const parsed = parseExcelDate(value);
      if (parsed) dates.push(parsed);
    }
  }

  if (dates.length === 0) return { startDate: null, endDate: null };

  // Sort dates and return first and last
  dates.sort();
  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1]
  };
};

// Helper function to parse Excel date
const parseExcelDate = (value) => {
  if (!value) return null;

  // If it's already a Date object
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  // If it's an Excel serial number (days since 1900-01-01)
  if (typeof value === 'number') {
    const excelEpoch = new Date(1900, 0, 1);
    const days = Math.floor(value) - 2; // Excel treats 1900 as leap year (it wasn't)
    const date = new Date(excelEpoch.getTime() + days * 86400000);
    return date.toISOString().split('T')[0];
  }

  // If it's a string, try to parse it
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }

  return null;
};

// POST /api/sales-data/upload - Upload and process sales data
router.post('/upload', authenticateToken, authorizeRoles('admin', 'buyer'), upload.single('file'), async (req, res) => {
  const client = await pool.connect();

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { locationId, columnMapping, sheetName } = req.body;

    // Parse column mapping if it's a string
    const mapping = typeof columnMapping === 'string' ? JSON.parse(columnMapping) : columnMapping;

    if (!mapping || !mapping.quantity) {
      return res.status(400).json({ error: 'Column mapping is required (quantity is mandatory)' });
    }

    // Either product or UPC must be mapped
    if (!mapping.product && !mapping.upc) {
      return res.status(400).json({ error: 'Either product name or UPC must be mapped' });
    }

    // Parse Excel file
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const selectedSheet = sheetName || workbook.SheetNames[0];
    const sheet = workbook.Sheets[selectedSheet];

    if (!sheet) {
      return res.status(400).json({ error: 'Selected sheet not found' });
    }

    const data = xlsx.utils.sheet_to_json(sheet, { raw: false, dateNF: 'yyyy-mm-dd' });

    if (data.length === 0) {
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    await client.query('BEGIN');

    // Track date range from actual data
    let minDate = null;
    let maxDate = null;

    let recordsProcessed = 0;
    let recordsAdded = 0;
    let recordsUpdated = 0;
    let recordsFailed = 0;
    const errors = [];

    console.log(`Starting to process ${data.length} rows...`);

    // Process each row
    for (let i = 0; i < data.length; i++) {
      try {
        const row = data[i];
        recordsProcessed++;

        // Extract data from row using column mapping
        const productName = row[mapping.product];
        const productUpc = mapping.upc ? row[mapping.upc] : null;
        const quantitySold = parseInt(row[mapping.quantity] || 0);
        const locationName = mapping.location ? row[mapping.location] : null;

        // Automatically detect and extract dates from any date columns in the row
        const { startDate, endDate } = extractDatesFromRow(row);

        if (!productName && !productUpc) {
          errors.push({ row: i + 2, error: 'Missing product name or UPC' });
          recordsFailed++;
          continue;
        }

        if (!startDate || !endDate) {
          errors.push({ row: i + 2, error: 'No valid dates found in row' });
          recordsFailed++;
          continue;
        }

        // Track overall date range
        if (!minDate || startDate < minDate) minDate = startDate;
        if (!maxDate || endDate > maxDate) maxDate = endDate;

        // Find matching product - try UPC first, then fall back to name
        let productResult;
        if (productUpc) {
          productResult = await client.query(
            'SELECT id FROM products WHERE upc = $1 LIMIT 1',
            [productUpc]
          );
        }

        // If no UPC match or no UPC provided, try name matching
        if (!productResult || productResult.rows.length === 0) {
          if (productName) {
            productResult = await client.query(`
              SELECT id FROM products
              WHERE LOWER(name) = LOWER($1)
              OR LOWER(name) LIKE LOWER($2)
              LIMIT 1
            `, [productName, `%${productName}%`]);
          }
        }

        if (!productResult || productResult.rows.length === 0) {
          const identifier = productUpc ? `UPC: ${productUpc}` : `Name: ${productName}`;
          errors.push({ row: i + 2, error: `Product not found (${identifier})` });
          recordsFailed++;
          continue;
        }

        const productId = productResult.rows[0].id;

        // Determine location
        let finalLocationId = locationId;
        if (!finalLocationId && locationName) {
          const locationResult = await client.query(
            'SELECT id FROM locations WHERE LOWER(name) = LOWER($1) LIMIT 1',
            [locationName]
          );
          if (locationResult.rows.length > 0) {
            finalLocationId = locationResult.rows[0].id;
          }
        }

        if (!finalLocationId) {
          errors.push({ row: i + 2, error: 'Location not specified or not found' });
          recordsFailed++;
          continue;
        }

        // Upsert sales data
        const result = await client.query(`
          INSERT INTO sales_data (
            product_id, location_id, start_date, end_date, quantity_sold,
            uploaded_by, original_product_name, original_upc
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (product_id, location_id, start_date, end_date)
          DO UPDATE SET
            quantity_sold = EXCLUDED.quantity_sold,
            updated_at = CURRENT_TIMESTAMP
          RETURNING (xmax = 0) AS inserted
        `, [productId, finalLocationId, startDate, endDate, quantitySold, req.user.id, productName, productUpc]);

        if (result.rows[0].inserted) {
          recordsAdded++;
        } else {
          recordsUpdated++;
        }
      } catch (rowError) {
        console.error(`Error processing row ${i + 2}:`, rowError);
        errors.push({ row: i + 2, error: rowError.message });
        recordsFailed++;
      }
    }

    // Create upload record with actual date range from data
    const uploadResult = await client.query(
      `INSERT INTO sales_uploads (
        filename, start_date, end_date, location_id, uploaded_by,
        records_processed, records_added, records_updated, records_failed, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed') RETURNING id`,
      [
        req.file.originalname,
        minDate,
        maxDate,
        locationId || null,
        req.user.id,
        recordsProcessed,
        recordsAdded,
        recordsUpdated,
        recordsFailed
      ]
    );

    const uploadId = uploadResult.rows[0].id;

    await client.query('COMMIT');

    console.log(`Sales data upload complete: ${recordsAdded} added, ${recordsUpdated} updated, ${recordsFailed} failed`);

    res.json({
      message: 'Sales data uploaded successfully',
      uploadId,
      summary: {
        recordsProcessed,
        recordsAdded,
        recordsUpdated,
        recordsFailed
      },
      errors: errors.slice(0, 100) // Return first 100 errors
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Sales data upload error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/sales-data/uploads - List all sales uploads
router.get('/uploads', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        su.*,
        l.name as location_name,
        u.email as uploaded_by_email
      FROM sales_uploads su
      LEFT JOIN locations l ON su.location_id = l.id
      LEFT JOIN users u ON su.uploaded_by = u.id
      ORDER BY su.created_at DESC
    `);

    res.json({ uploads: result.rows });
  } catch (error) {
    console.error('Get sales uploads error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/sales-data - Get sales data with filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { productId, locationId, startDate, endDate } = req.query;

    let query = `
      SELECT
        sd.*,
        p.name as product_name,
        p.sku,
        p.base_name,
        l.name as location_name
      FROM sales_data sd
      JOIN products p ON sd.product_id = p.id
      LEFT JOIN locations l ON sd.location_id = l.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (productId) {
      query += ` AND sd.product_id = $${paramIndex}`;
      params.push(productId);
      paramIndex++;
    }

    if (locationId) {
      query += ` AND sd.location_id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND sd.end_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND sd.start_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY sd.start_date DESC`;

    const result = await pool.query(query, params);

    res.json({ salesData: result.rows });
  } catch (error) {
    console.error('Get sales data error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
