const express = require('express');
const router = express.Router();
const ChatHistoryService = require('../services/chat-history-service');
const AnalyticsService = require('../services/analytics-service');
const authMiddleware = require('../middleware/auth-middleware');
const { createLogger, format, transports } = require('winston'); // Import Winston

// Initialize services
const chatHistoryService = new ChatHistoryService();
const analyticsService = new AnalyticsService();

// Inject analytics service into chat history service
chatHistoryService.setAnalyticsService(analyticsService);

// Set up Winston logger (consistent with other files)
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

/**
 * @swagger
 * /chat/conversations:
 *   get:
 *     summary: Get user conversations
 *     description: Retrieves all conversations for the authenticated user with pagination and filtering options
 *     tags: [Chat History]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of conversations to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of records to skip for pagination
 *       - in: query
 *         name: includeArchived
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether to include archived conversations
 *       - in: query
 *         name: filterStarred
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Filter to show only starred conversations
 *       - in: query
 *         name: searchTerm
 *         schema:
 *           type: string
 *         description: Text to search for in conversation titles or messages
 *     responses:
 *       200:
 *         description: List of conversations with pagination details
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/conversations', async (req, res) => {
  try {
    // Extract the userId from req.user
    let userId = '';
    
    if (req.user) {
      // The userId must be in the format "users/2133"
      if (req.user.userId) {
        userId = req.user.userId;
        // Ensure it has the correct prefix
        if (!userId.startsWith('users/')) {
          userId = `users/${userId}`;
        }
      } 
      // If not in userId, try _key and other fields
      else if (req.user._key) {
        userId = `users/${req.user._key}`;
      } 
      else if (req.user.id) {
        userId = `users/${req.user.id}`;
      }
      
      logger.info(`Using user identifier: ${userId}`);
    }
    
    // If we don't have a user ID from req.user, check query params
    if (!userId && req.query.userId) {
      userId = req.query.userId;
      // Ensure it has the correct prefix
      if (!userId.startsWith('users/')) {
        userId = `users/${userId}`;
      }
      logger.info(`Using userId from query parameter: ${userId}`);
    }
    
    if (!userId) {
      logger.warn('No userId available in request');
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is required but not found in request' 
      });
    }
    
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const includeArchived = req.query.includeArchived === 'true';
    const filterStarred = req.query.filterStarred === 'true';
    const searchTerm = req.query.searchTerm || '';
    
    logger.info(`Getting conversations for user ${userId} with filters - includeArchived: ${includeArchived}, filterStarred: ${filterStarred}, searchTerm: "${searchTerm}"`);
    
    const options = {
      limit,
      offset,
      includeArchived,
      filterStarred,
      searchTerm
    };
    
    // Call service with the proper userId format
    const result = await chatHistoryService.getUserConversations(userId, options);
    res.json(result);
  } catch (error) {
    logger.error(`Error getting user conversations: ${error.message}`, error);
    res.status(500).json({ 
      success: false, 
      message: `Error getting user conversations: ${error.message}` 
    });
  }
});

/**
 * @swagger
 * /chat/conversations/{conversationId}:
 *   get:
 *     summary: Get conversation details
 *     description: Retrieves a specific conversation including its messages
 *     tags: [Chat History]
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the conversation to retrieve
 *     responses:
 *       200:
 *         description: Conversation details with messages
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 *       500:
 *         description: Server error
 */
