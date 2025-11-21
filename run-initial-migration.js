const pool = require('./src/config/database');
const fs = require('fs');

async function runMigration() {
  try {
    console.log('Running initial schema migration...');

    const sql = fs.readFileSync('./migrations/000_initial_schema.sql', 'utf8');
    await pool.query(sql);

    console.log('✓ Initial schema created successfully!');
    console.log('✓ Default admin user created: admin@example.com / admin123');
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
