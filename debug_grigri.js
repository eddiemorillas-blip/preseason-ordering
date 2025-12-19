const { Pool } = require("pg");
const { bigquery, LOCATION_TO_FACILITY } = require("./src/services/bigquery");
const pool = new Pool({ connectionString: "postgresql://postgres:DdbsDfsKpRFuKxQudHhoTTWfhyPScthm@crossover.proxy.rlwy.net:29284/railway" });

async function debug() {
  const seasonId = 3;
  const brandId = 9;
  const locationId = 1;
  const facilityId = LOCATION_TO_FACILITY[locationId];
  const months = 12;

  // Step 1: Get products with UPCs and names
  const pgResult = await pool.query(`
    SELECT DISTINCT p.upc, p.name as product_name
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    JOIN products p ON oi.product_id = p.id
    WHERE o.season_id = $1 AND o.brand_id = $2 AND o.location_id = $3
      AND p.upc IS NOT NULL
  `, [seasonId, brandId, locationId]);

  const products = pgResult.rows.filter(r => r.upc && r.upc.trim());
  const upcToName = {};
  products.forEach(r => { upcToName[r.upc] = r.product_name; });
  const upcs = products.map(r => r.upc);

  // Find GRIGRI+ products
  const grigriPlusUpcs = upcs.filter(u => upcToName[u].includes("GRIGRI") && upcToName[u].includes("+"));
  console.log("GRIGRI+ UPCs in order:", grigriPlusUpcs.map(u => u + ": " + upcToName[u]));

  // Step 2: UPC matching
  const upcList = upcs.map(u => "'" + u + "'").join(",");
  const [upcRows] = await bigquery.query({ query: `
    SELECT p.BARCODE as upc, SUM(ii.QUANTITY) as total_qty_sold
    FROM rgp_cleaned_zone.invoice_items_all ii
    JOIN rgp_cleaned_zone.invoices_all i ON ii.invoice_concat = i.invoice_concat
    JOIN rgp_cleaned_zone.products_all p ON ii.product_concat = p.product_concat
    WHERE DATE(i.POSTDATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${months} MONTH)
      AND p.BARCODE IN (${upcList}) AND ii.QUANTITY > 0
      AND p.facility_id_true = '${facilityId}'
    GROUP BY p.BARCODE
  ` });

  const velocity = {};
  upcRows.forEach(r => { velocity[r.upc] = { total_sold: parseInt(r.total_qty_sold) }; });

  const missingUpcs = upcs.filter(u => !velocity[u]);
  console.log("\nTotal missing after UPC match:", missingUpcs.length);

  // Check if GRIGRI+ is still missing
  const grigriMissing = grigriPlusUpcs.filter(u => !velocity[u]);
  console.log("GRIGRI+ still missing:", grigriMissing.map(u => u + ": " + upcToName[u]));

  if (grigriMissing.length === 0) {
    console.log("\nGRIGRI+ already matched by UPC!");
    await pool.end();
    return;
  }

  // Step 3: Name fallback - what names are we searching for?
  const namesToSearch = grigriMissing.map(upc => {
    const name = upcToName[upc] || "";
    return name.toUpperCase()
      .replace(/\s+(XS|S|M|L|XL|XXL|XXXL|\d+M|\d+CM)$/i, "")
      .replace(/\s+(GRAY|GREY|BLACK|WHITE|BLUE|RED|ORANGE|GREEN|YELLOW|PURPLE|PINK|VIOLET)$/i, "")
      .replace(/[®™]/g, "")
      .trim();
  }).filter(n => n.length > 3);

  console.log("\nNames to search:", namesToSearch);
  const uniqueNames = [...new Set(namesToSearch)];
  console.log("Unique names:", uniqueNames);

  // Build name patterns
  const namePatterns = uniqueNames.map(n => `UPPER(p.DESCRIPTION) LIKE '%${n.replace(/'/g, "''")}%'`).join(" OR ");
  console.log("\nName patterns:", namePatterns);

  // Execute fallback query
  const fallbackQuery = `
    SELECT p.DESCRIPTION as product_name, SUM(ii.QUANTITY) as total_qty_sold,
           COUNT(DISTINCT FORMAT_DATE('%Y-%m', DATE(i.POSTDATE))) as months_of_data
    FROM rgp_cleaned_zone.invoice_items_all ii
    JOIN rgp_cleaned_zone.invoices_all i ON ii.invoice_concat = i.invoice_concat
    JOIN rgp_cleaned_zone.products_all p ON ii.product_concat = p.product_concat
    WHERE DATE(i.POSTDATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${months} MONTH)
      AND (${namePatterns})
      AND ii.QUANTITY > 0
      AND p.facility_id_true = '${facilityId}'
    GROUP BY p.DESCRIPTION
  `;

  console.log("\nFallback query:");
  console.log(fallbackQuery);

  const [nameRows] = await bigquery.query({ query: fallbackQuery });
  console.log("\nFallback query returned:", nameRows.length, "rows");
  nameRows.forEach(r => console.log("  " + r.product_name + ": sold " + r.total_qty_sold));

  // Now test the matching logic
  console.log("\n--- Testing matching logic ---");
  const nameMap = {};
  nameRows.forEach(row => {
    nameMap[row.product_name.toUpperCase()] = {
      avg_monthly_sales: Math.round((parseInt(row.total_qty_sold) / Math.max(1, parseInt(row.months_of_data))) * 10) / 10,
      total_sold: parseInt(row.total_qty_sold)
    };
  });

  grigriMissing.forEach(upc => {
    const rawName = (upcToName[upc] || '').toUpperCase()
      .replace(/[®™]/g, '')
      .replace(/\s+(XS|S|M|L|XL|XXL|XXXL)$/i, '')
      .trim();
    const normalizedName = rawName.replace(/\s+/g, '');
    const hasPlus = rawName.includes('+');

    console.log(`\nMatching: "${upcToName[upc]}" -> raw="${rawName}" normalized="${normalizedName}" hasPlus=${hasPlus}`);

    let bestMatch = null;
    let bestScore = 0;

    for (const [bqName, data] of Object.entries(nameMap)) {
      const normalizedBqName = bqName.replace(/\s+/g, '');
      const bqHasPlus = bqName.includes('+');

      console.log(`  vs "${bqName}" (normalized="${normalizedBqName}" bqHasPlus=${bqHasPlus})`);

      if (hasPlus !== bqHasPlus) {
        console.log(`    SKIP: plus mismatch`);
        continue;
      }

      let score = 0;
      if (normalizedBqName === normalizedName) {
        score = 100;
      } else if (normalizedBqName.includes(normalizedName)) {
        score = 80;
      } else if (normalizedName.includes(normalizedBqName)) {
        score = 70;
      }

      console.log(`    score: ${score}`);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { bqName, data };
      }
    }

    if (bestMatch) {
      console.log(`  MATCHED: ${bestMatch.bqName} (score ${bestScore})`);
    } else {
      console.log(`  NO MATCH FOUND`);
    }
  });

  await pool.end();
}

debug().catch(e => console.error(e));
