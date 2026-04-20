-- Migration 021: Ensure all revision-related columns exist on order_items
-- Safe to run multiple times (IF NOT EXISTS on everything)

-- From migration 012
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS adjusted_quantity INTEGER;

-- From migration 019
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS received_quantity INTEGER DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS backordered_quantity INTEGER DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS receipt_status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS received_date TIMESTAMP;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS vendor_decision VARCHAR(50);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_order_items_receipt ON order_items(receipt_status);
CREATE INDEX IF NOT EXISTS idx_order_items_vendor_decision ON order_items(vendor_decision);
