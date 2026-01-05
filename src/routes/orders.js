const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { getStockByUPCs, bigquery, FACILITY_TO_LOCATION } = require('../services/bigquery');

// Create ignored_products table if it doesn't exist
pool.query(`
  CREATE TABLE IF NOT EXISTS ignored_products (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    brand_id INTEGER NOT NULL REFERENCES brands(id),
    location_id INTEGER REFERENCES locations(id),
    ignored_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, brand_id, location_id)
  )
`).then(() => console.log('ignored_products table verified/created'))
  .catch(err => console.error('Error creating ignored_products table:', err.message));

// Create finalized_adjustments table if it doesn't exist
pool.query(`
  CREATE TABLE IF NOT EXISTS finalized_adjustments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    original_quantity INTEGER NOT NULL,
    adjusted_quantity INTEGER NOT NULL,
    unit_cost DECIMAL(10,2) NOT NULL,
    season_id INTEGER NOT NULL,
    brand_id INTEGER NOT NULL,
    location_id INTEGER NOT NULL,
    ship_date DATE,
    finalized_by INTEGER REFERENCES users(id),
    finalized_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(order_item_id)
  )
`).then(() => console.log('finalized_adjustments table verified/created'))
  .catch(err => console.error('Error creating finalized_adjustments table:', err.message));

// Add finalized_at column to orders if it doesn't exist
pool.query(`
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMP
`).then(() => console.log('orders.finalized_at column verified/created'))
  .catch(err => console.error('Error adding finalized_at column:', err.message));

// Month abbreviations for order numbers
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Generate readable order number: MAR26-PRA-SLC
function generateOrderNumber(shipDate, brandCode, locationCode) {
  // Use ship date if provided, otherwise use current date
  let date;
  if (shipDate) {
    // Handle various date formats: ISO timestamp, Date object, or date string
    let dateStr;
    if (shipDate instanceof Date) {
      dateStr = shipDate.toISOString().substring(0, 10);
    } else if (typeof shipDate === 'string') {
      // Extract just the date portion (handles both "2026-08-28" and "2026-08-28T00:00:00.000Z")
      dateStr = shipDate.substring(0, 10);
    } else {
      dateStr = String(shipDate).substring(0, 10);
    }
    // Parse date string as local date (add noon time to avoid timezone shifts)
    date = new Date(dateStr + 'T12:00:00');
  } else {
    date = new Date();
  }
  const month = MONTHS[date.getMonth()];
  const year = String(date.getFullYear()).slice(-2);
  return `${month}${year}-${brandCode}-${locationCode}`;
}

