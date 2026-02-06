-- Migration 018: Knowledge Layer
-- Captures institutional knowledge for AI-assisted ordering decisions

-- Knowledge entries: brand rules, location tendencies, product notes, category heuristics
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL CHECK (type IN ('brand', 'location', 'category', 'product', 'general')),
  target_id INTEGER,                    -- brand_id, location_id, or product_id (NULL for general/category)
  target_name VARCHAR(200),             -- denormalized name for easy display
  key VARCHAR(100) NOT NULL,            -- e.g. 'size_bias', 'category_velocity', 'vendor_notes'
  value JSONB NOT NULL DEFAULT '{}',    -- flexible structure per key type
  description TEXT NOT NULL,            -- human-readable explanation (this is the core knowledge)
  season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,  -- NULL = all seasons
  priority INTEGER DEFAULT 0,           -- higher = more important (shown first in context)
  active BOOLEAN DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Adjustment rules: reusable heuristics that can be applied as batch operations
CREATE TABLE IF NOT EXISTS adjustment_rules (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  rule_type VARCHAR(50) NOT NULL CHECK (rule_type IN ('percentage', 'size_curve', 'threshold', 'copy_season', 'velocity_based')),
  brand_id INTEGER REFERENCES brands(id) ON DELETE CASCADE,
  location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE,
  category VARCHAR(100),
  subcategory VARCHAR(100),
  gender VARCHAR(50),
  season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,  -- NULL = all seasons
  rule_config JSONB NOT NULL,           -- type-specific config (see examples below)
  enabled BOOLEAN DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Adjustment history: audit trail of every quantity change (manual, rule-applied, ai-suggested)
CREATE TABLE IF NOT EXISTS adjustment_history (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id INTEGER,
  product_id INTEGER,
  applied_rule_id INTEGER REFERENCES adjustment_rules(id) ON DELETE SET NULL,
  batch_operation_id VARCHAR(50),       -- groups items changed in same batch
  original_quantity INTEGER NOT NULL,
  new_quantity INTEGER NOT NULL,
  adjustment_type VARCHAR(50) NOT NULL CHECK (adjustment_type IN ('manual', 'rule_applied', 'ai_suggested', 'batch_percentage', 'batch_size_curve', 'batch_threshold', 'copy_season')),
  reasoning TEXT,
  applied_by INTEGER REFERENCES users(id),
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_type ON knowledge_entries(type);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_type_target ON knowledge_entries(type, target_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_active ON knowledge_entries(active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_adjustment_rules_brand ON adjustment_rules(brand_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_rules_location ON adjustment_rules(location_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_rules_category ON adjustment_rules(category);
CREATE INDEX IF NOT EXISTS idx_adjustment_rules_enabled ON adjustment_rules(enabled) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_adjustment_history_order ON adjustment_history(order_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_history_batch ON adjustment_history(batch_operation_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_history_rule ON adjustment_history(applied_rule_id);

/*
KNOWLEDGE ENTRY EXAMPLES:

-- Brand size bias (Petzl over-ships smalls)
INSERT INTO knowledge_entries (type, target_id, target_name, key, value, description)
VALUES ('brand', 5, 'Petzl', 'size_bias',
  '{"xs": -30, "s": -15, "m": 0, "l": 10, "xl": 15, "xxl": -20}',
  'Petzl consistently over-ships XS and S sizes. Cut small sizes aggressively, increase L/XL.');

-- Location tendency (Ogden = trad climbing)
INSERT INTO knowledge_entries (type, target_id, target_name, key, value, description)
VALUES ('location', 2, 'Ogden', 'category_strength',
  '{"strong": ["Trad Gear", "Rope", "Helmets"], "weak": ["Sport Climbing", "Bouldering"]}',
  'Ogden customer base is heavily trad climbing. Trad gear sells 80% faster than other locations.');

-- Category rule
INSERT INTO knowledge_entries (type, target_name, key, value, description)
VALUES ('category', NULL, 'Rope', 'stocking_rule',
  '{"min_months_coverage": 3, "max_months_coverage": 6, "min_units_per_sku": 2}',
  'Always maintain 3-6 months of rope coverage. Never go below 2 units per SKU.');

-- Product note
INSERT INTO knowledge_entries (type, target_id, target_name, key, value, description)
VALUES ('product', 42, 'Sirocco Helmet', 'lifecycle',
  '{"status": "being_replaced", "replacement": "Sirocco Plus", "sunset_date": "2026-09"}',
  'Sirocco Helmet is being replaced by Sirocco Plus in Fall 2026. Reduce orders to clear inventory.');

ADJUSTMENT RULE EXAMPLES:

-- Percentage rule: cut all Petzl accessories by 15%
INSERT INTO adjustment_rules (name, rule_type, brand_id, category, rule_config, description)
VALUES ('Petzl Accessories Cut', 'percentage', 5, 'Accessories',
  '{"percentage": -15}',
  'Petzl accessories consistently overstocked. Apply 15% reduction.');

-- Size curve rule: standard climbing gear size distribution
INSERT INTO adjustment_rules (name, rule_type, category, rule_config, description)
VALUES ('Standard Climbing Size Curve', 'size_curve', NULL, 'Harnesses',
  '{"xs": -25, "s": -10, "m": 0, "l": 10, "xl": 5, "xxl": -20}',
  'Standard size distribution for climbing harnesses based on 3 years of sales data.');

-- Threshold rule: enforce min/max coverage
INSERT INTO adjustment_rules (name, rule_type, category, rule_config, description)
VALUES ('Rope Coverage Threshold', 'threshold', NULL, 'Rope',
  '{"min_units": 2, "max_months_coverage": 6, "min_months_coverage": 2}',
  'Ensure rope SKUs have 2-6 months coverage and minimum 2 units.');
*/
