-- Migration 019: Vendor Shipment Tracking
-- Adds tables and columns for tracking inbound shipments from vendors,
-- monitoring shipping notifications, and recording receipt status.

-- ============================================================
-- 1. Add columns to order_items for receipt tracking
-- ============================================================
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS received_quantity INTEGER DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS backordered_quantity INTEGER DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS receipt_status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS received_date TIMESTAMP;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS vendor_decision VARCHAR(50);

-- ============================================================
-- 2. Add columns to orders for shipment tracking
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS actual_ship_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_shipment_check TIMESTAMP;

-- ============================================================
-- 3. vendor_shipments: Track inbound shipments from vendors
-- ============================================================
CREATE TABLE IF NOT EXISTS vendor_shipments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
  vendor_name VARCHAR(255) NOT NULL,
  email_message_id VARCHAR(500),
  tracking_number VARCHAR(255),
  carrier VARCHAR(100),
  ship_date DATE,
  expected_arrival DATE,
  invoice_number VARCHAR(255),
  invoice_date DATE,
  total_amount DECIMAL(10, 2),
  source_type VARCHAR(50) NOT NULL DEFAULT 'email',
  status VARCHAR(50) DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 4. shipment_line_items: Individual items in a shipment
-- ============================================================
CREATE TABLE IF NOT EXISTS shipment_line_items (
  id SERIAL PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES vendor_shipments(id) ON DELETE CASCADE,
  order_item_id INTEGER REFERENCES order_items(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  upc VARCHAR(50),
  sku VARCHAR(100),
  product_name VARCHAR(500),
  size VARCHAR(100),
  color VARCHAR(255),
  quantity_shipped INTEGER DEFAULT 0,
  quantity_backordered INTEGER DEFAULT 0,
  unit_price DECIMAL(10, 2),
  status VARCHAR(50) DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 5. email_message_cache: Prevent reprocessing same emails
-- ============================================================
CREATE TABLE IF NOT EXISTS email_message_cache (
  id SERIAL PRIMARY KEY,
  email_message_id VARCHAR(500) UNIQUE NOT NULL,
  sender_email VARCHAR(255),
  sender_name VARCHAR(255),
  subject VARCHAR(500),
  received_date TIMESTAMP,
  brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
  shipment_id INTEGER REFERENCES vendor_shipments(id) ON DELETE SET NULL,
  is_shipping_notification BOOLEAN DEFAULT FALSE,
  is_invoice BOOLEAN DEFAULT FALSE,
  parsing_result JSONB,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 6. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_vendor_shipments_order ON vendor_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_vendor_shipments_brand ON vendor_shipments(brand_id);
CREATE INDEX IF NOT EXISTS idx_vendor_shipments_email ON vendor_shipments(email_message_id);
CREATE INDEX IF NOT EXISTS idx_vendor_shipments_status ON vendor_shipments(status);
CREATE INDEX IF NOT EXISTS idx_vendor_shipments_tracking ON vendor_shipments(tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment ON shipment_line_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_order_item ON shipment_line_items(order_item_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_upc ON shipment_line_items(upc);
CREATE INDEX IF NOT EXISTS idx_email_cache_msg_id ON email_message_cache(email_message_id);
CREATE INDEX IF NOT EXISTS idx_email_cache_brand ON email_message_cache(brand_id);
CREATE INDEX IF NOT EXISTS idx_order_items_receipt ON order_items(receipt_status);
CREATE INDEX IF NOT EXISTS idx_order_items_vendor_decision ON order_items(vendor_decision);
