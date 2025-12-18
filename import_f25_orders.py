#!/usr/bin/env python3
"""
Import F25 Orders from Excel into the preseason ordering system
"""

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from datetime import datetime

# Database connection
DATABASE_URL = "postgresql://postgres:DdbsDfsKpRFuKxQudHhoTTWfhyPScthm@crossover.proxy.rlwy.net:29284/railway"

# Brand name mapping (Excel name -> Database name)
BRAND_MAP = {
    'Prana': 'Prana',
    'Free Fly': 'Free Fly',
    'La Sportiva Footwear': 'La Sportiva Footwear',
    'La Sportiva Apparel': 'La Sportiva Apparel',
    'Petzl': 'Petzl',
    'Montane': 'Montane',
    'Ripton': 'Ripton',
    'Metolius': 'Metolius',
    'Scarpa': 'Scarpa',
    'Sterling': 'Sterling',
    'Duer': 'Duer',
    'Patagonia': 'Patagonia',
    'CAMP': 'CAMP',
}

# Location mapping (Excel Gym -> Database location code)
LOCATION_MAP = {
    'SLC': 'SLC',
    'SLC ': 'SLC',  # with trailing space
    'South Main': 'SOMA',
    'Ogden': 'OGD',
    'OGden': 'OGD',  # typo in data
}

# Ship month to date mapping (for F25 = Fall 2025)
SHIP_MONTH_MAP = {
    'Jul': '2025-07-01',
    'Aug': '2025-08-01',
    'Sep': '2025-09-01',
    'Oct': '2025-10-01',
    'Nov': '2025-11-01',
    'Dec': '2025-12-01',
    'Jan': '2026-01-01',
    'ASAP ': '2025-07-01',  # Default ASAP to July
}

