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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create locations table
CREATE TABLE IF NOT EXISTS locations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Create products table
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(500) NOT NULL,
    sku VARCHAR(100),
    upc VARCHAR(50),
    description TEXT,
    price DECIMAL(10, 2),
    cost DECIMAL(10, 2),
    msrp DECIMAL(10, 2),
    brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
    category VARCHAR(255),
    gender VARCHAR(50),
    size VARCHAR(50),
    color VARCHAR(100),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(brand_id, sku)
);

-- 5. Create catalog_uploads table
CREATE TABLE IF NOT EXISTS catalog_uploads (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    brand_id INTEGER REFERENCES brands(id),
    records_processed INTEGER DEFAULT 0,
    records_added INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'processing',
    uploaded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Create orders table
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_number VARCHAR(100) UNIQUE,
    location_id INTEGER REFERENCES locations(id),
    created_by INTEGER REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'ordered', 'received', 'cancelled')),
    notes TEXT,
    total_amount DECIMAL(12, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Create order_items table
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10, 2),
    total_price DECIMAL(12, 2),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_upc ON products(upc);
CREATE INDEX IF NOT EXISTS idx_orders_location ON orders(location_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- 9. Insert default admin user (password: admin123)
-- Password hash for "admin123"
INSERT INTO users (first_name, last_name, email, password_hash, role)
VALUES ('Admin', 'User', 'admin@example.com', '$2a$10$8YRZvXqN5qFP5yX6F4j0Eu5MJb9.nP2xE8qNXZVzP7xqH0Y3FJ3JO', 'admin')
ON CONFLICT (email) DO NOTHING;

-- 10. Insert sample brands
INSERT INTO brands (name, description)
VALUES
    ('Sample Brand', 'A sample brand for testing'),
    ('Test Brand', 'Another test brand')
ON CONFLICT (name) DO NOTHING;

-- 11. Insert sample locations
INSERT INTO locations (name, city, state)
VALUES
    ('Main Store', 'Denver', 'CO'),
    ('North Location', 'Boulder', 'CO')
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE users IS 'System users with role-based access';
COMMENT ON TABLE brands IS 'Product brands/manufacturers';
COMMENT ON TABLE locations IS 'Store locations for orders';
COMMENT ON TABLE products IS 'Product catalog';
COMMENT ON TABLE orders IS 'Purchase orders';
