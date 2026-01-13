-- Product cases table for mapping individual products to case SKUs
-- Supports multiple case sizes per product (e.g., 6-pack, 12-pack)

CREATE TABLE IF NOT EXISTS product_cases (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    case_sku VARCHAR(100) NOT NULL,
    case_name VARCHAR(255),  -- Optional description like "Case of 12"
    units_per_case INTEGER NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, case_sku)
);

-- Add case reference to order_items
-- When case_id is set, quantity represents number of cases (not units)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS case_id INTEGER REFERENCES product_cases(id) ON DELETE SET NULL;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_product_cases_product ON product_cases(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_case ON order_items(case_id);

COMMENT ON TABLE product_cases IS 'Maps individual products to case SKUs for wholesale ordering';
COMMENT ON COLUMN product_cases.units_per_case IS 'Number of individual units in each case';
COMMENT ON COLUMN order_items.case_id IS 'If set, quantity is number of cases using this case SKU';
