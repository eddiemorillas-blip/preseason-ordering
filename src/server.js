const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Create uploads directory on startup
const uploadsDir = process.env.NODE_ENV === 'production'
  ? '/tmp/uploads'
  : path.join(__dirname, '../uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Created uploads directory:', uploadsDir);
} else {
  console.log('Uploads directory exists:', uploadsDir);
}

// Test write permissions
try {
  const testFile = path.join(uploadsDir, 'test.txt');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  console.log('✓ Uploads directory is writable');
} catch (err) {
  console.error('✗ Uploads directory is NOT writable:', err.message);
}

// Export for use in other modules
global.UPLOADS_DIR = uploadsDir;

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
const exportsRoutes = require('./routes/exports');
const brandTemplatesRoutes = require('./routes/brand-templates');
const pricesRoutes = require('./routes/prices');
const salesRoutes = require('./routes/sales');
const budgetsRoutes = require('./routes/budgets');
const productCasesRoutes = require('./routes/product-cases');
const formTemplatesRoutes = require('./routes/form-templates');
const formsRoutes = require('./routes/forms');
const agentRoutes = require('./routes/agent');

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
app.get('/api/health', (req, res) => {
  res.json({
    message: 'Preseason Ordering System API',
    version: '1.0.1',  // Updated: DATE() fix for ship date comparison
    deployedAt: '2025-12-21T20:15:00Z',
    status: 'running'
  });
});

// Debug endpoint to check AI Agent environment variables
app.get('/api/debug/ai-config', (req, res) => {
  res.json({
    AI_AGENT_ENABLED: process.env.AI_AGENT_ENABLED,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_MODEL: process.env.AI_MODEL,
    AI_MAX_MONTHLY_COST: process.env.AI_MAX_MONTHLY_COST,
    AI_MAX_TOKENS_PER_REQUEST: process.env.AI_MAX_TOKENS_PER_REQUEST,
    ANTHROPIC_API_KEY_SET: !!process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_API_KEY_LENGTH: process.env.ANTHROPIC_API_KEY?.length || 0,
    OPENAI_API_KEY_SET: !!process.env.OPENAI_API_KEY,
    NODE_ENV: process.env.NODE_ENV
  });
});

// Debug endpoint to check database tables
app.get('/api/debug/tables', async (req, res) => {
  const pool = require('./config/database');
  try {
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    const seasonPricesCount = await pool.query('SELECT COUNT(*) as cnt FROM season_prices').catch(() => ({ rows: [{ cnt: 'error' }] }));
    const seasonsCount = await pool.query('SELECT COUNT(*) as cnt FROM seasons').catch(() => ({ rows: [{ cnt: 'error' }] }));
    res.json({
      tables: tables.rows.map(r => r.table_name),
      season_prices_count: seasonPricesCount.rows[0].cnt,
      seasons_count: seasonsCount.rows[0].cnt,
      db_url_set: !!process.env.DATABASE_URL
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
app.use('/api/exports', exportsRoutes);
app.use('/api/brand-templates', brandTemplatesRoutes);
app.use('/api/prices', pricesRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/budgets', budgetsRoutes);
app.use('/api/product-cases', productCasesRoutes);
app.use('/api/form-templates', formTemplatesRoutes);
app.use('/api/forms', formsRoutes);
app.use('/api/agent', agentRoutes);

// Serve static files from frontend build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/dist')));

  // Handle React routing - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
    }
  });
}

// 404 handler for API routes
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('='.repeat(80));
  console.error('GLOBAL ERROR HANDLER');
  console.error('Path:', req.method, req.path);
  console.error('Error:', err);
  console.error('Stack:', err.stack);
  console.error('='.repeat(80));
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
