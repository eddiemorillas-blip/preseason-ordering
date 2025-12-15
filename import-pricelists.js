const XLSX = require('xlsx');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const EXCEL_FILE = '/mnt/c/Users/EddieMorillas/The Front Climbing Club/Retail - Documents/Buying/Best Retail Workbooks Ever/Best Retail Workbook Ever.xlsm';

async function importPricelists() {
  const client = await pool.connect();

  try {
    console.log('Reading Excel file...');
    const workbook = XLSX.readFile(EXCEL_FILE);

    // Create seasons if they don't exist
    console.log('Creating seasons...');

    const s26Result = await client.query(`
      INSERT INTO seasons (name, status, start_date, end_date)
      VALUES ('Spring 2026', 'planning', '2026-02-01', '2026-07-31')
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `);
    const s26SeasonId = s26Result.rows[0].id;
    console.log('Spring 2026 season ID:', s26SeasonId);

    const f25Result = await client.query(`
      INSERT INTO seasons (name, status, start_date, end_date)
      VALUES ('Fall 2025', 'closed', '2025-08-01', '2026-01-31')
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `);
    const f25SeasonId = f25Result.rows[0].id;
    console.log('Fall 2025 season ID:', f25SeasonId);

    // Process each pricelist
    const sheets = [
      { name: 'S26 Pricelists', seasonId: s26SeasonId, seasonName: 'Spring 2026' },
      { name: 'F25 Pricelists', seasonId: f25SeasonId, seasonName: 'Fall 2025' }
    ];

    for (const sheet of sheets) {
      console.log(`\n=== Processing ${sheet.name} (${sheet.seasonName}) ===`);

      const worksheet = workbook.Sheets[sheet.name];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      // Skip header row, filter valid rows
      const rows = data.slice(1).filter(row => row[0] && String(row[0]).trim() && String(row[0]) !== 'UPC');
      console.log(`Found ${rows.length} products`);

      // Get unique brands and create them
      const uniqueBrands = [...new Set(rows.map(r => r[1]).filter(b => b && b.trim()))];
      console.log(`Creating ${uniqueBrands.length} brands...`);

      // Batch create brands
      if (uniqueBrands.length > 0) {
        const brandValues = uniqueBrands.map((_, i) => `($${i + 1}, true)`).join(', ');
        await client.query(`
          INSERT INTO brands (name, active)
          VALUES ${brandValues}
          ON CONFLICT (name) DO NOTHING
        `, uniqueBrands);
      }

      // Get brand mapping
      const brandResult = await client.query('SELECT id, name FROM brands');
      const brandMap = new Map(brandResult.rows.map(r => [r.name, r.id]));

      // Process products in batches
      const BATCH_SIZE = 1000;
      let totalProcessed = 0;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const rawBatch = rows.slice(i, i + BATCH_SIZE);

        // Deduplicate by UPC within batch (keep last occurrence)
        const batchMap = new Map();
        for (const row of rawBatch) {
          const upc = String(row[0]).trim();
          batchMap.set(upc, row);
        }
        const batch = Array.from(batchMap.values());

        // Build batch insert for products
        const productValues = [];
        const productParams = [];
        let paramIdx = 1;

        for (const row of batch) {
          const upc = String(row[0]).trim();
          const brandName = row[1];
          const sku = row[2] || null;
          const name = row[3] || '';
          const color = row[4] || null;
          const size = row[5] !== undefined ? String(row[5]) : null;
          // Clean price values - convert "-" or empty to null
          const cleanPrice = (val) => {
            if (!val || val === '-' || val === '' || val === 'N/A') return null;
            const num = parseFloat(val);
            return isNaN(num) ? null : num;
          };
          const wholesaleCost = cleanPrice(row[6]);
          const msrp = cleanPrice(row[7]);
          const category = row[8] || null;

          const brandId = brandMap.get(brandName) || null;

          productValues.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7}, $${paramIdx+8}, true, $${paramIdx+3})`);
          productParams.push(brandId, upc, sku, name, color, size, category, wholesaleCost, msrp);
          paramIdx += 9;
        }

        // Batch upsert products
        await client.query(`
          INSERT INTO products (brand_id, upc, sku, name, color, size, category, wholesale_cost, msrp, active, base_name)
          VALUES ${productValues.join(', ')}
          ON CONFLICT (upc) DO UPDATE SET
            brand_id = COALESCE(EXCLUDED.brand_id, products.brand_id),
            sku = COALESCE(EXCLUDED.sku, products.sku),
            name = COALESCE(NULLIF(EXCLUDED.name, ''), products.name),
            color = COALESCE(EXCLUDED.color, products.color),
            size = COALESCE(EXCLUDED.size, products.size),
            category = COALESCE(EXCLUDED.category, products.category),
            wholesale_cost = COALESCE(EXCLUDED.wholesale_cost, products.wholesale_cost),
            msrp = COALESCE(EXCLUDED.msrp, products.msrp),
            active = true,
            updated_at = CURRENT_TIMESTAMP
        `, productParams);

        // Get product IDs for this batch
        const upcs = batch.map(row => String(row[0]).trim());
        const productIds = await client.query(`
          SELECT id, upc FROM products WHERE upc = ANY($1)
        `, [upcs]);

        const upcToId = new Map(productIds.rows.map(r => [r.upc, r.id]));

        // Build batch insert for season_prices
        const priceValues = [];
        const priceParams = [];
        paramIdx = 1;

        for (const row of batch) {
          const upc = String(row[0]).trim();
          const productId = upcToId.get(upc);
          const cleanPrice = (val) => {
            if (!val || val === '-' || val === '' || val === 'N/A') return null;
            const num = parseFloat(val);
            return isNaN(num) ? null : num;
          };
          const wholesaleCost = cleanPrice(row[6]);
          const msrp = cleanPrice(row[7]);

          if (productId) {
            priceValues.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3})`);
            priceParams.push(productId, sheet.seasonId, wholesaleCost, msrp);
            paramIdx += 4;
          }
        }

        // Batch upsert season prices
        if (priceValues.length > 0) {
          await client.query(`
            INSERT INTO season_prices (product_id, season_id, wholesale_cost, msrp)
            VALUES ${priceValues.join(', ')}
            ON CONFLICT (product_id, season_id) DO UPDATE SET
              wholesale_cost = EXCLUDED.wholesale_cost,
              msrp = EXCLUDED.msrp,
              updated_at = CURRENT_TIMESTAMP
          `, priceParams);
        }

        totalProcessed += rawBatch.length;
        console.log(`  Processed ${totalProcessed}/${rows.length} rows...`);
      }

      console.log(`Completed ${sheet.seasonName}: ${totalProcessed} products processed`);
    }

    console.log('\n=== Import Complete ===');

    // Show summary
    const summary = await client.query(`
      SELECT s.name as season, COUNT(sp.id) as price_count
      FROM seasons s
      LEFT JOIN season_prices sp ON s.id = sp.season_id
      GROUP BY s.id, s.name
      ORDER BY s.name
    `);
    console.log('\nPrices by season:');
    console.table(summary.rows);

    const productCount = await client.query('SELECT COUNT(*) as count FROM products');
    console.log('Total products:', productCount.rows[0].count);

  } catch (err) {
    console.error('Error:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

importPricelists().catch(console.error);
