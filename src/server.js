const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const brandsRoutes = require('./routes/brands');
const productsRoutes = require('./routes/products');
const catalogsRoutes = require('./routes/catalogs');
const migrationsRoutes = require('./routes/migrations');
const seasonsRoutes = require('./routes/seasons');
const productFamiliesRoutes = require('./routes/product-families');
const ordersRoutes = require('./routes/orders');
const locationsRoutes = require('./routes/locations');
const salesDataRoutes = require('./routes/sales-data');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Preseason Ordering System API',
    version: '1.0.0',
    status: 'running'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/brands', brandsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/catalogs', catalogsRoutes);
app.use('/api/migrations', migrationsRoutes);
app.use('/api/seasons', seasonsRoutes);
app.use('/api/product-families', productFamiliesRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/sales-data', salesDataRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${PORT}/`);
});

module.exports = app;
