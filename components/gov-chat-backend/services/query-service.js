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

class QueryService {
  constructor() {
    this.db = initDB;
    this.queries = this.db.collection('queries');
    this.serviceCategories = this.db.collection('serviceCategories');
    this.services = this.db.collection('services');
    this.analyticsService = null; // Will be set via dependency injection
    this.chatHistoryService = null; // Will be set via dependency injection
    logger.info('QueryService initialized');
  }

  /**
   * Set the analytics service
   * @param {Object} analyticsService - Analytics service instance
   */
  setAnalyticsService(analyticsService) {
    this.analyticsService = analyticsService;
    logger.info('Analytics service set for QueryService');
  }

  /**
   * Create a new query
   * @param {Object} queryData - Query data
   * @returns {Promise<Object>} The created query
   */
  /**
 * Create a new query
 * @param {Object} queryData - Query data
 * @returns {Promise<Object>} The created query
 */
  async createQuery(queryData) {
    try {
      logger.info(`Creating query with body: ${JSON.stringify(queryData)}`);

      // Ensure minimum required data
      let missingFields = [];
      if (!queryData.userId) missingFields.push('userId');
      if (!queryData.sessionId) missingFields.push('sessionId');
      if (!queryData.text) missingFields.push('text');

      if (missingFields.length > 0) {
        logger.error(`Missing required data: ${missingFields.join(', ')}`);
        throw new Error('Missing required query data');
      }

      // Create query document
      const basicQueryDoc = {
        userId: queryData.userId,
        sessionId: queryData.sessionId,
        text: queryData.text,
        timestamp: queryData.timestamp || new Date().toISOString(),
        isAnswered: queryData.isAnswered !== undefined ? queryData.isAnswered : false,
        categoryId: queryData.categoryId || null,
        serviceId: queryData.serviceId || null,
        responseTime: queryData.responseTime || 0
      };

      // Save query document
      logger.info(`Document to save: ${JSON.stringify(basicQueryDoc)}`);
      const query = await this.queries.save(basicQueryDoc);
      const queryId = query._key;
      logger.info(`Query created with auto-generated key: ${queryId}`);

      // Record query in analytics if service is set
      if (this.analyticsService) {
        try {
          await this.analyticsService.recordQuery({
            _key: queryId,
            userId: queryData.userId,
            sessionId: queryData.sessionId,
            text: queryData.text,
            categoryId: queryData.categoryId || null,
            serviceId: queryData.serviceId || null,
            responseTime: queryData.responseTime || 0,
            isAnswered: queryData.isAnswered || false
          });
          logger.info(`Analytics recorded for query ${queryId}`);
        } catch (error) {
          logger.error(`Error recording query analytics: ${error.message}`);
          // Continue even if analytics recording fails
        }
      }

      // Return the document
      const finalQuery = await this.queries.document(queryId);
      logger.info(`Query ${queryId} created successfully`);
      return finalQuery;
    } catch (error) {
      logger.error(`Error creating query: ${error.message}`);
      // Log collection properties for debugging if save fails
      if (error.message.includes('schema')) {
        try {
          const collProperties = await this.queries.properties();
          logger.info(`Collection properties: ${JSON.stringify(collProperties)}`);
        } catch (propsError) {
          logger.error(`Failed to get collection properties: ${propsError.message}`);
        }
      }
      throw error;
    }
  }

  /**
   * Add feedback to a query
   * @param {String} queryId - Query ID
   * @param {Object} feedback - Feedback data
   * @returns {Promise<Object>} The updated query
   */
  async addFeedback(queryId, feedback) {
    try {
      logger.info(`Adding feedback to query ${queryId}`);

      // Ensure feedback has required fields
      if (feedback.rating === undefined) {
        logger.warn('Feedback rating is required');
        throw new Error('Feedback rating is required');
      }

      // Prepare feedback object
      const userFeedback = {
        rating: feedback.rating,
        comment: feedback.comment || '',
        providedAt: new Date().toISOString()
      };

      // Update the query with feedback
      const updatedQuery = await this.queries.update(queryId, {
        userFeedback
      }, { returnNew: true });

      // Update analytics if service is set
      if (this.analyticsService) {
        try {
          await this.analyticsService.recordFeedback(queryId, userFeedback);
          logger.info(`Analytics updated with feedback for query ${queryId}`);
        } catch (error) {
          logger.error('Error updating analytics with feedback:', error);
          // Continue even if analytics update fails
        }
      }

      logger.info(`Feedback added to query ${queryId}`);
      return updatedQuery.new;
    } catch (error) {
      logger.error(`Error adding feedback to query ${queryId}:`, error);
      throw error;
    }
  }

