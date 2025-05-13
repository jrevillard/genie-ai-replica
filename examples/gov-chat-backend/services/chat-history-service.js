require('dotenv').config();
const { Database, aql } = require('arangojs');
const { v4: uuidv4 } = require('uuid');
const { createLogger, format, transports } = require('winston'); // Import Winston

// Initialize ArangoDB connection
const dbService = require('../utils/db-connect-service');

const initDB = dbService.getConnection();

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

class ChatHistoryService {
  constructor() {
    this.db = initDB;
    this.conversations = this.db.collection('conversations');
    this.messages = this.db.collection('messages');
    this.userConversations = this.db.collection('userConversations');
    this.conversationCategories = this.db.collection('conversationCategories');
    this.queryMessages = this.db.collection('queryMessages');
    this.analyticsService = null; // Will be set via dependency injection

    logger.info('ChatHistoryService initialized');
  }

  /**
   * Set the analytics service
   * @param {Object} analyticsService - Analytics service instance
   */
  setAnalyticsService(analyticsService) {
    this.analyticsService = analyticsService;
    logger.info('Analytics service set for ChatHistoryService');
  }

  /**
   * Create a new conversation
   * @param {Object} conversationData - Conversation data
   * @returns {Promise<Object>} The created conversation
   */
  async createConversation(conversationData) {
    try {
      logger.info('Creating new conversation with data:', conversationData);

      // Ensure minimum required data
      if (!conversationData.userId) {
        logger.warn('Missing required user ID');
        throw new Error('User ID is required');
      }

      // Prepare conversation document
      const conversationDoc = {
        title: conversationData.title || 'New Conversation',
        lastMessage: conversationData.lastMessage || '',
        created: conversationData.created || new Date().toISOString(),
        updated: conversationData.updated || new Date().toISOString(),
        messageCount: conversationData.messageCount || 0,
        isStarred: conversationData.isStarred || false,
        isArchived: conversationData.isArchived || false,
        category: conversationData.category || '',
        tags: Array.isArray(conversationData.tags) ? conversationData.tags : []
      };

      // Create conversation
      const conversation = await this.conversations.save(conversationDoc);
      logger.info(`Conversation created with key: ${conversation._key}`);

      // Link user to conversation
      await this.userConversations.save({
        _from: `users/${conversationData.userId}`,
        _to: `conversations/${conversation._key}`,
        role: conversationData.role || 'owner',
        lastViewedAt: new Date().toISOString()
      });
      logger.info(`User ${conversationData.userId} linked to conversation ${conversation._key}`);

      // Link conversation to category if provided
      if (conversationData.categoryId) {
        await this.conversationCategories.save({
          _from: `conversations/${conversation._key}`,
          _to: `serviceCategories/${conversationData.categoryId}`,
          relevanceScore: conversationData.relevanceScore || 1.0
        });
        logger.info(`Conversation ${conversation._key} linked to category ${conversationData.categoryId}`);
      }

      // Track conversation creation in analytics if service is available
      if (this.analyticsService) {
        try {
          await this.analyticsService.trackEvent(
            conversationData.userId,
            'conversationCreated',
            { conversationId: conversation._key }
          );
        } catch (error) {
          logger.error('Error tracking conversation creation in analytics:', error);
          // Continue even if analytics tracking fails
        }
      }

      return { ...conversation, ...conversationDoc };
    } catch (error) {
      logger.error('Error creating conversation:', error);
      throw error;
    }
  }

