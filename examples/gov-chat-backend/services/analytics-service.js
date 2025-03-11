// analytics-service.js
require('dotenv').config();
const { Database, aql } = require('arangojs');
const { v4: uuidv4 } = require('uuid');

// Initialize ArangoDB connection
const initDB = () => {
  const db = new Database({
    url: process.env.ARANGO_URL || 'http://localhost:8529',
    databaseName: process.env.ARANGO_DB || 'node-services',
    auth: {
      username: process.env.ARANGO_USERNAME || 'root',
      password: process.env.ARANGO_PASSWORD || 'test'
    }
  });

  return db;
};

class AnalyticsService {
  constructor() {
    this.db = initDB();
    this.analytics = this.db.collection('analytics');
    this.events = this.db.collection('events');
    this.queriesCollection = this.db.collection('queries');
    this.usersCollection = this.db.collection('users');
    this.sessionsCollection = this.db.collection('sessions');
    
    // Initialize collections
    this.initialize().catch(err => console.error('Error initializing collections:', err));
  }

  /**
   * Initialize collections if they don't exist
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Check if collections exist and create them if they don't
      const collections = await this.db.listCollections();
      const collectionNames = collections.map(c => c.name);
      
      // Function to create a collection if it doesn't exist
      const ensureCollection = async (name) => {
        if (!collectionNames.includes(name)) {
          console.log(`Creating ${name} collection...`);
          try {
            await this.db.createCollection(name);
            console.log(`Created ${name} collection successfully`);
          } catch (err) {
            // If collection was created in the meantime, ignore the error
            if (err.errorNum !== 1207) { // 1207 is "duplicate name" error
              throw err;
            }
          }
        }
      };
      
      // Ensure all required collections exist
      await ensureCollection('analytics');
      await ensureCollection('events');
      
      // Update local references to ensure they're valid
      this.analytics = this.db.collection('analytics');
      this.events = this.db.collection('events');
      
      console.log('Collections initialized successfully');
    } catch (error) {
      console.error('Error initializing collections:', error);
      // Don't throw here, log the error but allow service to continue
    }
  }

  /**
   * Record a query in analytics
   * @param {Object} queryDoc - Query document
   * @returns {Promise<Object>} The created analytics record
   */
  async recordQuery(queryDoc) {
    try {
      // Create analytics document without specifying a key - let ArangoDB auto-generate it
      const analyticsDoc = {
        type: 'query',
        queryId: queryDoc._key,
        userId: queryDoc.userId,
        sessionId: queryDoc.sessionId,
        timestamp: new Date().toISOString(),
        data: {
          text: queryDoc.text,
          categoryId: queryDoc.categoryId,
          serviceId: queryDoc.serviceId,
          responseTime: queryDoc.responseTime || 0,
          isAnswered: queryDoc.isAnswered || false
        }
      };

      console.log('Recording query analytics...');
      const record = await this.analytics.save(analyticsDoc);
      console.log(`Analytics record created with auto-generated key: ${record._key}`);
      
      return record;
    } catch (error) {
      console.error('Error recording query analytics:', error);
      throw error;
    }
  }

  /**
   * Record feedback in analytics
   * @param {String} queryId - Query ID
   * @param {Object} feedback - Feedback data
   * @returns {Promise<Object>} The created analytics record
   */
  async recordFeedback(queryId, feedback) {
    try {
      // Create feedback document without specifying a key - let ArangoDB auto-generate it
      const analyticsDoc = {
        type: 'feedback',
        queryId: queryId,
        timestamp: new Date().toISOString(),
        data: feedback
      };

      console.log('Recording feedback analytics...');
      const record = await this.analytics.save(analyticsDoc);
      console.log(`Feedback record created with auto-generated key: ${record._key}`);
      
      return record;
    } catch (error) {
      console.error('Error recording feedback analytics:', error);
      throw error;
    }
  }

