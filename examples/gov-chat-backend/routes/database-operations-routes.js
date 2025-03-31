const express = require('express');
const router = express.Router();
const DatabaseOperationsService = require('../services/database-operations-service');
const { createLogger, format, transports } = require('winston');

const databaseService = new DatabaseOperationsService();

// Set up Winston logger (consistent with index.js)
const logFormat = format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    logFormat
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' })
  ],
});

/**
 * @swagger
 * /database/reindex:
 *   post:
 *     summary: Reindex Database
 *     description: Drops and recreates indexes for all collections
 *     tags: [Database Operations]
 *     responses:
 *       200:
 *         description: Database reindexed successfully
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
 *       500:
 *         description: Server error
 */
router.post('/reindex', async (req, res) => {
  try {
    logger.info('Initiating database reindexing via API');
    const result = await databaseService.reindexDatabase();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Unexpected error during database reindexing:', error);
    res.status(500).json({ 
      success: false,
      message: 'Unexpected error during database reindexing',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /database/backup:
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
    logger.error('Unexpected error during database backup:', error);
    res.status(500).json({ 
      success: false,
      message: 'Unexpected error during database backup',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /database/optimize:
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
    logger.error('Unexpected error during database optimization:', error);
    res.status(500).json({ 
      success: false,
      message: 'Unexpected error during database optimization',
      error: error.message 
    });
  }
});

module.exports = router;