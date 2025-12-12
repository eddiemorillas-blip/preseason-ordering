-- Initial Database Schema
-- Run this first to create all base tables

-- 1. Create users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'viewer' CHECK (role IN ('admin', 'buyer', 'viewer')),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- 2. Create brands table
CREATE TABLE IF NOT EXISTS brands (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    vendor_code VARCHAR(100),
    contact_name VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    notes TEXT,
    code VARCHAR(50),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create locations table
CREATE TABLE IF NOT EXISTS locations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    code VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    zip VARCHAR(20),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Create seasons table
CREATE TABLE IF NOT EXISTS seasons (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    start_date DATE,
    end_date DATE,
    status VARCHAR(20) DEFAULT 'planning' CHECK (status IN ('planning', 'ordering', 'closed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Create products table
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(500) NOT NULL,
    base_name VARCHAR(500),
    sku VARCHAR(100),
    upc VARCHAR(50),
    description TEXT,
    price DECIMAL(10, 2),
    cost DECIMAL(10, 2),
    wholesale_cost DECIMAL(10, 2),
    msrp DECIMAL(10, 2),
    brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
    season_id INTEGER REFERENCES seasons(id),
    category VARCHAR(255),
    subcategory VARCHAR(255),
    gender VARCHAR(50),
    size VARCHAR(100),
    color VARCHAR(255),
    inseam VARCHAR(50),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(upc)
);

-- 6. Create catalog_uploads table
CREATE TABLE IF NOT EXISTS catalog_uploads (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    brand_id INTEGER REFERENCES brands(id),
    season_id INTEGER REFERENCES seasons(id),
    records_processed INTEGER DEFAULT 0,
    records_added INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    products_added INTEGER DEFAULT 0,
    products_updated INTEGER DEFAULT 0,
    products_deactivated INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'processing',
    upload_status VARCHAR(50),
    uploaded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Create orders table
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_number VARCHAR(100) UNIQUE,
    season_id INTEGER REFERENCES seasons(id),
    brand_id INTEGER REFERENCES brands(id),
    location_id INTEGER REFERENCES locations(id),
    created_by INTEGER REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'ordered', 'received', 'cancelled')),
    ship_date DATE,
    order_type VARCHAR(50) DEFAULT 'preseason',
    budget_total DECIMAL(12, 2),
    current_total DECIMAL(10, 2) DEFAULT 0,
    notes TEXT,
    total_amount DECIMAL(12, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Create order_items table
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10, 2),
    unit_cost DECIMAL(10, 2),
    total_price DECIMAL(12, 2),
    line_total DECIMAL(10, 2),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Create season_budgets table
CREATE TABLE IF NOT EXISTS season_budgets (
    id SERIAL PRIMARY KEY,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    budget_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(season_id, brand_id, location_id)
);

-- 10. Create brand_order_templates table
CREATE TABLE IF NOT EXISTS brand_order_templates (
    id SERIAL PRIMARY KEY,
    brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    file_path VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    column_mappings JSONB NOT NULL DEFAULT '{}',
    data_start_row INTEGER NOT NULL DEFAULT 2,
    sheet_name VARCHAR(100),
    active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(brand_id, name)
);

-- 11. Create sales_data table
CREATE TABLE IF NOT EXISTS sales_data (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    location_id INTEGER REFERENCES locations(id),
    original_upc VARCHAR(50),
    quantity_sold INTEGER DEFAULT 0,
    sale_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_season ON products(season_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_upc ON products(upc);
CREATE INDEX IF NOT EXISTS idx_products_base_name ON products(base_name);
CREATE INDEX IF NOT EXISTS idx_products_brand_base ON products(brand_id, base_name);
CREATE INDEX IF NOT EXISTS idx_orders_location ON orders(location_id);
CREATE INDEX IF NOT EXISTS idx_orders_season ON orders(season_id);
CREATE INDEX IF NOT EXISTS idx_orders_brand ON orders(brand_id);
CREATE INDEX IF NOT EXISTS idx_orders_season_brand_location ON orders(season_id, brand_id, location_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_season_budgets_lookup ON season_budgets(season_id, brand_id, location_id);
CREATE INDEX IF NOT EXISTS idx_brand_order_templates_brand ON brand_order_templates(brand_id);
CREATE INDEX IF NOT EXISTS idx_sales_data_upc ON sales_data(original_upc);

-- 13. Create update trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 14. Insert default admin user (password: admin123)
INSERT INTO users (first_name, last_name, email, password_hash, role)
VALUES ('Admin', 'User', 'admin@example.com', '$2a$10$8YRZvXqN5qFP5yX6F4j0Eu5MJb9.nP2xE8qNXZVzP7xqH0Y3FJ3JO', 'admin')
ON CONFLICT (email) DO NOTHING;

COMMENT ON TABLE users IS 'System users with role-based access';
COMMENT ON TABLE brands IS 'Product brands/manufacturers';
COMMENT ON TABLE locations IS 'Store locations for orders';
COMMENT ON TABLE seasons IS 'Ordering seasons for organizing preseason orders';
COMMENT ON TABLE products IS 'Product catalog';
COMMENT ON TABLE orders IS 'Purchase orders';
COMMENT ON TABLE season_budgets IS 'Budget allocations per brand per location per season';
COMMENT ON COLUMN products.base_name IS 'Product family name without size/color variants';
