const express = require('express');
const router = express.Router();
const QueryService = require('../services/query-service');
const AnalyticsService = require('../services/analytics-service');
const ChatHistoryService = require('../services/chat-history-service');
const authMiddleware = require('../middleware/auth-middleware'); // Import auth middleware
const { createLogger, format, transports } = require('winston'); // Import Winston

// Initialize services
const queryService = new QueryService();
const analyticsService = new AnalyticsService();
const chatHistoryService = new ChatHistoryService();

// Inject analytics service into query service
queryService.setAnalyticsService(analyticsService);

// Inject chat history service into query service
queryService.setChatHistoryService(chatHistoryService);

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

// Apply authentication middleware to all routes
router.use(authMiddleware.authenticate);

// Middleware to ensure analytics service is set
router.use((req, res, next) => {
  if (!queryService.analyticsService) {
    logger.warn('Analytics service was not set, setting it now...');
    queryService.setAnalyticsService(analyticsService);
  }
  if (!queryService.chatHistoryService) {
    logger.warn('Chat history service was not set, setting it now...');
    queryService.setChatHistoryService(chatHistoryService);
  }
  next();
});

/**
 * @swagger
 * /queries:
 *   post:
 *     summary: Create a new query
 *     description: Creates a new query and records it in analytics
 *     tags: [Queries]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - sessionId
 *               - text
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID of the user making the query
 *               sessionId:
 *                 type: string
 *                 description: ID of the current session
 *               text:
 *                 type: string
 *                 description: The query text
 *               categoryId:
 *                 type: string
 *                 description: Category ID for the query
 *               serviceId:
 *                 type: string
 *                 description: Service ID for the query
 *               timestamp:
 *                 type: string
 *                 format: date-time
 *                 description: Timestamp for the query (defaults to now)
 *     responses:
 *       201:
 *         description: Query created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Query'
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Server error
 */