// GET /api/orders/product-breakdown - Get product breakdown across all orders
router.get('/product-breakdown', authenticateToken, async (req, res) => {
  try {
    let { brandId, seasonId } = req.query;

    // Handle multiple brandIds (can be array or single value)
    const brandIds = Array.isArray(brandId) ? brandId : (brandId ? [brandId] : []);

    // Build WHERE clause with optional filters
    let whereClause = "o.status != 'cancelled'";
    const params = [];
    let paramIndex = 1;

    if (brandIds.length > 0) {
      const placeholders = brandIds.map((_, i) => `$${paramIndex + i}`).join(', ');
      whereClause += ` AND o.brand_id IN (${placeholders})`;
      params.push(...brandIds);
      paramIndex += brandIds.length;
    }

    if (seasonId) {
      whereClause += ` AND o.season_id = $${paramIndex}`;
      params.push(seasonId);
      paramIndex++;
    }

    // Get breakdown by gender (normalize similar values)
    const genderResult = await pool.query(`
      SELECT
        CASE
          WHEN LOWER(p.gender) IN ('male', 'mens', 'men', 'm', 'man') THEN 'Men'
          WHEN LOWER(p.gender) IN ('female', 'womens', 'women', 'w', 'woman', 'ladies') THEN 'Women'
          WHEN LOWER(p.gender) IN ('unisex', 'uni') THEN 'Unisex'
          WHEN LOWER(p.gender) IN ('kids', 'kid', 'youth', 'boys', 'girls', 'children', 'child') THEN 'Kids'
          WHEN p.gender IS NULL OR TRIM(p.gender) = '' THEN 'Unknown'
          ELSE INITCAP(p.gender)
        END as name,
        SUM(oi.quantity) as quantity,
        SUM(oi.line_total) as value
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE ${whereClause}
      GROUP BY CASE
          WHEN LOWER(p.gender) IN ('male', 'mens', 'men', 'm', 'man') THEN 'Men'
          WHEN LOWER(p.gender) IN ('female', 'womens', 'women', 'w', 'woman', 'ladies') THEN 'Women'
          WHEN LOWER(p.gender) IN ('unisex', 'uni') THEN 'Unisex'
          WHEN LOWER(p.gender) IN ('kids', 'kid', 'youth', 'boys', 'girls', 'children', 'child') THEN 'Kids'
          WHEN p.gender IS NULL OR TRIM(p.gender) = '' THEN 'Unknown'
          ELSE INITCAP(p.gender)
        END
      ORDER BY SUM(oi.quantity) DESC
    `, params);

    // Get breakdown by category
    const categoryResult = await pool.query(`
      SELECT
        COALESCE(p.category, 'Unknown') as name,
        SUM(oi.quantity) as quantity,
        SUM(oi.line_total) as value
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE ${whereClause}
      GROUP BY p.category
      ORDER BY SUM(oi.quantity) DESC
    `, params);

    // Get breakdown by color (top 10)
    const colorResult = await pool.query(`
      SELECT
        COALESCE(p.color, 'Unknown') as name,
        SUM(oi.quantity) as quantity,
        SUM(oi.line_total) as value
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE ${whereClause}
      GROUP BY p.color
      ORDER BY SUM(oi.quantity) DESC
      LIMIT 10
    `, params);

    // Get totals (wholesale and retail)
    const totalsResult = await pool.query(`
      SELECT
        SUM(oi.quantity) as total_quantity,
        SUM(oi.line_total) as total_wholesale,
        SUM(oi.quantity * COALESCE(p.msrp, 0)) as total_retail
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE ${whereClause}
    `, params);

    const totals = totalsResult.rows[0] || { total_quantity: 0, total_wholesale: 0, total_retail: 0 };

    res.json({
      gender: genderResult.rows,
      category: categoryResult.rows,
      color: colorResult.rows,
      totals: {
        quantity: parseInt(totals.total_quantity) || 0,
        wholesale: parseFloat(totals.total_wholesale) || 0,
        retail: parseFloat(totals.total_retail) || 0
      }
    });
  } catch (error) {
    console.error('Get product breakdown error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/ship-dates - Get available ship dates for a season
router.get('/ship-dates', authenticateToken, async (req, res) => {
  try {
    const { seasonId, brandId, locationId } = req.query;

    if (!seasonId) {
      return res.status(400).json({ error: 'seasonId is required' });
    }

    let whereClause = "season_id = $1 AND status != 'cancelled' AND ship_date IS NOT NULL";
    const params = [seasonId];
    let paramIndex = 2;

    if (brandId) {
      whereClause += ` AND brand_id = $${paramIndex}`;
      params.push(brandId);
      paramIndex++;
    }

    if (locationId) {
      whereClause += ` AND location_id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }

    const result = await pool.query(`
      SELECT DISTINCT ship_date
      FROM orders
      WHERE ${whereClause}
      ORDER BY ship_date
    `, params);

    res.json({ shipDates: result.rows.map(r => r.ship_date) });
  } catch (error) {
    console.error('Get ship dates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/inventory/velocity - Get sales velocity data from BigQuery
// NOTE: This route must be before /inventory to match correctly
router.get('/inventory/velocity', authenticateToken, async (req, res) => {
  console.log('Velocity endpoint called with:', req.query);
  try {
    const { seasonId, brandId, locationId, months = 12 } = req.query;

    if (!seasonId || !brandId) {
      return res.status(400).json({ error: 'seasonId and brandId are required' });
    }

    // Get UPCs and product names for products in orders matching the filter
    let upcQuery = `
      SELECT DISTINCT p.upc, p.name as product_name
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE o.season_id = $1 AND o.brand_id = $2
        AND p.upc IS NOT NULL
    `;
    const params = [seasonId, brandId];

    if (locationId) {
      upcQuery += ' AND o.location_id = $3';
      params.push(locationId);
    }

    const upcResult = await pool.query(upcQuery, params);
    const products = upcResult.rows.filter(r => r.upc && r.upc.trim());
    const upcs = products.map(r => r.upc);
    const upcToName = {};
    products.forEach(r => { upcToName[r.upc] = r.product_name; });
    console.log(`Found ${upcs.length} UPCs for velocity lookup`);
    console.log('Sample UPCs from PostgreSQL:', upcs.slice(0, 5));

    if (upcs.length === 0) {
      return res.json({ velocity: {} });
    }

    // Get facility ID for location
    const { LOCATION_TO_FACILITY, bigquery } = require('../services/bigquery');
    const facilityId = locationId ? LOCATION_TO_FACILITY[locationId] : null;
    console.log(`Location ${locationId} -> facility ${facilityId}`);

    // Query BigQuery for sales velocity
    // Create both original UPCs and versions with leading zeros stripped for matching
    const upcList = upcs.map(u => `'${u}'`).join(',');
    const upcListNoLeadingZeros = upcs.map(u => `'${u.replace(/^0+/, '')}'`).join(',');

    let velocityQuery = `
      SELECT
        p.BARCODE as upc,
        SUM(ii.QUANTITY) as total_qty_sold,
        COUNT(DISTINCT FORMAT_DATE('%Y-%m', DATE(i.POSTDATE))) as months_of_data,
        MAX(i.POSTDATE) as last_sale
      FROM rgp_cleaned_zone.invoice_items_all ii
      JOIN rgp_cleaned_zone.invoices_all i ON ii.invoice_concat = i.invoice_concat
      JOIN rgp_cleaned_zone.products_all p ON ii.product_concat = p.product_concat
      WHERE DATE(i.POSTDATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${parseInt(months)} MONTH)
        AND (p.BARCODE IN (${upcList}) OR LTRIM(p.BARCODE, '0') IN (${upcListNoLeadingZeros}))
        AND ii.QUANTITY > 0
    `;

    if (facilityId) {
      velocityQuery += ` AND p.facility_id_true = '${facilityId}'`;
    }

    velocityQuery += ` GROUP BY p.BARCODE`;

    console.log('Running BigQuery velocity query...');
    const [rows] = await bigquery.query({ query: velocityQuery });
    console.log(`BigQuery returned ${rows.length} rows for ${upcs.length} UPCs`);

    // Log sample of what BigQuery returned
    if (rows.length > 0) {
      console.log('Sample BigQuery UPCs:', rows.slice(0, 5).map(r => r.upc));
    }

    // Build a map of BigQuery UPCs (both original and normalized)
    const bqUpcMap = {};
    rows.forEach(row => {
      const monthsOfData = Math.max(1, parseInt(row.months_of_data) || 1);
      const totalSold = parseInt(row.total_qty_sold) || 0;
      const velocityData = {
        avg_monthly_sales: Math.round((totalSold / monthsOfData) * 10) / 10,
        total_sold: totalSold,
        months_of_data: monthsOfData,
        last_sale: row.last_sale
      };
      // Store both the original and stripped version for lookup
      bqUpcMap[row.upc] = velocityData;
      bqUpcMap[row.upc.replace(/^0+/, '')] = velocityData;
    });

    // Match PostgreSQL UPCs to BigQuery results
    const velocity = {};
    upcs.forEach(upc => {
      // Try exact match first, then stripped match
      const match = bqUpcMap[upc] || bqUpcMap[upc.replace(/^0+/, '')];
      if (match) {
        velocity[upc] = match;
      }
    });

    // Log UPCs that had no sales data (UPC matching only - no name fallback)
    const missingUPCs = upcs.filter(upc => !velocity[upc]);
    console.log(`Matched ${Object.keys(velocity).length}/${upcs.length} UPCs with sales data`);
    if (missingUPCs.length > 0) {
      console.log(`${missingUPCs.length} UPCs have no sales data in BigQuery`);
    }

    res.json({ velocity });
  } catch (error) {
    console.error('Get velocity error:', error.message, error.stack);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/orders/available-products/filters - Get available filter options for add items
router.get('/available-products/filters', authenticateToken, async (req, res) => {
  try {
    const { seasonId, brandId } = req.query;

    if (!seasonId || !brandId) {
      return res.status(400).json({ error: 'seasonId and brandId are required' });
    }

    // Get distinct categories, genders, and sizes for products in this brand's pricelist for the season
    const [categoriesResult, gendersResult, sizesResult] = await Promise.all([
      pool.query(`
        SELECT DISTINCT p.category
        FROM products p
        INNER JOIN season_prices sp ON sp.product_id = p.id AND sp.season_id = $2
        WHERE p.brand_id = $1
          AND p.active = true
          AND p.category IS NOT NULL
          AND p.category != ''
        ORDER BY p.category
      `, [brandId, seasonId]),
      pool.query(`
        SELECT DISTINCT p.gender
        FROM products p
        INNER JOIN season_prices sp ON sp.product_id = p.id AND sp.season_id = $2
        WHERE p.brand_id = $1
          AND p.active = true
          AND p.gender IS NOT NULL
          AND p.gender != ''
        ORDER BY p.gender
      `, [brandId, seasonId]),
      pool.query(`
        SELECT size FROM (
          SELECT DISTINCT p.size
          FROM products p
          INNER JOIN season_prices sp ON sp.product_id = p.id AND sp.season_id = $2
          WHERE p.brand_id = $1
            AND p.active = true
            AND p.size IS NOT NULL
            AND p.size != ''
        ) sizes
        ORDER BY
          CASE
            WHEN size ~ '^[0-9]+(\.[0-9]+)?$' THEN CAST(size AS DECIMAL)
            ELSE 0
          END ASC,
          CASE size
            WHEN 'XXS' THEN 1 WHEN '2XS' THEN 1
            WHEN 'XS' THEN 2
            WHEN 'S' THEN 3
            WHEN 'M' THEN 4
            WHEN 'L' THEN 5
            WHEN 'XL' THEN 6
            WHEN 'XXL' THEN 7 WHEN '2XL' THEN 7
            WHEN 'XXXL' THEN 8 WHEN '3XL' THEN 8
            ELSE 50
          END,
          size ASC
      `, [brandId, seasonId])
    ]);

    res.json({
      categories: categoriesResult.rows.map(r => r.category),
      genders: gendersResult.rows.map(r => r.gender),
      sizes: sizesResult.rows.map(r => r.size)
    });
  } catch (error) {
    console.error('Get available products filters error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/available-products - Get products not in order with zero stock
router.get('/available-products', authenticateToken, async (req, res) => {
  try {
    const { seasonId, brandId, locationId, shipDate, categories, sizes, gender, hasSalesHistory, includeWithStock } = req.query;

    if (!seasonId || !brandId || !locationId) {
      return res.status(400).json({ error: 'seasonId, brandId, and locationId are required' });
    }

    // Build dynamic WHERE clause for filters
    const params = [brandId, seasonId, locationId];
    let paramIndex = 4;
    let categoryFilter = '';
    let sizeFilter = '';
    let genderFilter = '';

    // Handle multiple categories (comma-separated string or array)
    const categoryList = categories ? (typeof categories === 'string' ? categories.split(',') : (Array.isArray(categories) ? categories : [categories])) : [];
    if (categoryList.length > 0) {
      const placeholders = categoryList.map((_, i) => `$${paramIndex + i}`).join(', ');
      categoryFilter = ` AND p.category IN (${placeholders})`;
      params.push(...categoryList);
      paramIndex += categoryList.length;
    }

    // Handle multiple sizes (comma-separated string or array)
    const sizeList = sizes ? (typeof sizes === 'string' ? sizes.split(',') : (Array.isArray(sizes) ? sizes : [sizes])) : [];
    if (sizeList.length > 0) {
      const placeholders = sizeList.map((_, i) => `$${paramIndex + i}`).join(', ');
      sizeFilter = ` AND p.size IN (${placeholders})`;
      params.push(...sizeList);
      paramIndex += sizeList.length;
    }

    if (gender) {
      genderFilter = ` AND p.gender = $${paramIndex}`;
      params.push(gender);
      paramIndex++;
    }

    // Build sales history filter using EXISTS subquery (avoids DISTINCT issues)
    const salesHistoryFilter = hasSalesHistory === 'true'
      ? ` AND EXISTS (SELECT 1 FROM sales_by_upc sbu WHERE sbu.upc = p.upc AND sbu.total_qty_sold > 0)`
      : '';

    // Get products in catalog for brand/season that are NOT in any order for this location
    // Also exclude products that have been ignored
    // IMPORTANT: Only include products with season pricing (confirms vendor availability)
    const productsResult = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.base_name,
        p.sku,
        p.upc,
        p.size,
        p.color,
        p.inseam,
        COALESCE(sp.wholesale_cost, p.wholesale_cost) as wholesale_cost,
        COALESCE(sp.msrp, p.msrp) as msrp,
        p.category,
        p.gender
      FROM products p
      INNER JOIN season_prices sp ON sp.product_id = p.id AND sp.season_id = $2
      WHERE
        p.brand_id = $1
        AND p.active = true
        AND p.id NOT IN (
          SELECT DISTINCT oi.product_id
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE o.season_id = $2
            AND o.location_id = $3
            AND o.status != 'cancelled'
        )
        AND p.id NOT IN (
          SELECT product_id FROM ignored_products
          WHERE brand_id = $1
            AND (location_id = $3 OR location_id IS NULL)
        )
        ${categoryFilter}
        ${sizeFilter}
        ${genderFilter}
        ${salesHistoryFilter}
      ORDER BY p.base_name, p.color,
        CASE
          WHEN p.size ~ '^[0-9]+(\.[0-9]+)?$' THEN CAST(p.size AS DECIMAL)
          ELSE 0
        END ASC,
        CASE p.size
          WHEN 'XXS' THEN 1 WHEN '2XS' THEN 1
          WHEN 'XS' THEN 2
          WHEN 'S' THEN 3
          WHEN 'M' THEN 4
          WHEN 'L' THEN 5
          WHEN 'XL' THEN 6
          WHEN 'XXL' THEN 7 WHEN '2XL' THEN 7
          WHEN 'XXXL' THEN 8 WHEN '3XL' THEN 8
          ELSE 50
        END,
        p.size ASC
    `, params);

    const products = productsResult.rows;
    console.log(`Found ${products.length} products not in order for brand ${brandId}, season ${seasonId}, location ${locationId} (filters: categories=${categoryList.length > 0 ? categoryList.join(',') : 'all'}, gender=${gender || 'all'}, hasSalesHistory=${hasSalesHistory || 'false'})`);

    if (products.length === 0) {
      return res.json({ families: [], totalProducts: 0 });
    }

    // Get stock on hand from BigQuery for all UPCs
    const upcs = [...new Set(products.map(p => p.upc).filter(Boolean))];
    let stockData = {};

    if (upcs.length > 0) {
      try {
        stockData = await getStockByUPCs(upcs);
        console.log(`Got stock data for ${Object.keys(stockData).length}/${upcs.length} UPCs`);
        // Debug: check specific UPC
        const debugUpc = '8057963494218';
        if (upcs.includes(debugUpc)) {
          console.log(`DEBUG: UPC ${debugUpc} in request, stockData has it: ${!!stockData[debugUpc]}, value:`, stockData[debugUpc]);
        }
      } catch (bqError) {
        console.error('BigQuery stock fetch error:', bqError.message);
        // Continue without stock data
      }
    }

    // Add stock_on_hand to each product, optionally filter to zero-stock only
    // Use null when no stock data found (to distinguish from "has data, qty is 0")
    const filteredProducts = products.filter(product => {
      const upcStock = stockData[product.upc];
      // null = no data found, 0 = data found but stock is zero
      const stockOnHand = upcStock !== undefined ? (upcStock[parseInt(locationId)] || 0) : null;
      product.stock_on_hand = stockOnHand;
      // If includeWithStock is true, return all products regardless of stock
      // Otherwise, only return zero-stock items (null treated as zero for filtering)
      return includeWithStock === 'true' || (stockOnHand === null || stockOnHand === 0);
    });

    console.log(`Filtered to ${filteredProducts.length} products (includeWithStock=${includeWithStock || 'false'})`);

    // Check if any of these products exist in future orders for this location
    let futureOrdersMap = {};
    if (shipDate && filteredProducts.length > 0) {
      const productIds = filteredProducts.map(p => p.id);
      const futureOrdersResult = await pool.query(`
        SELECT
          oi.product_id,
          o.order_number,
          o.ship_date,
          oi.quantity,
          oi.adjusted_quantity
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.location_id = $1
          AND o.status != 'cancelled'
          AND DATE(o.ship_date) > DATE($2::timestamp)
          AND oi.product_id = ANY($3)
        ORDER BY o.ship_date
      `, [locationId, shipDate, productIds]);

      // Group by product_id
      futureOrdersResult.rows.forEach(row => {
        if (!futureOrdersMap[row.product_id]) {
          futureOrdersMap[row.product_id] = [];
        }
        futureOrdersMap[row.product_id].push({
          order_number: row.order_number,
          ship_date: row.ship_date,
          quantity: row.adjusted_quantity !== null ? row.adjusted_quantity : row.quantity
        });
      });
      console.log(`Found ${Object.keys(futureOrdersMap).length} products with future orders`);
    }

    // Add future orders info to each product
    filteredProducts.forEach(product => {
      product.future_orders = futureOrdersMap[product.id] || [];
    });

    // Helper to extract family name from product name
    // Removes size patterns from the end, preserving model and color
    // (e.g., "Instinct VS Black/Orange 42" -> "Instinct VS Black/Orange")
    // NOTE: We use full `name` instead of `base_name` because base_name strips color,
    // which incorrectly merges different colorways into the same family
    const extractFamilyName = (product) => {
      // Use full name to preserve model variations and colors
      let name = product.name || product.base_name || '';

      // Common size patterns to remove from the end
      const sizePatterns = [
        /\s+(XXS|XS|S|M|L|XL|XXL|2XL|3XL|XXXL)$/i,
        /\s+\d+(\.\d+)?$/,  // Numeric sizes like "32" or "10.5"
        /\s+\d+\/\d+$/,     // Fraction sizes like "1/2"
        /\s+(One Size|OS|OSFA)$/i
      ];

      for (const pattern of sizePatterns) {
        name = name.replace(pattern, '');
      }

      return name.trim();
    };

    // Group by extracted family name
    const familyMap = {};
    filteredProducts.forEach(product => {
      const familyName = extractFamilyName(product);
      if (!familyMap[familyName]) {
        familyMap[familyName] = {
          base_name: familyName,
          category: product.category,
          products: []
        };
      }
      familyMap[familyName].products.push(product);
    });

    const families = Object.values(familyMap).sort((a, b) =>
      a.base_name.localeCompare(b.base_name)
    );

    res.json({
      families,
      totalProducts: filteredProducts.length
    });
  } catch (error) {
    console.error('Get available products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orders/ignore-product - Ignore a product from available products list
router.post('/ignore-product', authenticateToken, async (req, res) => {
  try {
    const { productId, brandId, locationId } = req.body;

    if (!productId || !brandId) {
      return res.status(400).json({ error: 'productId and brandId are required' });
    }

    await pool.query(`
      INSERT INTO ignored_products (product_id, brand_id, location_id, ignored_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (product_id, brand_id, location_id) DO NOTHING
    `, [productId, brandId, locationId || null, req.user.id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Ignore product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/ignored-products - Get list of ignored products
router.get('/ignored-products', authenticateToken, async (req, res) => {
  try {
    const { brandId, locationId } = req.query;

    let query = `
      SELECT ip.*, p.name as product_name, p.sku, p.upc, p.color, p.size
      FROM ignored_products ip
      JOIN products p ON ip.product_id = p.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (brandId) {
      query += ` AND ip.brand_id = $${paramIndex}`;
      params.push(brandId);
      paramIndex++;
    }

    if (locationId) {
      query += ` AND (ip.location_id = $${paramIndex} OR ip.location_id IS NULL)`;
      params.push(locationId);
      paramIndex++;
    }

    query += ' ORDER BY p.name';

    const result = await pool.query(query, params);
    res.json({ ignoredProducts: result.rows });
  } catch (error) {
    console.error('Get ignored products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orders/unignore-product - Remove a product from ignore list
router.post('/unignore-product', authenticateToken, async (req, res) => {
  try {
    const { productId, brandId, locationId } = req.body;

    if (!productId || !brandId) {
      return res.status(400).json({ error: 'productId and brandId are required' });
    }

    await pool.query(`
      DELETE FROM ignored_products
      WHERE product_id = $1 AND brand_id = $2 AND (location_id = $3 OR ($3 IS NULL AND location_id IS NULL))
    `, [productId, brandId, locationId || null]);

    res.json({ success: true });
  } catch (error) {
    console.error('Unignore product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/inventory - Get inventory view for order adjustment
router.get('/inventory', authenticateToken, async (req, res) => {
  try {
    const { seasonId, brandId, locationId, shipDate } = req.query;

    console.log('Inventory request params:', { seasonId, brandId, locationId, shipDate });

    if (!seasonId) {
      return res.status(400).json({ error: 'seasonId is required' });
    }

    // Build WHERE clause
    let whereClause = "o.season_id = $1 AND o.status != 'cancelled'";
    const params = [seasonId];
    let paramIndex = 2;

    if (brandId) {
      whereClause += ` AND o.brand_id = $${paramIndex}`;
      params.push(brandId);
      paramIndex++;
    }

    if (locationId) {
      whereClause += ` AND o.location_id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }

    if (shipDate) {
      // Compare just the date portion to avoid timezone mismatch issues
      whereClause += ` AND DATE(o.ship_date) = DATE($${paramIndex}::timestamp)`;
      params.push(shipDate);
      paramIndex++;
    }

    // Get order items with product details
    const inventoryResult = await pool.query(`
      SELECT
        oi.id as item_id,
        oi.order_id,
        oi.product_id,
        oi.quantity as original_quantity,
        oi.adjusted_quantity,
        oi.unit_cost,
        oi.line_total,
        o.order_number,
        o.status as order_status,
        o.location_id,
        p.name as product_name,
        p.base_name,
        p.sku,
        p.upc,
        p.size,
        p.color,
        p.inseam,
        p.wholesale_cost,
        p.msrp,
        p.category,
        p.gender,
        b.name as brand_name,
        b.id as brand_id,
        l.name as location_name
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      JOIN brands b ON p.brand_id = b.id
      LEFT JOIN locations l ON o.location_id = l.id
      WHERE ${whereClause}
      ORDER BY p.base_name, p.color,
        CASE
          WHEN p.size ~ '^[0-9]+(\.[0-9]+)?$' THEN CAST(p.size AS DECIMAL)
          ELSE 0
        END ASC,
        CASE p.size
          WHEN 'XXS' THEN 1 WHEN '2XS' THEN 1
          WHEN 'XS' THEN 2
          WHEN 'S' THEN 3
          WHEN 'M' THEN 4
          WHEN 'L' THEN 5
          WHEN 'XL' THEN 6
          WHEN 'XXL' THEN 7 WHEN '2XL' THEN 7
          WHEN 'XXXL' THEN 8 WHEN '3XL' THEN 8
          ELSE 50
        END,
        p.size ASC
    `, params);

    // Get stock on hand from BigQuery for all UPCs
    const items = inventoryResult.rows;
    const orderNumbers = [...new Set(items.map(item => item.order_number))];
    console.log(`Inventory query returned ${items.length} items from orders: ${orderNumbers.join(', ')}`);
    const upcs = [...new Set(items.map(item => item.upc).filter(Boolean))];

    let stockData = {};
    console.log(`Fetching stock for ${upcs.length} unique UPCs`);
    if (upcs.length > 0) {
      try {
        stockData = await getStockByUPCs(upcs);
        console.log(`Got stock data for ${Object.keys(stockData).length} UPCs`);
        // Debug: check specific UPC (Crux 42)
        const debugUpc = '8057963494218';
        if (upcs.includes(debugUpc)) {
          console.log(`DEBUG INVENTORY: UPC ${debugUpc} in request, stockData has it: ${!!stockData[debugUpc]}, value:`, stockData[debugUpc]);
        }
        // Log a few sample UPCs that have vs don't have stock
        const withStock = Object.keys(stockData).slice(0, 3);
        const withoutStock = upcs.filter(u => !stockData[u]).slice(0, 3);
        console.log('Sample UPCs WITH stock data:', withStock);
        console.log('Sample UPCs WITHOUT stock data:', withoutStock);
      } catch (bqError) {
        console.error('BigQuery stock fetch error:', bqError.message, bqError.stack);
        // Continue without stock data if BigQuery fails
      }
    }

    // Add stock_on_hand to each item based on its location
    items.forEach(item => {
      const upcStock = stockData[item.upc];
      if (upcStock && item.location_id) {
        item.stock_on_hand = upcStock[item.location_id] || 0;
      } else {
        item.stock_on_hand = null;
      }
    });
    const summary = {
      totalItems: items.length,
      totalOriginalUnits: items.reduce((sum, item) => sum + parseInt(item.original_quantity || 0), 0),
      totalAdjustedUnits: items.reduce((sum, item) => {
        const qty = item.adjusted_quantity !== null ? item.adjusted_quantity : item.original_quantity;
        return sum + parseInt(qty || 0);
      }, 0),
      totalOriginalWholesale: items.reduce((sum, item) => {
        return sum + (parseFloat(item.unit_cost || 0) * parseInt(item.original_quantity || 0));
      }, 0),
      totalWholesale: items.reduce((sum, item) => {
        const qty = item.adjusted_quantity !== null ? item.adjusted_quantity : item.original_quantity;
        return sum + (parseFloat(item.unit_cost || 0) * parseInt(qty || 0));
      }, 0)
    };

    res.json({
      inventory: items,
      summary
    });
  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/finalized-status - Get finalization status for orders
// NOTE: Must be defined BEFORE /:id routes to avoid path conflicts
router.get('/finalized-status', authenticateToken, async (req, res) => {
  try {
    const { seasonId, brandId } = req.query;

    if (!seasonId || !brandId) {
      return res.status(400).json({ error: 'seasonId and brandId are required' });
    }

    // Get all orders for this season/brand with finalization info
    const ordersResult = await pool.query(`
      SELECT
        o.id as order_id,
        o.order_number,
        o.ship_date,
        o.finalized_at,
        l.name as location_name,
        l.id as location_id,
        COUNT(oi.id) as total_items,
        SUM(COALESCE(oi.adjusted_quantity, oi.quantity)) as total_units,
        SUM(COALESCE(oi.adjusted_quantity, oi.quantity) * oi.unit_cost) as total_cost
      FROM orders o
      LEFT JOIN locations l ON o.location_id = l.id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.season_id = $1
        AND o.brand_id = $2
        AND o.status != 'cancelled'
      GROUP BY o.id, o.order_number, o.ship_date, o.finalized_at, l.name, l.id
      ORDER BY o.ship_date, l.name
    `, [seasonId, brandId]);

    // Calculate summary
    const orders = ordersResult.rows;
    const summary = {
      totalOrders: orders.length,
      finalizedOrders: orders.filter(o => o.finalized_at).length,
      totalUnits: orders.reduce((sum, o) => sum + parseInt(o.total_units || 0), 0),
      totalCost: orders.reduce((sum, o) => sum + parseFloat(o.total_cost || 0), 0)
    };

    res.json({ orders, summary });
  } catch (error) {
    console.error('Get finalized status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders - List orders with filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { seasonId, brandId, locationId, status, userId } = req.query;

    let query = `
      SELECT
        o.*,
        s.name as season_name,
        b.name as brand_name,
        l.name as location_name,
        l.code as location_code,
        u.email as created_by_email,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
      FROM orders o
      LEFT JOIN seasons s ON o.season_id = s.id
      LEFT JOIN brands b ON o.brand_id = b.id
      LEFT JOIN locations l ON o.location_id = l.id
      LEFT JOIN users u ON o.created_by = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (seasonId) {
      query += ` AND o.season_id = $${paramIndex}`;
      params.push(seasonId);
      paramIndex++;
    }

    if (brandId) {
      query += ` AND o.brand_id = $${paramIndex}`;
      params.push(brandId);
      paramIndex++;
    }

    if (locationId) {
      query += ` AND o.location_id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }

    if (status) {
      query += ` AND o.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (userId) {
      query += ` AND o.created_by = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    query += ` ORDER BY o.created_at DESC`;

    const result = await pool.query(query, params);

    res.json({ orders: result.rows });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orders - Create new order
router.post('/', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const {
      season_id,
      brand_id,
      location_id,
      ship_date,
      order_type,
      notes,
      budget_total
    } = req.body;

    const userId = req.user.id;

    // Validate required fields
    if (!season_id || !brand_id || !location_id) {
      return res.status(400).json({
        error: 'Season, brand, and location are required'
      });
    }

    // Get brand and location codes for order number
    const [brandResult, locationResult] = await Promise.all([
      pool.query('SELECT code, name FROM brands WHERE id = $1', [brand_id]),
      pool.query('SELECT code FROM locations WHERE id = $1', [location_id])
    ]);

    // Generate brand code - use code if set, otherwise first 3 letters of first word (trimmed, no spaces)
    let brandCode = brandResult.rows[0]?.code;
    if (!brandCode) {
      const brandName = brandResult.rows[0]?.name || 'UNK';
      // Get first word only, trim, take first 3 chars, uppercase, remove any non-alphanumeric
      brandCode = brandName.split(' ')[0].trim().substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!brandCode) brandCode = 'UNK';
    }
    const locationCode = locationResult.rows[0]?.code || 'UNK';

    // Generate order number with uniqueness handling
    let orderNumber = generateOrderNumber(ship_date, brandCode, locationCode);

    // Check if order number already exists, if so append a counter
    const existingOrders = await pool.query(
      'SELECT order_number FROM orders WHERE order_number LIKE $1 ORDER BY order_number DESC',
      [orderNumber + '%']
    );

    if (existingOrders.rows.length > 0) {
      // Find the highest counter suffix
      let maxCounter = 0;
      for (const row of existingOrders.rows) {
        if (row.order_number === orderNumber) {
          maxCounter = Math.max(maxCounter, 1);
        } else {
          const match = row.order_number.match(new RegExp(`^${orderNumber.replace(/[-]/g, '\\-')}-(\\d+)$`));
          if (match) {
            maxCounter = Math.max(maxCounter, parseInt(match[1], 10));
          }
        }
      }
      if (maxCounter > 0) {
        orderNumber = `${orderNumber}-${maxCounter + 1}`;
      }
    }

    const result = await pool.query(
      `INSERT INTO orders (
        order_number,
        season_id,
        brand_id,
        location_id,
        ship_date,
        order_type,
        notes,
        budget_total,
        created_by,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        orderNumber,
        season_id,
        brand_id,
        location_id,
        ship_date || null,
        order_type || 'preseason',
        notes || null,
        budget_total || null,
        userId,
        'draft'
      ]
    );

    res.status(201).json({
      message: 'Order created successfully',
      order: result.rows[0]
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/:id - Get order with items
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get order details
    const orderResult = await pool.query(`
      SELECT
        o.*,
        s.name as season_name,
        b.name as brand_name,
        l.name as location_name,
        l.code as location_code,
        u.email as created_by_email
      FROM orders o
      LEFT JOIN seasons s ON o.season_id = s.id
      LEFT JOIN brands b ON o.brand_id = b.id
      LEFT JOIN locations l ON o.location_id = l.id
      LEFT JOIN users u ON o.created_by = u.id
      WHERE o.id = $1
    `, [id]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Get order items
    const itemsResult = await pool.query(`
      SELECT
        oi.*,
        oi.unit_cost as unit_price,
        p.name as product_name,
        p.sku,
        p.upc,
        p.base_name,
        p.size,
        p.color,
        p.inseam,
        p.wholesale_cost,
        p.msrp
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      ORDER BY p.base_name, p.color, COALESCE(p.inseam, 'ZZZ'),
        CASE
          WHEN p.size ~ '^[0-9]+(\.[0-9]+)?$' THEN CAST(p.size AS DECIMAL)
          ELSE 0
        END ASC,
        CASE p.size
          WHEN 'XXS' THEN 1 WHEN '2XS' THEN 1
          WHEN 'XS' THEN 2
          WHEN 'S' THEN 3
          WHEN 'M' THEN 4
          WHEN 'L' THEN 5
          WHEN 'XL' THEN 6
          WHEN 'XXL' THEN 7 WHEN '2XL' THEN 7
          WHEN 'XXXL' THEN 8 WHEN '3XL' THEN 8
          ELSE 50
        END,
        p.size ASC
    `, [id]);

    res.json({
      order: orderResult.rows[0],
      items: itemsResult.rows
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/:id/family-groups - Get items grouped by product family
router.get('/:id/family-groups', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT
        p.base_name,
        p.color,
        json_agg(
          json_build_object(
            'id', oi.id,
            'product_id', oi.product_id,
            'product_name', p.name,
            'size', p.size,
            'color', p.color,
            'quantity', oi.quantity,
            'unit_price', oi.unit_cost,
            'line_total', oi.line_total
          ) ORDER BY
            CASE
              WHEN p.size ~ '^[0-9]+(\.[0-9]+)?$' THEN CAST(p.size AS DECIMAL)
              ELSE 0
            END ASC,
            CASE p.size
              WHEN 'XXS' THEN 1 WHEN '2XS' THEN 1
              WHEN 'XS' THEN 2
              WHEN 'S' THEN 3
              WHEN 'M' THEN 4
              WHEN 'L' THEN 5
              WHEN 'XL' THEN 6
              WHEN 'XXL' THEN 7 WHEN '2XL' THEN 7
              WHEN 'XXXL' THEN 8 WHEN '3XL' THEN 8
              ELSE 50
            END,
            p.size ASC
        ) as items
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      GROUP BY p.base_name, p.color
      ORDER BY p.base_name, p.color
    `, [id]);

    res.json({ families: result.rows });
  } catch (error) {
    console.error('Get order family groups error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orders/:id/items - Add item to order
router.post('/:id/items', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { id } = req.params;
    const { product_id, quantity, unit_price, notes, is_addition } = req.body;

    if (!product_id || !quantity) {
      return res.status(400).json({ error: 'Product ID and quantity are required' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get product details
      const productResult = await client.query(
        'SELECT * FROM products WHERE id = $1',
        [product_id]
      );

      if (productResult.rows.length === 0) {
        throw new Error('Product not found');
      }

      const product = productResult.rows[0];
      const price = unit_price || product.wholesale_cost || 0;
      const lineTotal = parseFloat(price) * parseInt(quantity);

      // For items added via "Add Items" (is_addition=true):
      // - original quantity = 0 (doesn't count toward Original $)
      // - adjusted_quantity = qty (counts toward Current $)
      const originalQty = is_addition ? 0 : quantity;
      const adjustedQty = is_addition ? quantity : null;

      // Insert order item
      const itemResult = await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, adjusted_quantity, unit_cost, line_total, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [id, product_id, originalQty, adjustedQty, price, lineTotal, notes || null]
      );

      // Update order total
      await client.query(
        `UPDATE orders
         SET current_total = (
           SELECT COALESCE(SUM(line_total), 0)
           FROM order_items
           WHERE order_id = $1
         ),
         updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id]
      );

      await client.query('COMMIT');

      res.status(201).json({
        message: 'Item added successfully',
        item: itemResult.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Add order item error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/orders/:id/copy - Copy order to another location with variant mapping
router.post('/:id/copy', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { id } = req.params;
    const { targetLocationId, variantMapping, shipDate, notes, skipFamilies } = req.body;

    // skipFamilies is an array of base_name strings to exclude from the copy

    if (!targetLocationId) {
      return res.status(400).json({ error: 'Target location ID is required' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get source order
      const sourceOrderResult = await client.query(
        'SELECT * FROM orders WHERE id = $1',
        [id]
      );

      if (sourceOrderResult.rows.length === 0) {
        throw new Error('Source order not found');
      }

      const sourceOrder = sourceOrderResult.rows[0];

      // Get brand and location codes for order number
      const [brandResult, locationResult] = await Promise.all([
        client.query('SELECT code, name FROM brands WHERE id = $1', [sourceOrder.brand_id]),
        client.query('SELECT code FROM locations WHERE id = $1', [targetLocationId])
      ]);

      // Generate brand code - use code if set, otherwise first 3 letters of first word (trimmed, no spaces)
      let brandCode = brandResult.rows[0]?.code;
      if (!brandCode) {
        const brandName = brandResult.rows[0]?.name || 'UNK';
        brandCode = brandName.split(' ')[0].trim().substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!brandCode) brandCode = 'UNK';
      }
      const locationCode = locationResult.rows[0]?.code || 'UNK';

      // Create new order
      const effectiveShipDate = shipDate || sourceOrder.ship_date;
      let newOrderNumber = generateOrderNumber(effectiveShipDate, brandCode, locationCode);

      // Check if order number already exists, if so append a counter
      const existingOrders = await client.query(
        'SELECT order_number FROM orders WHERE order_number LIKE $1 ORDER BY order_number DESC',
        [newOrderNumber + '%']
      );

      if (existingOrders.rows.length > 0) {
        let maxCounter = 0;
        for (const row of existingOrders.rows) {
          if (row.order_number === newOrderNumber) {
            maxCounter = Math.max(maxCounter, 1);
          } else {
            const match = row.order_number.match(new RegExp(`^${newOrderNumber.replace(/[-]/g, '\\-')}-(\\d+)$`));
            if (match) {
              maxCounter = Math.max(maxCounter, parseInt(match[1], 10));
            }
          }
        }
        if (maxCounter > 0) {
          newOrderNumber = `${newOrderNumber}-${maxCounter + 1}`;
        }
      }

      const newOrderResult = await client.query(
        `INSERT INTO orders (
          order_number,
          season_id,
          brand_id,
          location_id,
          ship_date,
          order_type,
          notes,
          budget_total,
          created_by,
          source_order_id,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          newOrderNumber,
          sourceOrder.season_id,
          sourceOrder.brand_id,
          targetLocationId,
          effectiveShipDate,
          sourceOrder.order_type,
          notes || `Copied from order ${sourceOrder.order_number}`,
          sourceOrder.budget_total,
          req.user.id,
          id, // source_order_id - track which order this was copied from
          'draft'
        ]
      );

      const newOrder = newOrderResult.rows[0];

      // Get source order items
      const sourceItemsResult = await client.query(`
        SELECT
          oi.*,
          oi.unit_cost as unit_price,
          p.base_name,
          p.size,
          p.color,
          p.inseam,
          p.name as product_name
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = $1
      `, [id]);

      // Copy items with variant mapping
      const skipSet = new Set(skipFamilies || []);

      for (const sourceItem of sourceItemsResult.rows) {
        // Skip this family if it's in the skip list
        if (skipSet.has(sourceItem.base_name)) {
          continue;
        }

        let targetProductId = sourceItem.product_id;

        // Check if variant mapping exists for this product family
        if (variantMapping && sourceItem.base_name in variantMapping) {
          const familyMapping = variantMapping[sourceItem.base_name];
          const sizeMapping = familyMapping[sourceItem.size];

          if (sizeMapping) {
            // Find product with same base_name, size, inseam but different color
            const targetColor = sizeMapping.to;
            const targetProductResult = await client.query(`
              SELECT id FROM products
              WHERE base_name = $1
              AND brand_id = $2
              AND size = $3
              AND (color = $4 OR name ILIKE $5)
              AND (inseam = $6 OR (inseam IS NULL AND $6 IS NULL))
              AND active = true
              LIMIT 1
            `, [
              sourceItem.base_name,
              sourceOrder.brand_id,
              sourceItem.size,
              targetColor,
              `%${targetColor}%`,
              sourceItem.inseam
            ]);

            if (targetProductResult.rows.length > 0) {
              targetProductId = targetProductResult.rows[0].id;
            }
          }
        }

        // Calculate line_total
        const lineTotal = parseFloat(sourceItem.unit_cost || 0) * parseInt(sourceItem.quantity || 0);

        // Insert item into new order with line_total
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_cost, line_total, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newOrder.id, targetProductId, sourceItem.quantity, sourceItem.unit_cost, lineTotal, sourceItem.notes]
        );
      }

      // Update new order total
      await client.query(
        `UPDATE orders
         SET current_total = (
           SELECT COALESCE(SUM(line_total), 0)
           FROM order_items
           WHERE order_id = $1
         )
         WHERE id = $1`,
        [newOrder.id]
      );

      await client.query('COMMIT');

      // Return new order with items
      const newOrderWithItems = await client.query(`
        SELECT
          o.*,
          s.name as season_name,
          b.name as brand_name,
          l.name as location_name,
          (SELECT json_agg(
            json_build_object(
              'id', oi.id,
              'product_id', oi.product_id,
              'product_name', p.name,
              'quantity', oi.quantity,
              'unit_price', oi.unit_cost,
              'line_total', oi.line_total
            )
          ) FROM order_items oi
          JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = o.id) as items
        FROM orders o
        JOIN seasons s ON o.season_id = s.id
        JOIN brands b ON o.brand_id = b.id
        JOIN locations l ON o.location_id = l.id
        WHERE o.id = $1
      `, [newOrder.id]);

      res.status(201).json({
        message: 'Order copied successfully',
        order: newOrderWithItems.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Copy order error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/orders/:id/copies - Get all orders that were copied from this order
router.get('/:id/copies', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT
        o.*,
        l.name as location_name,
        l.code as location_code,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count,
        (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = o.id) as total_quantity
      FROM orders o
      JOIN locations l ON o.location_id = l.id
      WHERE o.source_order_id = $1
      ORDER BY o.created_at DESC
    `, [id]);

    res.json({ copies: result.rows });
  } catch (error) {
    console.error('Get order copies error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orders/:id/push-updates - Push updates from source order to all copies
router.post('/:id/push-updates', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { targetOrderIds } = req.body; // Optional: specific orders to update, or all if not provided

    await client.query('BEGIN');

    // Get source order and its items
    const sourceOrder = await client.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (sourceOrder.rows.length === 0) {
      throw new Error('Source order not found');
    }

    const sourceItems = await client.query(`
      SELECT
        oi.*,
        p.base_name,
        p.size,
        p.color,
        p.inseam
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `, [id]);

    // Get all copied orders (or specific ones if provided)
    let copiesQuery = `
      SELECT o.*, l.name as location_name
      FROM orders o
      JOIN locations l ON o.location_id = l.id
      WHERE o.source_order_id = $1 AND o.status = 'draft'
    `;
    const queryParams = [id];

    if (targetOrderIds && targetOrderIds.length > 0) {
      copiesQuery += ` AND o.id = ANY($2)`;
      queryParams.push(targetOrderIds);
    }

    const copies = await client.query(copiesQuery, queryParams);

    if (copies.rows.length === 0) {
      throw new Error('No draft copies found to update');
    }

    const results = [];

    // For each copied order
    for (const copy of copies.rows) {
      let itemsAdded = 0;
      let itemsUpdated = 0;
      let itemsRemoved = 0;

      // Get existing items in the copy
      const copyItems = await client.query(`
        SELECT
          oi.*,
          p.base_name,
          p.size,
          p.color,
          p.inseam
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = $1
      `, [copy.id]);

      // Create a map of copy items by base_name+size+inseam for easy lookup
      const copyItemMap = new Map();
      for (const item of copyItems.rows) {
        const key = `${item.base_name}|${item.size}|${item.inseam || ''}`;
        copyItemMap.set(key, item);
      }

      // Track which items in the copy have been matched
      const matchedCopyItemIds = new Set();

      // Process each source item
      for (const sourceItem of sourceItems.rows) {
        const key = `${sourceItem.base_name}|${sourceItem.size}|${sourceItem.inseam || ''}`;
        const existingCopyItem = copyItemMap.get(key);

        if (existingCopyItem) {
          // Item exists in copy - update quantity if different
          matchedCopyItemIds.add(existingCopyItem.id);

          if (existingCopyItem.quantity !== sourceItem.quantity) {
            const lineTotal = parseFloat(existingCopyItem.unit_cost || 0) * parseInt(sourceItem.quantity);
            await client.query(`
              UPDATE order_items
              SET quantity = $1, line_total = $2
              WHERE id = $3
            `, [sourceItem.quantity, lineTotal, existingCopyItem.id]);
            itemsUpdated++;
          }
        } else {
          // Item doesn't exist in copy - find matching product for this location
          // Try to find product with same base_name, size, and inseam (may have different color)
          const matchingProduct = await client.query(`
            SELECT id, wholesale_cost FROM products
            WHERE base_name = $1 AND size = $2 AND brand_id = $3
            AND (inseam = $4 OR (inseam IS NULL AND $4 IS NULL))
            AND active = true
            LIMIT 1
          `, [sourceItem.base_name, sourceItem.size, sourceOrder.rows[0].brand_id, sourceItem.inseam]);

          if (matchingProduct.rows.length > 0) {
            const product = matchingProduct.rows[0];
            const unitCost = product.wholesale_cost || sourceItem.unit_cost || 0;
            const lineTotal = parseFloat(unitCost) * parseInt(sourceItem.quantity);

            await client.query(`
              INSERT INTO order_items (order_id, product_id, quantity, unit_cost, line_total)
              VALUES ($1, $2, $3, $4, $5)
            `, [copy.id, product.id, sourceItem.quantity, unitCost, lineTotal]);
            itemsAdded++;
          }
        }
      }

      // Remove items that are in copy but not in source
      for (const copyItem of copyItems.rows) {
        if (!matchedCopyItemIds.has(copyItem.id)) {
          await client.query('DELETE FROM order_items WHERE id = $1', [copyItem.id]);
          itemsRemoved++;
        }
      }

      // Update the copy's total
      await client.query(`
        UPDATE orders
        SET current_total = (
          SELECT COALESCE(SUM(line_total), 0)
          FROM order_items
          WHERE order_id = $1
        ),
        updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [copy.id]);

      results.push({
        orderId: copy.id,
        orderNumber: copy.order_number,
        location: copy.location_name,
        itemsAdded,
        itemsUpdated,
        itemsRemoved
      });
    }

    await client.query('COMMIT');

    res.json({
      message: `Updates pushed to ${results.length} orders`,
      results
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Push updates error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

// PATCH /api/orders/:orderId/items/:itemId - Update order item
router.patch('/:orderId/items/:itemId', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const client = await pool.connect();

  try {
    const { orderId, itemId } = req.params;
    const { quantity, unit_price, notes } = req.body;

    // Verify order exists and is editable (draft status)
    const orderResult = await client.query(
      'SELECT * FROM orders WHERE id = $1',
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Verify item exists and belongs to this order
    const itemResult = await client.query(
      'SELECT * FROM order_items WHERE id = $1 AND order_id = $2',
      [itemId, orderId]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order item not found' });
    }

    await client.query('BEGIN');

    // Get current item to calculate line_total
    const currentItem = itemResult.rows[0];
    const newQuantity = quantity !== undefined ? quantity : currentItem.quantity;
    const newUnitCost = unit_price !== undefined ? unit_price : currentItem.unit_cost;
    const newLineTotal = parseFloat(newUnitCost || 0) * parseInt(newQuantity || 0);

    // Update the item
    const updateResult = await client.query(
      `UPDATE order_items
       SET quantity = COALESCE($1, quantity),
           unit_cost = COALESCE($2, unit_cost),
           line_total = $3,
           notes = COALESCE($4, notes)
       WHERE id = $5
       RETURNING *`,
      [quantity, unit_price, newLineTotal, notes, itemId]
    );

    // Update order total
    await client.query(
      `UPDATE orders
       SET current_total = (
         SELECT COALESCE(SUM(line_total), 0)
         FROM order_items
         WHERE order_id = $1
       ),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [orderId]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Item updated successfully',
      item: updateResult.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update order item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/orders/:orderId/items/:itemId - Remove item from order
router.delete('/:orderId/items/:itemId', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const client = await pool.connect();

  try {
    const { orderId, itemId } = req.params;

    // Verify order exists and is editable (draft status)
    const orderResult = await client.query(
      'SELECT * FROM orders WHERE id = $1',
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Verify item exists and belongs to this order
    const itemResult = await client.query(
      'SELECT * FROM order_items WHERE id = $1 AND order_id = $2',
      [itemId, orderId]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order item not found' });
    }

    await client.query('BEGIN');

    // Delete the item
    await client.query('DELETE FROM order_items WHERE id = $1', [itemId]);

    // Update order total
    await client.query(
      `UPDATE orders
       SET current_total = (
         SELECT COALESCE(SUM(line_total), 0)
         FROM order_items
         WHERE order_id = $1
       ),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [orderId]
    );

    await client.query('COMMIT');

    res.json({ message: 'Item removed successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete order item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PATCH /api/orders/:orderId/items/:itemId/adjust - Adjust item quantity (preserves original)
router.patch('/:orderId/items/:itemId/adjust', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { orderId, itemId } = req.params;
    const { adjusted_quantity } = req.body;

    if (adjusted_quantity === undefined) {
      return res.status(400).json({ error: 'adjusted_quantity is required' });
    }

    // Verify item exists and belongs to this order
    const itemResult = await pool.query(
      'SELECT * FROM order_items WHERE id = $1 AND order_id = $2',
      [itemId, orderId]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order item not found' });
    }

    // Update adjusted_quantity (null to clear adjustment)
    const updateResult = await pool.query(
      `UPDATE order_items
       SET adjusted_quantity = $1
       WHERE id = $2
       RETURNING *`,
      [adjusted_quantity, itemId]
    );

    res.json({
      message: 'Item adjusted successfully',
      item: updateResult.rows[0]
    });
  } catch (error) {
    console.error('Adjust order item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/:orderId/family-colors - Get available colors for a product family in an order
router.get('/:orderId/family-colors', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { baseName, currentColor } = req.query;

    if (!baseName) {
      return res.status(400).json({ error: 'baseName is required' });
    }

    // Get the order to find brand_id and season_id
    const orderResult = await pool.query(
      'SELECT brand_id, season_id FROM orders WHERE id = $1',
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const { brand_id, season_id } = orderResult.rows[0];

    // Find all distinct colors for products with same base_name, brand, and season
    const colorsResult = await pool.query(`
      SELECT DISTINCT color
      FROM products
      WHERE base_name = $1
        AND brand_id = $2
        AND (season_id = $3 OR season_id IS NULL)
        AND active = true
        AND color IS NOT NULL
      ORDER BY color
    `, [baseName, brand_id, season_id]);

    const colors = colorsResult.rows.map(r => r.color);

    res.json({ colors, currentColor });
  } catch (error) {
    console.error('Get family colors error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orders/:orderId/change-family-color - Change color for all items in a family
router.post('/:orderId/change-family-color', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const client = await pool.connect();

  try {
    const { orderId } = req.params;
    const { baseName, currentColor, newColor } = req.body;

    if (!baseName || !newColor) {
      return res.status(400).json({ error: 'baseName and newColor are required' });
    }

    // Get the order to find brand_id and season_id
    const orderResult = await client.query(
      'SELECT brand_id, season_id FROM orders WHERE id = $1',
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const { brand_id, season_id } = orderResult.rows[0];

    await client.query('BEGIN');

    // Get all order items for this family with the current color
    const itemsResult = await client.query(`
      SELECT oi.id, oi.product_id, oi.quantity, oi.unit_cost, oi.notes, p.size, p.inseam
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
        AND p.base_name = $2
        AND (p.color = $3 OR ($3 IS NULL AND p.color IS NULL))
    `, [orderId, baseName, currentColor]);

    if (itemsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No items found for this family and color' });
    }

    const updatedItems = [];
    const notFoundItems = [];

    // For each item, find the corresponding product with the new color
    for (const item of itemsResult.rows) {
      // Find product with same base_name, size, inseam but new color
      const newProductResult = await client.query(`
        SELECT id, wholesale_cost
        FROM products
        WHERE base_name = $1
          AND brand_id = $2
          AND (season_id = $3 OR season_id IS NULL)
          AND size = $4
          AND (inseam = $5 OR ($5 IS NULL AND inseam IS NULL))
          AND color = $6
          AND active = true
        LIMIT 1
      `, [baseName, brand_id, season_id, item.size, item.inseam, newColor]);

      if (newProductResult.rows.length > 0) {
        const newProduct = newProductResult.rows[0];
        const unitCost = newProduct.wholesale_cost || item.unit_cost;
        const lineTotal = parseFloat(unitCost || 0) * parseInt(item.quantity || 0);

        // Update the order item to point to the new product
        await client.query(`
          UPDATE order_items
          SET product_id = $1, unit_cost = $2, line_total = $3
          WHERE id = $4
        `, [newProduct.id, unitCost, lineTotal, item.id]);

        updatedItems.push({
          itemId: item.id,
          size: item.size,
          inseam: item.inseam,
          newProductId: newProduct.id
        });
      } else {
        notFoundItems.push({
          itemId: item.id,
          size: item.size,
          inseam: item.inseam
        });
      }
    }

    // Update order total
    const totalResult = await client.query(`
      SELECT COALESCE(SUM(line_total), 0) as total
      FROM order_items
      WHERE order_id = $1
    `, [orderId]);

    await client.query(`
      UPDATE orders SET current_total = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
    `, [totalResult.rows[0].total, orderId]);

    await client.query('COMMIT');

    res.json({
      message: `Changed color from "${currentColor}" to "${newColor}" for ${updatedItems.length} items`,
      updatedItems,
      notFoundItems: notFoundItems.length > 0 ? notFoundItems : undefined
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Change family color error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PATCH /api/orders/:id - Update order
router.patch('/:id', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { id } = req.params;
    const { ship_date, notes, status, budget_total } = req.body;

    // Get current order to check if we need to update order_number
    const currentOrder = await pool.query(
      `SELECT o.*, b.code as brand_code, b.name as brand_name, l.code as location_code
       FROM orders o
       LEFT JOIN brands b ON o.brand_id = b.id
       LEFT JOIN locations l ON o.location_id = l.id
       WHERE o.id = $1`,
      [id]
    );

    if (currentOrder.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = currentOrder.rows[0];
    let newOrderNumber = order.order_number;

    // Check if ship_date is being updated and would change the month/year in order number
    if (ship_date !== undefined) {
      // Parse old date - extract YYYY-MM-DD and add noon to avoid timezone issues
      let oldDate = null;
      if (order.ship_date) {
        const oldDateStr = order.ship_date instanceof Date
          ? order.ship_date.toISOString().substring(0, 10)
          : String(order.ship_date).substring(0, 10);
        oldDate = new Date(oldDateStr + 'T12:00:00');
      }
      const newDate = ship_date ? new Date(ship_date + 'T12:00:00') : null;

      // If date changed and would affect the order number prefix
      if (newDate && (!oldDate ||
          oldDate.getMonth() !== newDate.getMonth() ||
          oldDate.getFullYear() !== newDate.getFullYear())) {
        const brandCode = order.brand_code || order.brand_name?.substring(0, 3).toUpperCase() || 'UNK';
        const locationCode = order.location_code || 'UNK';
        newOrderNumber = generateOrderNumber(ship_date, brandCode, locationCode);
      }
    }

    const result = await pool.query(
      `UPDATE orders
       SET ship_date = COALESCE($1, ship_date),
           notes = COALESCE($2, notes),
           status = COALESCE($3, status),
           budget_total = COALESCE($4, budget_total),
           order_number = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [ship_date, notes, status, budget_total, newOrderNumber, id]
    );

    res.json({
      message: 'Order updated successfully',
      order: result.rows[0]
    });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/orders/:id - Delete order
router.delete('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ message: 'Order deleted successfully' });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orders/batch-adjust - Batch update multiple order items
router.post('/batch-adjust', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const client = await pool.connect();

  try {
    const { adjustments } = req.body;

    if (!adjustments || !Array.isArray(adjustments) || adjustments.length === 0) {
      return res.status(400).json({ error: 'adjustments array is required' });
    }

    await client.query('BEGIN');

    let updated = 0;
    const failed = [];

    for (const adj of adjustments) {
      const { orderId, itemId, adjusted_quantity } = adj;

      if (!orderId || !itemId || adjusted_quantity === undefined) {
        failed.push({ itemId, error: 'Missing required fields' });
        continue;
      }

      try {
        // Verify item exists and belongs to this order
        const itemResult = await client.query(
          'SELECT id FROM order_items WHERE id = $1 AND order_id = $2',
          [itemId, orderId]
        );

        if (itemResult.rows.length === 0) {
          failed.push({ itemId, error: 'Item not found' });
          continue;
        }

        // Update adjusted_quantity
        await client.query(
          'UPDATE order_items SET adjusted_quantity = $1 WHERE id = $2',
          [adjusted_quantity, itemId]
        );

        updated++;
      } catch (err) {
        failed.push({ itemId, error: err.message });
      }
    }

    await client.query('COMMIT');

    res.json({ updated, failed });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Batch adjust error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/orders/:id/finalize - Finalize an order's adjustments for export
router.post('/:id/finalize', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    // Get order details
    const orderResult = await client.query(`
      SELECT o.*, b.name as brand_name, l.name as location_name
      FROM orders o
      LEFT JOIN brands b ON o.brand_id = b.id
      LEFT JOIN locations l ON o.location_id = l.id
      WHERE o.id = $1
    `, [id]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderResult.rows[0];

    // Get all order items
    const itemsResult = await client.query(`
      SELECT
        oi.id as order_item_id,
        oi.product_id,
        oi.quantity as original_quantity,
        COALESCE(oi.adjusted_quantity, oi.quantity) as adjusted_quantity,
        oi.unit_cost
      FROM order_items oi
      WHERE oi.order_id = $1
    `, [id]);

    if (itemsResult.rows.length === 0) {
      return res.status(400).json({ error: 'Order has no items to finalize' });
    }

    await client.query('BEGIN');

    // UPSERT each item into finalized_adjustments
    let finalizedCount = 0;
    for (const item of itemsResult.rows) {
      await client.query(`
        INSERT INTO finalized_adjustments (
          order_id, order_item_id, product_id,
          original_quantity, adjusted_quantity, unit_cost,
          season_id, brand_id, location_id, ship_date,
          finalized_by, finalized_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
        ON CONFLICT (order_item_id) DO UPDATE SET
          original_quantity = EXCLUDED.original_quantity,
          adjusted_quantity = EXCLUDED.adjusted_quantity,
          unit_cost = EXCLUDED.unit_cost,
          finalized_by = EXCLUDED.finalized_by,
          finalized_at = CURRENT_TIMESTAMP
      `, [
        id,
        item.order_item_id,
        item.product_id,
        item.original_quantity,
        item.adjusted_quantity,
        item.unit_cost,
        order.season_id,
        order.brand_id,
        order.location_id,
        order.ship_date,
        req.user.id
      ]);
      finalizedCount++;
    }

    // Update order's finalized_at timestamp
    await client.query(`
      UPDATE orders SET finalized_at = CURRENT_TIMESTAMP WHERE id = $1
    `, [id]);

    await client.query('COMMIT');

    // Get updated order
    const updatedOrder = await client.query(`
      SELECT id, order_number, finalized_at FROM orders WHERE id = $1
    `, [id]);

    res.json({
      success: true,
      finalizedItems: finalizedCount,
      order: updatedOrder.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Finalize order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/orders/debug-upc/:upc - Debug UPC lookup in BigQuery (temporary)
router.get('/debug-upc/:upc', async (req, res) => {
  try {
    const upc = req.params.upc;
    const searchTerm = upc.slice(-8); // Last 8 digits

    const query = `
      SELECT
        barcode,
        CAST(facility_id AS STRING) as facility_id,
        facility_name,
        on_hand_qty
      FROM \`front-data-production.dataform.INVENTORY_on_hand_report\`
      WHERE barcode LIKE '%${searchTerm}%'
      LIMIT 30
    `;

    const [rows] = await bigquery.query({ query });

    res.json({
      searchedFor: upc,
      searchTerm: searchTerm,
      resultsCount: rows.length,
      results: rows,
      facilityMapping: FACILITY_TO_LOCATION
    });
  } catch (error) {
    console.error('Debug UPC error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