  /**
   * Get a query by ID
   * @param {String} queryId - Query ID
   * @returns {Promise<Object>} The query
   */
  async getQuery(queryId) {
    try {
      logger.info(`Fetching query with ID: ${queryId}`);
      const query = await this.queries.document(queryId);
      logger.info(`Query ${queryId} retrieved successfully`);
      return query;
    } catch (error) {
      logger.error(`Error getting query ${queryId}:`, error);
      throw error;
    }
  }

  /**
   * Mark a query as answered
   * @param {String} queryId - Query ID
   * @param {Number} responseTime - Response time in milliseconds
   * @returns {Promise<Object>} The updated query
   */
  async markAsAnswered(queryId, responseTime = 0) {
    try {
      logger.info(`Marking query ${queryId} as answered with response time: ${responseTime}ms`);
      const updatedQuery = await this.queries.update(queryId, {
        isAnswered: true,
        responseTime
      }, { returnNew: true });

      logger.info(`Query ${queryId} marked as answered`);
      return updatedQuery.new;
    } catch (error) {
      logger.error(`Error marking query ${queryId} as answered:`, error);
      throw error;
    }
  }

  /**
   * Set query category and service
   * @param {String} queryId - Query ID
   * @param {String} categoryId - Category ID
   * @param {String} serviceId - Service ID (optional)
   * @returns {Promise<Object>} The updated query
   */
  async setQueryCategory(queryId, categoryId, serviceId = null) {
    try {
      logger.info(`Setting category ${categoryId} for query ${queryId}${serviceId ? ` with service ${serviceId}` : ''}`);

      // Update the query with category and service
      const updateData = { categoryId };
      if (serviceId) {
        updateData.serviceId = serviceId;
      }

      const updatedQuery = await this.queries.update(queryId, updateData, { returnNew: true });

      // Update or create edge between query and category
      try {
        // First try to get any existing edge
        const edgeCursor = await this.db.query(aql`
          FOR edge IN queryCategories
            FILTER edge._from == ${'queries/' + queryId}
            RETURN edge
        `);

        const existingEdge = await edgeCursor.next();

        if (existingEdge) {
          // Update existing edge
          logger.info(`Updating existing query-category edge for query ${queryId}`);
          await this.db.collection('queryCategories').update(existingEdge._key, {
            _to: `serviceCategories/${categoryId}`,
            updatedAt: new Date().toISOString()
          });
        } else {
          // Create new edge
          logger.info(`Creating new query-category edge for query ${queryId}`);
          await this.db.collection('queryCategories').save({
            _from: `queries/${queryId}`,
            _to: `serviceCategories/${categoryId}`,
            createdAt: new Date().toISOString()
          });
        }
      } catch (error) {
        logger.error(`Error updating query-category edge for query ${queryId}:`, error);
        // Continue even if edge update fails
      }

      logger.info(`Category set for query ${queryId}`);
      return updatedQuery.new;
    } catch (error) {
      logger.error(`Error setting category for query ${queryId}:`, error);
      throw error;
    }
  }

