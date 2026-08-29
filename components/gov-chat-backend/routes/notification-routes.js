const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const { logger } = require('../shared-lib');

/**
 * Fail-closed shared-secret guard for the broadcast/ops endpoints.
 *
 * The previous form — `if (expectedSecret && ...)` — silently disabled the
 * check whenever NOTIFICATION_BROADCAST_SECRET was unset (its default in
 * every compose file), leaving an unauthenticated push megaphone. Now an
 * unset secret refuses all broadcasts and logs at error level.
 *
 * Comparison is over SHA-256 digests via timingSafeEqual: constant-time and
 * immune to length mismatch errors.
 */
function requireBroadcastAuth(req, res, next) {
  const expectedSecret = process.env.NOTIFICATION_BROADCAST_SECRET || '';
  if (!expectedSecret) {
    logger.error('notification-routes: NOTIFICATION_BROADCAST_SECRET is not set — broadcast endpoints are disabled');
    return res.status(503).json({ success: false, message: 'notification_broadcast_not_configured' });
  }
  const provided = req.get('x-notification-secret') || '';
  const expectedDigest = crypto.createHash('sha256').update(expectedSecret).digest();
  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  if (!crypto.timingSafeEqual(expectedDigest, providedDigest)) {
    return res.status(401).json({ success: false, message: 'Invalid notification secret' });
  }
  req.notificationCaller = { kind: 'service', id: req.get('x-notification-source') || 'shared-secret' };
  return next();
}

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

  router.post('/unregister', authMiddleware.authenticate, async (req, res) => {
    try {
      const body = req.body || {};
      const userId = req.user?._key || req.user?.userId || req.user?.id;
      const result = await notificationService.unregisterDeviceToken({
        userId,
        fcmToken: body.fcmToken || null,
        all: body.all === true,
      });
      res.status(200).json(result);
    } catch (error) {
      logger.error('notification-routes.unregister_failed', { error: error.message });
      res.status(400).json({ success: false, message: error.message });
    }
  });

  // Asynchronous: returns 202 + broadcastId immediately; the fan-out runs on
  // the worker. Callers poll the status endpoint below.
  router.post('/broadcast', requireBroadcastAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const result = await notificationService.enqueueBroadcast(body, {
        idempotencyKey: body.idempotencyKey || req.get('idempotency-key') || null,
        requestedBy: req.notificationCaller,
        source: req.get('x-notification-source') || 'api',
      });

      if (result.duplicate) {
        return res.status(200).json({
          success: true,
          duplicate: true,
          broadcastId: result.broadcastId,
          status: result.status,
          statusUrl: `/api/notifications/broadcasts/${result.broadcastId}`,
        });
      }
      return res.status(202).json({
        success: true,
        broadcastId: result.broadcastId,
        status: result.status,
        statusUrl: `/api/notifications/broadcasts/${result.broadcastId}`,
      });
    } catch (error) {
      logger.error('notification-routes.broadcast_failed', {
        error: error.message,
        stack: error.stack,
      });
      res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  });

  router.get('/broadcasts/:broadcastId', requireBroadcastAuth, async (req, res) => {
    try {
      const status = await notificationService.getBroadcastStatus(req.params.broadcastId);
      if (!status) {
        return res.status(404).json({ success: false, message: 'Broadcast not found' });
      }
      return res.status(200).json({ success: true, ...status });
    } catch (error) {
      logger.error('notification-routes.status_failed', { error: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  });

  router.get('/broadcasts', requireBroadcastAuth, async (req, res) => {
    try {
      const broadcasts = await notificationService.listBroadcasts({
        status: req.query.status || null,
        limit: req.query.limit,
      });
      res.status(200).json({ success: true, broadcasts });
    } catch (error) {
      logger.error('notification-routes.list_failed', { error: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  });

  router.get('/health', requireBroadcastAuth, async (req, res) => {
    try {
      const health = await notificationService.getHealth();
      res.status(200).json({ success: true, ...health });
    } catch (error) {
      logger.error('notification-routes.health_failed', { error: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
