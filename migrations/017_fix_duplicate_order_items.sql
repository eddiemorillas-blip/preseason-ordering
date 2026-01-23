-- Migration: Fix duplicate order items
-- This migration:
-- 1. Removes duplicate order_items (keeping the first one, merging quantities)
-- 2. Adds a unique constraint to prevent future duplicates

-- First, merge duplicates by keeping the first item and summing quantities
WITH duplicates AS (
  SELECT
    order_id,
    product_id,
    MIN(id) as keep_id,
    SUM(quantity) as total_quantity,
    SUM(COALESCE(adjusted_quantity, quantity)) as total_adjusted,
    COUNT(*) as dup_count
  FROM order_items
  GROUP BY order_id, product_id
  HAVING COUNT(*) > 1
),
-- Update the kept items with merged quantities
updated AS (
  UPDATE order_items oi
  SET
    quantity = d.total_quantity,
    adjusted_quantity = d.total_adjusted,
    line_total = oi.unit_cost * d.total_adjusted
  FROM duplicates d
  WHERE oi.id = d.keep_id
  RETURNING oi.id
)
-- Delete the duplicate rows (not the kept ones)
DELETE FROM order_items
WHERE id IN (
  SELECT oi.id
  FROM order_items oi
  JOIN duplicates d ON oi.order_id = d.order_id AND oi.product_id = d.product_id
  WHERE oi.id != d.keep_id
);

-- Now add the unique constraint to prevent future duplicates
-- Using CREATE UNIQUE INDEX instead of ALTER TABLE for better control
CREATE UNIQUE INDEX IF NOT EXISTS order_items_order_product_unique
ON order_items (order_id, product_id);

-- Log how many duplicates were cleaned up
DO $$
DECLARE
  cleaned_count INTEGER;
BEGIN
  -- This is just informational, the actual cleanup was done above
  RAISE NOTICE 'Duplicate order items have been merged and unique constraint added';
END $$;
