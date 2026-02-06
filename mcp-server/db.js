const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

// Fallback to .env if .env.local doesn't exist
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable not set. Please check .env.local or .env');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// BigQuery client (optional - only available if credentials are configured)
let bigquery = null;
let BigQuery = null;

try {
  BigQuery = require('@google-cloud/bigquery').BigQuery;

  let bigqueryConfig = { projectId: 'front-data-production' };

  if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    const decoded = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf8');
    bigqueryConfig.credentials = JSON.parse(decoded);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    bigqueryConfig.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    bigqueryConfig.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  } else {
    // Local dev: try credentials file
    const credPath = path.join(__dirname, '../credentials/bigquery-credentials.json');
    const fs = require('fs');
    if (fs.existsSync(credPath)) {
      bigqueryConfig.keyFilename = credPath;
    }
  }

  bigquery = new BigQuery(bigqueryConfig);
} catch (e) {
  // BigQuery not available - that's fine, live inventory tools will be disabled
  console.error('BigQuery not available:', e.message);
}

// Facility <-> Location mapping (same as main app)
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

module.exports = {
  pool,
  bigquery,
  FACILITY_TO_LOCATION,
  LOCATION_TO_FACILITY
};
