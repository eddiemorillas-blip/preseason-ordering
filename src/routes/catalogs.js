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
    const uploadDir = path.join(__dirname, '../../uploads');
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

// Parse Excel file
const parseExcelFile = (filePath) => {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { raw: false });
  return data;
};

// Parse CSV file
const parseCSVFile = (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
};

// Map row data to product fields
const mapRowToProduct = (row, columnMapping, brandId) => {
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
    active: true
  };

  // Map each field using the column mapping
  for (const [dbField, fileColumn] of Object.entries(columnMapping)) {
    if (row[fileColumn] !== undefined && row[fileColumn] !== null && row[fileColumn] !== '') {
      product[dbField] = row[fileColumn];
    }
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
const validateProduct = (product) => {
  const errors = [];

  // Required fields
  if (!product.upc || product.upc.trim() === '') {
    errors.push('UPC is required');
  }

  if (!product.sku || product.sku.trim() === '') {
    errors.push('SKU/Product Number is required');
  }

  if (!product.name || product.name.trim() === '') {
    errors.push('Product name is required');
  }

  if (!product.size || product.size.trim() === '') {
    errors.push('Size is required');
  }

  if (!product.color || product.color.trim() === '') {
    errors.push('Color is required');
  }

  if (!product.gender || product.gender.trim() === '') {
    errors.push('Gender is required');
  }

  if (!product.category || product.category.trim() === '') {
    errors.push('Category is required');
  }

  // Clean and validate numeric fields
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

  return errors;
};

// Upload catalog endpoint
router.post('/upload', authenticateToken, authorizeRoles('admin', 'buyer'), upload.single('file'), async (req, res) => {
  const client = await pool.connect();

  try {
    const { brandId, brandName, columnMapping } = req.body;
    const file = req.file;

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

    // Parse file based on type
    let rows;
    const fileExt = path.extname(file.originalname).toLowerCase();

    if (fileExt === '.csv') {
      rows = await parseCSVFile(file.path);
    } else if (fileExt === '.xlsx' || fileExt === '.xls') {
      rows = parseExcelFile(file.path);
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

    console.log(`Starting to validate ${rows.length} rows...`);

    for (let i = 0; i < rows.length; i++) {
      try {
        const product = mapRowToProduct(rows[i], mapping, actualBrandId);

        // Validate product
        const validationErrors = validateProduct(product);
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
      // Get existing UPCs to determine what's new vs updated
      const upcList = validProducts.map(p => p.upc);
      const existingUPCs = await client.query(
        'SELECT upc FROM products WHERE upc = ANY($1)',
        [upcList]
      );
      const existingUPCSet = new Set(existingUPCs.rows.map(r => r.upc));

      // Build batch INSERT with ON CONFLICT DO UPDATE
      const values = [];
      const placeholders = [];
      let paramIndex = 1;

      for (const product of validProducts) {
        placeholders.push(
          `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11})`
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
          product.active
        );
        paramIndex += 12;

        // Count adds vs updates
        if (existingUPCSet.has(product.upc)) {
          productsUpdated++;
        } else {
          productsAdded++;
        }
      }

      const batchQuery = `
        INSERT INTO products (
          brand_id, upc, sku, name, category, subcategory,
          wholesale_cost, msrp, size, color, gender, active
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
          active = EXCLUDED.active,
          updated_at = CURRENT_TIMESTAMP
      `;

      await client.query(batchQuery, values);
      console.log(`Batch upsert complete: ${productsAdded} added, ${productsUpdated} updated`);
    }

    // Step 3: Log the upload
    const uploadStatus = errors.length > 0 ? 'completed_with_errors' : 'completed';
    await client.query(
      `INSERT INTO catalog_uploads (
        brand_id, file_name, products_added, products_updated,
        products_deactivated, upload_status, error_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        actualBrandId,
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

// Preview file (get first N rows)
router.post('/preview', authenticateToken, authorizeRoles('admin', 'buyer'), upload.single('file'), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Parse file based on type
    let rows;
    const fileExt = path.extname(file.originalname).toLowerCase();

    if (fileExt === '.csv') {
      rows = await parseCSVFile(file.path);
    } else if (fileExt === '.xlsx' || fileExt === '.xls') {
      rows = parseExcelFile(file.path);
    } else {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    // Get first 5 rows and column names
    const preview = rows.slice(0, 5);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    // Clean up uploaded file
    fs.unlinkSync(file.path);

    res.json({
      columns,
      preview,
      totalRows: rows.length
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
