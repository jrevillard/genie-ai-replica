require('dotenv').config();
const axios = require('axios');
const { Database, aql } = require('arangojs');
const { v4: uuidv4 } = require('uuid');
const { logger, dbService } = require('../shared-lib');

class QueryService {
  constructor() {
    this.dbService = dbService; // Store the service reference instead of the promise
    this.db = null;
    this.queries = null;
    this.serviceCategories = null;
    this.services = null;
    this.analyticsService = null; // Will be set via dependency injection
    this.chatHistoryService = null; // Will be set via dependency injection
    this.initialized = false;
    logger.info('QueryService constructor called');
  }

  /**
   * Initialize the QueryService
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) {
      logger.debug('QueryService already initialized, skipping');
      return;
    }
    try {
      this.db = await this.dbService.getConnection('default');
      this.queries = this.db.collection('queries');
      this.serviceCategories = this.db.collection('serviceCategories');
      this.services = this.db.collection('services');
      this.initialized = true;
      logger.info('QueryService initialized successfully');
    } catch (error) {
      logger.error(`Error initializing QueryService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Set the analytics service
   * @param {Object} analyticsService - Analytics service instance
   */
  setAnalyticsService(analyticsService) {
    this.analyticsService = analyticsService;
    logger.info('QueryService.analytics_service_set');
  }

  /**
   * Set the chat history service
   * @param {Object} chatHistoryService - Chat history service instance
   */
  async setChatHistoryService(chatHistoryService) {
    this.chatHistoryService = chatHistoryService;
    logger.info('QueryService.chat_history_service_set');
  }

  /**
   * Create a new query
   * @param {Object} queryData - Query data
   * @returns {Promise<Object>} The created query
   */
  async createQuery(queryData) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.create_query_start', { dataLength: JSON.stringify(queryData).length });

      // Validate required fields
      let missingFields = [];
      if (!queryData.userId) missingFields.push('userId');
      if (!queryData.sessionId) missingFields.push('sessionId');

      // Determine context option: queryData > environment > default
      const validContextOptions = ['single-message', 'conversation-with-context-labels'];
      const contextOption = queryData.contextOption || process.env.CONTEXT_OPTION || 'single-message';
      if (!validContextOptions.includes(contextOption)) {
        logger.error('QueryService.invalid_context_option', { contextOption });
        throw new Error(`Invalid contextOption: ${contextOption}. Must be one of ${validContextOptions.join(', ')}.`);
      }

      // Validate input based on context option
      if (contextOption === 'single-message') {
        if (!queryData.text) missingFields.push('text');
      } else if (contextOption === 'conversation-with-context-labels') {
        if (!Array.isArray(queryData.messages) || queryData.messages.length === 0) {
          missingFields.push('messages');
        }
        if (!queryData.context || typeof queryData.context !== 'object') {
          missingFields.push('context');
        } else {
          if (!queryData.context.categoryLabel) missingFields.push('context.categoryLabel');
          if (!Array.isArray(queryData.context.serviceLabels)) missingFields.push('context.serviceLabels');
          // language is optional, default to 'EN'
        }
      }

      if (missingFields.length > 0) {
        logger.error('QueryService.missing_required_data', { missingFields: missingFields.join(', ') });
        throw new Error('Missing required query data');
      }

      // Create query document
      const basicQueryDoc = {
        userId: queryData.userId,
        sessionId: queryData.sessionId,
        timestamp: queryData.timestamp || new Date().toISOString(),
        isAnswered: queryData.isAnswered !== undefined ? queryData.isAnswered : false,
        categoryId: queryData.categoryId || null,
        serviceId: queryData.serviceId || null,
        responseTime: queryData.responseTime || 0,
        contextOption // Store the option used
      };

      // Add text or messages based on option
      if (contextOption === 'single-message') {
        basicQueryDoc.text = queryData.text;
      } else {
        basicQueryDoc.messages = queryData.messages;
        basicQueryDoc.context = queryData.context;
      }

