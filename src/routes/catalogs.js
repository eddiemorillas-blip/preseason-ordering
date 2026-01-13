const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use global uploads directory set in server.js
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
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedTypes.includes(file.mimetype) ||
        file.originalname.match(/\.(csv|xlsx|xls)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV and Excel files are allowed.'));
    }
  }
});

// Get sheet names from Excel file
const getExcelSheetNames = (filePath) => {
  const workbook = XLSX.readFile(filePath);
  return workbook.SheetNames;
};

// Extract gender from sheet name
const extractGenderFromSheetName = (sheetName) => {
  if (!sheetName) return null;

  const lowerName = sheetName.toLowerCase();

  // Check for men's/mens/male patterns
  if (lowerName.includes("men's") || lowerName.includes('mens') ||
      lowerName.includes('male') || lowerName === 'men' ||
      lowerName.startsWith('men ') || lowerName.endsWith(' men')) {
    // Make sure it's not "women's" - check for 'wo' prefix
    if (!lowerName.includes('women') && !lowerName.includes("women's")) {
      return "Men's";
    }
  }

  // Check for women's/womens/female patterns
  if (lowerName.includes("women's") || lowerName.includes('womens') ||
      lowerName.includes('female') || lowerName === 'women' ||
      lowerName.startsWith('women ') || lowerName.endsWith(' women') ||
      lowerName.includes('ladies') || lowerName.includes("lady's")) {
    return "Women's";
  }

  // Check for unisex patterns
  if (lowerName.includes('unisex') || lowerName.includes('uni-sex')) {
    return 'Unisex';
  }

  // Check for kids/children patterns
  if (lowerName.includes('kids') || lowerName.includes("kid's") ||
      lowerName.includes('children') || lowerName.includes('youth') ||
      lowerName.includes('boys') || lowerName.includes('girls') ||
      lowerName.includes('junior')) {
    return 'Kids';
  }

  return null;
};

// Parse Excel file with optional header row offset and sheet name
// Returns { data, headers } object to ensure all columns are available for mapping
const parseExcelFile = (filePath, headerRow = 1, sheetName = null) => {
  const workbook = XLSX.readFile(filePath);
  const targetSheet = sheetName || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[targetSheet];

  // Always read as array of arrays for consistent handling
  const allRows = XLSX.utils.sheet_to_json(worksheet, {
    raw: false,
    header: 1,  // Returns array of arrays
    defval: ''  // Default value for empty cells
  });

  if (allRows.length < headerRow) {
    return { data: [], headers: [] };
  }

  // Get headers from the specified row (headerRow is 1-indexed)
  const headers = allRows[headerRow - 1].map((h, idx) => {
    const header = String(h || '').trim();
    return header || `Column_${idx + 1}`;  // Fallback for empty headers
  });

  // Build data objects from rows after the header
  const data = [];
  for (let i = headerRow; i < allRows.length; i++) {
    const row = allRows[i];
    const obj = {};
    let hasData = false;

    headers.forEach((header, idx) => {
      const value = row[idx];
      // Include all values, even empty ones, so columns show in preview
      obj[header] = (value !== undefined && value !== null) ? value : '';
      if (value !== undefined && value !== null && value !== '') {
        hasData = true;
      }
    });

    // Only include rows that have at least some data
    if (hasData) {
      data.push(obj);
    }
  }

  return { data, headers };
};

// Get raw rows from Excel file (for header row detection)
const getRawExcelRows = (filePath, numRows = 10, sheetName = null) => {
  const workbook = XLSX.readFile(filePath);
  const targetSheet = sheetName || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[targetSheet];

  // Get all data as array of arrays (no headers assumed)
  const allData = XLSX.utils.sheet_to_json(worksheet, {
    raw: false,
    header: 1,  // Returns array of arrays
    defval: ''  // Default value for empty cells
  });

  return allData.slice(0, numRows);
};

