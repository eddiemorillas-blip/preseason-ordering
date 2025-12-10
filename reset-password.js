const pool = require('./src/config/database');
const bcrypt = require('bcryptjs');

async function resetPassword() {
  try {
    // Get email from command line or use default
    const email = process.argv[2] || 'admin@frontclimbing.com';
    const newPassword = process.argv[3] || 'admin123';

    console.log(`Resetting password for: ${email}`);
    console.log(`New password: ${newPassword}\n`);

    // Check if user exists
    const userCheck = await pool.query('SELECT id, email FROM users WHERE email = $1', [email]);

    if (userCheck.rows.length === 0) {
      console.log(`❌ User ${email} not found!`);
      await pool.end();
      process.exit(1);
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE email = $2',
      [hashedPassword, email]
    );

    console.log('✓ Password updated successfully!');
    console.log('\nYou can now login with:');
    console.log(`  Email: ${email}`);
    console.log(`  Password: ${newPassword}`);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

resetPassword();