      // Save query document
      logger.debug('QueryService.saving_query_document', { basicQueryDoc });
      const query = await this.queries.save(basicQueryDoc);
      const queryId = query._key;
      logger.info('QueryService.query_created', { queryId });

      // Call OPEA service
      const opeaHost = process.env.OPEA_HOST || 'e2e-109-198';
      const opeaPort = process.env.OPEA_PORT || '8888';
      const opeaUrl = `http://${opeaHost}:${opeaPort}/v1/chatqna`;

      let opeaPayload;
      if (contextOption === 'single-message') {
        opeaPayload = {
          messages: queryData.text,
          stream: false
        };
      } else {
        // For conversation-with-context-labels
        // If categoryId/serviceId provided and labels not in context, fetch them
        let categoryLabel = queryData.context.categoryLabel;
        let serviceLabels = queryData.context.serviceLabels;

        if (queryData.categoryId && !categoryLabel) {
          const categoryDoc = await this.serviceCategories.document(queryData.categoryId);
          categoryLabel = categoryDoc.name || categoryLabel;
        }

        if (queryData.serviceId && (!serviceLabels || serviceLabels.length === 0)) {
          const serviceDoc = await this.services.document(queryData.serviceId);
          serviceLabels = [serviceDoc.name] || serviceLabels;
        }

        opeaPayload = {
          messages: queryData.messages,
          context: {
            categoryLabel,
            serviceLabels,
            language: queryData.context.language || 'EN'
          },
          stream: false
        };
      }

      // Log OPEA configuration
      logger.info('QueryService.opea_config', { opeaHost, opeaPort, url: opeaUrl });
      logger.info('QueryService.preparing_opea_call', { queryId, payload: JSON.stringify(opeaPayload) });