  /**
   * Track an event
   * @param {String} userId - User ID
   * @param {String} eventType - Event type
   * @param {Object} eventData - Event data
   * @returns {Promise<Object>} The created event
   */
  async trackEvent(userId, eventType, eventData = {}) {
    try {
      // Ensure the events collection exists
      await this.initialize();
      
      // Create event document without specifying a key - let ArangoDB auto-generate it
      const eventDoc = {
        userId,
        eventType,
        timestamp: new Date().toISOString(),
        data: eventData
      };

      console.log('Tracking event...');
      const event = await this.events.save(eventDoc);
      console.log(`Event created with auto-generated key: ${event._key}`);
      
      return event;
    } catch (error) {
      console.error('Error tracking event:', error);
      throw error;
    }
  }

  /**
   * Get analytics for dashboard
   * @param {String} startDate - Start date (ISO string)
   * @param {String} endDate - End date (ISO string)
   * @returns {Promise<Object>} Dashboard analytics
   */
  async getDashboardAnalytics(startDate, endDate) {
    try {
      const query = aql`
        LET queryCount = (
          FOR a IN analytics
            FILTER a.type == 'query'
            FILTER a.timestamp >= ${startDate} && a.timestamp <= ${endDate}
            COLLECT WITH COUNT INTO count
            RETURN count
        )[0]
        
        LET unansweredCount = (
          FOR a IN analytics
            FILTER a.type == 'query'
            FILTER a.timestamp >= ${startDate} && a.timestamp <= ${endDate}
            FILTER a.data.isAnswered == false
            COLLECT WITH COUNT INTO count
            RETURN count
        )[0]
        
        LET avgResponseTime = (
          FOR a IN analytics
            FILTER a.type == 'query'
            FILTER a.timestamp >= ${startDate} && a.timestamp <= ${endDate}
            FILTER a.data.responseTime > 0
            COLLECT AGGREGATE avgTime = AVG(a.data.responseTime)
            RETURN avgTime
        )[0]
        
        LET categoryDistribution = (
          FOR a IN analytics
            FILTER a.type == 'query'
            FILTER a.timestamp >= ${startDate} && a.timestamp <= ${endDate}
            FILTER a.data.categoryId != null
            COLLECT categoryId = a.data.categoryId WITH COUNT INTO count
            LET category = DOCUMENT(CONCAT('serviceCategories/', categoryId))
            RETURN {
              categoryId,
              name: category.nameEN || category._key,
              count
            }
        )
        
        LET feedbackStats = (
          LET feedbacks = (
            FOR a IN analytics
              FILTER a.type == 'feedback'
              FILTER a.timestamp >= ${startDate} && a.timestamp <= ${endDate}
              RETURN a
          )
          
          LET totalFeedback = LENGTH(feedbacks)
          LET positiveCount = (
            FOR f IN feedbacks
              FILTER f.data.rating >= 4
              COLLECT WITH COUNT INTO count
              RETURN count
          )[0] || 0
          
          LET negativeCount = (
            FOR f IN feedbacks
              FILTER f.data.rating <= 2
              COLLECT WITH COUNT INTO count
              RETURN count
          )[0] || 0
          
          LET neutralCount = totalFeedback - positiveCount - negativeCount
          
          RETURN {
            total: totalFeedback,
            positive: positiveCount,
            neutral: neutralCount,
            negative: negativeCount,
            positivePercentage: totalFeedback > 0 ? (positiveCount / totalFeedback) * 100 : 0,
            negativePercentage: totalFeedback > 0 ? (negativeCount / totalFeedback) * 100 : 0
          }
        )
        
        LET userStats = (
          LET activeUsers = (
            FOR a IN analytics
              FILTER a.type == 'query'
              FILTER a.timestamp >= ${startDate} && a.timestamp <= ${endDate}
              COLLECT userId = a.userId
              RETURN userId
          )
          
          RETURN {
            activeCount: LENGTH(activeUsers)
          }
        )
        
        RETURN {
          queries: {
            total: queryCount,
            unanswered: unansweredCount,
            answeredPercentage: queryCount > 0 ? ((queryCount - unansweredCount) / queryCount) * 100 : 0,
            avgResponseTime
          },
          categories: categoryDistribution,
          feedback: feedbackStats,
          users: userStats
        }
      `;
      
      const cursor = await this.db.query(query);
      return await cursor.next() || {
        queries: { total: 0, unanswered: 0, answeredPercentage: 0, avgResponseTime: null },
        categories: [],
        feedback: [{ total: 0, positive: 0, neutral: 0, negative: 0, positivePercentage: 0, negativePercentage: 0 }],
        users: [{ activeCount: 0 }]
      };
    } catch (error) {
      console.error('Error getting dashboard analytics:', error);
      throw error;
    }
  }