def main():
    # Read Excel file
    print("Reading Excel file...")
    df = pd.read_excel('/mnt/c/Users/EddieMorillas/Downloads/F25 order import.xlsx')
    print(f"Loaded {len(df)} rows")

    # Clean data
    df = df.dropna(subset=['UPC', 'Brand', 'Gym', 'Quantity'])
    df['UPC'] = df['UPC'].astype(str).str.strip()
    df['Quantity'] = df['Quantity'].astype(int)
    print(f"After cleaning: {len(df)} rows")

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    try:
        # 1. Create Fall 2025 season
        print("\n1. Creating Fall 2025 season...")
        cur.execute("""
            INSERT INTO seasons (name, status)
            VALUES ('Fall 2025', 'ordering')
            ON CONFLICT (name) DO UPDATE SET name = 'Fall 2025'
            RETURNING id
        """)
        season_id = cur.fetchone()[0]
        print(f"   Season ID: {season_id}")

        # 2. Get brand IDs
        print("\n2. Mapping brands...")
        cur.execute("SELECT id, name FROM brands")
        db_brands = {row[1]: row[0] for row in cur.fetchall()}
        brand_ids = {}
        for excel_name, db_name in BRAND_MAP.items():
            if db_name in db_brands:
                brand_ids[excel_name] = db_brands[db_name]
                print(f"   {excel_name} -> ID {brand_ids[excel_name]}")
            else:
                print(f"   WARNING: Brand '{db_name}' not found in database!")

        # 3. Get location IDs
        print("\n3. Mapping locations...")
        cur.execute("SELECT id, code FROM locations")
        db_locations = {row[1]: row[0] for row in cur.fetchall()}
        location_ids = {}
        for excel_name, db_code in LOCATION_MAP.items():
            if db_code in db_locations:
                location_ids[excel_name] = db_locations[db_code]
        print(f"   Mapped {len(location_ids)} location variations")

        # 4. Get/create products by UPC
        print("\n4. Processing products...")
        cur.execute("SELECT id, upc FROM products WHERE upc IS NOT NULL")
        existing_products = {row[1]: row[0] for row in cur.fetchall()}
        print(f"   Found {len(existing_products)} existing products with UPCs")

        products_created = 0
        product_ids = {}  # UPC -> product_id

        for _, row in df.drop_duplicates(subset=['UPC']).iterrows():
            upc = str(row['UPC']).strip()
            if upc in existing_products:
                product_ids[upc] = existing_products[upc]
            else:
                # Create new product
                brand_name = row['Brand']
                brand_id = brand_ids.get(brand_name)
                if not brand_id:
                    continue

                cur.execute("""
                    INSERT INTO products (
                        upc, name, sku, color, size, wholesale_cost, msrp,
                        brand_id, season_id, active
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, true)
                    ON CONFLICT (upc) DO UPDATE SET upc = EXCLUDED.upc
                    RETURNING id
                """, (
                    upc,
                    row['Description'],
                    row.get('Product Number', ''),
                    row.get('Color', ''),
                    row.get('Size', ''),
                    row.get('Wholesale', 0),
                    row.get('Retail', 0),
                    brand_id,
                    season_id
                ))
                product_ids[upc] = cur.fetchone()[0]
                products_created += 1

        print(f"   Created {products_created} new products")
        print(f"   Total products mapped: {len(product_ids)}")

        # 5. Create orders grouped by brand + location + ship month
        print("\n5. Creating orders...")
        orders_created = 0
        order_map = {}  # (brand, location, ship_month) -> order_id

        # Group by brand, gym, ship month
        groups = df.groupby(['Brand', 'Gym', 'Ship Month'])

        for (brand, gym, ship_month), group in groups:
            brand_id = brand_ids.get(brand)
            location_id = location_ids.get(gym)

            if not brand_id or not location_id:
                print(f"   Skipping: Brand={brand}, Gym={gym} (not mapped)")
                continue

            ship_date = SHIP_MONTH_MAP.get(ship_month, '2025-08-01')

            # Generate order number
            month_abbr = ship_month.strip()[:3].upper()
            brand_code = brand[:3].upper()
            loc_code = LOCATION_MAP.get(gym, 'UNK')
            order_number = f"{month_abbr}25-{brand_code}-{loc_code}"

            # Check if order exists, if so append counter
            cur.execute(
                "SELECT COUNT(*) FROM orders WHERE order_number LIKE %s",
                (order_number + '%',)
            )
            count = cur.fetchone()[0]
            if count > 0:
                order_number = f"{order_number}-{count + 1}"

            cur.execute("""
                INSERT INTO orders (
                    order_number, season_id, brand_id, location_id,
                    ship_date, order_type, status, created_by
                ) VALUES (%s, %s, %s, %s, %s, 'preseason', 'draft', 1)
                RETURNING id
            """, (order_number, season_id, brand_id, location_id, ship_date))

            order_id = cur.fetchone()[0]
            order_map[(brand, gym, ship_month)] = order_id
            orders_created += 1

        print(f"   Created {orders_created} orders")

        # 6. Add order items
        print("\n6. Adding order items...")
        items_added = 0
        items_skipped = 0

        for _, row in df.iterrows():
            upc = str(row['UPC']).strip()
            product_id = product_ids.get(upc)
            order_id = order_map.get((row['Brand'], row['Gym'], row['Ship Month']))

            if not product_id or not order_id:
                items_skipped += 1
                continue

            quantity = int(row['Quantity'])
            unit_cost = float(row.get('Wholesale', 0) or 0)
            line_total = unit_cost * quantity

            cur.execute("""
                INSERT INTO order_items (
                    order_id, product_id, quantity, unit_cost, line_total
                ) VALUES (%s, %s, %s, %s, %s)
            """, (order_id, product_id, quantity, unit_cost, line_total))
            items_added += 1

        print(f"   Added {items_added} order items")
        print(f"   Skipped {items_skipped} items (missing product or order)")

        # 7. Update order totals
        print("\n7. Updating order totals...")
        cur.execute("""
            UPDATE orders o
            SET current_total = (
                SELECT COALESCE(SUM(line_total), 0)
                FROM order_items
                WHERE order_id = o.id
            )
            WHERE season_id = %s
        """, (season_id,))

        conn.commit()
        print("\n✓ Import completed successfully!")

        # Summary
        print("\n" + "="*50)
        print("IMPORT SUMMARY")
        print("="*50)
        print(f"Season: Fall 2025 (ID: {season_id})")
        print(f"Products created: {products_created}")
        print(f"Orders created: {orders_created}")
        print(f"Order items added: {items_added}")
        print(f"Items skipped: {items_skipped}")

    except Exception as e:
        conn.rollback()
        print(f"\n✗ Error: {e}")
        raise
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    main()
