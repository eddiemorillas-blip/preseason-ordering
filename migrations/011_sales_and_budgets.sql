-- Sales and Budget Tables Migration
-- Adds tables for BigQuery sales sync and season budgets

-- ============================================
-- BRAND MAPPING TABLE
-- Maps RGP vendor names to pricelist brand names
-- ============================================
CREATE TABLE IF NOT EXISTS brand_mapping (
    id SERIAL PRIMARY KEY,
    rgp_vendor_name VARCHAR(255) NOT NULL,
    brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
    brand_name VARCHAR(255),
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(rgp_vendor_name)
);

CREATE INDEX IF NOT EXISTS idx_brand_mapping_vendor ON brand_mapping(rgp_vendor_name);
CREATE INDEX IF NOT EXISTS idx_brand_mapping_brand ON brand_mapping(brand_id);

-- ============================================
-- SALES SUMMARY BY UPC
-- Aggregated sales data synced from BigQuery
-- ============================================
CREATE TABLE IF NOT EXISTS sales_by_upc (
    id SERIAL PRIMARY KEY,
    upc VARCHAR(50) NOT NULL,
    product_name VARCHAR(500),
    rgp_category VARCHAR(255),
    rgp_revenue_category VARCHAR(255),
    rgp_vendor_name VARCHAR(255),
    facility_id VARCHAR(50),
    total_qty_sold INTEGER DEFAULT 0,
    total_revenue DECIMAL(12, 2) DEFAULT 0,
    transaction_count INTEGER DEFAULT 0,
    first_sale_date TIMESTAMP,
    last_sale_date TIMESTAMP,
    period_months INTEGER DEFAULT 12,
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(upc, facility_id, period_months)
);

CREATE INDEX IF NOT EXISTS idx_sales_upc ON sales_by_upc(upc);
CREATE INDEX IF NOT EXISTS idx_sales_vendor ON sales_by_upc(rgp_vendor_name);
CREATE INDEX IF NOT EXISTS idx_sales_category ON sales_by_upc(rgp_category);

-- ============================================
-- SALES SUMMARY BY BRAND/CATEGORY
-- Aggregated brand-level sales from BigQuery
-- ============================================
CREATE TABLE IF NOT EXISTS sales_by_brand_category (
    id SERIAL PRIMARY KEY,
    rgp_vendor_name VARCHAR(255),
    brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
    category VARCHAR(255),
    revenue_category VARCHAR(255),
    facility_id VARCHAR(50),
    unique_products INTEGER DEFAULT 0,
    total_qty_sold INTEGER DEFAULT 0,
    total_revenue DECIMAL(12, 2) DEFAULT 0,
    transaction_count INTEGER DEFAULT 0,
    period_months INTEGER DEFAULT 12,
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(rgp_vendor_name, category, facility_id, period_months)
);

CREATE INDEX IF NOT EXISTS idx_sales_brand_vendor ON sales_by_brand_category(rgp_vendor_name);
CREATE INDEX IF NOT EXISTS idx_sales_brand_id ON sales_by_brand_category(brand_id);

