const { getStockByUPCs, getStockOnHand } = require('./src/services/bigquery');

async function test() {
  // Test with a few sample UPCs - let's first see what UPCs we have in orders
  const pool = require('./src/config/database');
  
  try {
    // Get some UPCs from order items
    const result = await pool.query(`
      SELECT DISTINCT p.upc 
      FROM order_items oi 
      JOIN products p ON oi.product_id = p.id 
      WHERE p.upc IS NOT NULL 
      LIMIT 10
    `);
    
    const upcs = result.rows.map(r => r.upc);
    console.log('Sample UPCs from orders:', upcs);
    
    if (upcs.length > 0) {
      // Test raw stock query
      console.log('\nTesting getStockOnHand...');
      const rawStock = await getStockOnHand(upcs);
      console.log('Raw stock data:', JSON.stringify(rawStock, null, 2));
      
      // Test grouped stock query
      console.log('\nTesting getStockByUPCs...');
      const groupedStock = await getStockByUPCs(upcs);
      console.log('Grouped stock data:', JSON.stringify(groupedStock, null, 2));
    }
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

test();
