const express = require('express');
const router = express.Router();
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger } = require('../shared-lib');

module.exports = (databaseService) => {
  // Apply authentication middleware to all routes
  router.use(keycloakAuthMiddleware.authenticate);

  /**
   * @swagger
   * /api/database/backup:
   *   post:
   *     summary: Backup Database
   *     description: Creates a full backup of the database
   *     tags: [Database Operations]
   *     responses:
   *       200:
   *         description: Database backed up successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 backupFile:
   *                   type: string
   *                 backupLocation:
   *                   type: string
   *       500:
   *         description: Server error
   */
  router.post('/backup', async (req, res) => {
    try {
      logger.info('Initiating database backup via API');
      const result = await databaseService.backupDatabase();

      if (result.success) {
        res.json(result);
      } else {
        res.status(500).json(result);
      }
    } catch (error) {
      logger.error(`Unexpected error during database backup: ${error.message}`, { stack: error.stack });
      res.status(500).json({
        success: false,
        message: 'Unexpected error during database backup'
      });
    }
  });

  /**
   * @swagger
   * /api/database/optimize:
   *   post:
   *     summary: Optimize Database
   *     description: Performs database optimization including compacting collections
   *     tags: [Database Operations]
   *     responses:
   *       200:
   *         description: Database optimized successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 results:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       collection:
   *                         type: string
   *                       status:
   *                         type: string
   *                       indexSuggestions:
   *                         type: array
   *       500:
   *         description: Server error
   */
  router.post('/optimize', async (req, res) => {
    try {
      logger.info('Initiating database optimization via API');
      const result = await databaseService.optimizeDatabase();

      if (result.success) {
        res.json(result);
      } else {
        res.status(500).json(result);
      }
    } catch (error) {
      logger.error(`Unexpected error during database optimization: ${error.message}`, { stack: error.stack });
      res.status(500).json({
        success: false,
        message: 'Unexpected error during database optimization'
      });
    }
  });

  return router;
};
