const pool = require('./src/config/database');

async function checkSchema() {
  try {
    console.log('Checking existing database schema...\n');

    // Check what tables exist
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    console.log('Existing tables:');
    tablesResult.rows.forEach(row => console.log('  -', row.table_name));
    console.log('');

    // Check if users table exists
    const hasUsers = tablesResult.rows.some(row => row.table_name === 'users');
    console.log('Has users table:', hasUsers);

    if (!hasUsers) {
      console.log('\n❌ Missing users table - need to create it!');
    }

    // Check brands table structure
    const hasBrands = tablesResult.rows.some(row => row.table_name === 'brands');
    if (hasBrands) {
      const brandsColumns = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'brands'
        ORDER BY ordinal_position;
      `);
      console.log('\nBrands table columns:');
      brandsColumns.rows.forEach(row => console.log('  -', row.column_name, ':', row.data_type));
    }

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

checkSchema();
