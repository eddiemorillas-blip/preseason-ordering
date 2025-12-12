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

    const { locationId, columnMapping, sheetName, startDate, endDate } = req.body;

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

    // Extract date range from the date column if mapped
    let extractedMinDate = null;
    let extractedMaxDate = null;

    if (mapping.date) {
      console.log(`Extracting date range from column: ${mapping.date}`);
      for (const row of data) {
        const dateValue = row[mapping.date];
        const parsedDate = parseExcelDate(dateValue);
        if (parsedDate) {
          if (!extractedMinDate || parsedDate < extractedMinDate) {
            extractedMinDate = parsedDate;
          }
          if (!extractedMaxDate || parsedDate > extractedMaxDate) {
            extractedMaxDate = parsedDate;
          }
        }
      }
      console.log(`Extracted date range from data: ${extractedMinDate} to ${extractedMaxDate}`);
    }

    // Priority: user-provided dates > extracted dates from column > default (1 year)
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const dataStartDate = startDate || extractedMinDate || oneYearAgo.toISOString().split('T')[0];
    const dataEndDate = endDate || extractedMaxDate || today.toISOString().split('T')[0];

    const dateSource = startDate ? 'user provided' : (extractedMinDate ? 'extracted from data' : 'default');
    console.log(`Using date range: ${dataStartDate} to ${dataEndDate} (${dateSource})`);
    console.log(`Starting to process ${data.length} rows with batch optimization...`);

    // Step 1: Pre-load all products into memory for fast lookup
    console.log('Loading products into memory...');
    const productsResult = await client.query('SELECT id, upc, sku, LOWER(name) as name_lower FROM products');
    const productsByUpc = new Map();
    const productsByName = new Map();
    const productsBySku = new Map();

    // Helper to normalize UPC (remove leading zeros, non-digits)
    const normalizeUpc = (upc) => {
      if (!upc) return null;
      const cleaned = String(upc).replace(/[^0-9]/g, '');
      return cleaned.replace(/^0+/, '') || cleaned; // Remove leading zeros but keep at least one digit
    };

    for (const p of productsResult.rows) {
      if (p.upc) {
        productsByUpc.set(p.upc, p.id);
        // Also store normalized version
        const normalized = normalizeUpc(p.upc);
        if (normalized) productsByUpc.set(normalized, p.id);
      }
      if (p.name_lower) productsByName.set(p.name_lower, p.id);
      if (p.sku) productsBySku.set(p.sku.toLowerCase(), p.id);
    }
    console.log(`Loaded ${productsResult.rows.length} products`);

    // Step 2: Pre-load all locations with multiple lookup options
    console.log('Loading locations into memory...');
    const locationsResult = await client.query('SELECT id, name, code FROM locations');
    const locationsByName = new Map();
    const locationsByCode = new Map();
    const locationsByPartial = new Map(); // For partial matching
    for (const l of locationsResult.rows) {
      if (l.name) {
        const nameLower = l.name.toLowerCase();
        locationsByName.set(nameLower, l.id);
        // Also add partial matches (first word, e.g., "Ogden" from "Ogden Store")
        const firstWord = nameLower.split(/[\s-]/)[0];
        if (firstWord.length >= 3) {
          locationsByPartial.set(firstWord, l.id);
        }
      }
      if (l.code) {
        locationsByCode.set(l.code.toLowerCase(), l.id);
      }
    }
    console.log(`Loaded ${locationsResult.rows.length} locations`);

    let recordsProcessed = 0;
    let recordsFailed = 0;
    const errors = [];
    const unmatchedProducts = new Map(); // Track unique unmatched UPCs/names with their counts
    const unmatchedLocations = new Map(); // Track unique unmatched locations with their counts

    // Step 3: Process all rows and collect individual transactions
    console.log('Processing rows as individual transactions...');
    const salesTransactions = []; // Each row is a separate transaction

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      recordsProcessed++;

      // Extract data from row using column mapping
      const productName = mapping.product ? (row[mapping.product] || '').toString().trim() : null;
      const productUpc = mapping.upc ? (row[mapping.upc] || '').toString().trim() : null;
      const quantitySold = parseInt(row[mapping.quantity] || 0) || 0;
      const locationName = mapping.location ? (row[mapping.location] || '').toString().trim() : null;

      // Get the transaction date from the mapped date column
      let transactionDate = null;
      if (mapping.date) {
        const dateValue = row[mapping.date];
        transactionDate = parseExcelDate(dateValue);
      }
      // Fall back to user-provided dates if no date column mapped
      if (!transactionDate) {
        transactionDate = dataStartDate;
      }

      // Check if we have at least one identifier (empty strings count as missing)
      const hasName = productName && productName.length > 0;
      const hasUpc = productUpc && productUpc.length > 0;

      if (!hasName && !hasUpc) {
        if (errors.length < 100) errors.push({ row: i + 2, error: 'Missing product name or UPC' });
        recordsFailed++;
        continue;
      }

      // Find product ID from pre-loaded maps - try multiple strategies
      let productId = null;

      // Strategy 1: Try UPC matching first
      if (productUpc) {
        // Try exact UPC match
        productId = productsByUpc.get(String(productUpc));
        // Try normalized UPC match
        if (!productId) {
          const normalizedInput = normalizeUpc(productUpc);
          productId = productsByUpc.get(normalizedInput);
        }
      }

      // Strategy 2: If UPC didn't match (or wasn't provided), try by product name
      // NOTE: Only use exact matches to avoid incorrect product assignments
      if (!productId && productName) {
        const nameLower = productName.toLowerCase().trim();
        // Try exact name match only
        productId = productsByName.get(nameLower);
        // Try by SKU (in case product name column contains SKU)
        if (!productId) {
          productId = productsBySku.get(nameLower);
        }
      }

      if (!productId) {
        const identifier = hasUpc ? `UPC: ${productUpc}` : `Name: ${productName}`;
        // Track unique unmatched products - use UPC as key if available
        const key = hasUpc ? productUpc : productName;
        const existing = unmatchedProducts.get(key) || {
          count: 0,
          identifier,
          quantity: 0,
          upc: hasUpc ? productUpc : null,
          name: hasName ? productName : null
        };
        existing.count++;
        existing.quantity += quantitySold;
        if (!existing.name && hasName) existing.name = productName;
        if (!existing.upc && hasUpc) existing.upc = productUpc;
        unmatchedProducts.set(key, existing);

        if (errors.length < 50) errors.push({ row: i + 2, error: `Product not found (${identifier})` });
        recordsFailed++;
        continue;
      }

      // Determine location - try multiple matching strategies
      let finalLocationId = locationId ? parseInt(locationId) : null;
      if (!finalLocationId && locationName) {
        const locNameLower = locationName.toLowerCase().trim();
        finalLocationId = locationsByName.get(locNameLower);
        if (!finalLocationId) {
          finalLocationId = locationsByCode.get(locNameLower);
        }
        if (!finalLocationId) {
          const firstWord = locNameLower.split(/[\s-]/)[0];
          if (firstWord.length >= 3) {
            finalLocationId = locationsByPartial.get(firstWord);
          }
        }
        if (!finalLocationId) {
          for (const [knownName, locId] of locationsByName) {
            if (locNameLower.includes(knownName) || knownName.includes(locNameLower)) {
              finalLocationId = locId;
              break;
            }
          }
        }
      }

      if (!finalLocationId) {
        const locKey = locationName || 'EMPTY';
        const existingLoc = unmatchedLocations.get(locKey) || { count: 0 };
        existingLoc.count++;
        unmatchedLocations.set(locKey, existingLoc);

        if (errors.length < 50) errors.push({ row: i + 2, error: `Location not found: "${locationName || 'empty'}"` });
        recordsFailed++;
        continue;
      }

      // Store each transaction individually (will be inserted one at a time)
      salesTransactions.push({
        productId,
        locationId: finalLocationId,
        quantity: quantitySold,
        saleDate: transactionDate,
        productName,
        productUpc
      });

      // Log progress every 50k rows
      if (recordsProcessed % 50000 === 0) {
        console.log(`Processed ${recordsProcessed}/${data.length} rows...`);
      }
    }

    console.log(`Collected ${salesTransactions.length} individual transactions`);

    // Step 4: Insert transactions one at a time (to handle duplicates via ON CONFLICT)
    console.log('Inserting individual sales transactions...');
    let recordsAdded = 0;
    let recordsUpdated = 0;

    for (let i = 0; i < salesTransactions.length; i++) {
      const sale = salesTransactions[i];

      const result = await client.query(`
        INSERT INTO sales_data (
          product_id, location_id, start_date, end_date, quantity_sold,
          uploaded_by, original_product_name, original_upc
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (product_id, location_id, start_date, end_date)
        DO UPDATE SET
          quantity_sold = sales_data.quantity_sold + EXCLUDED.quantity_sold,
          updated_at = CURRENT_TIMESTAMP
        RETURNING (xmax = 0) AS inserted
      `, [
        sale.productId,
        sale.locationId,
        sale.saleDate,
        sale.saleDate,
        sale.quantity,
        req.user.id,
        sale.productName,
        sale.productUpc
      ]);

      if (result.rows[0].inserted) recordsAdded++;
      else recordsUpdated++;

      if ((i + 1) % 1000 === 0) {
        console.log(`Inserted ${i + 1}/${salesTransactions.length} records...`);
      }
    }

    // Create upload record with manual date range
    const uploadResult = await client.query(
      `INSERT INTO sales_uploads (
        filename, start_date, end_date, location_id, uploaded_by,
        records_processed, records_added, records_updated, records_failed, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed') RETURNING id`,
      [
        req.file.originalname,
        dataStartDate,
        dataEndDate,
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
    console.log(`Unmatched products: ${unmatchedProducts.size}, Unmatched locations: ${unmatchedLocations.size}`);

    // Build unmatched summary - top 50 by occurrence count
    const unmatchedProductList = Array.from(unmatchedProducts.entries())
      .map(([key, data]) => ({ key, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

    const unmatchedLocationList = Array.from(unmatchedLocations.entries())
      .map(([key, data]) => ({ name: key, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    res.json({
      message: 'Sales data uploaded successfully',
      uploadId,
      summary: {
        recordsProcessed,
        recordsAdded,
        recordsUpdated,
        recordsFailed,
        uniqueUnmatchedProducts: unmatchedProducts.size,
        uniqueUnmatchedLocations: unmatchedLocations.size,
        dateRange: {
          start: dataStartDate,
          end: dataEndDate,
          source: dateSource
        }
      },
      errors: errors.slice(0, 50),
      unmatchedProducts: unmatchedProductList,
      unmatchedLocations: unmatchedLocationList
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

// GET /api/sales-data/suggestions - Get order suggestions based on prior sales
router.get('/suggestions', authenticateToken, async (req, res) => {
  try {
    const { brandId, locationId, salesMonths, startDate, endDate } = req.query;

    if (!brandId) {
      return res.status(400).json({ error: 'brandId is required' });
    }

    if (!locationId) {
      return res.status(400).json({ error: 'locationId is required' });
    }

    // Determine date range - custom dates take precedence over salesMonths
    let salesStartDateStr, salesEndDateStr;
    let periodDescription;

    if (startDate && endDate) {
      // Custom date range
      salesStartDateStr = startDate;
      salesEndDateStr = endDate;
      periodDescription = `${startDate} to ${endDate}`;
    } else {
      // Default to last N months of sales data
      const monthsBack = parseInt(salesMonths) || 6;
      const salesStartDate = new Date();
      salesStartDate.setMonth(salesStartDate.getMonth() - monthsBack);
      salesStartDateStr = salesStartDate.toISOString().split('T')[0];
      salesEndDateStr = new Date().toISOString().split('T')[0];
      periodDescription = `Last ${monthsBack} months`;
    }

    // Build the query to get suggestions based on prior sales
    // Filter by sale date (start_date) being within the requested period
    // Simple logic: suggested qty = units sold in the prior period
    const query = `
      SELECT
        p.id as product_id,
        p.name as product_name,
        p.sku,
        p.upc,
        p.base_name,
        p.category,
        p.subcategory,
        p.gender,
        p.size,
        p.color,
        p.wholesale_cost,
        p.msrp,
        b.name as brand_name,
        l.name as location_name,
        COALESCE(SUM(sd.quantity_sold), 0) as prior_sales,
        MIN(sd.start_date) as sales_period_start,
        MAX(sd.end_date) as sales_period_end
      FROM products p
      JOIN brands b ON p.brand_id = b.id
      CROSS JOIN locations l
      LEFT JOIN sales_data sd ON sd.product_id = p.id
        AND sd.location_id = l.id
        AND sd.start_date >= $1
        AND sd.start_date <= $4
      WHERE p.brand_id = $2
        AND l.id = $3
      GROUP BY p.id, p.name, p.sku, p.upc, p.base_name, p.category, p.subcategory,
               p.gender, p.size, p.color, p.wholesale_cost, p.msrp,
               b.name, l.name
      HAVING COALESCE(SUM(sd.quantity_sold), 0) > 0
      ORDER BY p.base_name, p.color, p.size
    `;

    const result = await pool.query(query, [salesStartDateStr, brandId, locationId, salesEndDateStr]);

    // Get the actual date range from the data
    let overallStartDate = null;
    let overallEndDate = null;
    for (const row of result.rows) {
      if (row.sales_period_start) {
        const start = new Date(row.sales_period_start);
        if (!overallStartDate || start < overallStartDate) overallStartDate = start;
      }
      if (row.sales_period_end) {
        const end = new Date(row.sales_period_end);
        if (!overallEndDate || end > overallEndDate) overallEndDate = end;
      }
    }

    // Group by product family (base_name) for easier display
    const groupedByFamily = {};
    for (const row of result.rows) {
      const family = row.base_name || row.product_name;
      if (!groupedByFamily[family]) {
        groupedByFamily[family] = {
          base_name: family,
          category: row.category,
          subcategory: row.subcategory,
          gender: row.gender,
          brand_name: row.brand_name,
          location_name: row.location_name,
          total_prior_sales: 0,
          total_suggested_qty: 0,
          total_suggested_cost: 0,
          variants: []
        };
      }

      // Simple logic: suggested qty = prior sales (what sold before, order again)
      const priorSales = parseInt(row.prior_sales);
      const suggestedQty = priorSales;
      const lineCost = suggestedQty * parseFloat(row.wholesale_cost || 0);

      groupedByFamily[family].total_prior_sales += priorSales;
      groupedByFamily[family].total_suggested_qty += suggestedQty;
      groupedByFamily[family].total_suggested_cost += lineCost;
      groupedByFamily[family].variants.push({
        product_id: row.product_id,
        product_name: row.product_name,
        sku: row.sku,
        upc: row.upc,
        size: row.size,
        color: row.color,
        wholesale_cost: row.wholesale_cost,
        msrp: row.msrp,
        prior_sales: priorSales,
        suggested_qty: suggestedQty,
        line_cost: lineCost,
        sales_period_start: row.sales_period_start,
        sales_period_end: row.sales_period_end
      });
    }

    // Convert to array and sort by total suggested qty
    const suggestions = Object.values(groupedByFamily)
      .sort((a, b) => b.total_suggested_qty - a.total_suggested_qty);

    // Calculate totals
    const totalPriorSales = suggestions.reduce((sum, f) => sum + f.total_prior_sales, 0);
    const totalSuggestedQty = suggestions.reduce((sum, f) => sum + f.total_suggested_qty, 0);
    const totalSuggestedCost = suggestions.reduce((sum, f) => sum + f.total_suggested_cost, 0);

    res.json({
      suggestions,
      summary: {
        total_families: suggestions.length,
        total_variants: result.rows.length,
        total_prior_sales: totalPriorSales,
        total_suggested_qty: totalSuggestedQty,
        total_suggested_cost: totalSuggestedCost,
        sales_months: monthsBack,
        sales_period_start: overallStartDate ? overallStartDate.toISOString().split('T')[0] : null,
        sales_period_end: overallEndDate ? overallEndDate.toISOString().split('T')[0] : null
      }
    });
  } catch (error) {
    console.error('Get suggestions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/sales-data/uploads/:id - Delete a sales upload and its associated data
router.delete('/uploads/:id', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query('BEGIN');

    // Get upload info first
    const uploadResult = await client.query(
      'SELECT * FROM sales_uploads WHERE id = $1',
      [id]
    );

    if (uploadResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Upload not found' });
    }

    const upload = uploadResult.rows[0];

    // Delete associated sales_data records that match the upload's date range and location
    // This deletes all sales data that was part of this upload
    let deleteQuery = `
      DELETE FROM sales_data
      WHERE start_date = $1 AND end_date = $2
    `;
    const deleteParams = [upload.start_date, upload.end_date];

    if (upload.location_id) {
      deleteQuery += ' AND location_id = $3';
      deleteParams.push(upload.location_id);
    }

    const deleteResult = await client.query(deleteQuery, deleteParams);
    const deletedRecords = deleteResult.rowCount;

    // Delete the upload record
    await client.query('DELETE FROM sales_uploads WHERE id = $1', [id]);

    await client.query('COMMIT');

    console.log(`Deleted upload ${id} and ${deletedRecords} associated sales records`);

    res.json({
      message: 'Upload deleted successfully',
      deletedRecords
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete upload error:', error);
    res.status(500).json({ error: 'Failed to delete upload' });
  } finally {
    client.release();
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
