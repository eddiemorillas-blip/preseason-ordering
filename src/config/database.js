const { Pool } = require('pg');
require('dotenv').config();

// Simple config - just use the connection string
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test the connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Failed to connect to PostgreSQL database:', err.message);
  } else {
    console.log('Connected to PostgreSQL database at', res.rows[0].now);
  }
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;