// Known header keywords for auto-detection
const HEADER_KEYWORDS = [
  'upc', 'sku', 'barcode', 'ean', 'gtin', 'product code', 'item code',
  'item number', 'item #', 'style', 'style number', 'model', 'model number',
  'part number', 'vendor sku', 'product number', 'product #',
  'name', 'product name', 'product', 'item name', 'item', 'title', 'description',
  'size', 'sizing', 'dimension', 'dimensions',
  'color', 'colour', 'colorway', 'color name',
  'gender', 'sex', 'mens', 'womens', 'unisex',
  'category', 'product category', 'type', 'product type', 'department', 'class',
  'wholesale', 'wholesale cost', 'wholesale price', 'cost', 'dealer price',
  'msrp', 'retail', 'retail price', 'list price', 'price', 'srp', 'rrp',
  'subcategory', 'sub category', 'subclass', 'quantity', 'qty',
  'case qty', 'case quantity', 'case pack', 'pack size', 'units per case', 'case size'
];

// Auto-detect which row contains the header
const detectHeaderRow = (rawRows) => {
  if (!rawRows || rawRows.length === 0) return 1;

  let bestRow = 1;
  let bestScore = 0;

  for (let rowIdx = 0; rowIdx < Math.min(rawRows.length, 10); rowIdx++) {
    const row = rawRows[rowIdx];
    if (!row || row.length === 0) continue;

    let score = 0;
    let nonEmptyCells = 0;
    let keywordMatches = 0;
    let numericCells = 0;

    for (const cell of row) {
      const cellStr = String(cell || '').trim().toLowerCase();
      if (!cellStr) continue;

      nonEmptyCells++;

      // Check for keyword matches
      const hasKeyword = HEADER_KEYWORDS.some(keyword =>
        cellStr === keyword ||
        cellStr.includes(keyword) ||
        keyword.includes(cellStr)
      );
      if (hasKeyword) {
        keywordMatches++;
        score += 10; // High score for keyword match
      }

      // Check if cell looks like a number (headers usually aren't numbers)
      const looksNumeric = /^[\d$,.%-]+$/.test(cellStr) || !isNaN(parseFloat(cellStr.replace(/[$,]/g, '')));
      if (looksNumeric) {
        numericCells++;
        score -= 3; // Penalty for numeric cells
      }

      // Check if cell looks like a UPC/barcode (12-14 digits)
      if (/^\d{12,14}$/.test(cellStr)) {
        score -= 10; // Strong penalty - this is likely data, not header
      }
    }

    // Bonus for having multiple keyword matches
    if (keywordMatches >= 3) score += 15;
    if (keywordMatches >= 5) score += 20;

    // Bonus for rows with reasonable number of non-empty cells
    if (nonEmptyCells >= 3 && nonEmptyCells <= 20) score += 5;

    // Penalty if most cells are numeric
    if (nonEmptyCells > 0 && numericCells / nonEmptyCells > 0.5) score -= 10;

    // Check if next row has different characteristics (more numeric = likely data)
    if (rowIdx < rawRows.length - 1) {
      const nextRow = rawRows[rowIdx + 1];
      if (nextRow && nextRow.length > 0) {
        let nextNumeric = 0;
        let nextNonEmpty = 0;
        for (const cell of nextRow) {
          const cellStr = String(cell || '').trim();
          if (!cellStr) continue;
          nextNonEmpty++;
          if (/^[\d$,.%-]+$/.test(cellStr) || !isNaN(parseFloat(cellStr.replace(/[$,]/g, '')))) {
            nextNumeric++;
          }
        }
        // If next row is more numeric, this row is likely the header
        if (nextNonEmpty > 0 && nextNumeric / nextNonEmpty > numericCells / Math.max(nonEmptyCells, 1)) {
          score += 8;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestRow = rowIdx + 1; // 1-indexed
    }
  }

  // If no good header found, default to row 1
  return bestScore > 0 ? bestRow : 1;
};

// Parse CSV file with optional header row offset
const parseCSVFile = (filePath, headerRow = 1) => {
  return new Promise((resolve, reject) => {
    const results = [];
    let rowIndex = 0;
    let headers = null;

    if (headerRow === 1) {
      // Standard parsing - first row is header
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', (error) => reject(error));
    } else {
      // Custom header row - need to manually handle
      fs.createReadStream(filePath)
        .pipe(csv({ headers: false }))  // Don't auto-detect headers
        .on('data', (row) => {
          rowIndex++;
          if (rowIndex === headerRow) {
            // This row contains our headers
            headers = Object.values(row).map(h => String(h).trim());
          } else if (rowIndex > headerRow && headers) {
            // Data row - map to headers
            const obj = {};
            headers.forEach((header, idx) => {
              if (header) {
                obj[header] = row[idx] || '';
              }
            });
            results.push(obj);
          }
        })
        .on('end', () => resolve(results))
        .on('error', (error) => reject(error));
    }
  });
};

// Get raw CSV rows (for header row detection)
const getRawCSVRows = (filePath, numRows = 10) => {
  return new Promise((resolve, reject) => {
    const results = [];
    let count = 0;

    fs.createReadStream(filePath)
      .pipe(csv({ headers: false }))
      .on('data', (row) => {
        if (count < numRows) {
          results.push(Object.values(row));
          count++;
        }
      })
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
};

// Map row data to product fields
// sheetGender is an optional fallback gender derived from the sheet name
const mapRowToProduct = (row, columnMapping, brandId, sheetGender = null) => {
  const product = {
    brand_id: brandId,
    upc: null,
    sku: null,
    name: null,
    category: null,
    subcategory: null,
    wholesale_cost: null,
    msrp: null,
    size: null,
    color: null,
    gender: null,
    inseam: null,
    case_qty: null,
    active: true
  };

  // Map each field using the column mapping
  for (const [dbField, fileColumn] of Object.entries(columnMapping)) {
    // Skip fields marked as "Not Available"
    if (fileColumn === '__NOT_AVAILABLE__') {
      continue;
    }
    if (row[fileColumn] !== undefined && row[fileColumn] !== null && row[fileColumn] !== '') {
      product[dbField] = row[fileColumn];
    }
  }

  // If gender wasn't mapped from a column (or is empty), use sheet-derived gender as fallback
  if (!product.gender && sheetGender) {
    product.gender = sheetGender;
  }

  return product;
};

// Clean numeric value (remove currency symbols, commas, spaces)
const cleanNumericValue = (value) => {
  if (!value || value === '') return null;
  // Remove currency symbols, commas, and spaces
  const cleaned = String(value).replace(/[$,\s]/g, '').trim();
  return cleaned === '' ? null : cleaned;
};

// Validate product data
// skipValidation is a Set of field names that are marked as "Not Available"
const validateProduct = (product, skipValidation = new Set()) => {
  const errors = [];

  // Only UPC is strictly required - it's needed to identify the product
  if (!skipValidation.has('upc') && (!product.upc || product.upc.trim() === '')) {
    errors.push('UPC is required');
  }

  // Name is strongly recommended but rows will still import with blank names
  // (They'll just show as empty in the UI)

  // Other fields (sku, size, color, gender, category) are optional
  // Rows with blank values in these fields will still be imported

  // Clean and validate numeric fields (if provided)
  if (product.wholesale_cost) {
    const cleaned = cleanNumericValue(product.wholesale_cost);
    if (cleaned && isNaN(parseFloat(cleaned))) {
      errors.push('Wholesale cost must be a valid number');
    } else {
      product.wholesale_cost = cleaned;
    }
  }

  if (product.msrp) {
    const cleaned = cleanNumericValue(product.msrp);
    if (cleaned && isNaN(parseFloat(cleaned))) {
      errors.push('MSRP must be a valid number');
    } else {
      product.msrp = cleaned;
    }
  }

  if (product.case_qty) {
    const cleaned = cleanNumericValue(product.case_qty);
    if (cleaned && isNaN(parseInt(cleaned))) {
      errors.push('Case qty must be a valid integer');
    } else {
      product.case_qty = cleaned ? parseInt(cleaned) : null;
    }
  }

  return errors;
};

// Case detection patterns
const CASE_NAME_PATTERNS = [
  /case\s*of\s*(\d+)/i,           // "Case of 12"
  /(\d+)\s*-?\s*pack/i,           // "12-pack" or "12 pack"
  /pack\s*of\s*(\d+)/i,           // "Pack of 12"
  /(\d+)\s*-?\s*case/i,           // "12-case"
  /carton\s*of\s*(\d+)/i,         // "Carton of 12"
  /box\s*of\s*(\d+)/i,            // "Box of 12"
  /\((\d+)\s*(?:pk|pc|ct)\)/i,    // "(12pk)" or "(12pc)" or "(12ct)"
];

const CASE_SKU_PATTERNS = [
  /-CS(\d+)$/i,                   // "-CS12"
  /-CASE(\d+)?$/i,                // "-CASE" or "-CASE12"
  /-(\d+)PK$/i,                   // "-12PK"
  /-(\d+)CT$/i,                   // "-12CT"
  /-BX(\d+)$/i,                   // "-BX12"
];

// Detect if a product row is a case (not an individual unit)
const detectCase = (product) => {
  let unitsPerCase = null;
  let isCase = false;
  let caseSku = product.sku;

  // Method 1: Check case_qty field (explicit pack size column)
  if (product.case_qty && parseInt(product.case_qty) > 1) {
    isCase = true;
    unitsPerCase = parseInt(product.case_qty);
  }

  // Method 2: Check product name for case patterns
  if (!isCase && product.name) {
    for (const pattern of CASE_NAME_PATTERNS) {
      const match = product.name.match(pattern);
      if (match) {
        isCase = true;
        unitsPerCase = parseInt(match[1]) || unitsPerCase;
        break;
      }
    }
  }

  // Method 3: Check SKU for case patterns
  if (product.sku) {
    for (const pattern of CASE_SKU_PATTERNS) {
      const match = product.sku.match(pattern);
      if (match) {
        isCase = true;
        if (match[1]) {
          unitsPerCase = parseInt(match[1]) || unitsPerCase;
        }
        break;
      }
    }
  }

  return { isCase, unitsPerCase, caseSku };
};

// Extract base SKU from a case SKU (remove case suffix)
const extractBaseSku = (sku) => {
  if (!sku) return null;

  // Remove common case suffixes
  let baseSku = sku
    .replace(/-CS\d*$/i, '')
    .replace(/-CASE\d*$/i, '')
    .replace(/-\d+PK$/i, '')
    .replace(/-\d+CT$/i, '')
    .replace(/-BX\d*$/i, '');

  return baseSku !== sku ? baseSku : null;
};

// Extract base name from a case product name (remove case designation)
const extractBaseName = (name) => {
  if (!name) return null;

  let baseName = name
    .replace(/\s*-?\s*case\s*of\s*\d+/i, '')
    .replace(/\s*-?\s*\d+\s*-?\s*pack/i, '')
    .replace(/\s*-?\s*pack\s*of\s*\d+/i, '')
    .replace(/\s*-?\s*\d+\s*-?\s*case/i, '')
    .replace(/\s*-?\s*carton\s*of\s*\d+/i, '')
    .replace(/\s*-?\s*box\s*of\s*\d+/i, '')
    .replace(/\s*\(\d+\s*(?:pk|pc|ct)\)/i, '')
    .trim();

  return baseName !== name ? baseName : null;
};

// Upload catalog endpoint
router.post('/upload', authenticateToken, authorizeRoles('admin', 'buyer'), upload.single('file'), async (req, res) => {
  const client = await pool.connect();

  try {
    const { brandId, brandName, seasonId, columnMapping, headerRow: headerRowParam, sheetNames: sheetNamesParam } = req.body;
    const file = req.file;

    // Parse headerRow from form data (comes as string)
    const headerRow = headerRowParam ? parseInt(headerRowParam, 10) : 1;

    // Parse sheetNames from form data (comes as JSON string)
    let sheetNames = null;
    if (sheetNamesParam) {
      try {
        sheetNames = JSON.parse(sheetNamesParam);
      } catch (e) {
        // If it's a single sheet name string, wrap in array
        sheetNames = [sheetNamesParam];
      }
    }

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!brandId && !brandName) {
      return res.status(400).json({ error: 'Brand ID or Brand Name is required' });
    }

    if (!columnMapping) {
      return res.status(400).json({ error: 'Column mapping is required' });
    }

    // Parse column mapping (it comes as string from multipart form)
    const mapping = typeof columnMapping === 'string'
      ? JSON.parse(columnMapping)
      : columnMapping;

    // Get or create brand
    let brand;
    let actualBrandId;

    if (brandId) {
      // Use existing brand ID
      const brandResult = await pool.query('SELECT * FROM brands WHERE id = $1', [brandId]);
      if (brandResult.rows.length === 0) {
        fs.unlinkSync(file.path);
        return res.status(404).json({ error: 'Brand not found' });
      }
      brand = brandResult.rows[0];
      actualBrandId = brandId;
    } else if (brandName) {
      // Check if brand exists by name
      const existingBrand = await pool.query('SELECT * FROM brands WHERE LOWER(name) = LOWER($1)', [brandName]);

      if (existingBrand.rows.length > 0) {
        // Brand exists, use it
        brand = existingBrand.rows[0];
        actualBrandId = brand.id;
      } else {
        // Create new brand
        const newBrand = await pool.query(
          'INSERT INTO brands (name, active) VALUES ($1, $2) RETURNING *',
          [brandName, true]
        );
        brand = newBrand.rows[0];
        actualBrandId = brand.id;
      }
    }

    // Parse file based on type (using headerRow parameter)
    // Each row will have an optional __sheetName property for tracking source sheet
    let rows;
    const fileExt = path.extname(file.originalname).toLowerCase();

    if (fileExt === '.csv') {
      rows = await parseCSVFile(file.path, headerRow);
    } else if (fileExt === '.xlsx' || fileExt === '.xls') {
      // Handle multiple sheets
      if (sheetNames && sheetNames.length > 0) {
        rows = [];
        for (const sheet of sheetNames) {
          const { data: sheetRows } = parseExcelFile(file.path, headerRow, sheet);
          // Tag each row with its source sheet name for gender extraction
          for (const row of sheetRows) {
            row.__sheetName = sheet;
          }
          rows = rows.concat(sheetRows);
        }
      } else {
        // Default to first sheet
        const { data } = parseExcelFile(file.path, headerRow, null);
        rows = data;
      }
    } else {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    if (rows.length === 0) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'No data found in file' });
    }

    // Start transaction
    await client.query('BEGIN');

    // Step 1: Mark all existing products for this brand as inactive
    const deactivateResult = await client.query(
      'UPDATE products SET active = false WHERE brand_id = $1 AND active = true RETURNING id',
      [actualBrandId]
    );
    const productsDeactivated = deactivateResult.rowCount;

    // Step 2: Process and validate all rows first
    let errors = [];
    let validProducts = [];

    // Build set of fields marked as "Not Available" to skip validation
    const skipValidation = new Set();
    for (const [dbField, fileColumn] of Object.entries(mapping)) {
      if (fileColumn === '__NOT_AVAILABLE__') {
        skipValidation.add(dbField);
      }
    }

    console.log(`Starting to validate ${rows.length} rows...`);
    if (skipValidation.size > 0) {
      console.log(`Skipping validation for fields marked as N/A: ${[...skipValidation].join(', ')}`);
    }

    for (let i = 0; i < rows.length; i++) {
      try {
        // Extract gender from sheet name if available (used as fallback)
        const sheetGender = rows[i].__sheetName
          ? extractGenderFromSheetName(rows[i].__sheetName)
          : null;

        const product = mapRowToProduct(rows[i], mapping, actualBrandId, sheetGender);

        // Validate product (passing fields to skip)
        const validationErrors = validateProduct(product, skipValidation);
        if (validationErrors.length > 0) {
          errors.push({
            row: i + 1,
            errors: validationErrors,
            data: rows[i]
          });
          continue;
        }

        validProducts.push(product);
      } catch (err) {
        console.error(`Error processing row ${i + 1}:`, err);
        errors.push({
          row: i + 1,
          errors: [err.message],
          data: rows[i]
        });
      }
    }

    console.log(`Validated ${validProducts.length} products, ${errors.length} errors. Starting batch upsert...`);

    // Step 3: Batch upsert all valid products using PostgreSQL's ON CONFLICT
    let productsAdded = 0;
    let productsUpdated = 0;

    if (validProducts.length > 0) {
      // Deduplicate products by UPC (keep last occurrence to get latest data)
      const productsByUpc = new Map();
      for (const product of validProducts) {
        if (product.upc) {
          productsByUpc.set(product.upc, product);
        }
      }
      const deduplicatedProducts = Array.from(productsByUpc.values());
      const duplicateCount = validProducts.length - deduplicatedProducts.length;
      if (duplicateCount > 0) {
        console.log(`Removed ${duplicateCount} duplicate UPCs from batch`);
      }

      // Get existing UPCs to determine what's new vs updated
      const upcList = deduplicatedProducts.map(p => p.upc);
      const existingUPCs = await client.query(
        'SELECT upc FROM products WHERE upc = ANY($1)',
        [upcList]
      );
      const existingUPCSet = new Set(existingUPCs.rows.map(r => r.upc));

      // Count adds vs updates
      for (const product of deduplicatedProducts) {
        if (existingUPCSet.has(product.upc)) {
          productsUpdated++;
        } else {
          productsAdded++;
        }
      }

      // Process in batches to avoid PostgreSQL parameter limit (~65535)
      // With 13 parameters per product, we can do ~5000 products per batch
      const BATCH_SIZE = 2000;
      const totalBatches = Math.ceil(deduplicatedProducts.length / BATCH_SIZE);
      console.log(`Processing ${deduplicatedProducts.length} products in ${totalBatches} batches...`);

      for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
        const batchStart = batchNum * BATCH_SIZE;
        const batchEnd = Math.min(batchStart + BATCH_SIZE, deduplicatedProducts.length);
        const batchProducts = deduplicatedProducts.slice(batchStart, batchEnd);

        // Build batch INSERT with ON CONFLICT DO UPDATE
        const values = [];
        const placeholders = [];
        let paramIndex = 1;

        for (const product of batchProducts) {
          placeholders.push(
            `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11}, $${paramIndex + 12}, $${paramIndex + 13}, $${paramIndex + 14}, $${paramIndex + 15})`
          );
          values.push(
            product.brand_id,
            product.upc,
            product.sku,
            product.name,
            product.category,
            product.subcategory,
            product.wholesale_cost,
            product.msrp,
            product.size,
            product.color,
            product.gender,
            product.inseam,
            product.active,
            seasonId || null,
            product.name, // base_name defaults to product name for family grouping
            product.case_qty
          );
          paramIndex += 16;
        }

        const batchQuery = `
          INSERT INTO products (
            brand_id, upc, sku, name, category, subcategory,
            wholesale_cost, msrp, size, color, gender, inseam, active, season_id, base_name, case_qty
          ) VALUES ${placeholders.join(', ')}
          ON CONFLICT (upc) DO UPDATE SET
            brand_id = EXCLUDED.brand_id,
            sku = EXCLUDED.sku,
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            subcategory = EXCLUDED.subcategory,
            wholesale_cost = EXCLUDED.wholesale_cost,
            msrp = EXCLUDED.msrp,
            size = EXCLUDED.size,
            color = EXCLUDED.color,
            gender = EXCLUDED.gender,
            inseam = EXCLUDED.inseam,
            active = EXCLUDED.active,
            season_id = COALESCE(EXCLUDED.season_id, products.season_id),
            base_name = COALESCE(EXCLUDED.base_name, products.base_name),
            case_qty = COALESCE(EXCLUDED.case_qty, products.case_qty),
            updated_at = CURRENT_TIMESTAMP
        `;

        await client.query(batchQuery, values);
        console.log(`Batch ${batchNum + 1}/${totalBatches} complete (${batchProducts.length} products)`);
      }

      console.log(`Batch upsert complete: ${productsAdded} added, ${productsUpdated} updated`);

      // Step 3b: If seasonId is provided, insert/update prices in season_prices table
      if (seasonId) {
        console.log(`Writing prices to season_prices for season ${seasonId}...`);

        // Get all products we just upserted (by UPC) to get their IDs and current prices
        const upcList = deduplicatedProducts.map(p => p.upc);

        // Process in batches for the price inserts too
        const PRICE_BATCH_SIZE = 1000;
        for (let i = 0; i < upcList.length; i += PRICE_BATCH_SIZE) {
          const batchUpcs = upcList.slice(i, i + PRICE_BATCH_SIZE);

          // Get product IDs and their new prices
          const productsResult = await client.query(`
            SELECT id, upc, wholesale_cost, msrp FROM products WHERE upc = ANY($1)
          `, [batchUpcs]);

          if (productsResult.rows.length > 0) {
            // Build season_prices upsert
            const priceValues = [];
            const pricePlaceholders = [];
            let priceParamIndex = 1;

            for (const prod of productsResult.rows) {
              pricePlaceholders.push(
                `($${priceParamIndex}, $${priceParamIndex + 1}, $${priceParamIndex + 2}, $${priceParamIndex + 3})`
              );
              priceValues.push(prod.id, seasonId, prod.wholesale_cost, prod.msrp);
              priceParamIndex += 4;
            }

            // Upsert season prices
            await client.query(`
              INSERT INTO season_prices (product_id, season_id, wholesale_cost, msrp)
              VALUES ${pricePlaceholders.join(', ')}
              ON CONFLICT (product_id, season_id) DO UPDATE SET
                wholesale_cost = EXCLUDED.wholesale_cost,
                msrp = EXCLUDED.msrp,
                updated_at = CURRENT_TIMESTAMP
            `, priceValues);

            // Record price history for audit trail
            const historyValues = [];
            const historyPlaceholders = [];
            let historyParamIndex = 1;

            for (const prod of productsResult.rows) {
              historyPlaceholders.push(
                `($${historyParamIndex}, $${historyParamIndex + 1}, $${historyParamIndex + 2}, $${historyParamIndex + 3}, $${historyParamIndex + 4})`
              );
              historyValues.push(prod.id, seasonId, prod.wholesale_cost, prod.msrp, 'catalog_upload');
              historyParamIndex += 5;
            }

            await client.query(`
              INSERT INTO price_history (product_id, season_id, new_wholesale_cost, new_msrp, change_reason)
              VALUES ${historyPlaceholders.join(', ')}
            `, historyValues);
          }
        }
        console.log(`Season prices written for ${upcList.length} products`);
      }
    }

    // Step 4: Log the upload
    const uploadStatus = errors.length > 0 ? 'completed_with_errors' : 'completed';
    await client.query(
      `INSERT INTO catalog_uploads (
        brand_id, season_id, file_name, products_added, products_updated,
        products_deactivated, upload_status, error_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        actualBrandId,
        seasonId || null,
        file.originalname,
        productsAdded,
        productsUpdated,
        productsDeactivated,
        uploadStatus,
        errors.length
      ]
    );

    // Commit transaction
    await client.query('COMMIT');

    // Clean up uploaded file
    fs.unlinkSync(file.path);

    res.json({
      success: true,
      message: 'Catalog upload completed',
      stats: {
        totalRows: rows.length,
        productsAdded,
        productsUpdated,
        productsDeactivated,
        errorCount: errors.length
      },
      errors: errors.length > 0 ? errors.slice(0, 10) : [] // Return first 10 errors
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Catalog upload error:', error);

    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      error: 'Failed to upload catalog',
      message: error.message
    });
  } finally {
    client.release();
  }
});

// Get upload history
router.get('/uploads', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        cu.*,
        b.name as brand_name
      FROM catalog_uploads cu
      LEFT JOIN brands b ON cu.brand_id = b.id
      ORDER BY cu.created_at DESC
      LIMIT 50
    `);

    res.json({ uploads: result.rows });
  } catch (error) {
    console.error('Get uploads error:', error);
    res.status(500).json({ error: 'Failed to fetch upload history' });
  }
});

