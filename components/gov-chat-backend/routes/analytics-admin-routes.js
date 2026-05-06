'use strict';

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const { logger } = require('../shared-lib');

/**
 * @swagger
 * tags:
 *   - name: Admin Analytics
 *     description: Admin analytics — chat, call, patient, and twin insights
 */

module.exports = (analyticsAdminService) => {
  if (!analyticsAdminService || typeof analyticsAdminService.getSummary !== 'function') {
    logger.error('analytics-admin-routes: invalid analyticsAdminService');
    throw new Error('analyticsAdminService is required');
  }

  /**
   * @swagger
   * /api/analytics/admin:
   *   get:
   *     summary: Full admin analytics summary
   *     description: >
   *       Returns all analytics data for the authenticated admin scoped to their
   *       patients (users with adminId matching the caller) and their twins.
   *       Includes KPI cards, daily activity, channel split, twin breakdown,
   *       session/call distributions, top topics, and hourly patterns.
   *     tags: [Admin Analytics]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: from
   *         schema:
   *           type: string
   *           format: date
   *           example: "2026-04-01"
   *         description: Start date (YYYY-MM-DD). Defaults to 30 days ago.
   *       - in: query
   *         name: to
   *         schema:
   *           type: string
   *           format: date
   *           example: "2026-04-30"
   *         description: End date (YYYY-MM-DD). Defaults to today.
   *     responses:
   *       200:
   *         description: Analytics summary payload
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 period:
   *                   type: object
   *                   properties:
   *                     from: { type: string, format: date-time }
   *                     to:   { type: string, format: date-time }
   *                 kpis:
   *                   type: object
   *                   properties:
   *                     totalChatSessions:    { type: integer }
   *                     totalCalls:           { type: integer }
   *                     activePatients:       { type: integer }
   *                     newPatients:          { type: integer }
   *                     totalMessages:        { type: integer }
   *                     avgResponseTimeMs:    { type: integer, nullable: true }
   *                     avgCallDurationSecs:  { type: integer, nullable: true }
   *                 activityByDay:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       day:          { type: string, example: "2026-04-15" }
   *                       chatSessions: { type: integer }
   *                       calls:        { type: integer }
   *                 channelSplit:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       channel: { type: string, example: "chat" }
   *                       count:   { type: integer }
   *                 twinBreakdown:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       twinId:              { type: string }
   *                       name:                { type: string }
   *                       chatSessions:        { type: integer }
   *                       calls:               { type: integer }
   *                       avgResponseTimeMs:   { type: integer, nullable: true }
   *                       avgMsgsPerSession:   { type: number, nullable: true }
   *                       avgCallDurationSecs: { type: integer, nullable: true }
   *                 sessionLengthDistribution:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       bucket: { type: string, example: "1-5" }
   *                       count:  { type: integer }
   *                 callDurationDistribution:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       bucket: { type: string, example: "<1min" }
   *                       count:  { type: integer }
   *                 topCategories:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       category: { type: string }
   *                       count:    { type: integer }
   *                 callLanguages:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       language: { type: string }
   *                       count:    { type: integer }
   *                 hourlyDistribution:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       hour:  { type: integer, minimum: 0, maximum: 23 }
   *                       count: { type: integer }
   *       401:
   *         description: Authentication required
   *       403:
   *         description: Admin access required
   *       500:
   *         description: Server error
   */
  router.get(
    '/admin',
    authMiddleware.authenticate,
    authMiddleware.isAdmin,
    async (req, res) => {
      try {
        const adminKey = req.user._key;
        const { from, to } = req.query;
        logger.info(`[ANALYTICS] Admin ${adminKey} requested summary from=${from} to=${to}`);
        const summary = await analyticsAdminService.getSummary(adminKey, from, to);
        res.json(summary);
      } catch (error) {
        logger.error(`[ANALYTICS] GET /admin error: ${error.message}`, { stack: error.stack });
        res.status(500).json({ message: error.message });
      }
    }
  );

  /**
   * @swagger
   * /api/analytics/admin/patients:
   *   get:
   *     summary: Per-patient engagement breakdown
   *     description: >
   *       Paginated table of each patient's chat and call activity in the given
   *       date range. Suitable for a sortable table in the admin dashboard.
   *     tags: [Admin Analytics]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: from
   *         schema: { type: string, format: date }
   *       - in: query
   *         name: to
   *         schema: { type: string, format: date }
   *       - in: query
   *         name: offset
   *         schema: { type: integer, default: 0 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 50, maximum: 200 }
   *     responses:
   *       200:
   *         description: Paginated patient engagement rows
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 total:  { type: integer }
   *                 offset: { type: integer }
   *                 limit:  { type: integer }
   *                 patients:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       patientId:         { type: string }
   *                       name:              { type: string, nullable: true }
   *                       email:             { type: string }
   *                       createdAt:         { type: string, format: date-time }
   *                       chatSessions:      { type: integer }
   *                       calls:             { type: integer }
   *                       totalMessages:     { type: integer }
   *                       avgSessionLength:  { type: number, nullable: true }
   *                       totalCallSecs:     { type: integer, nullable: true }
   *                       avgResponseTimeMs: { type: integer, nullable: true }
   *                       lastActive:        { type: string, format: date-time, nullable: true }
   *       401:
   *         description: Authentication required
   *       403:
   *         description: Admin access required
   */
  router.get(
    '/admin/patients',
    authMiddleware.authenticate,
    authMiddleware.isAdmin,
    async (req, res) => {
      try {
        const adminKey = req.user._key;
        const { from, to } = req.query;
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

        const result = await analyticsAdminService.getPatients(adminKey, from, to, offset, limit);
        res.json(result);
      } catch (error) {
        logger.error(`[ANALYTICS] GET /admin/patients error: ${error.message}`, { stack: error.stack });
        res.status(500).json({ message: error.message });
      }
    }
  );

  return router;
};
