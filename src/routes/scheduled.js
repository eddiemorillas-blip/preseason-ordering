const express = require('express');
const router = express.Router();
const inventoryAlerts = require('../services/inventoryAlerts');

/**
 * Scheduled job routes
 * These can be triggered by Railway cron, external cron services, or manually
 */

// Secret key for authenticating scheduled job calls
const CRON_SECRET = process.env.CRON_SECRET || 'default-cron-secret-change-me';

/**
 * Middleware to verify cron secret
 */
function verifyCronSecret(req, res, next) {
  const providedSecret = req.headers['x-cron-secret'] || req.query.secret;

  if (providedSecret !== CRON_SECRET) {
    console.log('[Scheduled] Unauthorized cron request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

/**
 * POST /api/scheduled/inventory-alerts
 * Run the weekly inventory analysis and send alerts
 *
 * Can be triggered by:
 * - Railway cron job
 * - External cron service (cron-job.org, etc.)
 * - Manual API call with secret
 */
router.post('/inventory-alerts', verifyCronSecret, async (req, res) => {
  console.log('[Scheduled] Inventory alerts job triggered');

  try {
    const result = await inventoryAlerts.runAndNotify();

    res.json({
      success: true,
      summary: result.report.summary,
      webhook_sent: result.webhook.sent,
      webhook_error: result.webhook.reason || null,
      report_date: result.report.report_date
    });
  } catch (error) {
    console.error('[Scheduled] Inventory alerts job failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/scheduled/inventory-alerts/preview
 * Preview what the weekly report would contain (without sending)
 * Requires auth but doesn't send webhook
 */
router.get('/inventory-alerts/preview', verifyCronSecret, async (req, res) => {
  console.log('[Scheduled] Inventory alerts preview requested');

  try {
    const report = await inventoryAlerts.runWeeklyAnalysis();

    res.json({
      success: true,
      preview: true,
      report
    });
  } catch (error) {
    console.error('[Scheduled] Inventory alerts preview failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/scheduled/inventory-alerts/test-webhook
 * Send a test message to the Power Automate webhook
 */
router.post('/inventory-alerts/test-webhook', verifyCronSecret, async (req, res) => {
  console.log('[Scheduled] Testing Power Automate webhook');

  const webhookUrl = process.env.POWER_AUTOMATE_WEBHOOK_URL;

  if (!webhookUrl) {
    return res.status(400).json({
      success: false,
      error: 'POWER_AUTOMATE_WEBHOOK_URL environment variable not set'
    });
  }

  const testPayload = {
    test: true,
    report_date: new Date().toISOString().split('T')[0],
    message: 'This is a test alert from the Preseason Ordering System',
    summary: {
      total_critical_items: 0,
      total_low_items: 0,
      total_overstocked_items: 0,
      brands_analyzed: 0,
      locations_analyzed: 0
    },
    critical_items: []
  };

  const result = await inventoryAlerts.sendToWebhook(testPayload, webhookUrl);

  res.json({
    success: result.sent,
    error: result.reason || null
  });
});

module.exports = router;