      let opeaResponseContent = null;
      let opeaMetadata = null;
      let opeaResponseTime = 0;
      const opeaStartTime = Date.now();
      try {
        logger.info('QueryService.calling_opea_service', { queryId });
        const opeaResponse = await axios.post(opeaUrl, opeaPayload);
        opeaResponseTime = Date.now() - opeaStartTime;

        if (contextOption === 'single-message') {
          opeaResponseContent = opeaResponse.data.choices[0].message.content;
        } else {
          opeaResponseContent = opeaResponse.data.response;
          opeaMetadata = opeaResponse.data.metadata;
        }

        logger.info(`QueryService.opea_response_received for query ${queryId}: status=${opeaResponse.status}, data=${JSON.stringify(opeaResponse.data)}, duration=${opeaResponseTime}ms`);

        // Update query document with response content and time
        const updateData = {
          response: opeaResponseContent,
          responseTime: opeaResponseTime,
          isAnswered: true
        };
        if (contextOption === 'conversation-with-context-labels') {
          updateData.metadata = opeaMetadata;
        }
        await this.queries.update(queryId, updateData);
      } catch (error) {
        opeaResponseTime = Date.now() - opeaStartTime;
        logger.error(`QueryService.opea_service_error for query ${queryId}: ${error.message} (Status: ${error.response ? error.response.status : 'N/A'}, Duration: ${opeaResponseTime}ms)`);
        if (error.response) {
          logger.error(`OPEA service response details: ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
          logger.error('No response received from OPEA service - possible network or timeout issue');
        } else {
          logger.error('Error setting up OPEA service request - check configuration');
        }
        // Optionally set a default response or handle the error gracefully
        await this.queries.update(queryId, {
          response: 'Error: Unable to retrieve response from OPEA service',
          responseTime: opeaResponseTime,
          isAnswered: false
        });
      }

      // Record analytics if available
      if (this.analyticsService) {
        try {
          logger.debug('QueryService.recording_analytics', { queryId });
          const analyticsData = {
            _key: queryId,
            userId: queryData.userId,
            sessionId: queryData.sessionId,
            responseTime: opeaResponseTime,
            isAnswered: opeaResponseContent !== null
          };
          if (contextOption === 'single-message') {
            analyticsData.text = queryData.text;
          } else {
            analyticsData.messages = queryData.messages;
            analyticsData.context = queryData.context;
          }
          analyticsData.categoryId = queryData.categoryId || null;
          analyticsData.serviceId = queryData.serviceId || null;
          await this.analyticsService.recordQuery(analyticsData);
          logger.info('QueryService.analytics_recorded', { queryId });
        } catch (error) {
          logger.error('QueryService.record_analytics_failed', { queryId, error: error.message });
        }
      }

      // Return the final query document
      const finalQuery = await this.queries.document(queryId);
      logger.info('QueryService.query_created_success', {
        queryId,
        durationMs: Date.now() - startTime
      });
      return finalQuery;
    } catch (error) {
      logger.error('QueryService.create_query_failed', {
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });

      // Debug collection properties if schema error occurs
      if (error.message.includes('schema')) {
        try {
          const collProperties = await this.queries.properties();
          logger.debug('QueryService.collection_properties', { properties: collProperties });
        } catch (propsError) {
          logger.error('QueryService.get_collection_properties_failed', { error: propsError.message });
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
    const startTime = Date.now();
    try {
      logger.info('QueryService.add_feedback_start', { queryId });

      // Ensure feedback has required fields
      if (feedback.rating === undefined) {
        logger.warn('QueryService.feedback_rating_required', { queryId });
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
          logger.info('QueryService.analytics_feedback_updated', { queryId });
        } catch (error) {
          logger.error('QueryService.update_analytics_feedback_failed', {
            queryId,
            error: error.message
          });
          // Continue even if analytics update fails
        }
      }

      logger.info('QueryService.feedback_added', {
        queryId,
        durationMs: Date.now() - startTime
      });
      return updatedQuery.new;
    } catch (error) {
      logger.error('QueryService.add_feedback_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Get a query by ID
   * @param {String} queryId - Query ID
   * @returns {Promise<Object>} The query
   */
  async getQuery(queryId) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.get_query_start', { queryId });
      const query = await this.queries.document(queryId);
      logger.info('QueryService.query_retrieved', {
        queryId,
        durationMs: Date.now() - startTime
      });
      return query;
    } catch (error) {
      logger.error('QueryService.get_query_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
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
    const startTime = Date.now();
    try {
      logger.info('QueryService.mark_as_answered_start', { queryId, responseTime });
      const updatedQuery = await this.queries.update(queryId, {
        isAnswered: true,
        responseTime
      }, { returnNew: true });

      logger.info('QueryService.query_marked_answered', {
        queryId,
        durationMs: Date.now() - startTime
      });
      return updatedQuery.new;
    } catch (error) {
      logger.error('QueryService.mark_as_answered_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Update the response time for a query
   * @param {String} queryId - Query ID
   * @param {Number} responseTime - Response time in milliseconds
   * @returns {Promise<Object>} The updated query
   */
  async updateQueryResponseTime(queryId, responseTime) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.update_query_response_time_start', { queryId, responseTime });

      // Validate responseTime
      if (typeof responseTime !== 'number' || responseTime < 0) {
        logger.warn('QueryService.invalid_response_time', { queryId, responseTime });
        throw new Error('Invalid response time');
      }

      // Update the query with response time
      const updatedQuery = await this.queries.update(queryId, {
        responseTime,
        updatedAt: new Date().toISOString()
      }, { returnNew: true });

      logger.info('QueryService.query_response_time_updated', {
        queryId,
        durationMs: Date.now() - startTime
      });
      return updatedQuery.new;
    } catch (error) {
      logger.error('QueryService.update_query_response_time_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
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
    const startTime = Date.now();
    try {
      logger.info('QueryService.set_query_category_start', { queryId, categoryId, serviceId });

      // Update the query with category and service
      const updateData = { categoryId };
      if (serviceId) {
        updateData.serviceId = serviceId;
      }

      const updatedQuery = await this.queries.update(queryId, updateData, { returnNew: true });

      // Update or create edge between query and category
      try {
        const edgeCursor = await this.db.query(aql`
          FOR edge IN queryCategories
            FILTER edge._from == ${'queries/' + queryId}
            RETURN edge
        `);

        const existingEdge = await edgeCursor.next();

        if (existingEdge) {
          logger.debug('QueryService.updating_query_category_edge', { queryId });
          await this.db.collection('queryCategories').update(existingEdge._key, {
            _to: `serviceCategories/${categoryId}`,
            updatedAt: new Date().toISOString()
          });
        } else {
          logger.debug('QueryService.creating_query_category_edge', { queryId });
          await this.db.collection('queryCategories').save({
            _from: `queries/${queryId}`,
            _to: `serviceCategories/${categoryId}`,
            createdAt: new Date().toISOString()
          });
        }
      } catch (error) {
        logger.error('QueryService.update_query_category_edge_failed', {
          queryId,
          error: error.message
        });
        // Continue even if edge update fails
      }

      logger.info('QueryService.category_set', {
        queryId,
        durationMs: Date.now() - startTime
      });
      return updatedQuery.new;
    } catch (error) {
      logger.error('QueryService.set_query_category_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
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
    const startTime = Date.now();
    try {
      logger.info('QueryService.search_queries_start', { criteria, limit, offset });

      let filterConditions = [];

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

      let filterQuery;
      if (filterConditions.length > 0) {
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

      const query = aql`
        FOR q IN queries
          ${filterQuery}
          SORT q.timestamp DESC
          LIMIT ${offset}, ${limit}
          RETURN q
      `;

      const cursor = await this.db.query(query);
      const queries = await cursor.all();

      const countQuery = aql`
        FOR q IN queries
          ${filterQuery}
          COLLECT WITH COUNT INTO total
          RETURN total
      `;
      const countCursor = await this.db.query(countQuery);
      const totalCount = await countCursor.next() || 0;

      logger.info('QueryService.search_queries_completed', {
        resultCount: queries.length,
        totalCount,
        durationMs: Date.now() - startTime
      });
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
      logger.error('QueryService.search_queries_failed', {
        criteria,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Delete a query
   * @param {String} queryId - Query ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteQuery(queryId) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.delete_query_start', { queryId });

      // Delete edges connected to the query
      try {
        await this.db.query(aql`
          FOR edge IN sessionQueries
            FILTER edge._to == ${'queries/' + queryId}
            REMOVE edge IN sessionQueries
        `);

        await this.db.query(aql`
          FOR edge IN queryCategories
            FILTER edge._from == ${'queries/' + queryId}
            REMOVE edge IN queryCategories
        `);
        logger.info('QueryService.edges_deleted', { queryId });
      } catch (error) {
        logger.error('QueryService.delete_edges_failed', {
          queryId,
          error: error.message
        });
        // Continue even if edge deletion fails
      }

      const result = await this.queries.remove(queryId);
      logger.info('QueryService.query_deleted', {
        queryId,
        durationMs: Date.now() - startTime
      });
      return result;
    } catch (error) {
      logger.error('QueryService.delete_query_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
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
    const startTime = Date.now();
    try {
      logger.info('QueryService.get_similar_queries_start', { queryText });

      const lowerQueryText = queryText.toLowerCase();
      const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'by'];
      const words = lowerQueryText.split(/\s+/).filter(word =>
        word.length > 2 && !stopWords.includes(word)
      );

      if (words.length === 0) {
        logger.info('QueryService.no_significant_words', { queryText });
        return [];
      }

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
      logger.info('QueryService.similar_queries_found', {
        count: similarQueries.length,
        durationMs: Date.now() - startTime
      });
      return similarQueries;
    } catch (error) {
      logger.error('QueryService.get_similar_queries_failed', {
        queryText,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      return [];
    }
  }

  /**
   * Save a query with its criteria for future recall
   * @param {Object} queryData - Query data with criteria
   * @returns {Promise<Object>} The saved query
   */
  async saveQueryWithCriteria(queryData) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.save_query_with_criteria_start', { dataLength: JSON.stringify(queryData).length });

      if (!queryData.userId || !queryData.text) {
        logger.warn('QueryService.missing_required_data', { queryData });
        throw new Error('Missing required query data');
      }

      const basicQueryDoc = {
        userId: queryData.userId,
        text: queryData.text,
        timestamp: queryData.timestamp || new Date().toISOString()
      };

      if (queryData.categoryId) basicQueryDoc.categoryId = queryData.categoryId;
      if (queryData.serviceId) basicQueryDoc.serviceId = queryData.serviceId;

      basicQueryDoc.metadata = {
        criteria: queryData.criteria || '',
        tags: Array.isArray(queryData.tags) ? queryData.tags : [],
        isSaved: true,
        name: queryData.name || `Query ${new Date().toISOString()}`,
        description: queryData.description || ''
      };

      logger.debug('QueryService.saving_query_with_criteria', { basicQueryDoc });
      const query = await this.queries.save(basicQueryDoc);
      logger.info('QueryService.query_saved', {
        queryId: query._key,
        durationMs: Date.now() - startTime
      });

      return query;
    } catch (error) {
      logger.error('QueryService.save_query_with_criteria_failed', {
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
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
    const startTime = Date.now();
    try {
      logger.info('QueryService.get_saved_queries_start', { userId });

      const query = aql`
        FOR q IN queries
          FILTER q.userId == ${userId}
          FILTER q.metadata.isSaved == true
          SORT q.timestamp DESC
          LIMIT ${offset}, ${limit}
          RETURN q
      `;

      const cursor = await this.db.query(query);
      const queries = await cursor.all();

      const countQuery = aql`
        FOR q IN queries
          FILTER q.userId == ${userId}
          FILTER q.metadata.isSaved == true
          COLLECT WITH COUNT INTO total
          RETURN total
      `;
      const countCursor = await this.db.query(countQuery);
      const totalCount = await countCursor.next() || 0;

      logger.info('QueryService.saved_queries_retrieved', {
        userId,
        count: queries.length,
        totalCount,
        durationMs: Date.now() - startTime
      });
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
      logger.error('QueryService.get_saved_queries_failed', {
        userId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
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
    const startTime = Date.now();
    try {
      logger.info('QueryService.get_query_recommendations_start', { userId });

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
        logger.info('QueryService.no_recent_queries', { userId });
        const popularQueries = await this.getPopularQueries(limit);
        return popularQueries.map(q => q.text);
      }

      const categories = recentQueries
        .filter(q => q.categoryId)
        .map(q => q.categoryId);

      const services = recentQueries
        .filter(q => q.serviceId)
        .map(q => q.serviceId);

      if (categories.length === 0 && services.length === 0) {
        logger.info('QueryService.no_categories_or_services', { userId });
        const popularQueries = await this.getPopularQueries(limit);
        return popularQueries.map(q => q.text);
      }

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

      if (recommendations.length < limit) {
        logger.info('QueryService.insufficient_recommendations', {
          count: recommendations.length,
          limit
        });
        const popularQueries = await this.getPopularQueries(limit - recommendations.length);
        return [...recommendations, ...popularQueries.map(q => q.text)];
      }

      logger.info('QueryService.query_recommendations_found', {
        userId,
        count: recommendations.length,
        durationMs: Date.now() - startTime
      });
      return recommendations;
    } catch (error) {
      logger.error('QueryService.get_query_recommendations_failed', {
        userId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      return await this.getPopularQueries(limit).then(queries => queries.map(q => q.text));
    }
  }

  /**
   * Get popular queries
   * @param {Number} limit - Maximum number of queries to return
   * @returns {Promise<Array>} Popular queries
   */
  async getPopularQueries(limit = 5) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.get_popular_queries_start');
      const query = aql`
        FOR q IN queries
          COLLECT text = q.text WITH COUNT INTO count
          SORT count DESC
          LIMIT ${limit}
          RETURN { text, count }
      `;

      const cursor = await this.db.query(query);
      const popularQueries = await cursor.all();
      logger.info('QueryService.popular_queries_found', {
        count: popularQueries.length,
        durationMs: Date.now() - startTime
      });
      return popularQueries;
    } catch (error) {
      logger.error('QueryService.get_popular_queries_failed', {
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      return [];
    }
  }

  /**
   * Create a conversation from a query
   * @param {String} queryId - Query ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Created conversation data
   */
  async createConversationFromQuery(queryId, options = {}) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.create_conversation_from_query_start', { queryId });

      if (!this.chatHistoryService) {
        logger.error('QueryService.chat_history_service_not_set');
        throw new Error('Chat history service is not set');
      }

      const query = await this.getQuery(queryId);

      if (!query) {
        logger.warn('QueryService.query_not_found', { queryId });
        throw new Error('Query not found');
      }

      const conversation = await this.chatHistoryService.createConversationFromQuery(
        queryId,
        query.userId,
        {
          title: options.title || query.text,
          responseText: options.responseText,
          tags: options.tags || []
        }
      );

      logger.info('QueryService.conversation_created', {
        queryId,
        conversationId: conversation.conversation._key,
        durationMs: Date.now() - startTime
      });
      return conversation;
    } catch (error) {
      logger.error('QueryService.create_conversation_from_query_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Get conversations for a query
   * @param {String} queryId - Query ID
   * @returns {Promise<Array>} Conversations associated with the query
   */
  async getConversationsForQuery(queryId) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.get_conversations_for_query_start', { queryId });

      if (!this.chatHistoryService) {
        logger.error('QueryService.chat_history_service_not_set');
        throw new Error('Chat history service is not set');
      }

      const relatedMessages = await this.chatHistoryService.findMessagesForQuery(queryId);

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
      logger.info('QueryService.conversations_found', {
        queryId,
        count: conversations.length,
        durationMs: Date.now() - startTime
      });
      return conversations;
    } catch (error) {
      logger.error('QueryService.get_conversations_for_query_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
 * Mark a query as answered
 * @param {String} queryId - Query ID
 * @param {Number} responseTime - Response time in milliseconds
 * @returns {Promise<Object>} Updated query
 */
  async markQueryAsAnswered(queryId, responseTime) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.mark_query_as_answered_start', { queryId, responseTime });

      const updateData = {
        isAnswered: true,
        responseTime,
        updatedAt: new Date().toISOString()
      };

      const updatedQuery = await this.queries.update(queryId, updateData);

      logger.info('QueryService.query_marked_as_answered', {
        queryId,
        responseTime,
        durationMs: Date.now() - startTime
      });

      return updatedQuery;
    } catch (error) {
      logger.error('QueryService.mark_query_as_answered_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });

      if (error.name === 'ArangoError' && error.errorNum === 1202) {
        throw new Error('Query not found');
      }

      throw error;
    }
  }

  /**
   * Link query to an existing conversation message
   * @param {String} queryId - Query ID
   * @param {String} messageId - Message ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Link details
   */
  async linkQueryToMessage(queryId, messageId, options = {}) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.link_query_to_message_start', { queryId, messageId });

      if (!this.chatHistoryService) {
        logger.error('QueryService.chat_history_service_not_set');
        throw new Error('Chat history service is not set');
      }

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
        logger.warn('QueryService.message_not_found', { messageId });
        throw new Error('Message not found');
      }

      const link = await this.chatHistoryService.linkQueryToConversation(
        queryId,
        message.conversationId,
        messageId,
        {
          responseType: options.responseType || 'primary',
          confidenceScore: options.confidenceScore || 1.0
        }
      );

      logger.info('QueryService.query_linked_to_message', {
        queryId,
        messageId,
        conversationId: message.conversationId,
        durationMs: Date.now() - startTime
      });
      return link;
    } catch (error) {
      logger.error('QueryService.link_query_to_message_failed', {
        queryId,
        messageId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }
}

// Singleton instance
const instance = new QueryService();
module.exports = instance;