// Delete a catalog upload record
router.delete('/uploads/:id', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const { id } = req.params;
  const { deactivateProducts } = req.query;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get the upload record first
    const uploadResult = await client.query(
      'SELECT * FROM catalog_uploads WHERE id = $1',
      [id]
    );

    if (uploadResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Upload not found' });
    }

    const upload = uploadResult.rows[0];

    // Optionally deactivate products from this brand that were part of this upload
    let productsDeactivated = 0;
    if (deactivateProducts === 'true' && upload.brand_id) {
      // Deactivate products for this brand that were created/updated around the upload time
      // This is approximate since we don't track exactly which products came from which upload
      const deactivateResult = await client.query(`
        UPDATE products
        SET active = false
        WHERE brand_id = $1
          AND updated_at >= $2
          AND updated_at <= $2 + INTERVAL '1 hour'
        RETURNING id
      `, [upload.brand_id, upload.created_at]);
      productsDeactivated = deactivateResult.rowCount;
    }

    // Delete the upload record
    await client.query('DELETE FROM catalog_uploads WHERE id = $1', [id]);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Upload record deleted',
      productsDeactivated
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete upload error:', error);
    res.status(500).json({ error: 'Failed to delete upload record' });
  } finally {
    client.release();
  }
});

// Preview file (get first N rows)
// Supports headerRow parameter to specify which row contains column headers
// Supports sheetName parameter to specify which Excel sheet to use
router.post('/preview', authenticateToken, authorizeRoles('admin', 'buyer'), upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const { headerRow: headerRowParam, rawPreview, sheetName } = req.body;

    console.log('Preview request received:', {
      sheetName: sheetName || '(not specified)',
      rawPreview: rawPreview || false,
      headerRow: headerRowParam || '(default)',
      filename: file?.originalname || '(no file)'
    });

    // Parse headerRow from form data (comes as string)
    const headerRow = headerRowParam ? parseInt(headerRowParam, 10) : 1;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileExt = path.extname(file.originalname).toLowerCase();

    // Get sheet names for Excel files
    let sheetNames = null;
    if (fileExt === '.xlsx' || fileExt === '.xls') {
      sheetNames = getExcelSheetNames(file.path);
    }

    // If rawPreview is requested, return first 10 rows as arrays (for header row detection)
    if (rawPreview === 'true' || rawPreview === true) {
      let rawRows;

      if (fileExt === '.csv') {
        rawRows = await getRawCSVRows(file.path, 10);
      } else if (fileExt === '.xlsx' || fileExt === '.xls') {
        console.log('Getting raw Excel rows from sheet:', sheetName || '(first sheet)');
        rawRows = getRawExcelRows(file.path, 10, sheetName);
        console.log('Got raw rows, first row:', rawRows[0]);
      } else {
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: 'Unsupported file format' });
      }

      // Auto-detect header row
      const detectedHeaderRow = detectHeaderRow(rawRows);

      // Clean up uploaded file
      fs.unlinkSync(file.path);

      return res.json({
        rawRows,
        totalRawRows: rawRows.length,
        detectedHeaderRow,
        sheetNames,
        selectedSheet: sheetName || (sheetNames ? sheetNames[0] : null)
      });
    }

    // Parse file based on type with headerRow parameter
    let rows;

    let columns = [];
    if (fileExt === '.csv') {
      rows = await parseCSVFile(file.path, headerRow);
      columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    } else if (fileExt === '.xlsx' || fileExt === '.xls') {
      console.log('Parsing Excel for data preview, sheet:', sheetName || '(first sheet)', 'headerRow:', headerRow);
      const result = parseExcelFile(file.path, headerRow, sheetName);
      rows = result.data;
      columns = result.headers;
      console.log('Parsed', rows.length, 'data rows, columns:', columns);
    } else {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    // Get first 5 rows
    const preview = rows.slice(0, 5);

    console.log('Preview response:', {
      rowCount: rows.length,
      columnsCount: columns.length,
      columns: columns.slice(0, 5),  // First 5 columns
      previewRowCount: preview.length
    });

    // Clean up uploaded file
    fs.unlinkSync(file.path);

    res.json({
      columns,
      preview,
      totalRows: rows.length,
      headerRow,
      sheetNames,
      selectedSheet: sheetName || (sheetNames ? sheetNames[0] : null)
    });

  } catch (error) {
    console.error('File preview error:', error);

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      error: 'Failed to preview file',
      message: error.message
    });
  }
});

module.exports = router;