  /**
   * Search for queries based on criteria
   * @param {Object} criteria - Search criteria
   * @param {Number} limit - Maximum number of results (default: 20)
   * @param {Number} offset - Offset for pagination (default: 0)
   * @returns {Promise<Object>} Search results
   */
  async searchQueries(criteria, limit = 20, offset = 0) {
    try {
      logger.info('Searching queries with criteria:', criteria);

      let filterConditions = [];

      // Build filter conditions based on criteria
      if (criteria.userId) {
        filterConditions.push(aql`q.userId == ${criteria.userId}`);
      }

      if (criteria.sessionId) {
        filterConditions.push(aql`q.sessionId == ${criteria.sessionId}`);
      }

      if (criteria.text) {
        filterConditions.push(aql`LOWER(q.text) LIKE CONCAT("%", LOWER(${criteria.text}), "%")`);
      }

      if (criteria.categoryId) {
        filterConditions.push(aql`q.categoryId == ${criteria.categoryId}`);
      }

      if (criteria.serviceId) {
        filterConditions.push(aql`q.serviceId == ${criteria.serviceId}`);
      }

      if (criteria.isAnswered !== undefined) {
        filterConditions.push(aql`q.isAnswered == ${criteria.isAnswered}`);
      }

      if (criteria.startDate) {
        filterConditions.push(aql`q.timestamp >= ${criteria.startDate}`);
      }

      if (criteria.endDate) {
        filterConditions.push(aql`q.timestamp <= ${criteria.endDate}`);
      }

      if (criteria.hasFeedback !== undefined) {
        if (criteria.hasFeedback) {
          filterConditions.push(aql`q.userFeedback != null`);
        } else {
          filterConditions.push(aql`q.userFeedback == null`);
        }
      }

      if (criteria.minRating !== undefined) {
        filterConditions.push(aql`q.userFeedback.rating >= ${criteria.minRating}`);
      }

      if (criteria.maxRating !== undefined) {
        filterConditions.push(aql`q.userFeedback.rating <= ${criteria.maxRating}`);
      }

      if (criteria.tags && criteria.tags.length > 0) {
        filterConditions.push(aql`
          LENGTH(
            FOR tag IN ${criteria.tags}
              FILTER tag IN q.metadata.tags
              RETURN tag
          ) == LENGTH(${criteria.tags})
        `);
      }

      // If no specific criteria provided, return all queries
      let filterQuery;
      if (filterConditions.length > 0) {
        // Manually join the filter conditions with ' AND ' since aql.join is problematic
        filterQuery = aql`FILTER `;
        for (let i = 0; i < filterConditions.length; i++) {
          if (i > 0) {
            filterQuery = aql`${filterQuery} AND `;
          }
          filterQuery = aql`${filterQuery} ${filterConditions[i]}`;
        }
      } else {
        filterQuery = aql``;
      }

      // Build and execute the query
      const query = aql`
        FOR q IN queries
          ${filterQuery}
          SORT q.timestamp DESC
          LIMIT ${offset}, ${limit}
          RETURN q
      `;

      // Execute query and get results
      const cursor = await this.db.query(query);
      const queries = await cursor.all();

      // Get total count for pagination
      const countQuery = aql`
        FOR q IN queries
          ${filterQuery}
          COLLECT WITH COUNT INTO total
          RETURN total
      `;
      const countCursor = await this.db.query(countQuery);
      const totalCount = await countCursor.next() || 0;

      logger.info(`Found ${queries.length} queries matching criteria`);
      return {
        queries,
        pagination: {
          total: totalCount,
          limit,
          offset,
          pages: Math.ceil(totalCount / limit),
          currentPage: Math.floor(offset / limit) + 1
        }
      };
    } catch (error) {
      logger.error('Error searching queries:', error);
      throw error;
    }
  }