  /**
   * Add a message to a conversation
   * @param {Object} messageData - Message data
   * @returns {Promise<Object>} The created message
   */
  async addMessage(messageData) {
    try {
      logger.info(`Adding message to conversation ${messageData.conversationId}`);

      // Ensure minimum required data
      if (!messageData.conversationId || !messageData.content || !messageData.sender) {
        logger.warn('Missing required message data');
        throw new Error('conversationId, content, and sender are required');
      }

      // Get conversation to check if it exists and to update stats
      const conversation = await this.conversations.document(messageData.conversationId);

      // Get the latest sequence number for this conversation
      const sequenceCursor = await this.db.query(aql`
        FOR msg IN messages
          FILTER msg.conversationId == ${messageData.conversationId}
          SORT msg.sequence DESC
          LIMIT 1
          RETURN msg.sequence
      `);

      const latestSequence = await sequenceCursor.next() || 0;
      const newSequence = latestSequence + 1;

      // Prepare message document
      const messageDoc = {
        conversationId: messageData.conversationId,
        content: messageData.content,
        timestamp: messageData.timestamp || new Date().toISOString(),
        sender: messageData.sender, // "user" or "assistant"
        sequence: newSequence,
        readStatus: messageData.readStatus !== undefined ? messageData.readStatus : true,
        metadata: messageData.metadata || {}
      };

      // Create message
      const message = await this.messages.save(messageDoc);
      logger.info(`Message created with key: ${message._key}`);

      // Link to originating query if provided
      if (messageData.queryId) {
        await this.queryMessages.save({
          _from: `queries/${messageData.queryId}`,
          _to: `messages/${message._key}`,
          responseType: messageData.responseType || 'primary',
          confidenceScore: messageData.confidenceScore || 1.0,
          createdAt: new Date().toISOString()
        });
        logger.info(`Message ${message._key} linked to query ${messageData.queryId}`);
      }

      // Update conversation stats
      await this.conversations.update(messageData.conversationId, {
        messageCount: conversation.messageCount + 1,
        lastMessage: messageData.content.length > 100
          ? `${messageData.content.substring(0, 97)}...`
          : messageData.content,
        updated: new Date().toISOString()
      });
      logger.info(`Conversation ${messageData.conversationId} stats updated`);

      // Track message creation in analytics if service is available
      if (this.analyticsService && messageData.userId) {
        try {
          await this.analyticsService.trackEvent(
            messageData.userId,
            'messageSent',
            {
              conversationId: messageData.conversationId,
              messageId: message._key,
              sender: messageData.sender
            }
          );
        } catch (error) {
          logger.error('Error tracking message creation in analytics:', error);
          // Continue even if analytics tracking fails
        }
      }

      return { ...message, ...messageDoc };
    } catch (error) {
      logger.error(`Error adding message to conversation ${messageData.conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Get a conversation by ID
   * @param {String} conversationId - Conversation ID
   * @returns {Promise<Object>} Conversation details with messages
   */
  async getConversation(conversationId) {
    try {
      logger.info(`Getting conversation with ID: ${conversationId}`);

      // Get conversation
      const conversation = await this.conversations.document(conversationId);

      // Get messages for this conversation
      const messagesCursor = await this.db.query(aql`
        FOR msg IN messages
          FILTER msg.conversationId == ${conversationId}
          SORT msg.sequence ASC
          RETURN msg
      `);

      const messages = await messagesCursor.all();
      logger.info(`Found ${messages.length} messages for conversation ${conversationId}`);

      // Get category details
      const categoryCursor = await this.db.query(aql`
        FOR edge IN conversationCategories
          FILTER edge._from == ${'conversations/' + conversationId}
          FOR cat IN serviceCategories
            FILTER cat._id == edge._to
            RETURN {
              _id: cat._id,
              _key: cat._key,
              nameEN: cat.nameEN,
              nameFR: cat.nameFR,
              nameSW: cat.nameSW,
              relevanceScore: edge.relevanceScore
            }
      `);

      const categories = await categoryCursor.all();

      // Get owner details
      const ownerCursor = await this.db.query(aql`
        FOR edge IN userConversations
          FILTER edge._to == ${'conversations/' + conversationId}
          FOR user IN users
            FILTER user._id == edge._from
            RETURN {
              _id: user._id,
              _key: user._key,
              role: edge.role,
              lastViewedAt: edge.lastViewedAt
            }
      `);

      const owners = await ownerCursor.all();

      return {
        ...conversation,
        messages,
        categories,
        owners
      };
    } catch (error) {
      logger.error(`Error getting conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Get all conversations for a user
   * @param {String} userId - User ID
   * @param {Object} options - Query options (limit, offset, filters)
   * @returns {Promise<Object>} Conversations with pagination
   */
  // Fixed getUserConversations method

  async getUserConversations(userId, options = {}) {
    try {
      logger.info(`Getting conversations for user ${userId}`);
      
      // Ensure userId is in the correct format with users/ prefix
      const userIdWithPrefix = userId.startsWith('users/') ? userId : `users/${userId}`;
      logger.info(`Using complete user path: ${userIdWithPrefix}`);
      
      // Parse options
      const limit = options.limit || 20;
      const offset = options.offset || 0;
      const includeArchived = options.includeArchived || false;
      const filterStarred = options.filterStarred || false;
      const searchTerm = options.searchTerm || '';
      
      // Use the most basic, simple query possible to reduce errors
      const query = `
        FOR edge IN userConversations
          FILTER edge._from == '${userIdWithPrefix}'
          
          LET conversation = DOCUMENT(edge._to)
          
          FILTER ${!includeArchived ? 'conversation.isArchived == false' : 'true'}
          FILTER ${filterStarred ? 'conversation.isStarred == true' : 'true'}
          
          ${searchTerm ? `FILTER (
            LIKE(LOWER(conversation.title), CONCAT("%", LOWER("${searchTerm.replace(/"/g, '\\"')}"), "%")) OR
            LIKE(LOWER(conversation.lastMessage), CONCAT("%", LOWER("${searchTerm.replace(/"/g, '\\"')}"), "%")) OR
            LIKE(LOWER(conversation.category), CONCAT("%", LOWER("${searchTerm.replace(/"/g, '\\"')}"), "%"))
          )` : ''}
          
          SORT conversation.updated DESC
          LIMIT ${offset}, ${limit}
          
          LET messagePreview = (
            FOR msg IN messages
              FILTER msg.conversationId == PARSE_IDENTIFIER(conversation._id).key
              SORT msg.sequence DESC
              LIMIT 1
              RETURN msg
          )[0]
          
          RETURN {
            _id: conversation._id,
            _key: conversation._key,
            title: conversation.title,
            lastMessage: conversation.lastMessage,
            created: conversation.created,
            updated: conversation.updated,
            messageCount: conversation.messageCount,
            isStarred: conversation.isStarred,
            isArchived: conversation.isArchived,
            category: conversation.category,
            tags: conversation.tags,
            userRole: edge.role,
            lastViewedAt: edge.lastViewedAt,
            lastMessagePreview: messagePreview
          }
      `;
      
      // Log and execute the query
      logger.info(`Executing simplified query for user path: ${userIdWithPrefix}`);
      const cursor = await this.db.query(query);
      const conversations = await cursor.all();
      logger.info(`Found ${conversations.length} conversations for user ${userIdWithPrefix}`);
      
      // Simplified count query
      const countQuery = `
        RETURN LENGTH(
          FOR edge IN userConversations
            FILTER edge._from == '${userIdWithPrefix}'
            LET conversation = DOCUMENT(edge._to)
            FILTER ${!includeArchived ? 'conversation.isArchived == false' : 'true'}
            FILTER ${filterStarred ? 'conversation.isStarred == true' : 'true'}
            ${searchTerm ? `FILTER (
              LIKE(LOWER(conversation.title), CONCAT("%", LOWER("${searchTerm.replace(/"/g, '\\"')}"), "%")) OR
              LIKE(LOWER(conversation.lastMessage), CONCAT("%", LOWER("${searchTerm.replace(/"/g, '\\"')}"), "%")) OR
              LIKE(LOWER(conversation.category), CONCAT("%", LOWER("${searchTerm.replace(/"/g, '\\"')}"), "%"))
            )` : ''}
            RETURN 1
        )
      `;
      
      const countCursor = await this.db.query(countQuery);
      const totalCount = await countCursor.next() || 0;
      
      return {
        conversations,
        pagination: {
          total: totalCount,
          limit,
          offset,
          pages: Math.ceil(totalCount / limit),
          currentPage: Math.floor(offset / limit) + 1
        }
      };
    } catch (error) {
      logger.error(`Error getting conversations for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get conversation messages
   * @param {String} conversationId - Conversation ID
   * @param {Object} options - Query options (limit, offset)
   * @returns {Promise<Object>} Messages with pagination
   */
  async getConversationMessages(conversationId, options = {}) {
    try {
      logger.info(`Getting messages for conversation ${conversationId}`);

      const limit = options.limit || 50;
      const offset = options.offset || 0;
      const sortDirection = options.newestFirst ? 'DESC' : 'ASC';

      // Get messages with explicit string template
      const messageQuery = `
        FOR msg IN messages
          FILTER msg.conversationId == "${conversationId}"
          SORT msg.sequence ${sortDirection === 'DESC' ? 'DESC' : 'ASC'}
          LIMIT ${offset}, ${limit}
          
          LET queryInfo = (
            FOR edge IN queryMessages
              FILTER edge._to == CONCAT('messages/', msg._key)
              FOR q IN queries
                FILTER q._id == edge._from
                RETURN {
                  _id: q._id,
                  _key: q._key,
                  text: q.text,
                  responseType: edge.responseType,
                  confidenceScore: edge.confidenceScore
                }
          )[0]
          
          RETURN MERGE(msg, { queryInfo: queryInfo })
      `;

      const messageCursor = await this.db.query(messageQuery);
      const messages = await messageCursor.all();

      // Count total messages
      const countQuery = `
        FOR msg IN messages
          FILTER msg.conversationId == "${conversationId}"
          COLLECT WITH COUNT INTO total
          RETURN total
      `;

      const countCursor = await this.db.query(countQuery);
      const totalCount = await countCursor.next() || 0;

      logger.info(`Found ${messages.length} messages for conversation ${conversationId}`);

      return {
        messages,
        pagination: {
          total: totalCount,
          limit,
          offset,
          pages: Math.ceil(totalCount / limit),
          currentPage: Math.floor(offset / limit) + 1
        }
      };
    } catch (error) {
      logger.error(`Error getting messages for conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Update conversation properties
   * @param {String} conversationId - Conversation ID
   * @param {Object} updateData - Properties to update
   * @returns {Promise<Object>} Updated conversation
   */
  async updateConversation(conversationId, updateData) {
    try {
      logger.info(`Updating conversation ${conversationId} with data:`, updateData);

      const allowedFields = [
        'title', 'isStarred', 'isArchived', 'tags', 'category'
      ];

      // Filter out non-allowed fields
      const filteredData = {};
      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          filteredData[field] = updateData[field];
        }
      }

      // Always update the 'updated' timestamp
      filteredData.updated = new Date().toISOString();

      if (Object.keys(filteredData).length === 0) {
        logger.warn('No valid fields to update');
        throw new Error('No valid fields to update');
      }

      // Update the conversation
      const updatedConv = await this.conversations.update(conversationId, filteredData, { returnNew: true });
      logger.info(`Conversation ${conversationId} updated successfully`);

      // If category changed and categoryId is provided, update the relationship
      if (updateData.categoryId) {
        // First, remove any existing category relationships
        await this.db.query(aql`
          FOR edge IN conversationCategories
            FILTER edge._from == ${'conversations/' + conversationId}
            REMOVE edge IN conversationCategories
        `);

        // Then create new relationship
        await this.conversationCategories.save({
          _from: `conversations/${conversationId}`,
          _to: `serviceCategories/${updateData.categoryId}`,
          relevanceScore: updateData.relevanceScore || 1.0
        });

        logger.info(`Conversation ${conversationId} category updated to ${updateData.categoryId}`);
      }

      // Track conversation update in analytics if service is available
      if (this.analyticsService && updateData.userId) {
        try {
          await this.analyticsService.trackEvent(
            updateData.userId,
            'conversationUpdated',
            {
              conversationId,
              updatedFields: Object.keys(filteredData)
            }
          );
        } catch (error) {
          logger.error('Error tracking conversation update in analytics:', error);
          // Continue even if analytics tracking fails
        }
      }

      return updatedConv.new;
    } catch (error) {
      logger.error(`Error updating conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Mark messages as read
   * @param {String} conversationId - Conversation ID
   * @param {Array<String>} messageIds - Optional array of message IDs to mark (if empty, mark all)
   * @returns {Promise<Object>} Result with count of updated messages
   */
  async markMessagesAsRead(conversationId, messageIds = []) {
    try {
      logger.info(`Marking messages as read for conversation ${conversationId}`);

      let result;

      // If specific message IDs are provided
      if (messageIds && messageIds.length > 0) {
        logger.info(`Marking ${messageIds.length} specific messages as read`);

        // Convert message IDs to JSON string for AQL
        const messageIdsJson = JSON.stringify(messageIds);

        // Update only the specified messages
        const updateQuery = `
          FOR msgId IN ${messageIdsJson}
            UPDATE { _key: msgId, readStatus: true } IN messages
            FILTER OLD.conversationId == "${conversationId}" AND OLD.readStatus == false
            RETURN NEW
        `;

        const updateCursor = await this.db.query(updateQuery);
        const updatedMessages = await updateCursor.all();
        result = { count: updatedMessages.length, ids: updatedMessages.map(msg => msg._key) };
      } else {
        // Update all unread messages in the conversation
        logger.info(`Marking all unread messages as read in conversation ${conversationId}`);

        const updateQuery = `
          FOR msg IN messages
            FILTER msg.conversationId == "${conversationId}" AND msg.readStatus == false
            UPDATE msg WITH { readStatus: true } IN messages
            RETURN NEW
        `;

        const updateCursor = await this.db.query(updateQuery);
        const updatedMessages = await updateCursor.all();
        result = { count: updatedMessages.length, ids: updatedMessages.map(msg => msg._key) };
      }

      // Update the lastViewedAt timestamp in the userConversations edge
      if (result.count > 0) {
        const userId = await this.getConversationOwnerId(conversationId);
        if (userId) {
          const currentTime = new Date().toISOString();

          const updateViewedQuery = `
            FOR edge IN userConversations
              FILTER edge._from == 'users/${userId}' AND edge._to == 'conversations/${conversationId}'
              UPDATE edge WITH { lastViewedAt: "${currentTime}" } IN userConversations
          `;

          await this.db.query(updateViewedQuery);
          logger.info(`Updated lastViewedAt for user ${userId} in conversation ${conversationId}`);
        }
      }

      logger.info(`Marked ${result.count} messages as read in conversation ${conversationId}`);
      return result;
    } catch (error) {
      logger.error(`Error marking messages as read in conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Get the owner ID of a conversation
   * @param {String} conversationId - Conversation ID
   * @returns {Promise<String|null>} User ID or null if not found
   * @private
   */
  async getConversationOwnerId(conversationId) {
    try {
      const cursor = await this.db.query(aql`
        FOR edge IN userConversations
          FILTER edge._to == ${'conversations/' + conversationId} AND edge.role == 'owner'
          RETURN SUBSTRING(edge._from, 6)
      `);

      return await cursor.next() || null;
    } catch (error) {
      logger.error(`Error getting owner ID for conversation ${conversationId}:`, error);
      return null;
    }
  }

  /**
   * Delete a conversation and all related messages
   * @param {String} conversationId - Conversation ID
   * @param {String} userId - User ID requesting the deletion (for validation)
   * @returns {Promise<Object>} Result with deleted counts
   */
  async deleteConversation(conversationId, userId) {
    try {
      logger.info(`Deleting conversation ${conversationId} for user ${userId}`);

      // Verify the user has permission to delete this conversation
      const permissionQuery = `
        FOR edge IN userConversations
          FILTER edge._to == 'conversations/${conversationId}' AND edge._from == 'users/${userId}'
          RETURN edge
      `;

      const permissionCursor = await this.db.query(permissionQuery);
      const permission = await permissionCursor.next();

      if (!permission) {
        logger.warn(`User ${userId} does not have permission to delete conversation ${conversationId}`);
        throw new Error('You do not have permission to delete this conversation');
      }

      // Get all message IDs for this conversation
      const messageQuery = `
        FOR msg IN messages
          FILTER msg.conversationId == "${conversationId}"
          RETURN msg._id
      `;

      const messageCursor = await this.db.query(messageQuery);
      const messageIds = await messageCursor.all();

      // Start a transaction to ensure atomicity
      const trx = await this.db.beginTransaction({
        write: ['messages', 'queryMessages', 'userConversations', 'conversationCategories', 'conversations']
      });

      try {
        // Delete message-query edges
        for (const messageId of messageIds) {
          await trx.step(() => {
            const deleteEdgeQuery = `
              FOR edge IN queryMessages
                FILTER edge._to == "${messageId}"
                REMOVE edge IN queryMessages
            `;
            return this.db.query(deleteEdgeQuery);
          });
        }

        // Delete all messages
        const deleteMessageQuery = `
          FOR msg IN messages
            FILTER msg.conversationId == "${conversationId}"
            REMOVE msg IN messages
            RETURN OLD
        `;

        const deleteMessageResult = await trx.step(() => this.db.query(deleteMessageQuery));
        const messagesDeleted = await deleteMessageResult.all();

        // Delete user-conversation edges
        const deleteUserEdgeQuery = `
          FOR edge IN userConversations
            FILTER edge._to == 'conversations/${conversationId}'
            REMOVE edge IN userConversations
        `;

        await trx.step(() => this.db.query(deleteUserEdgeQuery));

        // Delete conversation-category edges
        const deleteCategoryEdgeQuery = `
          FOR edge IN conversationCategories
            FILTER edge._from == 'conversations/${conversationId}'
            REMOVE edge IN conversationCategories
        `;

        await trx.step(() => this.db.query(deleteCategoryEdgeQuery));

        // Delete the conversation
        await trx.step(() => this.conversations.remove(conversationId));

        // Commit the transaction
        await trx.commit();

        logger.info(`Conversation ${conversationId} deleted with ${messagesDeleted.length} messages`);

        // Track conversation deletion in analytics if service is available
        if (this.analyticsService) {
          try {
            await this.analyticsService.trackEvent(
              userId,
              'conversationDeleted',
              {
                conversationId,
                messageCount: messagesDeleted.length
              }
            );
          } catch (error) {
            logger.error('Error tracking conversation deletion in analytics:', error);
            // Continue even if analytics tracking fails
          }
        }

        return {
          conversationId,
          messagesDeleted: messagesDeleted.length,
          success: true
        };
      } catch (error) {
        // Abort the transaction on error
        await trx.abort();
        throw error;
      }
    } catch (error) {
      logger.error(`Error deleting conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Find messages related to a specific query
   * @param {String} queryId - Query ID
   * @returns {Promise<Array>} Related messages with conversation info
   */
  async findMessagesForQuery(queryId) {
    try {
      logger.info(`Finding messages related to query ${queryId}`);

      const query = `
        FOR edge IN queryMessages
          FILTER edge._from == 'queries/${queryId}'
          
          FOR msg IN messages
            FILTER msg._id == edge._to
            
            LET conversation = (
              FOR conv IN conversations
                FILTER conv._key == msg.conversationId
                RETURN conv
            )[0]
            
            RETURN {
              message: msg,
              conversation: conversation,
              relationship: {
                responseType: edge.responseType,
                confidenceScore: edge.confidenceScore,
                createdAt: edge.createdAt
              }
            }
      `;

      const cursor = await this.db.query(query);
      const relatedMessages = await cursor.all();
      logger.info(`Found ${relatedMessages.length} messages related to query ${queryId}`);

      return relatedMessages;
    } catch (error) {
      logger.error(`Error finding messages for query ${queryId}:`, error);
      throw error;
    }
  }

  /**
   * Find the originating query for a message
   * @param {String} messageId - Message ID
   * @returns {Promise<Object|null>} Query information or null if not found
   */
  async findOriginatingQuery(messageId) {
    try {
      logger.info(`Finding originating query for message ${messageId}`);

      const cursor = await this.db.query(aql`
        FOR edge IN queryMessages
          FILTER edge._to == ${'messages/' + messageId}
          
          FOR q IN queries
            FILTER q._id == edge._from
            
            RETURN {
              query: q,
              relationship: {
                responseType: edge.responseType,
                confidenceScore: edge.confidenceScore,
                createdAt: edge.createdAt
              }
            }
      `);

      const result = await cursor.next();

      if (result) {
        logger.info(`Found originating query ${result.query._key} for message ${messageId}`);
      } else {
        logger.info(`No originating query found for message ${messageId}`);
      }

      return result || null;
    } catch (error) {
      logger.error(`Error finding originating query for message ${messageId}:`, error);
      return null;
    }
  }

  /**
   * Link a query to a conversation
   * @param {String} queryId - Query ID
   * @param {String} conversationId - Conversation ID
   * @param {String} messageId - Message ID responding to the query
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Created relationship
   */
  async linkQueryToConversation(queryId, conversationId, messageId, options = {}) {
    try {
      logger.info(`Linking query ${queryId} to conversation ${conversationId} via message ${messageId}`);

      // Ensure all IDs exist
      const query = await this.db.collection('queries').document(queryId);
      const conversation = await this.conversations.document(conversationId);
      const message = await this.messages.document(messageId);

      // Check if message belongs to conversation
      if (message.conversationId !== conversationId) {
        logger.warn(`Message ${messageId} does not belong to conversation ${conversationId}`);
        throw new Error('Message does not belong to the specified conversation');
      }

      // Check if the link already exists
      const existingCursor = await this.db.query(aql`
        FOR edge IN queryMessages
          FILTER edge._from == ${'queries/' + queryId} AND edge._to == ${'messages/' + messageId}
          RETURN edge
      `);

      const existingLink = await existingCursor.next();

      if (existingLink) {
        logger.info(`Link between query ${queryId} and message ${messageId} already exists`);
        return existingLink;
      }

      // Create the edge
      const edge = await this.queryMessages.save({
        _from: `queries/${queryId}`,
        _to: `messages/${messageId}`,
        responseType: options.responseType || 'primary',
        confidenceScore: options.confidenceScore || 1.0,
        createdAt: new Date().toISOString()
      });

      logger.info(`Created link between query ${queryId} and message ${messageId}`);

      // If there's a category on the query, update the conversation category
      if (query.categoryId) {
        // Check if conversation already has this category
        const categoryExistsCursor = await this.db.query(aql`
          FOR edge IN conversationCategories
            FILTER edge._from == ${'conversations/' + conversationId} AND edge._to == ${'serviceCategories/' + query.categoryId}
            RETURN edge
        `);

        const categoryExists = await categoryExistsCursor.next();

        if (!categoryExists) {
          // Get category name for the conversation category field
          const categoryCursor = await this.db.query(aql`
            FOR cat IN serviceCategories
              FILTER cat._key == ${query.categoryId}
              RETURN cat.nameEN
          `);

          const categoryName = await categoryCursor.next();

          // Update the conversation with the category name
          if (categoryName) {
            await this.conversations.update(conversationId, {
              category: categoryName
            });
          }

          // Create the category relationship
          await this.conversationCategories.save({
            _from: `conversations/${conversationId}`,
            _to: `serviceCategories/${query.categoryId}`,
            relevanceScore: 1.0
          });

          logger.info(`Updated conversation ${conversationId} with category from query: ${query.categoryId}`);
        }
      }

      return edge;
    } catch (error) {
      logger.error(`Error linking query ${queryId} to conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Search for conversations by text
   * @param {String} userId - User ID
   * @param {String} searchTerm - Text to search for
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Matching conversations
   */
  async searchConversations(userId, searchTerm, options = {}) {
    try {
      logger.info(`Searching conversations for user ${userId} with term: "${searchTerm}"`);

      const limit = options.limit || 20;
      const offset = options.offset || 0;
      const includeArchived = options.includeArchived || false;

      const searchTermEscaped = searchTerm.replace(/"/g, '\\"'); // Escape quotes

      const query = `
        FOR edge IN userConversations
          FILTER edge._from == 'users/${userId}'
          
          FOR conv IN conversations
            FILTER conv._id == edge._to
            FILTER ${includeArchived} OR conv.isArchived == false
            
            FILTER (
              LIKE(LOWER(conv.title), CONCAT("%", LOWER("${searchTermEscaped}"), "%")) OR
              LIKE(LOWER(conv.lastMessage), CONCAT("%", LOWER("${searchTermEscaped}"), "%")) OR
              LIKE(LOWER(conv.category), CONCAT("%", LOWER("${searchTermEscaped}"), "%")) OR
              "${searchTermEscaped}" IN conv.tags
            )
            
            // Also search in messages content
            LET matchingMessages = (
              FOR msg IN messages
                FILTER msg.conversationId == conv._key
                FILTER LIKE(LOWER(msg.content), CONCAT("%", LOWER("${searchTermEscaped}"), "%"))
                SORT msg.timestamp DESC
                LIMIT 3
                RETURN msg
            )
            
            SORT LENGTH(matchingMessages) > 0 ? 1 : 0 DESC, // Prioritize conversations with matching messages
                 conv.updated DESC
            
            LIMIT ${offset}, ${limit}
            
            RETURN {
              conversation: conv,
              matchingMessages: matchingMessages,
              role: edge.role
            }
      `;

      const cursor = await this.db.query(query);
      const results = await cursor.all();

      logger.info(`Found ${results.length} conversations matching term "${searchTerm}" for user ${userId}`);

      return results;
    } catch (error) {
      logger.error(`Error searching conversations for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get conversation statistics for a user
   * @param {String} userId - User ID
   * @returns {Promise<Object>} Conversation statistics
   */
  async getUserConversationStats(userId) {
    try {
      logger.info(`Getting conversation statistics for user ${userId}`);

      const query = `
        LET userConvs = (
          FOR edge IN userConversations
            FILTER edge._from == 'users/${userId}'
            FOR conv IN conversations
              FILTER conv._id == edge._to
              RETURN conv
        )
        
        LET totalCount = LENGTH(userConvs)
        LET activeCount = LENGTH(FOR c IN userConvs FILTER c.isArchived == false RETURN c)
        LET archivedCount = LENGTH(FOR c IN userConvs FILTER c.isArchived == true RETURN c)
        LET starredCount = LENGTH(FOR c IN userConvs FILTER c.isStarred == true RETURN c)
        
        LET messageCount = (
          FOR conv IN userConvs
            FOR msg IN messages
              FILTER msg.conversationId == conv._key
              COLLECT WITH COUNT INTO count
              RETURN count
        )[0] OR 0
        
        LET categoryDistribution = (
          FOR conv IN userConvs
            COLLECT category = conv.category WITH COUNT INTO count
            FILTER category != null AND category != ""
            SORT count DESC
            RETURN {
              category: category,
              count: count
            }
        )
        
        LET timeDistribution = (
          FOR conv IN userConvs
            LET hour = DATE_HOUR(DATE_ISO8601(conv.created))
            COLLECT timeSlot = hour WITH COUNT INTO count
            SORT timeSlot ASC
            RETURN {
              hour: timeSlot,
              count: count
            }
        )
        
        RETURN {
          total: totalCount,
          active: activeCount,
          archived: archivedCount,
          starred: starredCount,
          messageCount: messageCount,
          avgMessagesPerConversation: totalCount > 0 ? messageCount / totalCount : 0,
          categoryDistribution: categoryDistribution,
          timeDistribution: timeDistribution,
          lastUpdated: DATE_ISO8601(DATE_NOW())
        }
      `;

      const cursor = await this.db.query(query);
      const stats = await cursor.next();
      logger.info(`Retrieved conversation statistics for user ${userId}`);

      return stats || {
        total: 0,
        active: 0,
        archived: 0,
        starred: 0,
        messageCount: 0,
        avgMessagesPerConversation: 0,
        categoryDistribution: [],
        timeDistribution: [],
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error getting conversation statistics for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Create a conversation from a query
   * @param {String} queryId - Query ID
   * @param {String} userId - User ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} The created conversation and message
   */
  async createConversationFromQuery(queryId, userId, options = {}) {
    try {
      logger.info(`Creating conversation from query ${queryId} for user ${userId}`);

      // Get the query
      const query = await this.db.collection('queries').document(queryId);

      if (!query) {
        logger.warn(`Query ${queryId} not found`);
        throw new Error('Query not found');
      }

      // Extract conversationTitle from options or use the query text (truncated if needed)
      const conversationTitle = options.title ||
        (query.text.length > 50 ? `${query.text.substring(0, 47)}...` : query.text);

      // Create conversation
      const conversationData = {
        userId: userId,
        title: conversationTitle,
        lastMessage: query.text,
        categoryId: query.categoryId,
        created: query.timestamp,
        updated: new Date().toISOString(),
        messageCount: 0,
        isStarred: false,
        isArchived: false,
        category: options.category || '',
        tags: options.tags || []
      };

      const conversation = await this.createConversation(conversationData);

      // Add the user query as the first message
      const userMessage = await this.addMessage({
        conversationId: conversation._key,
        content: query.text,
        timestamp: query.timestamp,
        sender: 'user',
        readStatus: true,
        userId: userId
      });

      // If there's a response in options, add it as the assistant's message
      if (options.responseText) {
        const assistantMessage = await this.addMessage({
          conversationId: conversation._key,
          content: options.responseText,
          timestamp: new Date().toISOString(),
          sender: 'assistant',
          readStatus: false,
          queryId: queryId,
          userId: userId,
          responseType: 'primary'
        });

        // Link query to the assistant's message
        await this.linkQueryToConversation(
          queryId,
          conversation._key,
          assistantMessage._key,
          { responseType: 'primary' }
        );

        logger.info(`Created conversation ${conversation._key} from query ${queryId} with response`);

        return {
          conversation,
          userMessage,
          assistantMessage
        };
      } else {
        logger.info(`Created conversation ${conversation._key} from query ${queryId} without response`);

        return {
          conversation,
          userMessage
        };
      }
    } catch (error) {
      logger.error(`Error creating conversation from query ${queryId}:`, error);
      throw error;
    }
  }

  /**
   * Get recent conversations
   * @param {String} userId - User ID
   * @param {Number} limit - Maximum number of conversations to return
   * @returns {Promise<Array>} Recent conversations
   */
  async getRecentConversations(userId, limit = 5) {
    try {
      logger.info(`Getting ${limit} recent conversations for user ${userId}`);

      const cursor = await this.db.query(aql`
        FOR edge IN userConversations
          FILTER edge._from == ${'users/' + userId}
          
          FOR conv IN conversations
            FILTER conv._id == edge._to
            FILTER conv.isArchived == false
            
            SORT conv.updated DESC
            LIMIT ${limit}
            
            LET lastMessage = (
              FOR msg IN messages
                FILTER msg.conversationId == conv._key
                SORT msg.sequence DESC
                LIMIT 1
                RETURN msg
            )[0]
            
            RETURN {
              _id: conv._id,
              _key: conv._key,
              title: conv.title,
              lastMessage: conv.lastMessage,
              updated: conv.updated,
              messageCount: conv.messageCount,
              isStarred: conv.isStarred,
              category: conv.category,
              lastMessageDetails: lastMessage
            }
      `);

      const conversations = await cursor.all();
      logger.info(`Found ${conversations.length} recent conversations for user ${userId}`);

      return conversations;
    } catch (error) {
      logger.error(`Error getting recent conversations for user ${userId}:`, error);
      throw error;
    }
  }
}
module.exports = ChatHistoryService;