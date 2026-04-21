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
const scheduledRoutes = require('./routes/scheduled');
const knowledgeRoutes = require('./routes/knowledge');
const patternsRoutes = require('./routes/patterns');
const batchOperationsRoutes = require('./routes/batch-operations');
const revisionsRoutes = require('./routes/revisions');
const revisionsChatRoutes = require('./routes/revisions-chat');
const targetsRoutes = require('./routes/targets');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

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

// Debug endpoint to diagnose export issues
app.get('/api/debug/export-diagnosis', async (req, res) => {
  const pool = require('./config/database');
  try {
    // Check if finalized_adjustments table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'finalized_adjustments'
      ) as exists
    `);

    // Count records
    const adjustmentCount = await pool.query('SELECT COUNT(*) as count FROM finalized_adjustments').catch(() => ({ rows: [{ count: 0 }] }));
    const finalizedOrderCount = await pool.query('SELECT COUNT(*) as count FROM orders WHERE finalized_at IS NOT NULL');

    // Get finalized orders with adjustment comparison
    const comparison = await pool.query(`
      SELECT
        o.id,
        o.order_number,
        o.finalized_at,
        o.season_id,
        o.brand_id,
        s.name as season_name,
        b.name as brand_name,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as item_count,
        (SELECT COUNT(*) FROM finalized_adjustments fa WHERE fa.order_id = o.id) as adjustment_count
      FROM orders o
      LEFT JOIN seasons s ON o.season_id = s.id
      LEFT JOIN brands b ON o.brand_id = b.id
      WHERE o.finalized_at IS NOT NULL
      ORDER BY o.finalized_at DESC
      LIMIT 30
    `);

    // Find orders with missing adjustments
    const missingAdjustments = comparison.rows.filter(r => r.item_count > 0 && r.adjustment_count === 0);

    // Get adjustments grouped by season/brand
    const bySeasonBrand = await pool.query(`
      SELECT
        s.id as season_id,
        s.name as season_name,
        b.id as brand_id,
        b.name as brand_name,
        COUNT(DISTINCT fa.order_id) as order_count,
        COUNT(*) as adjustment_count
      FROM finalized_adjustments fa
      LEFT JOIN seasons s ON fa.season_id = s.id
      LEFT JOIN brands b ON fa.brand_id = b.id
      GROUP BY s.id, s.name, b.id, b.name
      ORDER BY s.name, b.name
    `);

    // Get users
    const users = await pool.query('SELECT id, email, first_name, last_name, role FROM users ORDER BY role, email');

    res.json({
      tableExists: tableCheck.rows[0].exists,
      totalAdjustmentRecords: parseInt(adjustmentCount.rows[0].count),
      totalFinalizedOrders: parseInt(finalizedOrderCount.rows[0].count),
      finalizedOrders: comparison.rows,
      ordersWithMissingAdjustments: missingAdjustments,
      adjustmentsBySeasonBrand: bySeasonBrand.rows,
      users: users.rows.map(u => ({ ...u, canAccessExportCenter: ['admin', 'buyer'].includes(u.role) })),
      diagnosis: {
        hasMissingAdjustments: missingAdjustments.length > 0,
        message: missingAdjustments.length > 0
          ? `Found ${missingAdjustments.length} finalized order(s) with missing adjustment records. This causes the "no file to export" error.`
          : adjustmentCount.rows[0].count === 0
            ? 'The finalized_adjustments table is empty. No orders have been properly finalized.'
            : 'Export data looks healthy.'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
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
app.use('/api/scheduled', scheduledRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/patterns', patternsRoutes);
app.use('/api/batch-operations', batchOperationsRoutes);
app.use('/api/revisions/chat', revisionsChatRoutes);
app.use('/api/revisions', revisionsRoutes);
app.use('/api/targets', targetsRoutes);

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

// Run essential schema migrations on startup
const pool = require('./config/database');
(async () => {
  try {
    await pool.query(`
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS adjusted_quantity INTEGER;
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS received_quantity INTEGER DEFAULT 0;
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS backordered_quantity INTEGER DEFAULT 0;
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS receipt_status VARCHAR(50) DEFAULT 'pending';
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS received_date TIMESTAMP;
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS vendor_decision VARCHAR(50);
      CREATE INDEX IF NOT EXISTS idx_order_items_receipt ON order_items(receipt_status);
      CREATE INDEX IF NOT EXISTS idx_order_items_vendor_decision ON order_items(vendor_decision);
    `);
    console.log('✓ Schema migrations verified');
  } catch (err) {
    console.error('Schema migration warning:', err.message);
  }
})();

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${PORT}/`);
});

module.exports = app;
