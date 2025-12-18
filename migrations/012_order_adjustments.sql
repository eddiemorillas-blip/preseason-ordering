-- Migration: Add adjusted_quantity column to order_items
-- This allows tracking adjustments separately from the original order quantity

-- Add adjusted_quantity column (NULL means no adjustment, use original quantity)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS adjusted_quantity INTEGER;

-- Add comment explaining the column
COMMENT ON COLUMN order_items.adjusted_quantity IS 'Adjusted quantity (NULL = use original quantity, set value = adjusted amount)';