  /**
   * Get general analytics
   * @param {Object} filters - Filters to apply
   * @param {String} startDate - Start date (ISO string)
   * @param {String} endDate - End date (ISO string)
   * @returns {Promise<Object>} General analytics data
   */
  async getAnalytics(filters = {}, startDate, endDate) {
    try {
      // Ensure we have valid dates
      const validStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // Default to 30 days ago
      const validEndDate = endDate || new Date().toISOString(); // Default to now

      // First make sure the collections exist
      await this.initialize();

      // Build a simple query that avoids complex filter building
      const query = `
        FOR a IN analytics
          FILTER a.timestamp >= @startDate
          FILTER a.timestamp <= @endDate
          ${filters && filters.type ? 'FILTER a.type == @type' : ''}
          ${filters && filters.userId ? 'FILTER a.userId == @userId' : ''}
          ${filters && filters.categoryId ? 'FILTER a.data.categoryId == @categoryId' : ''}
          ${filters && filters.serviceId ? 'FILTER a.data.serviceId == @serviceId' : ''}
          SORT a.timestamp DESC
          LIMIT 1000
          RETURN a
      `;
      
      // Prepare bind variables - always include dates
      const bindVars = {
        startDate: validStartDate,
        endDate: validEndDate
      };
      
      // Add optional filter values only if they exist
      if (filters) {
        if (filters.type) bindVars.type = filters.type;
        if (filters.userId) bindVars.userId = filters.userId;
        if (filters.categoryId) bindVars.categoryId = filters.categoryId;
        if (filters.serviceId) bindVars.serviceId = filters.serviceId;
      }
      
      console.log('Executing analytics query with bind vars:', JSON.stringify(bindVars));
      
      // Execute the query using string template with bind variables
      const cursor = await this.db.query(query, bindVars);
      const analyticsData = await cursor.all();
      
      // Process the data for different analytics types
      const processedData = {
        queryCount: 0,
        feedbackCount: 0,
        avgRating: 0,
        timeDistribution: {},
        categoryDistribution: {},
        raw: analyticsData
      };
      
      // Count queries and feedback
      const queryData = analyticsData.filter(a => a && a.type === 'query');
      const feedbackData = analyticsData.filter(a => a && a.type === 'feedback');
      
      processedData.queryCount = queryData.length;
      processedData.feedbackCount = feedbackData.length;
      
      // Calculate average rating if there is feedback
      if (feedbackData.length > 0) {
        let totalRating = 0;
        let ratingCount = 0;
        
        for (const item of feedbackData) {
          if (item.data && typeof item.data.rating === 'number') {
            totalRating += item.data.rating;
            ratingCount++;
          }
        }
        
        processedData.avgRating = ratingCount > 0 ? totalRating / ratingCount : 0;
      }
      
      // Calculate time distribution (by hour)
      for (const item of analyticsData) {
        if (item && item.timestamp) {
          try {
            const hour = new Date(item.timestamp).getHours();
            if (!isNaN(hour)) {
              processedData.timeDistribution[hour] = (processedData.timeDistribution[hour] || 0) + 1;
            }
          } catch (err) {
            // Skip invalid timestamps
            console.error('Invalid timestamp in analytics item:', item.timestamp);
          }
        }
      }
      
      // Calculate category distribution
      for (const item of queryData) {
        if (item && item.data && item.data.categoryId) {
          const catId = item.data.categoryId;
          processedData.categoryDistribution[catId] = (processedData.categoryDistribution[catId] || 0) + 1;
        }
      }
      
      return processedData;
    } catch (error) {
      console.error('Error getting analytics:', error);
      throw error;
    }
  }
}

module.exports = AnalyticsService;