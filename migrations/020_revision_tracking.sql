-- Migration 020: Revision Tracking, Vendor Form Import, Knowledge Fix
-- Covers: knowledge persistence fix, revision history, vendor form imports, vendor form templates

-- ============================================================
-- 1. Fix knowledge_entries: remove restrictive CHECK constraint on type
-- ============================================================
ALTER TABLE knowledge_entries DROP CONSTRAINT IF EXISTS knowledge_entries_type_check;

-- Add unique index on type+key for upsert support
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_entries_type_key ON knowledge_entries(type, key)
  WHERE type IS NOT NULL AND key IS NOT NULL;

-- ============================================================
-- 2. Extend brand_order_templates for vendor form template registry
-- ============================================================
ALTER TABLE brand_order_templates
  ADD COLUMN IF NOT EXISTS header_row INTEGER,
  ADD COLUMN IF NOT EXISTS dropdown_options JSONB,
  ADD COLUMN IF NOT EXISTS po_pattern TEXT,
  ADD COLUMN IF NOT EXISTS location_mapping JSONB,
  ADD COLUMN IF NOT EXISTS fill_rules JSONB,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Make file_path and original_filename nullable (templates saved via MCP won't have files)
ALTER TABLE brand_order_templates
  ALTER COLUMN file_path DROP NOT NULL,
  ALTER COLUMN original_filename DROP NOT NULL;

-- ============================================================
-- 3. Vendor form imports
-- ============================================================
CREATE TABLE IF NOT EXISTS vendor_form_imports (
  id SERIAL PRIMARY KEY,
  brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
  form_type TEXT,
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  item_count INTEGER DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_vendor_form_imports_brand ON vendor_form_imports(brand_id);
CREATE INDEX IF NOT EXISTS idx_vendor_form_imports_date ON vendor_form_imports(imported_at DESC);

CREATE TABLE IF NOT EXISTS vendor_form_items (
  id SERIAL PRIMARY KEY,
  import_id INTEGER REFERENCES vendor_form_imports(id) ON DELETE CASCADE,
  order_item_id INTEGER,
  upc TEXT,
  vendor_po TEXT,
  vendor_so TEXT,
  location_name TEXT,
  ordered_qty INTEGER,
  committed_qty INTEGER,
  backorder_qty INTEGER,
  eta TEXT,
  matched BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_vendor_form_items_import ON vendor_form_items(import_id);
CREATE INDEX IF NOT EXISTS idx_vendor_form_items_order_item ON vendor_form_items(order_item_id);
CREATE INDEX IF NOT EXISTS idx_vendor_form_items_upc ON vendor_form_items(upc);

-- ============================================================
-- 4. Revisions summary table
-- ============================================================
CREATE TABLE IF NOT EXISTS revisions (
  id SERIAL PRIMARY KEY,
  revision_id TEXT NOT NULL UNIQUE,
  brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
  season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
  revision_type TEXT DEFAULT 'monthly_adjustment',

  -- Summary stats
  total_items INTEGER DEFAULT 0,
  ship_count INTEGER DEFAULT 0,
  cancel_count INTEGER DEFAULT 0,
  keep_open_count INTEGER DEFAULT 0,
  original_total_qty INTEGER DEFAULT 0,
  adjusted_total_qty INTEGER DEFAULT 0,
  reduction_pct NUMERIC(5,2),

  -- Workflow config used
  max_reduction_pct NUMERIC(5,4),
  logic_applied TEXT,

  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_revisions_brand ON revisions(brand_id);
CREATE INDEX IF NOT EXISTS idx_revisions_season ON revisions(season_id);
CREATE INDEX IF NOT EXISTS idx_revisions_date ON revisions(created_at DESC);

-- ============================================================
-- 5. Extend adjustment_history for revision tracking
-- ============================================================
ALTER TABLE adjustment_history
  ADD COLUMN IF NOT EXISTS revision_id TEXT,
  ADD COLUMN IF NOT EXISTS brand_id INTEGER,
  ADD COLUMN IF NOT EXISTS location_id INTEGER,
  ADD COLUMN IF NOT EXISTS vendor_form_item_id INTEGER,
  ADD COLUMN IF NOT EXISTS upc TEXT,
  ADD COLUMN IF NOT EXISTS product_name TEXT,
  ADD COLUMN IF NOT EXISTS size TEXT,
  ADD COLUMN IF NOT EXISTS decision TEXT,
  ADD COLUMN IF NOT EXISTS decision_reason TEXT,
  ADD COLUMN IF NOT EXISTS on_hand_at_revision INTEGER,
  ADD COLUMN IF NOT EXISTS was_flipped BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_by TEXT;

CREATE INDEX IF NOT EXISTS idx_adjustment_history_revision ON adjustment_history(revision_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_history_upc ON adjustment_history(upc);
CREATE INDEX IF NOT EXISTS idx_adjustment_history_brand ON adjustment_history(brand_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_history_decision ON adjustment_history(decision);
