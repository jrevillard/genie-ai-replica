const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const { logger } = require('../shared-lib');

module.exports = (notificationService) => {
  if (!notificationService || typeof notificationService.registerDeviceToken !== 'function') {
    logger.error('Invalid notificationService provided to notification-routes');
    throw new Error('notificationService is required');
  }

  router.post('/register', authMiddleware.authenticate, async (req, res) => {
    try {
      const body = req.body || {};
      const authenticatedUserId = req.user?._key || req.user?.userId || req.user?.id;
      const result = await notificationService.registerDeviceToken({
        ...body,
        userId: body.userId || authenticatedUserId,
      });
      res.status(200).json(result);
    } catch (error) {
      logger.error('notification-routes.register_failed', {
        error: error.message,
        stack: error.stack,
      });
      res.status(400).json({ success: false, message: error.message });
    }
  });

  router.post('/broadcast', async (req, res) => {
    try {
      const expectedSecret = process.env.NOTIFICATION_BROADCAST_SECRET || '';
      if (expectedSecret && req.get('x-notification-secret') !== expectedSecret) {
        return res.status(401).json({ success: false, message: 'Invalid notification secret' });
      }

      const result = await notificationService.broadcast(req.body || {});
      res.status(result.success ? 200 : 503).json(result);
    } catch (error) {
      logger.error('notification-routes.broadcast_failed', {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
