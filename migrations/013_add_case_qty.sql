-- Add case_qty column to products table
-- This stores the number of units per case for wholesale ordering
-- NULL means no case restriction (order individual units)

ALTER TABLE products ADD COLUMN IF NOT EXISTS case_qty INTEGER;

COMMENT ON COLUMN products.case_qty IS 'Number of units per case for wholesale ordering. NULL means no case restriction.';