router.get('/conversations/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    logger.info(`Getting conversation ${conversationId}`);
    
    const conversation = await chatHistoryService.getConversation(conversationId);
    
    if (!conversation) {
      logger.warn(`Conversation ${conversationId} not found`);
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    res.json(conversation);
  } catch (error) {
    logger.error(`Error getting conversation ${req.params.conversationId}: ${error.message}`, error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /chat/conversations:
 *   post:
 *     summary: Create a new conversation
 *     description: Creates a new chat conversation
 *     tags: [Chat History]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *                 description: Title of the conversation
 *               categoryId:
 *                 type: string
 *                 description: ID of the service category
 *               initialMessage:
 *                 type: string
 *                 description: Initial message to include in the conversation
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Tags associated with the conversation
 *     responses:
 *       201:
 *         description: Conversation created successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/conversations', async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, categoryId, initialMessage, tags } = req.body;
    
    logger.info(`Creating new conversation for user ${userId} with title "${title}"`);
    
    const conversationData = {
      userId,
      title: title || 'New Conversation',
      categoryId,
      tags: tags || [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      messageCount: initialMessage ? 1 : 0,
      isStarred: false,
      isArchived: false
    };
    
    const conversation = await chatHistoryService.createConversation(conversationData);
    
    // If an initial message is provided, add it to the conversation
    if (initialMessage) {
      await chatHistoryService.addMessage({
        conversationId: conversation._key,
        content: initialMessage,
        sender: 'user',
        userId
      });
    }
    
    res.status(201).json(conversation);
  } catch (error) {
    logger.error(`Error creating conversation: ${error.message}`, error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /chat/conversations/{conversationId}:
 *   patch:
 *     summary: Update conversation
 *     description: Updates conversation properties like title, starred status, etc.
 *     tags: [Chat History]
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the conversation to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: New title for the conversation
 *               isStarred:
 *                 type: boolean
 *                 description: Star status
 *               isArchived:
 *                 type: boolean
 *                 description: Archive status
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Tags for the conversation
 *               categoryId:
 *                 type: string
 *                 description: ID of the service category
 *     responses:
 *       200:
 *         description: Conversation updated successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 *       500:
 *         description: Server error
 */
router.patch('/conversations/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const updateData = { ...req.body, userId };
    
    logger.info(`Updating conversation ${conversationId} with data:`, updateData);
    
    const updatedConversation = await chatHistoryService.updateConversation(conversationId, updateData);
    res.json(updatedConversation);
  } catch (error) {
    logger.error(`Error updating conversation ${req.params.conversationId}: ${error.message}`, error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /chat/conversations/{conversationId}:
 *   delete:
 *     summary: Delete conversation
 *     description: Deletes a conversation and all associated messages
 *     tags: [Chat History]
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the conversation to delete
 *     responses:
 *       200:
 *         description: Conversation deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - user doesn't have permission to delete this conversation
 *       404:
 *         description: Conversation not found
 *       500:
 *         description: Server error
 */
router.delete('/conversations/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    
    logger.info(`Deleting conversation ${conversationId} for user ${userId}`);
    
    const result = await chatHistoryService.deleteConversation(conversationId, userId);
    res.json(result);
  } catch (error) {
    logger.error(`Error deleting conversation ${req.params.conversationId}: ${error.message}`, error);
    
    if (error.message.includes('permission')) {
      return res.status(403).json({ message: error.message });
    }
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /chat/conversations/{conversationId}/messages:
 *   get:
 *     summary: Get conversation messages
 *     description: Retrieves messages for a specific conversation with pagination
 *     tags: [Chat History]
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the conversation
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of messages to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of records to skip for pagination
 *       - in: query
 *         name: newestFirst
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Sort messages with newest first
 *     responses:
 *       200:
 *         description: List of messages with pagination details
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 *       500:
 *         description: Server error
 */
router.get('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const newestFirst = req.query.newestFirst === 'true';
    
    logger.info(`Getting messages for conversation ${conversationId} with limit ${limit}, offset ${offset}, newestFirst ${newestFirst}`);
    
    const options = { limit, offset, newestFirst };
    const result = await chatHistoryService.getConversationMessages(conversationId, options);
    
    res.json(result);
  } catch (error) {
    logger.error(`Error getting messages for conversation ${req.params.conversationId}: ${error.message}`, error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /chat/conversations/{conversationId}/messages:
 *   post:
 *     summary: Add message to conversation
 *     description: Adds a new message to a conversation
 *     tags: [Chat History]
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the conversation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *               - sender
 *             properties:
 *               content:
 *                 type: string
 *                 description: Message content
 *               sender:
 *                 type: string
 *                 enum: [user, assistant]
 *                 description: Sender of the message
 *               queryId:
 *                 type: string
 *                 description: Optional ID of a related query (for assistant messages)
 *               metadata:
 *                 type: object
 *                 description: Additional metadata for the message
 *     responses:
 *       201:
 *         description: Message added successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 *       500:
 *         description: Server error
 */
router.post('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const { content, sender, queryId, metadata } = req.body;
    
    logger.info(`Adding ${sender} message to conversation ${conversationId}`);
    
    if (!content) {
      return res.status(400).json({ message: 'Message content is required' });
    }
    
    if (!['user', 'assistant'].includes(sender)) {
      return res.status(400).json({ message: 'Sender must be either "user" or "assistant"' });
    }
    
    const messageData = {
      conversationId,
      content,
      sender,
      userId,
      timestamp: new Date().toISOString(),
      queryId,
      metadata
    };
    
    const message = await chatHistoryService.addMessage(messageData);
    
    // If it's an assistant message with a query ID, link them
    if (sender === 'assistant' && queryId) {
      await chatHistoryService.linkQueryToConversation(
        queryId,
        conversationId,
        message._key,
        { responseType: 'primary' }
      );
    }
    
    res.status(201).json(message);
  } catch (error) {
    logger.error(`Error adding message to conversation ${req.params.conversationId}: ${error.message}`, error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /chat/conversations/{conversationId}/messages/read:
 *   post:
 *     summary: Mark messages as read
 *     description: Marks all or specific messages in a conversation as read
 *     tags: [Chat History]
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the conversation
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               messageIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Specific message IDs to mark as read (if empty, marks all messages)
 *     responses:
 *       200:
 *         description: Messages marked as read
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 *       500:
 *         description: Server error
 */
router.post('/conversations/:conversationId/messages/read', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { messageIds } = req.body;
    
    logger.info(`Marking messages as read in conversation ${conversationId}`);
    
    const result = await chatHistoryService.markMessagesAsRead(conversationId, messageIds);
    res.json(result);
  } catch (error) {
    logger.error(`Error marking messages as read in conversation ${req.params.conversationId}: ${error.message}`, error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /chat/query/{queryId}/messages:
 *   get:
 *     summary: Get messages for a query
 *     description: Retrieves all messages related to a specific query
 *     tags: [Chat History]
 *     parameters:
 *       - in: path
 *         name: queryId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the query
 *     responses:
 *       200:
 *         description: Messages related to the query
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Query not found
 *       500:
 *         description: Server error
 */
router.get('/query/:queryId/messages', async (req, res) => {
  try {
    const { queryId } = req.params;
    
    logger.info(`Finding messages related to query ${queryId}`);
    
    const messages = await chatHistoryService.findMessagesForQuery(queryId);
    res.json(messages);
  } catch (error) {
    logger.error(`Error finding messages for query ${req.params.queryId}: ${error.message}`, error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: 'Query not found' });
    }
    
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /chat/messages/{messageId}/query:
 *   get:
 *     summary: Get originating query for a message
 *     description: Retrieves the query that led to a specific message
 *     tags: [Chat History]
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the message
 *     responses:
 *       200:
 *         description: Query information
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No originating query found
 *       500:
 *         description: Server error
 */
router.get('/messages/:messageId/query', async (req, res) => {
  try {
    const { messageId } = req.params;
    
    logger.info(`Finding originating query for message ${messageId}`);
    
    const query = await chatHistoryService.findOriginatingQuery(messageId);
    
    if (!query) {
      return res.status(404).json({ message: 'No originating query found for this message' });
    }
    
    res.json(query);
  } catch (error) {
    logger.error(`Error finding originating query for message ${req.params.messageId}: ${error.message}`, error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /chat/query/{queryId}/conversation:
 *   post:
 *     summary: Create conversation from query
 *     description: Creates a new conversation based on an existing query
 *     tags: [Chat History]
 *     parameters:
 *       - in: path
 *         name: queryId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the query
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
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Query not found
 *       500:
 *         description: Server error
 */
router.post('/query/:queryId/conversation', async (req, res) => {
  try {
    const { queryId } = req.params;
    const userId = req.user.id;
    const { title, responseText, tags } = req.body;
    
    logger.info(`Creating conversation from query ${queryId} for user ${userId}`);
    
    const result = await chatHistoryService.createConversationFromQuery(
      queryId,
      userId,
      { title, responseText, tags }
    );
    
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
 * /chat/search:
 *   get:
 *     summary: Search conversations
 *     description: Searches for conversations containing specific text
 *     tags: [Chat History]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search term
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
 *         name: includeArchived
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether to include archived conversations
 *     responses:
 *       200:
 *         description: Search results
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/search', async (req, res) => {
  try {
    const userId = req.user.id;
    const searchTerm = req.query.q || '';
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const includeArchived = req.query.includeArchived === 'true';
    
    if (!searchTerm) {
      return res.status(400).json({ message: 'Search term is required' });
    }
    
    logger.info(`Searching conversations for user ${userId} with term "${searchTerm}"`);
    
    const options = { limit, offset, includeArchived };
    const results = await chatHistoryService.searchConversations(userId, searchTerm, options);
    
    res.json(results);
  } catch (error) {
    logger.error(`Error searching conversations: ${error.message}`, error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /chat/recent:
 *   get:
 *     summary: Get recent conversations
 *     description: Retrieves recent conversations for the user
 *     tags: [Chat History]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *         description: Maximum number of conversations to return
 *     responses:
 *       200:
 *         description: Recent conversations
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/recent', async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 5;
    
    logger.info(`Getting ${limit} recent conversations for user ${userId}`);
    
    const conversations = await chatHistoryService.getRecentConversations(userId, limit);
    res.json(conversations);
  } catch (error) {
    logger.error(`Error getting recent conversations: ${error.message}`, error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /chat/stats:
 *   get:
 *     summary: Get conversation statistics
 *     description: Retrieves statistics about the user's conversations
 *     tags: [Chat History]
 *     responses:
 *       200:
 *         description: Conversation statistics
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.id;
    
    logger.info(`Getting conversation statistics for user ${userId}`);
    
    const stats = await chatHistoryService.getUserConversationStats(userId);
    res.json(stats);
  } catch (error) {
    logger.error(`Error getting conversation statistics: ${error.message}`, error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;