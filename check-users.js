const pool = require('./src/config/database');
const bcrypt = require('bcryptjs');

async function checkAndCreateUser() {
  try {
    console.log('Checking users table...\n');

    // Check if any users exist
    const result = await pool.query('SELECT id, first_name, last_name, email, role, active FROM users');

    console.log(`Found ${result.rows.length} user(s):`);
    result.rows.forEach(user => {
      console.log(`  - ${user.email} (${user.role}) ${user.active ? '✓' : '✗ inactive'}`);
    });

    if (result.rows.length === 0) {
      console.log('\n📝 No users found. Creating admin user...');

      // Create admin user
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const newUser = await pool.query(
        'INSERT INTO users (first_name, last_name, email, password_hash, role, active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, first_name, last_name, email, role',
        ['Admin', 'User', 'admin@example.com', hashedPassword, 'admin', true]
      );

      console.log('\n✓ Admin user created successfully!');
      console.log('  Email: admin@example.com');
      console.log('  Password: admin123');
    }

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

checkAndCreateUser();