// Submit a query
router.post('/', async (req, res) => {
  try {
    logger.info(`Creating query with body: ${JSON.stringify(req.body)}`);
    const query = await queryService.createQuery(req.body);
    res.status(201).json(query);
  } catch (error) {
    logger.error(`Error creating query: ${error.message}`, error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /queries/{queryId}:
 *   get:
 *     summary: Get query by ID
 *     description: Retrieves a query by its unique identifier
 *     tags: [Queries]
 *     parameters:
 *       - in: path
 *         name: queryId
 *         required: true
 *         schema:
 *           type: string
 *         description: Query ID
 *     responses:
 *       200:
 *         description: Query retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Query'
 *       404:
 *         description: Query not found
 *       500:
 *         description: Server error
 */
// Get query by ID
router.get('/:queryId', async (req, res) => {
  try {
    logger.info(`Fetching query with ID: ${req.params.queryId}`);
    const query = await queryService.getQuery(req.params.queryId);
    res.json(query);
  } catch (error) {
    logger.error(`Error getting query ${req.params.queryId}: ${error.message}`, error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /queries/{queryId}/feedback:
 *   post:
 *     summary: Add feedback to a query
 *     description: Adds user feedback to a query and records it in analytics
 *     tags: [Queries]
 *     parameters:
 *       - in: path
 *         name: queryId
 *         required: true
 *         schema:
 *           type: string
 *         description: Query ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - rating
 *             properties:
 *               rating:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 5
 *                 description: Rating from 1 to 5
 *               comment:
 *                 type: string
 *                 description: Optional feedback comment
 *     responses:
 *       200:
 *         description: Feedback added successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Query'
 *       400:
 *         description: Missing required fields
 *       404:
 *         description: Query not found
 *       500:
 *         description: Server error
 */
// Add feedback to a query
router.post('/:queryId/feedback', async (req, res) => {
  try {
    logger.info(`Adding feedback to query ${req.params.queryId} with body: ${JSON.stringify(req.body)}`);
    const query = await queryService.addFeedback(req.params.queryId, req.body);
    res.json(query);
  } catch (error) {
    logger.error(`Error adding feedback to query ${req.params.queryId}: ${error.message}`, error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /queries/{queryId}/answered:
 *   patch:
 *     summary: Mark a query as answered (PATCH)
 *     description: Updates a query to mark it as answered with response time
 *     tags: [Queries]
 *     parameters:
 *       - in: path
 *         name: queryId
 *         required: true
 *         schema:
 *           type: string
 *         description: Query ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               responseTime:
 *                 type: number
 *                 description: Response time in milliseconds
 *     responses:
 *       200:
 *         description: Query marked as answered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Query'
 *       404:
 *         description: Query not found
 *       500:
 *         description: Server error
 */
// Mark a query as answered - support both PATCH and PUT
router.patch('/:queryId/answered', async (req, res) => {
  try {
    logger.info(`Marking query ${req.params.queryId} as answered with body: ${JSON.stringify(req.body)}`);
    const query = await queryService.markAsAnswered(req.params.queryId, req.body.responseTime);
    res.json(query);
  } catch (error) {
    logger.error(`Error marking query ${req.params.queryId} as answered: ${error.message}`, error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /queries/{queryId}/answered:
 *   put:
 *     summary: Mark a query as answered (PUT)
 *     description: Updates a query to mark it as answered with response time
 *     tags: [Queries]
 *     parameters:
 *       - in: path
 *         name: queryId
 *         required: true
 *         schema:
 *           type: string
 *         description: Query ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               responseTime:
 *                 type: number
 *                 description: Response time in milliseconds
 *     responses:
 *       200:
 *         description: Query marked as answered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Query'
 *       404:
 *         description: Query not found
 *       500:
 *         description: Server error
 */
// Mark a query as answered (PUT method for test compatibility)
router.put('/:queryId/answered', async (req, res) => {
  try {
    const responseTime = req.body.responseTime || 0;
    
    logger.info(`Marking query ${req.params.queryId} as answered with response time: ${responseTime}ms and body: ${JSON.stringify(req.body)}`);
    
    const query = await queryService.markAsAnswered(req.params.queryId, responseTime);
    res.json(query);
  } catch (error) {
    logger.error(`Error marking query ${req.params.queryId} as answered: ${error.message}`, error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /queries:
 *   get:
 *     summary: Search queries
 *     description: Search for queries based on various criteria with pagination
 *     tags: [Queries]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of results to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of results to skip for pagination
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *       - in: query
 *         name: sessionId
 *         schema:
 *           type: string
 *         description: Filter by session ID
 *       - in: query
 *         name: text
 *         schema:
 *           type: string
 *         description: Filter by query text (partial match)
 *       - in: query
 *         name: categoryId
 *         schema:
 *           type: string
 *         description: Filter by category ID
 *       - in: query
 *         name: serviceId
 *         schema:
 *           type: string
 *         description: Filter by service ID
 *       - in: query
 *         name: isAnswered
 *         schema:
 *           type: boolean
 *         description: Filter by answered status
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter by start date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter by end date
 *     responses:
 *       200:
 *         description: Search results with pagination
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 queries:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Query'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     pages:
 *                       type: integer
 *                     currentPage:
 *                       type: integer
 *       500:
 *         description: Server error
 */
// Search queries
router.get('/', async (req, res) => {
  try {
    const { limit = 20, offset = 0, ...criteria } = req.query;
    logger.info(`Searching queries with criteria: ${JSON.stringify(criteria)}, limit: ${limit}, offset: ${offset}`);
    const results = await queryService.searchQueries(criteria, parseInt(limit), parseInt(offset));
    res.json(results);
  } catch (error) {
    logger.error(`Error searching queries: ${error.message}`, error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /queries/{queryId}/conversations:
 *   get:
 *     summary: Get conversations for a query
 *     description: Retrieves all conversations associated with a specific query
 *     tags: [Queries]
 *     parameters:
 *       - in: path
 *         name: queryId
 *         required: true
 *         schema:
 *           type: string
 *         description: Query ID
 *     responses:
 *       200:
 *         description: Conversations associated with the query
 *       404:
 *         description: Query not found
 *       500:
 *         description: Server error
 */
router.get('/:queryId/conversations', async (req, res) => {
  try {
    logger.info(`Getting conversations for query ${req.params.queryId}`);
    const conversations = await queryService.getConversationsForQuery(req.params.queryId);
    res.json(conversations);
  } catch (error) {
    logger.error(`Error getting conversations for query ${req.params.queryId}: ${error.message}`, error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: 'Query not found' });
    }
    
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /queries/{queryId}/conversation:
 *   post:
 *     summary: Create conversation from query
 *     description: Creates a new conversation based on an existing query
 *     tags: [Queries]
 *     parameters:
 *       - in: path
 *         name: queryId
 *         required: true
 *         schema:
 *           type: string
 *         description: Query ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Optional title for the conversation
 *               responseText:
 *                 type: string
 *                 description: Optional response text to include
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Optional tags for the conversation
 *     responses:
 *       201:
 *         description: Conversation created successfully
 *       404:
 *         description: Query not found
 *       500:
 *         description: Server error
 */
router.post('/:queryId/conversation', async (req, res) => {
  try {
    const { queryId } = req.params;
    const options = req.body;
    
    logger.info(`Creating conversation from query ${queryId} with options:`, options);
    
    const result = await queryService.createConversationFromQuery(queryId, options);
    res.status(201).json(result);
  } catch (error) {
    logger.error(`Error creating conversation from query ${req.params.queryId}: ${error.message}`, error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: 'Query not found' });
    }
    
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /queries/{queryId}/link/{messageId}:
 *   post:
 *     summary: Link query to message
 *     description: Creates a link between a query and an existing message
 *     tags: [Queries]
 *     parameters:
 *       - in: path
 *         name: queryId
 *         required: true
 *         schema:
 *           type: string
 *         description: Query ID
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *         description: Message ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               responseType:
 *                 type: string
 *                 default: primary
 *                 description: Type of response (primary, followup, etc.)
 *               confidenceScore:
 *                 type: number
 *                 default: 1.0
 *                 description: Confidence score for the relationship
 *     responses:
 *       200:
 *         description: Link created successfully
 *       404:
 *         description: Query or message not found
 *       500:
 *         description: Server error
 */
router.post('/:queryId/link/:messageId', async (req, res) => {
  try {
    const { queryId, messageId } = req.params;
    const options = req.body;
    
    logger.info(`Linking query ${queryId} to message ${messageId} with options:`, options);
    
    const result = await queryService.linkQueryToMessage(queryId, messageId, options);
    res.json(result);
  } catch (error) {
    logger.error(`Error linking query ${req.params.queryId} to message ${req.params.messageId}: ${error.message}`, error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: error.message });
    }
    
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;