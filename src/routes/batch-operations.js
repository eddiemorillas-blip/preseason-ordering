const router = require('express').Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const {
  previewBatchOperation,
  applyBatchOperation,
  previewCopySeason,
  applyCopySeason,
  applyRule,
  undoBatchOperation,
  getAdjustmentHistory
} = require('../services/batchService');

/**
 * POST /api/batch-operations/preview
 * Preview a batch operation without applying changes
 *
 * Body: {
 *   orderId: number,
 *   operation: {
 *     type: 'percentage' | 'size_curve' | 'threshold',
 *     filters: { category?, gender?, subcategory?, color? },
 *     config: { ... }  // depends on type
 *   }
 * }
 */
router.post('/preview', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { orderId, operation } = req.body;

    if (!orderId || !operation) {
      return res.status(400).json({
        error: 'Missing required fields: orderId, operation'
      });
    }

    const preview = await previewBatchOperation(orderId, operation);

    res.json({
      success: true,
      data: preview
    });
  } catch (error) {
    console.error('[batch-operations] Preview error:', error);
    res.status(400).json({
      error: error.message
    });
  }
});

/**
 * POST /api/batch-operations/apply
 * Apply a batch operation and record changes
 *
 * Body: {
 *   orderId: number,
 *   changes: [{ order_item_id, new_qty }, ...],
 *   operation: { type, filters, config }
 * }
 */
router.post('/apply', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { orderId, changes, operation } = req.body;

    if (!orderId || !changes || !Array.isArray(changes) || !operation) {
      return res.status(400).json({
        error: 'Missing required fields: orderId, changes (array), operation'
      });
    }

    if (changes.length === 0) {
      return res.status(400).json({
        error: 'No changes to apply'
      });
    }

    const result = await applyBatchOperation(orderId, changes, req.user.id, operation);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[batch-operations] Apply error:', error);
    res.status(400).json({
      error: error.message
    });
  }
});

/**
 * POST /api/batch-operations/copy-season/preview
 * Preview copying quantities from a source season to target order
 *
 * Body: {
 *   targetOrderId: number,
 *   sourceSeasonId: number,
 *   scalingFactor?: number (default 1.0),
 *   filters?: {}
 * }
 */
router.post('/copy-season/preview', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { targetOrderId, sourceSeasonId, scalingFactor = 1.0, filters = {} } = req.body;

    if (!targetOrderId || !sourceSeasonId) {
      return res.status(400).json({
        error: 'Missing required fields: targetOrderId, sourceSeasonId'
      });
    }

    const preview = await previewCopySeason(targetOrderId, sourceSeasonId, scalingFactor, filters);

    res.json({
      success: true,
      data: preview
    });
  } catch (error) {
    console.error('[batch-operations] Copy season preview error:', error);
    res.status(400).json({
      error: error.message
    });
  }
});

/**
 * POST /api/batch-operations/copy-season/apply
 * Apply copy season operation
 *
 * Body: {
 *   targetOrderId: number,
 *   changes: [{ target_item_id, suggested_qty }, ...]
 * }
 */
router.post('/copy-season/apply', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { targetOrderId, changes } = req.body;

    if (!targetOrderId || !changes || !Array.isArray(changes)) {
      return res.status(400).json({
        error: 'Missing required fields: targetOrderId, changes (array)'
      });
    }

    if (changes.length === 0) {
      return res.status(400).json({
        error: 'No changes to apply'
      });
    }

    const result = await applyCopySeason(targetOrderId, changes, req.user.id);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[batch-operations] Copy season apply error:', error);
    res.status(400).json({
      error: error.message
    });
  }
});

/**
 * POST /api/batch-operations/apply-rule/:ruleId
 * Apply a predefined adjustment rule to an order
 *
 * Body: {
 *   orderId: number
 * }
 */
router.post('/apply-rule/:ruleId', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { ruleId } = req.params;
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        error: 'Missing required field: orderId'
      });
    }

    if (!ruleId) {
      return res.status(400).json({
        error: 'Missing required parameter: ruleId'
      });
    }

    const result = await applyRule(orderId, parseInt(ruleId), req.user.id);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[batch-operations] Apply rule error:', error);
    res.status(400).json({
      error: error.message
    });
  }
});

/**
 * POST /api/batch-operations/undo/:batchOperationId
 * Undo a batch operation by restoring original quantities
 *
 * No body required
 */
router.post('/undo/:batchOperationId', authenticateToken, authorizeRoles('admin', 'buyer'), async (req, res) => {
  try {
    const { batchOperationId } = req.params;

    if (!batchOperationId) {
      return res.status(400).json({
        error: 'Missing required parameter: batchOperationId'
      });
    }

    const result = await undoBatchOperation(batchOperationId, req.user.id);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[batch-operations] Undo error:', error);
    res.status(400).json({
      error: error.message
    });
  }
});

/**
 * GET /api/batch-operations/history/:orderId
 * Get adjustment history for an order, grouped by batch operation
 */
router.get('/history/:orderId', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({
        error: 'Missing required parameter: orderId'
      });
    }

    const history = await getAdjustmentHistory(parseInt(orderId));

    res.json({
      success: true,
      data: history,
      total_operations: history.length
    });
  } catch (error) {
    console.error('[batch-operations] History error:', error);
    res.status(400).json({
      error: error.message
    });
  }
});

module.exports = router;
