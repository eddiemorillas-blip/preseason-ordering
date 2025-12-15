-- Season Prices Migration
-- This migration adds season-specific pricing and price history tracking

-- 1. Create season_prices table for per-season pricing
CREATE TABLE IF NOT EXISTS season_prices (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    wholesale_cost DECIMAL(10, 2),
    msrp DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, season_id)
);

-- 2. Create price_history table to track all price changes
CREATE TABLE IF NOT EXISTS price_history (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    old_wholesale_cost DECIMAL(10, 2),
    new_wholesale_cost DECIMAL(10, 2),
    old_msrp DECIMAL(10, 2),
    new_msrp DECIMAL(10, 2),
    change_reason VARCHAR(255),
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_season_prices_product ON season_prices(product_id);
CREATE INDEX IF NOT EXISTS idx_season_prices_season ON season_prices(season_id);
CREATE INDEX IF NOT EXISTS idx_season_prices_lookup ON season_prices(product_id, season_id);
CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_season ON price_history(season_id);
CREATE INDEX IF NOT EXISTS idx_price_history_changed_at ON price_history(changed_at);

-- 4. Add trigger for updated_at on season_prices
CREATE TRIGGER update_season_prices_updated_at
    BEFORE UPDATE ON season_prices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 5. Migrate existing product prices to season_prices for products with season_id
INSERT INTO season_prices (product_id, season_id, wholesale_cost, msrp)
SELECT
    id,
    season_id,
    wholesale_cost,
    msrp
FROM products
WHERE season_id IS NOT NULL
  AND (wholesale_cost IS NOT NULL OR msrp IS NOT NULL)
ON CONFLICT (product_id, season_id) DO NOTHING;

-- 6. Create initial price history records for migrated data
INSERT INTO price_history (product_id, season_id, new_wholesale_cost, new_msrp, change_reason, changed_at)
SELECT
    id,
    season_id,
    wholesale_cost,
    msrp,
    'migration_from_products',
    COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
FROM products
WHERE season_id IS NOT NULL
  AND (wholesale_cost IS NOT NULL OR msrp IS NOT NULL);

COMMENT ON TABLE season_prices IS 'Product prices per season, allowing different prices across seasons';
COMMENT ON TABLE price_history IS 'Audit trail of all price changes with timestamps and reasons';
