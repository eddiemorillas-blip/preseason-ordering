const { BigQuery } = require('@google-cloud/bigquery');
const path = require('path');

// Initialize BigQuery client
// Support credentials as base64, JSON string, or file path
let bigqueryConfig = {
  projectId: 'front-data-production'
};

if (process.env.GOOGLE_CREDENTIALS_BASE64) {
  // Production: credentials passed as base64-encoded JSON
  try {
    const decoded = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf8');
    bigqueryConfig.credentials = JSON.parse(decoded);
    console.log('BigQuery: Using credentials from GOOGLE_CREDENTIALS_BASE64 env var');
  } catch (e) {
    console.error('Failed to parse GOOGLE_CREDENTIALS_BASE64:', e.message);
  }
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  // Alternative: credentials passed as JSON string
  try {
    bigqueryConfig.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    console.log('BigQuery: Using credentials from GOOGLE_APPLICATION_CREDENTIALS_JSON env var');
  } catch (e) {
    console.error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON:', e.message);
  }
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // Alternative: path to credentials file
  bigqueryConfig.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  console.log('BigQuery: Using credentials from file path:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
} else {
  // Local development: use local credentials file
  bigqueryConfig.keyFilename = path.join(__dirname, '../../credentials/bigquery-credentials.json');
  console.log('BigQuery: Using local credentials file');
}

const bigquery = new BigQuery(bigqueryConfig);

/**
 * Get sales summary by UPC for the last N months
 */
async function getSalesByUPC(months = 12) {
  const query = `
    SELECT
      p.BARCODE as upc,
      p.DESCRIPTION as product_name,
      p.DISP_CATEGORY as category,
      p.REV_CATEGORY as revenue_category,
      v.VENDOR_NAME as vendor_name,
      p.facility_id_true as facility_id,
      SUM(ii.QUANTITY) as total_qty_sold,
      SUM(ii.QUANTITY * ii.PRICE) as total_revenue,
      COUNT(DISTINCT i.INVOICE_ID) as transaction_count,
      MIN(i.POSTDATE) as first_sale,
      MAX(i.POSTDATE) as last_sale
    FROM rgp_cleaned_zone.invoice_items_all ii
    JOIN rgp_cleaned_zone.invoices_all i ON ii.invoice_concat = i.invoice_concat
    JOIN rgp_cleaned_zone.products_all p ON ii.product_concat = p.product_concat
    LEFT JOIN rgp_cleaned_zone.vendors_all v ON p.vendor_concat = v.vendor_concat
    WHERE i.POSTDATE >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${months} MONTH)
      AND p.BARCODE IS NOT NULL
      AND LENGTH(p.BARCODE) > 5
      AND p.BARCODE NOT IN ('TAX', 'CREDIT', 'WRITEOFF')
      AND ii.QUANTITY > 0
    GROUP BY p.BARCODE, p.DESCRIPTION, p.DISP_CATEGORY, p.REV_CATEGORY,
             v.VENDOR_NAME, p.facility_id_true
    ORDER BY total_revenue DESC
  `;

  const [rows] = await bigquery.query({ query });
  return rows;
}

/**
 * Get sales summary by vendor/brand and category
 */
async function getSalesByBrandCategory(months = 12) {
  const query = `
    SELECT
      v.VENDOR_NAME as vendor_name,
      p.DISP_CATEGORY as category,
      p.REV_CATEGORY as revenue_category,
      p.facility_id_true as facility_id,
      COUNT(DISTINCT p.BARCODE) as unique_products,
      SUM(ii.QUANTITY) as total_qty_sold,
      SUM(ii.QUANTITY * ii.PRICE) as total_revenue,
      COUNT(DISTINCT i.INVOICE_ID) as transaction_count
    FROM rgp_cleaned_zone.invoice_items_all ii
    JOIN rgp_cleaned_zone.invoices_all i ON ii.invoice_concat = i.invoice_concat
    JOIN rgp_cleaned_zone.products_all p ON ii.product_concat = p.product_concat
    LEFT JOIN rgp_cleaned_zone.vendors_all v ON p.vendor_concat = v.vendor_concat
    WHERE i.POSTDATE >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${months} MONTH)
      AND p.BARCODE IS NOT NULL
      AND LENGTH(p.BARCODE) > 5
      AND ii.QUANTITY > 0
    GROUP BY v.VENDOR_NAME, p.DISP_CATEGORY, p.REV_CATEGORY, p.facility_id_true
    ORDER BY total_revenue DESC
  `;

  const [rows] = await bigquery.query({ query });
  return rows;
}

/**
 * Get monthly sales trends by vendor/brand
 */
async function getMonthlySalesByBrand(months = 24) {
  const query = `
    SELECT
      v.VENDOR_NAME as vendor_name,
      FORMAT_TIMESTAMP('%Y-%m', i.POSTDATE) as month,
      SUM(ii.QUANTITY) as total_qty_sold,
      SUM(ii.QUANTITY * ii.PRICE) as total_revenue
    FROM rgp_cleaned_zone.invoice_items_all ii
    JOIN rgp_cleaned_zone.invoices_all i ON ii.invoice_concat = i.invoice_concat
    JOIN rgp_cleaned_zone.products_all p ON ii.product_concat = p.product_concat
    LEFT JOIN rgp_cleaned_zone.vendors_all v ON p.vendor_concat = v.vendor_concat
    WHERE i.POSTDATE >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${months} MONTH)
      AND p.BARCODE IS NOT NULL
      AND LENGTH(p.BARCODE) > 5
      AND ii.QUANTITY > 0
      AND v.VENDOR_NAME IS NOT NULL
    GROUP BY v.VENDOR_NAME, month
    ORDER BY v.VENDOR_NAME, month
  `;

  const [rows] = await bigquery.query({ query });
  return rows;
}

/**
 * Get all vendors/brands from RGP
 */
async function getVendors() {
  const query = `
    SELECT DISTINCT
      v.VENDOR_ID,
      v.VENDOR_NAME,
      v.CONTACT_EMAIL,
      COUNT(DISTINCT p.PRODUCT_ID) as product_count
    FROM rgp_cleaned_zone.vendors_all v
    LEFT JOIN rgp_cleaned_zone.products_all p ON v.vendor_concat = p.vendor_concat
    WHERE v.VENDOR_NAME IS NOT NULL AND v.VENDOR_NAME != ''
    GROUP BY v.VENDOR_ID, v.VENDOR_NAME, v.CONTACT_EMAIL
    ORDER BY v.VENDOR_NAME
  `;

  const [rows] = await bigquery.query({ query });
  return rows;
}

/**
 * Get facility/location mapping
 */
async function getFacilities() {
  const query = `
    SELECT DISTINCT
      FACILITY_ID,
      facility_id_true
    FROM rgp_cleaned_zone.facilities_all
    WHERE FACILITY_ID IS NOT NULL
  `;

  const [rows] = await bigquery.query({ query });
  return rows;
}

/**
 * Test connection to BigQuery
 */
async function testConnection() {
  try {
    const [rows] = await bigquery.query({
      query: 'SELECT 1 as test'
    });
    return { success: true, message: 'Connected to BigQuery' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/**
 * Facility ID to location mapping
 * BigQuery facility_id -> Database location_id
 */
const FACILITY_TO_LOCATION = {
  '41185': 1,  // SLC
  '1003': 2,   // South Main
  '1000': 3,   // Ogden
};

const LOCATION_TO_FACILITY = {
  1: '41185',  // SLC
  2: '1003',   // South Main
  3: '1000',   // Ogden
};

/**
 * Get current stock on hand from INVENTORY_on_hand_report table
 */
async function getStockOnHand(upcs = []) {
  if (!upcs || upcs.length === 0) return [];

  // Convert UPCs to quoted strings for SQL
  const upcList = upcs.map(u => `'${u}'`).join(',');

  const query = `
    SELECT
      barcode as upc,
      CAST(facility_id AS STRING) as facility_id,
      facility_name,
      on_hand_qty as stock_on_hand
    FROM \`front-data-production.dataform.INVENTORY_on_hand_report\`
    WHERE barcode IN (${upcList})
      AND on_hand_qty IS NOT NULL
  `;

  const [rows] = await bigquery.query({ query });
  return rows;
}

/**
 * Get stock on hand for multiple UPCs, grouped by UPC and location_id
 */
async function getStockByUPCs(upcs) {
  if (!upcs || upcs.length === 0) return {};

  const stockData = await getStockOnHand(upcs);
  console.log(`BigQuery returned ${stockData.length} stock rows for ${upcs.length} UPCs`);

  // Debug: log unique facility IDs we got back
  const facilityIds = [...new Set(stockData.map(r => r.facility_id))];
  console.log('Facility IDs in stock data:', facilityIds);
  console.log('Expected facility mapping:', FACILITY_TO_LOCATION);

  // Group by UPC -> location_id -> stock
  const result = {};
  let skippedFacilities = 0;
  stockData.forEach(row => {
    const locationId = FACILITY_TO_LOCATION[row.facility_id];
    if (!locationId) {
      skippedFacilities++;
      return; // Skip unknown facilities
    }

    if (!result[row.upc]) {
      result[row.upc] = {};
    }
    result[row.upc][locationId] = parseInt(row.stock_on_hand) || 0;
  });

  if (skippedFacilities > 0) {
    console.log(`Skipped ${skippedFacilities} rows with unmapped facility IDs`);
  }

  return result;
}

module.exports = {
  bigquery,
  getSalesByUPC,
  getSalesByBrandCategory,
  getMonthlySalesByBrand,
  getVendors,
  getFacilities,
  testConnection,
  getStockOnHand,
  getStockByUPCs,
  FACILITY_TO_LOCATION,
  LOCATION_TO_FACILITY
};
