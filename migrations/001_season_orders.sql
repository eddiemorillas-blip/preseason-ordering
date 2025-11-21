-- Season-Based Order System Migration
-- This migration adds season management, budgets, and product family support

-- 1. Create seasons table
CREATE TABLE IF NOT EXISTS seasons (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    start_date DATE,
    end_date DATE,
    status VARCHAR(20) DEFAULT 'planning' CHECK (status IN ('planning', 'ordering', 'closed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Add season_id and brand_id to orders table
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(id),
    ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(id),
    ADD COLUMN IF NOT EXISTS ship_date DATE;

-- 3. Create season_budgets table for brand budgets per season per location
CREATE TABLE IF NOT EXISTS season_budgets (
    id SERIAL PRIMARY KEY,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    budget_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(season_id, brand_id, location_id)
);

-- 4. Add base_name to products for product family grouping
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS base_name VARCHAR(500);

-- 5. Update base_name for existing products
-- Extract base name by removing size and color indicators
UPDATE products
SET base_name = REGEXP_REPLACE(
    REGEXP_REPLACE(
        REGEXP_REPLACE(
            name,
            '\s*-\s*(XSmall|Small|Medium|Large|XLarge|XXL|XS|S|M|L|XL)\s*',
            '',
            'gi'
        ),
        '\s*-\s*\d+(\.\d+)?\s*',
        '',
        'g'
    ),
    '\s*-\s*(Black|White|Blue|Red|Green|Yellow|Gray|Grey|Orange|Purple|Pink|Brown|Tan|Beige)\s*',
    '',
    'gi'
)
WHERE base_name IS NULL;

-- 6. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_products_base_name ON products(base_name);
CREATE INDEX IF NOT EXISTS idx_products_brand_base ON products(brand_id, base_name);
CREATE INDEX IF NOT EXISTS idx_orders_season_brand_location ON orders(season_id, brand_id, location_id);
CREATE INDEX IF NOT EXISTS idx_season_budgets_lookup ON season_budgets(season_id, brand_id, location_id);

-- 7. Add triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_seasons_updated_at
    BEFORE UPDATE ON seasons
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_season_budgets_updated_at
    BEFORE UPDATE ON season_budgets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 8. Insert default season if none exist
INSERT INTO seasons (name, status, start_date, end_date)
SELECT 'Fall 2025', 'planning', '2025-09-01', '2026-02-28'
WHERE NOT EXISTS (SELECT 1 FROM seasons);

COMMENT ON TABLE seasons IS 'Ordering seasons for organizing preseason orders';
COMMENT ON TABLE season_budgets IS 'Budget allocations per brand per location per season';
COMMENT ON COLUMN products.base_name IS 'Product family name without size/color variants';
