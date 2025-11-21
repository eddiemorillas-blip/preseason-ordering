const pool = require('./src/config/database');
const fs = require('fs');

async function runMigration() {
  try {
    console.log('Running migration 003: Create sales data tables...');

    const sql = fs.readFileSync('./migrations/003_sales_data.sql', 'utf8');
    await pool.query(sql);

    console.log('Migration 003 completed successfully!');
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
