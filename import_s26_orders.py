#!/usr/bin/env python3
"""
Import S26 Orders from Excel into the preseason ordering system
"""

import pandas as pd
import psycopg2

DATABASE_URL = "postgresql://postgres:DdbsDfsKpRFuKxQudHhoTTWfhyPScthm@crossover.proxy.rlwy.net:29284/railway"

# Brand name mapping (Excel name -> Database name)
BRAND_MAP = {
    'Prana': 'Prana',
    'Free Fly': 'Free Fly',
    'LaSportivaApparel': 'La Sportiva Apparel',
    'LaSportivaEquipment': 'La Sportiva Equipment',
    'LaSportiva': 'La Sportiva',
    'ArcteryxFW': 'ArcteryxFW',
    'Arcteryx': 'Arcteryx',
    'Toad&Co': 'Toad&Co',
    'TenTree': 'TenTree',
    'DUER': 'DUER',
    'Sterling': 'Sterling',
    'Scarpa': 'Scarpa',
    'Petzl': 'Petzl',
    'DMM': 'DMM',
    'Metolius': 'Metolius',
}

# Location mapping
LOCATION_MAP = {
    'SLC': 'SLC',
    'SouthMain': 'SOMA',
    'Ogden': 'OGD',
}

# Ship month mapping (numeric -> date for S26)
SHIP_MONTH_MAP = {
    126: ('2026-01-01', 'JAN'),
    226: ('2026-02-01', 'FEB'),
    326: ('2026-03-01', 'MAR'),
    426: ('2026-04-01', 'APR'),
    526: ('2026-05-01', 'MAY'),
    626: ('2026-06-01', 'JUN'),
}

def main():
    print("Reading Excel file (S26 sheet)...")
    df = pd.read_excel('/mnt/c/Users/EddieMorillas/Downloads/F25 order import.xlsx', sheet_name='S26')
    print(f"Loaded {len(df)} rows")

    df = df.dropna(subset=['UPC', 'Brand', 'Gym', 'Quantity'])
    df['UPC'] = df['UPC'].astype(str).str.strip()
    df['Quantity'] = df['Quantity'].astype(int)
    print(f"After cleaning: {len(df)} rows")

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    try:
        # 1. Get or use existing Spring 2026 season
        print("\n1. Getting Spring 2026 season...")
        cur.execute("SELECT id FROM seasons WHERE name = 'Spring 2026'")
        result = cur.fetchone()
        if result:
            season_id = result[0]
        else:
            cur.execute("""
                INSERT INTO seasons (name, status) VALUES ('Spring 2026', 'ordering')
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
                print(f"   WARNING: Brand '{db_name}' not found!")

        # 3. Get location IDs
        print("\n3. Mapping locations...")
        cur.execute("SELECT id, code FROM locations")
        db_locations = {row[1]: row[0] for row in cur.fetchall()}
        location_ids = {}
        for excel_name, db_code in LOCATION_MAP.items():
            if db_code in db_locations:
                location_ids[excel_name] = db_locations[db_code]
        print(f"   Mapped {len(location_ids)} locations")

        # 4. Get existing products
        print("\n4. Processing products...")
        cur.execute("SELECT id, upc FROM products WHERE upc IS NOT NULL")
        existing_products = {row[1]: row[0] for row in cur.fetchall()}
        print(f"   Found {len(existing_products)} existing products")

        products_created = 0
        product_ids = {}

        for _, row in df.drop_duplicates(subset=['UPC']).iterrows():
            upc = str(row['UPC']).strip()
            if upc in existing_products:
                product_ids[upc] = existing_products[upc]
            else:
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

        # 5. Create orders
        print("\n5. Creating orders...")
        orders_created = 0
        order_map = {}

        groups = df.groupby(['Brand', 'Gym', 'Ship Month'])

        for (brand, gym, ship_month), group in groups:
            brand_id = brand_ids.get(brand)
            location_id = location_ids.get(gym)

            if not brand_id or not location_id:
                print(f"   Skipping: Brand={brand}, Gym={gym}")
                continue

            ship_date, month_abbr = SHIP_MONTH_MAP.get(ship_month, ('2026-03-01', 'MAR'))
            brand_code = brand[:3].upper()
            loc_code = LOCATION_MAP.get(gym, 'UNK')
            order_number = f"{month_abbr}26-{brand_code}-{loc_code}"

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
        print(f"   Skipped {items_skipped} items")

        # 7. Update order totals
        print("\n7. Updating order totals...")
        cur.execute("""
            UPDATE orders o
            SET current_total = (
                SELECT COALESCE(SUM(line_total), 0)
                FROM order_items WHERE order_id = o.id
            )
            WHERE season_id = %s
        """, (season_id,))

        conn.commit()
        print("\n✓ Import completed successfully!")

        print("\n" + "="*50)
        print("IMPORT SUMMARY")
        print("="*50)
        print(f"Season: Spring 2026 (ID: {season_id})")
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
