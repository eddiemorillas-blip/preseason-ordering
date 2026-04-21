-- migrations/022_product_location_targets.sql
-- Target quantities per product per location (evergreen — no season scope)

CREATE TABLE IF NOT EXISTS product_location_targets (
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id  INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  target_qty   INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by   TEXT,
  PRIMARY KEY (product_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_targets_product ON product_location_targets(product_id);
CREATE INDEX IF NOT EXISTS idx_targets_location ON product_location_targets(location_id);
CREATE INDEX IF NOT EXISTS idx_targets_updated ON product_location_targets(updated_at DESC);

-- DOWN (commented out):
-- DROP TABLE IF EXISTS product_location_targets;