-- ============================================
-- MONTHLY SALES TRENDS
-- Monthly breakdown for trend analysis
-- ============================================
CREATE TABLE IF NOT EXISTS sales_monthly_trends (
    id SERIAL PRIMARY KEY,
    rgp_vendor_name VARCHAR(255),
    brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
    month VARCHAR(7) NOT NULL, -- YYYY-MM format
    total_qty_sold INTEGER DEFAULT 0,
    total_revenue DECIMAL(12, 2) DEFAULT 0,
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(rgp_vendor_name, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_vendor ON sales_monthly_trends(rgp_vendor_name);
CREATE INDEX IF NOT EXISTS idx_monthly_month ON sales_monthly_trends(month);

-- ============================================
-- SEASON BUDGETS
-- Overall budget for a season
-- ============================================
CREATE TABLE IF NOT EXISTS season_budgets (
    id SERIAL PRIMARY KEY,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    total_budget DECIMAL(12, 2) NOT NULL,
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(season_id)
);

-- ============================================
-- BRAND BUDGET ALLOCATIONS
-- Budget breakdown by brand for a season
-- ============================================
CREATE TABLE IF NOT EXISTS brand_budget_allocations (
    id SERIAL PRIMARY KEY,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    brand_id INTEGER REFERENCES brands(id) ON DELETE CASCADE,
    brand_name VARCHAR(255), -- Store name in case brand is deleted
    allocated_amount DECIMAL(12, 2) NOT NULL,
    last_year_revenue DECIMAL(12, 2), -- From BigQuery sync
    last_year_pct DECIMAL(5, 2), -- Percentage of total sales
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(season_id, brand_id)
);

CREATE INDEX IF NOT EXISTS idx_budget_alloc_season ON brand_budget_allocations(season_id);
CREATE INDEX IF NOT EXISTS idx_budget_alloc_brand ON brand_budget_allocations(brand_id);

-- ============================================
-- SYNC LOG
-- Track BigQuery sync operations
-- ============================================
CREATE TABLE IF NOT EXISTS bigquery_sync_log (
    id SERIAL PRIMARY KEY,
    sync_type VARCHAR(50) NOT NULL, -- 'sales_by_upc', 'sales_by_brand', 'monthly_trends'
    records_synced INTEGER DEFAULT 0,
    period_months INTEGER,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'running', -- 'running', 'completed', 'failed'
    error_message TEXT,
    triggered_by INTEGER REFERENCES users(id)
);

-- ============================================
-- ADD COMMITTED AMOUNT TO ORDERS
-- Track how much of budget is committed per order
-- ============================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS committed_amount DECIMAL(12, 2) DEFAULT 0;

-- ============================================
-- HELPER VIEW: Budget Status by Season
-- ============================================
CREATE OR REPLACE VIEW v_season_budget_status AS
SELECT
    s.id as season_id,
    s.name as season_name,
    sb.total_budget,
    COALESCE(SUM(o.committed_amount), 0) as total_committed,
    sb.total_budget - COALESCE(SUM(o.committed_amount), 0) as remaining_budget,
    CASE
        WHEN sb.total_budget > 0 THEN
            ROUND((COALESCE(SUM(o.committed_amount), 0) / sb.total_budget) * 100, 1)
        ELSE 0
    END as pct_committed
FROM seasons s
LEFT JOIN season_budgets sb ON s.id = sb.season_id
LEFT JOIN orders o ON s.id = o.season_id AND o.status != 'cancelled'
GROUP BY s.id, s.name, sb.total_budget;

-- ============================================
-- HELPER VIEW: Brand Budget Status
-- ============================================
CREATE OR REPLACE VIEW v_brand_budget_status AS
SELECT
    bba.season_id,
    bba.brand_id,
    COALESCE(b.name, bba.brand_name) as brand_name,
    bba.allocated_amount,
    bba.last_year_revenue,
    bba.last_year_pct,
    COALESCE(SUM(
        CASE WHEN oi.id IS NOT NULL THEN
            oi.quantity * COALESCE(oi.unit_cost, p.wholesale_cost, 0)
        ELSE 0 END
    ), 0) as committed_amount,
    bba.allocated_amount - COALESCE(SUM(
        CASE WHEN oi.id IS NOT NULL THEN
            oi.quantity * COALESCE(oi.unit_cost, p.wholesale_cost, 0)
        ELSE 0 END
    ), 0) as remaining_amount
FROM brand_budget_allocations bba
LEFT JOIN brands b ON bba.brand_id = b.id
LEFT JOIN orders o ON bba.season_id = o.season_id AND o.status != 'cancelled'
LEFT JOIN order_items oi ON o.id = oi.order_id
LEFT JOIN products p ON oi.product_id = p.id AND p.brand_id = bba.brand_id
GROUP BY bba.season_id, bba.brand_id, b.name, bba.brand_name,
         bba.allocated_amount, bba.last_year_revenue, bba.last_year_pct;
