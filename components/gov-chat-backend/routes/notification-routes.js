const express = require('express');
const authMiddleware = require('../middleware/auth-middleware');
const { logger } = require('../shared-lib');

module.exports = (notificationService) => {
  const router = express.Router();

  if (!notificationService || typeof notificationService.registerDevice !== 'function') {
    logger.error('Invalid notificationService provided to notification-routes');
    throw new Error('notificationService is required');
  }

  router.post('/register', authMiddleware.authenticate, async (req, res) => {
    try {
      const tokenUserId = req.user?._key || req.user?.userId || req.user?.id;
      const userId = req.body.userId || tokenUserId;
      const registered = await notificationService.registerDevice({
        userId,
        fcmToken: req.body.fcmToken,
        platform: req.body.platform || 'android',
        preferences: req.body.preferences || {},
      });
      res.json({ ok: true, tokenId: registered._key, userId: registered.userId });
    } catch (error) {
      logger.error('[NOTIFICATIONS] Register failed', { error: error.message, stack: error.stack });
      res.status(400).json({ ok: false, message: error.message });
    }
  });

  router.post('/unregister', authMiddleware.authenticate, async (req, res) => {
    try {
      const updated = await notificationService.deactivateToken(req.body.fcmToken);
      res.json({ ok: true, tokenId: updated?._key || null });
    } catch (error) {
      logger.error('[NOTIFICATIONS] Unregister failed', { error: error.message, stack: error.stack });
      res.status(400).json({ ok: false, message: error.message });
    }
  });

  router.post('/broadcast', async (req, res, next) => {
    const configuredSecret = process.env.NOTIFICATION_BROADCAST_SECRET || '';
    const providedSecret = req.get('x-notification-secret') || req.get('x-api-key') || '';

    if (configuredSecret && providedSecret === configuredSecret) {
      return handleBroadcast(req, res);
    }

    return authMiddleware.authenticate(req, res, (authError) => {
      if (authError) return next(authError);
      if (!['Admin', 'Manager'].includes(req.user?.role)) {
        return res.status(403).json({ ok: false, message: 'Admin or notification secret required' });
      }
      return handleBroadcast(req, res);
    });
  });

  async function handleBroadcast(req, res) {
    try {
      const result = await notificationService.broadcast(req.body || {});
      res.json({ ok: true, ...result });
    } catch (error) {
      logger.error('[NOTIFICATIONS] Broadcast failed', { error: error.message, stack: error.stack });
      res.status(500).json({ ok: false, message: error.message });
    }
  }

  return router;
};