  /**
   * Delete a query
   * @param {String} queryId - Query ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteQuery(queryId) {
    try {
      logger.info(`Deleting query ${queryId}`);

      // Delete edges connected to the query
      try {
        // Delete session-query edges
        await this.db.query(aql`
          FOR edge IN sessionQueries
            FILTER edge._to == ${'queries/' + queryId}
            REMOVE edge IN sessionQueries
        `);

        // Delete query-category edges
        await this.db.query(aql`
          FOR edge IN queryCategories
            FILTER edge._from == ${'queries/' + queryId}
            REMOVE edge IN queryCategories
        `);
        logger.info(`Edges deleted for query ${queryId}`);
      } catch (error) {
        logger.error(`Error deleting edges for query ${queryId}:`, error);
        // Continue even if edge deletion fails
      }

      // Delete the query document
      const result = await this.queries.remove(queryId);
      logger.info(`Query ${queryId} deleted successfully`);
      return result;
    } catch (error) {
      logger.error(`Error deleting query ${queryId}:`, error);
      throw error;
    }
  }

  /**
   * Get similar queries
   * @param {String} queryText - Query text to find similar queries
   * @param {Number} limit - Maximum number of similar queries to return
   * @returns {Promise<Array>} Similar queries
   */
  async getSimilarQueries(queryText, limit = 5) {
    try {
      logger.info(`Finding similar queries for text: "${queryText}"`);

      // This is a simple implementation using text matching
      // In a production system, you would use a more sophisticated approach like vector embeddings

      // Convert query to lowercase for case-insensitive matching
      const lowerQueryText = queryText.toLowerCase();

      // Extract important words (excluding common stop words)
      const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'by'];
      const words = lowerQueryText.split(/\s+/).filter(word =>
        word.length > 2 && !stopWords.includes(word)
      );

      if (words.length === 0) {
        logger.info('No significant words found in query text, returning empty result');
        return [];
      }

      // Build a query that finds documents containing any of these words
      const similarQueriesQuery = aql`
        FOR q IN queries
          LET score = (
            FOR word IN ${words}
              FILTER LOWER(q.text) LIKE CONCAT("%", word, "%")
              RETURN 1
          )
          FILTER LENGTH(score) > 0
          SORT LENGTH(score) DESC, q.timestamp DESC
          LIMIT ${limit}
          RETURN q
      `;

      const cursor = await this.db.query(similarQueriesQuery);
      const similarQueries = await cursor.all();
      logger.info(`Found ${similarQueries.length} similar queries`);
      return similarQueries;
    } catch (error) {
      logger.error(`Error finding similar queries for "${queryText}":`, error);
      return [];
    }
  }

  /**
   * Save a query with its criteria for future recall
   * @param {Object} queryData - Query data with criteria
   * @returns {Promise<Object>} The saved query
   */
  async saveQueryWithCriteria(queryData) {
    try {
      logger.info('Saving query with criteria:', queryData);

      // Ensure minimum required data
      if (!queryData.userId || !queryData.text) {
        logger.warn('Missing required query data');
        throw new Error('Missing required query data');
      }

      // Create basic query document - let ArangoDB generate the key
      const basicQueryDoc = {
        userId: queryData.userId,
        text: queryData.text,
        timestamp: queryData.timestamp || new Date().toISOString()
      };

      // Add category and service if provided
      if (queryData.categoryId) basicQueryDoc.categoryId = queryData.categoryId;
      if (queryData.serviceId) basicQueryDoc.serviceId = queryData.serviceId;

      // Add metadata with isSaved flag
      basicQueryDoc.metadata = {
        criteria: queryData.criteria || '',
        tags: Array.isArray(queryData.tags) ? queryData.tags : [],
        isSaved: true,
        name: queryData.name || `Query ${new Date().toISOString()}`,
        description: queryData.description || ''
      };

      logger.info('Saving query with criteria...');
      const query = await this.queries.save(basicQueryDoc);
      logger.info(`Query saved with auto-generated key: ${query._key}`);

      return query;
    } catch (error) {
      logger.error('Error saving query with criteria:', error);
      throw error;
    }
  }

  /**
   * Get saved queries for a user
   * @param {String} userId - User ID
   * @param {Number} limit - Maximum number of queries to return
   * @param {Number} offset - Offset for pagination
   * @returns {Promise<Object>} Saved queries with pagination
   */
  async getSavedQueries(userId, limit = 20, offset = 0) {
    try {
      logger.info(`Fetching saved queries for user ${userId}`);

      // Build and execute the query
      const query = aql`
        FOR q IN queries
          FILTER q.userId == ${userId}
          FILTER q.metadata.isSaved == true
          SORT q.timestamp DESC
          LIMIT ${offset}, ${limit}
          RETURN q
      `;

      // Execute query and get results
      const cursor = await this.db.query(query);
      const queries = await cursor.all();

      // Get total count for pagination
      const countQuery = aql`
        FOR q IN queries
          FILTER q.userId == ${userId}
          FILTER q.metadata.isSaved == true
          COLLECT WITH COUNT INTO total
          RETURN total
      `;
      const countCursor = await this.db.query(countQuery);
      const totalCount = await countCursor.next() || 0;

      logger.info(`Found ${queries.length} saved queries for user ${userId}`);
      return {
        queries,
        pagination: {
          total: totalCount,
          limit,
          offset,
          pages: Math.ceil(totalCount / limit),
          currentPage: Math.floor(offset / limit) + 1
        }
      };
    } catch (error) {
      logger.error(`Error getting saved queries for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get query recommendations based on user history
   * @param {String} userId - User ID
   * @param {Number} limit - Maximum number of recommendations
   * @returns {Promise<Array>} Recommended queries
   */
  async getQueryRecommendations(userId, limit = 5) {
    try {
      logger.info(`Fetching query recommendations for user ${userId}`);

      // First get the user's recent queries
      const recentQueriesQuery = aql`
        FOR q IN queries
          FILTER q.userId == ${userId}
          SORT q.timestamp DESC
          LIMIT 10
          RETURN q
      `;

      const recentQueriesCursor = await this.db.query(recentQueriesQuery);
      const recentQueries = await recentQueriesCursor.all();

      if (recentQueries.length === 0) {
        logger.info(`No recent queries found for user ${userId}, falling back to popular queries`);
        return await this.getPopularQueries(limit);
      }

      // Extract categories and services from recent queries
      const categories = recentQueries
        .filter(q => q.categoryId)
        .map(q => q.categoryId);

      const services = recentQueries
        .filter(q => q.serviceId)
        .map(q => q.serviceId);

      if (categories.length === 0 && services.length === 0) {
        logger.info(`No categories or services found in recent queries for user ${userId}, falling back to popular queries`);
        return await this.getPopularQueries(limit);
      }

      // Find recommendations based on categories and services
      const recommendationsQuery = aql`
        LET categorySimilar = (
          FOR q IN queries
            FILTER q.userId != ${userId}
            FILTER q.categoryId IN ${categories}
            SORT q.timestamp DESC
            LIMIT ${limit * 2}
            RETURN DISTINCT q.text
        )
        
        LET serviceSimilar = (
          FOR q IN queries
            FILTER q.userId != ${userId}
            FILTER q.serviceId IN ${services}
            SORT q.timestamp DESC
            LIMIT ${limit * 2}
            RETURN DISTINCT q.text
        )
        
        LET combined = UNION(categorySimilar, serviceSimilar)
        
        FOR text IN combined
          SORT RAND()
          LIMIT ${limit}
          RETURN text
      `;

      const recommendationsCursor = await this.db.query(recommendationsQuery);
      const recommendations = await recommendationsCursor.all();

      // If we don't have enough recommendations, add popular queries
      if (recommendations.length < limit) {
        logger.info(`Not enough recommendations (${recommendations.length}/${limit}), supplementing with popular queries`);
        const popularQueries = await this.getPopularQueries(limit - recommendations.length);
        return [...recommendations, ...popularQueries.map(q => q.text)];
      }

      logger.info(`Found ${recommendations.length} query recommendations for user ${userId}`);
      return recommendations;
    } catch (error) {
      logger.error(`Error getting query recommendations for user ${userId}:`, error);
      return await this.getPopularQueries(limit);
    }
  }

  /**
   * Get popular queries
   * @param {Number} limit - Maximum number of queries to return
   * @returns {Promise<Array>} Popular queries
   */
  async getPopularQueries(limit = 5) {
    try {
      logger.info('Fetching popular queries');
      const query = aql`
        FOR q IN queries
          COLLECT text = q.text WITH COUNT INTO count
          SORT count DESC
          LIMIT ${limit}
          RETURN { text, count }
      `;

      const cursor = await this.db.query(query);
      const popularQueries = await cursor.all();
      logger.info(`Found ${popularQueries.length} popular queries`);
      return popularQueries;
    } catch (error) {
      logger.error(`Error getting popular queries:`, error);
      return [];
    }
  }

  // Add this method to the QueryService class
  /**
   * Set the chat history service
   * @param {Object} chatHistoryService - Chat history service instance
   */
  async setChatHistoryService(chatHistoryService) {
    this.chatHistoryService = chatHistoryService;
    logger.info('Chat history service set for QueryService');
  }

  // Add this method to the QueryService class
  /**
   * Create a conversation from a query
   * @param {String} queryId - Query ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Created conversation data
   */
  async createConversationFromQuery(queryId, options = {}) {
    try {
      logger.info(`Creating conversation from query ${queryId}`);

      // Ensure chat history service is set
      if (!this.chatHistoryService) {
        logger.error('Chat history service is not set');
        throw new Error('Chat history service is not set');
      }

      // Get the query details
      const query = await this.getQuery(queryId);

      if (!query) {
        logger.warn(`Query ${queryId} not found`);
        throw new Error('Query not found');
      }

      // Create conversation using the chat history service
      const conversation = await this.chatHistoryService.createConversationFromQuery(
        queryId,
        query.userId,
        {
          title: options.title || query.text,
          responseText: options.responseText,
          tags: options.tags || []
        }
      );

      logger.info(`Conversation created from query ${queryId} with ID ${conversation.conversation._key}`);

      return conversation;
    } catch (error) {
      logger.error(`Error creating conversation from query ${queryId}:`, error);
      throw error;
    }
  }

  // Add this method to the QueryService class
  /**
   * Get conversations for a query
   * @param {String} queryId - Query ID
   * @returns {Promise<Array>} Conversations associated with the query
   */
  async getConversationsForQuery(queryId) {
    try {
      logger.info(`Getting conversations for query ${queryId}`);

      // Ensure chat history service is set
      if (!this.chatHistoryService) {
        logger.error('Chat history service is not set');
        throw new Error('Chat history service is not set');
      }

      // Find messages related to this query
      const relatedMessages = await this.chatHistoryService.findMessagesForQuery(queryId);

      // Extract unique conversations
      const conversationMap = new Map();
      for (const item of relatedMessages) {
        if (item.conversation && !conversationMap.has(item.conversation._key)) {
          conversationMap.set(item.conversation._key, {
            conversation: item.conversation,
            messages: []
          });
        }

        if (item.message) {
          const conversation = conversationMap.get(item.conversation._key);
          if (conversation) {
            conversation.messages.push(item.message);
          }
        }
      }

      const conversations = Array.from(conversationMap.values());
      logger.info(`Found ${conversations.length} conversations for query ${queryId}`);

      return conversations;
    } catch (error) {
      logger.error(`Error getting conversations for query ${queryId}:`, error);
      throw error;
    }
  }

  // Add this method to the QueryService class
  /**
   * Link query to an existing conversation message
   * @param {String} queryId - Query ID
   * @param {String} messageId - Message ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Link details
   */
  async linkQueryToMessage(queryId, messageId, options = {}) {
    try {
      logger.info(`Linking query ${queryId} to message ${messageId}`);

      // Ensure chat history service is set
      if (!this.chatHistoryService) {
        logger.error('Chat history service is not set');
        throw new Error('Chat history service is not set');
      }

      // Get message details to find the conversation
      const messageCursor = await this.db.query(`
      FOR msg IN messages
        FILTER msg._key == @messageId
        RETURN {
          _key: msg._key,
          conversationId: msg.conversationId
        }
    `, { messageId });

      const message = await messageCursor.next();

      if (!message) {
        logger.warn(`Message ${messageId} not found`);
        throw new Error('Message not found');
      }

      // Link the query to the conversation
      const link = await this.chatHistoryService.linkQueryToConversation(
        queryId,
        message.conversationId,
        messageId,
        {
          responseType: options.responseType || 'primary',
          confidenceScore: options.confidenceScore || 1.0
        }
      );

      logger.info(`Query ${queryId} linked to message ${messageId} in conversation ${message.conversationId}`);

      return link;
    } catch (error) {
      logger.error(`Error linking query ${queryId} to message ${messageId}:`, error);
      throw error;
    }
  }

}

module.exports = QueryService;