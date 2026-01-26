#!/usr/bin/env node
/**
 * Diagnostic script to check finalized_adjustments and export issues
 * Run with: DATABASE_URL=your_connection_string node scripts/diagnose-exports.js
 * Or if you have .env: node scripts/diagnose-exports.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function diagnose() {
  console.log('\n========== EXPORT DIAGNOSTICS ==========\n');

  try {
    // Check 1: Table exists
    console.log('1. Checking if finalized_adjustments table exists...');
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'finalized_adjustments'
      ) as exists
    `);
    console.log(`   Table exists: ${tableCheck.rows[0].exists ? 'YES ✓' : 'NO ✗'}`);

    if (!tableCheck.rows[0].exists) {
      console.log('\n   ⚠️  The finalized_adjustments table does not exist!');
      console.log('   The server needs to be restarted to create it.');
      return;
    }

    // Check 2: Count records in finalized_adjustments
    console.log('\n2. Checking finalized_adjustments record count...');
    const countResult = await pool.query('SELECT COUNT(*) as count FROM finalized_adjustments');
    console.log(`   Total records: ${countResult.rows[0].count}`);

    // Check 3: Finalized orders
    console.log('\n3. Checking orders with finalized_at set...');
    const finalizedOrders = await pool.query(`
      SELECT COUNT(*) as count FROM orders WHERE finalized_at IS NOT NULL
    `);
    console.log(`   Orders with finalized_at: ${finalizedOrders.rows[0].count}`);

    // Check 4: Compare finalized orders vs adjustment records
    console.log('\n4. Comparing finalized orders vs adjustment records...');
    const comparison = await pool.query(`
      SELECT
        o.id,
        o.order_number,
        o.finalized_at,
        o.season_id,
        o.brand_id,
        s.name as season_name,
        b.name as brand_name,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as item_count,
        (SELECT COUNT(*) FROM finalized_adjustments fa WHERE fa.order_id = o.id) as adjustment_count
      FROM orders o
      LEFT JOIN seasons s ON o.season_id = s.id
      LEFT JOIN brands b ON o.brand_id = b.id
      WHERE o.finalized_at IS NOT NULL
      ORDER BY o.finalized_at DESC
      LIMIT 20
    `);

    if (comparison.rows.length === 0) {
      console.log('   No finalized orders found.');
    } else {
      console.log('\n   Order#                  | Season           | Brand            | Items | Adjustments | Status');
      console.log('   ' + '-'.repeat(95));
      for (const row of comparison.rows) {
        const status = row.item_count > 0 && row.adjustment_count === 0 ? '⚠️  MISSING' : '✓';
        console.log(`   ${row.order_number.padEnd(25)} | ${(row.season_name || 'N/A').padEnd(16)} | ${(row.brand_name || 'N/A').padEnd(16)} | ${String(row.item_count).padStart(5)} | ${String(row.adjustment_count).padStart(11)} | ${status}`);
      }
    }

    // Check 5: Missing adjustments detail
    const missingCount = comparison.rows.filter(r => r.item_count > 0 && r.adjustment_count === 0).length;
    if (missingCount > 0) {
      console.log(`\n   ⚠️  Found ${missingCount} finalized order(s) with MISSING adjustment records!`);
      console.log('   This is the cause of the "no file to export" error.');
    }

    // Check 6: Group by season/brand
    console.log('\n5. Finalized adjustments by Season/Brand...');
    const bySeasonBrand = await pool.query(`
      SELECT
        s.id as season_id,
        s.name as season_name,
        b.id as brand_id,
        b.name as brand_name,
        COUNT(DISTINCT fa.order_id) as order_count,
        COUNT(*) as adjustment_count
      FROM finalized_adjustments fa
      LEFT JOIN seasons s ON fa.season_id = s.id
      LEFT JOIN brands b ON fa.brand_id = b.id
      GROUP BY s.id, s.name, b.id, b.name
      ORDER BY s.name, b.name
    `);

    if (bySeasonBrand.rows.length === 0) {
      console.log('   No finalized adjustments found in any season/brand.');
    } else {
      console.log('\n   Season           | Brand            | Orders | Adjustments');
      console.log('   ' + '-'.repeat(65));
      for (const row of bySeasonBrand.rows) {
        console.log(`   ${(row.season_name || 'N/A').padEnd(16)} | ${(row.brand_name || 'N/A').padEnd(16)} | ${String(row.order_count).padStart(6)} | ${String(row.adjustment_count).padStart(11)}`);
      }
    }

    // Check 7: Users and roles
    console.log('\n6. Checking users with buyer/admin roles (Export Center access)...');
    const users = await pool.query(`
      SELECT id, email, first_name, last_name, role
      FROM users
      ORDER BY role, email
    `);
    console.log('\n   Email                          | Name                | Role');
    console.log('   ' + '-'.repeat(70));
    for (const user of users.rows) {
      const canExport = ['admin', 'buyer'].includes(user.role) ? '✓' : '✗';
      console.log(`   ${user.email.padEnd(32)} | ${(user.first_name + ' ' + user.last_name).padEnd(19)} | ${user.role} ${canExport}`);
    }

    console.log('\n========== DIAGNOSIS COMPLETE ==========\n');

  } catch (error) {
    console.error('Error running diagnostics:', error.message);
  } finally {
    await pool.end();
  }
}

diagnose();
