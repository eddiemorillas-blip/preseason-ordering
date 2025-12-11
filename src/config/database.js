const { Pool } = require('pg');
require('dotenv').config();

// Parse DATABASE_URL and configure pool
const poolConfig = {
  connectionString: process.env.DATABASE_URL,
};

// For Railway internal connections, use SSL
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('.railway.internal')) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

// Force IPv4 for Railway internal networking
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('.railway.internal')) {
  const url = new URL(process.env.DATABASE_URL);
  poolConfig.host = url.hostname;
  poolConfig.port = url.port || 5432;
  poolConfig.user = url.username;
  poolConfig.password = url.password;
  poolConfig.database = url.pathname.slice(1);
  poolConfig.family = 4; // Force IPv4
  delete poolConfig.connectionString;
}

const pool = new Pool(poolConfig);

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
