// query-service.js
require('dotenv').config();
const { Database, aql } = require('arangojs');
const { v4: uuidv4 } = require('uuid');

// Initialize ArangoDB connection
const dbService = require('../utils/db-connect-service');

const initDB = dbService.getConnection();


class QueryService {
  constructor() {
    this.db = initDB;
    this.queries = this.db.collection('queries');
    this.serviceCategories = this.db.collection('serviceCategories');
    this.services = this.db.collection('services');
    this.analyticsService = null; // Will be set via dependency injection
  }

  /**
   * Set the analytics service
   * @param {Object} analyticsService - Analytics service instance
   */
  setAnalyticsService(analyticsService) {
    this.analyticsService = analyticsService;
  }

  /**
   * Create a new query
   * @param {Object} queryData - Query data
   * @returns {Promise<Object>} The created query
   */
  async createQuery(queryData) {
    try {
      // Ensure minimum required data
      if (!queryData.userId || !queryData.sessionId || !queryData.text) {
        throw new Error('Missing required query data');
      }

      // Create basic query document - let ArangoDB generate the key
      const basicQueryDoc = {
        userId: queryData.userId,
        sessionId: queryData.sessionId,
        text: queryData.text,
        timestamp: queryData.timestamp || new Date().toISOString(),
        isAnswered: false
      };
      
      console.log('Creating basic query document...');
      const query = await this.queries.save(basicQueryDoc);
      const queryId = query._key;
      console.log(`Query created with auto-generated key: ${queryId}`);
      
      // Now add additional data if needed
      const updateData = {};
      
      if (queryData.categoryId) updateData.categoryId = queryData.categoryId;
      if (queryData.serviceId) updateData.serviceId = queryData.serviceId;
      if (queryData.responseTime) updateData.responseTime = queryData.responseTime;
      if (queryData.isAnswered !== undefined) updateData.isAnswered = queryData.isAnswered;
      
      // Add metadata
      if (queryData.criteria || queryData.tags) {
        updateData.metadata = {
          criteria: queryData.criteria || '',
          tags: Array.isArray(queryData.tags) ? queryData.tags : []
        };
      }
      
      // Update with additional data if needed
      if (Object.keys(updateData).length > 0) {
        console.log(`Updating query ${queryId} with additional data...`);
        await this.queries.update(queryId, updateData);
      }

      // Create edge between session and query
      if (queryData.sessionId) {
        try {
          console.log(`Creating edge between session ${queryData.sessionId} and query ${queryId}`);
          await this.db.collection('sessionQueries').save({
            _from: `sessions/${queryData.sessionId}`,
            _to: `queries/${queryId}`,
            createdAt: new Date().toISOString()
          });
        } catch (err) {
          // Ignore duplicate key errors
          if (err.errorNum !== 1210) console.error('Error creating session-query edge:', err);
        }
      }

      // Create edge between query and category (if provided)
      if (queryData.categoryId) {
        try {
          console.log(`Creating edge between query ${queryId} and category ${queryData.categoryId}`);
          await this.db.collection('queryCategories').save({
            _from: `queries/${queryId}`,
            _to: `serviceCategories/${queryData.categoryId}`,
            confidence: queryData.confidence || 1.0
          });
        } catch (err) {
          // Ignore duplicate key errors
          if (err.errorNum !== 1210) console.error('Error creating query-category edge:', err);
        }
      }

      // Update analytics if service is set
      if (this.analyticsService) {
        try {
          await this.analyticsService.recordQuery({
            ...query,
            ...updateData
          });
        } catch (error) {
          console.error('Error updating analytics:', error);
          // Continue even if analytics update fails
        }
      }

      // Return the complete query document
      return await this.queries.document(queryId);
    } catch (error) {
      console.error('Error creating query:', error);
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
      // Ensure feedback has required fields
      if (feedback.rating === undefined) {
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
        } catch (error) {
          console.error('Error updating analytics with feedback:', error);
          // Continue even if analytics update fails
        }
      }

      return updatedQuery.new;
    } catch (error) {
      console.error(`Error adding feedback to query ${queryId}:`, error);
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
      return await this.queries.document(queryId);
    } catch (error) {
      console.error(`Error getting query ${queryId}:`, error);
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
      const updatedQuery = await this.queries.update(queryId, {
        isAnswered: true,
        responseTime
      }, { returnNew: true });

      return updatedQuery.new;
    } catch (error) {
      console.error(`Error marking query ${queryId} as answered:`, error);
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
          await this.db.collection('queryCategories').update(existingEdge._key, {
            _to: `serviceCategories/${categoryId}`,
            updatedAt: new Date().toISOString()
          });
        } else {
          // Create new edge
          await this.db.collection('queryCategories').save({
            _from: `queries/${queryId}`,
            _to: `serviceCategories/${categoryId}`,
            createdAt: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error(`Error updating query-category edge for query ${queryId}:`, error);
        // Continue even if edge update fails
      }

      return updatedQuery.new;
    } catch (error) {
      console.error(`Error setting category for query ${queryId}:`, error);
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
      console.error('Error searching queries:', error);
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
      } catch (error) {
        console.error(`Error deleting edges for query ${queryId}:`, error);
        // Continue even if edge deletion fails
      }

      // Delete the query document
      return await this.queries.remove(queryId);
    } catch (error) {
      console.error(`Error deleting query ${queryId}:`, error);
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
      return await cursor.all();
    } catch (error) {
      console.error(`Error finding similar queries for "${queryText}":`, error);
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
      // Ensure minimum required data
      if (!queryData.userId || !queryData.text) {
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
      
      console.log('Saving query with criteria...');
      const query = await this.queries.save(basicQueryDoc);
      console.log(`Query saved with auto-generated key: ${query._key}`);
      
      return query;
    } catch (error) {
      console.error('Error saving query with criteria:', error);
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
      console.error(`Error getting saved queries for user ${userId}:`, error);
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
        // If no recent queries, return popular queries
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
        const popularQueries = await this.getPopularQueries(limit - recommendations.length);
        return [...recommendations, ...popularQueries.map(q => q.text)];
      }
      
      return recommendations;
    } catch (error) {
      console.error(`Error getting query recommendations for user ${userId}:`, error);
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
      const query = aql`
        FOR q IN queries
          COLLECT text = q.text WITH COUNT INTO count
          SORT count DESC
          LIMIT ${limit}
          RETURN { text, count }
      `;
      
      const cursor = await this.db.query(query);
      return await cursor.all();
    } catch (error) {
      console.error(`Error getting popular queries:`, error);
      return [];
    }
  }
}

module.exports = QueryService;