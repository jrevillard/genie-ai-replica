// analytics-service.js
const { Database, aql } = require('arangojs');

// Initialize ArangoDB connection
const initDB = () => {
  const db = new Database({
    url: process.env.ARANGO_URL || 'http://localhost:8529',
    databaseName: process.env.ARANGO_DB || 'chatbot_analytics',
    auth: {
      username: process.env.ARANGO_USERNAME || 'root',
      password: process.env.ARANGO_PASSWORD || ''
    }
  });

  return db;
};

class AnalyticsService {
  constructor() {
    this.db = initDB();
    this.queries = this.db.collection('queries');
    this.users = this.db.collection('users');
    this.sessions = this.db.collection('sessions');
    this.analytics = this.db.collection('analytics');
    this.serviceCategories = this.db.collection('serviceCategories');
  }

  /**
   * Record a new chatbot query and update analytics
   * @param {Object} queryData - The query data to record
   * @returns {Promise<Object>} The recorded query document
   */
  async recordQuery(queryData) {
    try {
      // Ensure we have minimum required data
      if (!queryData.userId || !queryData.sessionId || !queryData.text) {
        throw new Error('Missing required query data');
      }

      // Create query document with timestamp and response time
      const queryDoc = {
        _key: `query_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        userId: queryData.userId,
        sessionId: queryData.sessionId,
        text: queryData.text,
        timestamp: new Date().toISOString(),
        responseTime: queryData.responseTime || 0,
        categoryId: queryData.categoryId || null,
        serviceId: queryData.serviceId || null,
        isAnswered: queryData.isAnswered || true,
        metadata: {
          criteria: queryData.criteria || '',
          tags: queryData.tags || []
        }
      };

      // Save the query document
      const query = await this.queries.save(queryDoc);
      
      // Create edge between session and query if not exists
      await this.db.collection('sessionQueries').save({
        _from: `sessions/${queryData.sessionId}`,
        _to: `queries/${query._key}`,
        createdAt: new Date().toISOString()
      }).catch(err => {
        // Ignore duplicate key errors
        if (err.errorNum !== 1210) throw err;
      });

      // If categoryId is provided, create edge between query and category
      if (queryData.categoryId) {
        await this.db.collection('queryCategories').save({
          _from: `queries/${query._key}`,
          _to: `serviceCategories/${queryData.categoryId}`,
          confidence: queryData.confidence || 1.0
        }).catch(err => {
          // Ignore duplicate key errors
          if (err.errorNum !== 1210) throw err;
        });
      }

      // Update the real-time analytics for today
      await this.updateDailyAnalytics();

      return query;
    } catch (error) {
      console.error('Error recording query:', error);
      throw error;
    }
  }

  /**
   * Record user feedback for a specific query
   * @param {String} queryId - The ID of the query
   * @param {Object} feedback - The feedback object
   * @returns {Promise<Object>} The updated query document
   */
  async recordFeedback(queryId, feedback) {
    try {
      // Ensure feedback has required fields
      if (!feedback.rating) {
        throw new Error('Feedback rating is required');
      }

      // Update the query document with feedback
      const userFeedback = {
        rating: feedback.rating,
        comment: feedback.comment || '',
        providedAt: new Date().toISOString()
      };

      // Update the query with feedback
      const updatedQuery = await this.queries.update(queryId, {
        userFeedback
      }, { returnNew: true });

      // Update analytics after feedback
      await this.updateDailyAnalytics();

      return updatedQuery.new;
    } catch (error) {
      console.error('Error recording feedback:', error);
      throw error;
    }
  }

  /**
   * Update daily analytics with the latest data
   * @returns {Promise<Object>} The updated analytics document
   */
  async updateDailyAnalytics() {
    try {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const analyticsKey = `daily-${todayStr}`;

      // Check if today's analytics document exists
      let analyticsDoc = null;
      try {
        analyticsDoc = await this.analytics.document(analyticsKey);
      } catch (err) {
        // Document doesn't exist, create it
        analyticsDoc = {
          _key: analyticsKey,
          period: 'daily',
          startDate: `${todayStr}T00:00:00.000Z`,
          endDate: `${todayStr}T23:59:59.999Z`,
          totalQueries: 0,
          uniqueUsers: 0,
          averageResponseTime: 0,
          satisfactionRate: 0,
          queryDistribution: [],
          topQueries: [],
          lastUpdated: new Date().toISOString()
        };
      }

      // Calculate analytics for today
      const startOfDay = `${todayStr}T00:00:00.000Z`;
      const endOfDay = `${todayStr}T23:59:59.999Z`;

      // Get total queries for today
      const totalQueriesResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startOfDay} && q.timestamp <= ${endOfDay}
          COLLECT WITH COUNT INTO count
          RETURN count
      `);
      const totalQueries = await totalQueriesResult.next() || 0;

      // Get unique users for today
      const uniqueUsersResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startOfDay} && q.timestamp <= ${endOfDay}
          COLLECT userId = q.userId WITH COUNT INTO count
          RETURN count
      `);
      const uniqueUsers = await uniqueUsersResult.next() || 0;

      // Calculate average response time for today
      const avgResponseTimeResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startOfDay} && q.timestamp <= ${endOfDay}
          COLLECT AGGREGATE avgTime = AVG(q.responseTime)
          RETURN avgTime
      `);
      const averageResponseTime = await avgResponseTimeResult.next() || 0;

      // Calculate satisfaction rate from user feedback
      const satisfactionResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startOfDay} && q.timestamp <= ${endOfDay}
          FILTER q.userFeedback != null
          COLLECT AGGREGATE avgRating = AVG(q.userFeedback.rating)
          RETURN avgRating
      `);
      const satisfactionRate = await satisfactionResult.next() || 0;

      // Get query distribution by category
      const queryDistributionResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startOfDay} && q.timestamp <= ${endOfDay}
          FILTER q.categoryId != null
          COLLECT categoryId = q.categoryId WITH COUNT INTO count
          SORT count DESC
          RETURN { categoryId, count }
      `);
      const queryDistribution = await queryDistributionResult.all();

      // Get top 5 queries for today
      const topQueriesResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startOfDay} && q.timestamp <= ${endOfDay}
          COLLECT text = q.text WITH COUNT INTO count
          SORT count DESC
          LIMIT 5
          RETURN { text, count }
      `);
      const topQueries = await topQueriesResult.all();

      // Update or create analytics document
      analyticsDoc.totalQueries = totalQueries;
      analyticsDoc.uniqueUsers = uniqueUsers;
      analyticsDoc.averageResponseTime = averageResponseTime;
      analyticsDoc.satisfactionRate = satisfactionRate;
      analyticsDoc.queryDistribution = queryDistribution;
      analyticsDoc.topQueries = topQueries;
      analyticsDoc.lastUpdated = new Date().toISOString();

      // Save the analytics document
      return await this.analytics.save(analyticsDoc, { overwriteMode: 'replace' });
    } catch (error) {
      console.error('Error updating daily analytics:', error);
      throw error;
    }
  }

  /**
   * Get analytics for a specific period
   * @param {String} period - The period to get analytics for ('daily', 'weekly', 'monthly', 'all-time')
   * @param {String} date - The date for the period (ISO format)
   * @returns {Promise<Object>} The analytics document
   */
  async getAnalytics(period = 'daily', date = new Date().toISOString().split('T')[0]) {
    try {
      let analyticsKey;
      
      if (period === 'all-time') {
        analyticsKey = 'all-time';
      } else {
        const dateObj = new Date(date);
        
        if (period === 'daily') {
          analyticsKey = `daily-${date}`;
        } else if (period === 'weekly') {
          // Get start of the week (Sunday)
          const startOfWeek = new Date(dateObj);
          startOfWeek.setDate(dateObj.getDate() - dateObj.getDay());
          const weekStr = startOfWeek.toISOString().split('T')[0];
          analyticsKey = `weekly-${weekStr}`;
        } else if (period === 'monthly') {
          const monthStr = date.substring(0, 7); // YYYY-MM
          analyticsKey = `monthly-${monthStr}`;
        }
      }

      // Try to get existing analytics document
      try {
        return await this.analytics.document(analyticsKey);
      } catch (err) {
        // If document doesn't exist, generate it
        if (period === 'all-time') {
          return await this.generateAllTimeAnalytics();
        } else if (period === 'monthly') {
          return await this.generateMonthlyAnalytics(date);
        } else if (period === 'weekly') {
          return await this.generateWeeklyAnalytics(date);
        } else {
          // For daily, update the daily analytics
          return await this.updateDailyAnalytics();
        }
      }
    } catch (error) {
      console.error(`Error getting ${period} analytics:`, error);
      throw error;
    }
  }

  /**
   * Generate all-time analytics
   * @returns {Promise<Object>} The all-time analytics document
   */
  async generateAllTimeAnalytics() {
    try {
      // Get total queries
      const totalQueriesResult = await this.db.query(aql`
        FOR q IN queries
          COLLECT WITH COUNT INTO count
          RETURN count
      `);
      const totalQueries = await totalQueriesResult.next() || 0;

      // Get unique users
      const uniqueUsersResult = await this.db.query(aql`
        FOR q IN queries
          COLLECT userId = q.userId WITH COUNT INTO count
          RETURN count
      `);
      const uniqueUsers = await uniqueUsersResult.next() || 0;

      // Calculate average response time
      const avgResponseTimeResult = await this.db.query(aql`
        FOR q IN queries
          COLLECT AGGREGATE avgTime = AVG(q.responseTime)
          RETURN avgTime
      `);
      const averageResponseTime = await avgResponseTimeResult.next() || 0;

      // Calculate satisfaction rate from user feedback
      const satisfactionResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.userFeedback != null
          COLLECT AGGREGATE avgRating = AVG(q.userFeedback.rating)
          RETURN avgRating
      `);
      const satisfactionRate = await satisfactionResult.next() || 0;

      // Get query distribution by category
      const queryDistributionResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.categoryId != null
          COLLECT categoryId = q.categoryId WITH COUNT INTO count
          SORT count DESC
          RETURN { categoryId, count }
      `);
      const queryDistribution = await queryDistributionResult.all();

      // Get top 5 queries of all time
      const topQueriesResult = await this.db.query(aql`
        FOR q IN queries
          COLLECT text = q.text WITH COUNT INTO count
          SORT count DESC
          LIMIT 5
          RETURN { text, count }
      `);
      const topQueries = await topQueriesResult.all();

      // Create all-time analytics document
      const analyticsDoc = {
        _key: 'all-time',
        period: 'all-time',
        startDate: '1970-01-01T00:00:00.000Z', // Beginning of time
        endDate: new Date().toISOString(),
        totalQueries,
        uniqueUsers,
        averageResponseTime,
        satisfactionRate,
        queryDistribution,
        topQueries,
        lastUpdated: new Date().toISOString()
      };

      // Save the analytics document
      return await this.analytics.save(analyticsDoc, { overwriteMode: 'replace' });
    } catch (error) {
      console.error('Error generating all-time analytics:', error);
      throw error;
    }
  }

  /**
   * Generate monthly analytics for a specific month
   * @param {String} date - Any date in the month (ISO format YYYY-MM-DD)
   * @returns {Promise<Object>} The monthly analytics document
   */
  async generateMonthlyAnalytics(date) {
    try {
      const monthStr = date.substring(0, 7); // YYYY-MM
      const year = parseInt(monthStr.split('-')[0]);
      const month = parseInt(monthStr.split('-')[1]) - 1; // 0-based month
      
      const startOfMonth = new Date(year, month, 1);
      const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);
      
      const startDate = startOfMonth.toISOString();
      const endDate = endOfMonth.toISOString();

      // Get total queries for the month
      const totalQueriesResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startDate} && q.timestamp <= ${endDate}
          COLLECT WITH COUNT INTO count
          RETURN count
      `);
      const totalQueries = await totalQueriesResult.next() || 0;

      // Get unique users for the month
      const uniqueUsersResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startDate} && q.timestamp <= ${endDate}
          COLLECT userId = q.userId WITH COUNT INTO count
          RETURN count
      `);
      const uniqueUsers = await uniqueUsersResult.next() || 0;

      // Calculate average response time for the month
      const avgResponseTimeResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startDate} && q.timestamp <= ${endDate}
          COLLECT AGGREGATE avgTime = AVG(q.responseTime)
          RETURN avgTime
      `);
      const averageResponseTime = await avgResponseTimeResult.next() || 0;

      // Calculate satisfaction rate from user feedback for the month
      const satisfactionResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startDate} && q.timestamp <= ${endDate}
          FILTER q.userFeedback != null
          COLLECT AGGREGATE avgRating = AVG(q.userFeedback.rating)
          RETURN avgRating
      `);
      const satisfactionRate = await satisfactionResult.next() || 0;

      // Get query distribution by category for the month
      const queryDistributionResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startDate} && q.timestamp <= ${endDate}
          FILTER q.categoryId != null
          COLLECT categoryId = q.categoryId WITH COUNT INTO count
          SORT count DESC
          RETURN { categoryId, count }
      `);
      const queryDistribution = await queryDistributionResult.all();

      // Get top 5 queries for the month
      const topQueriesResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startDate} && q.timestamp <= ${endDate}
          COLLECT text = q.text WITH COUNT INTO count
          SORT count DESC
          LIMIT 5
          RETURN { text, count }
      `);
      const topQueries = await topQueriesResult.all();

      // Create monthly analytics document
      const analyticsDoc = {
        _key: `monthly-${monthStr}`,
        period: 'monthly',
        startDate,
        endDate,
        totalQueries,
        uniqueUsers,
        averageResponseTime,
        satisfactionRate,
        queryDistribution,
        topQueries,
        lastUpdated: new Date().toISOString()
      };

      // Save the analytics document
      return await this.analytics.save(analyticsDoc, { overwriteMode: 'replace' });
    } catch (error) {
      console.error(`Error generating monthly analytics for ${date}:`, error);
      throw error;
    }
  }

  /**
   * Generate weekly analytics for a specific week
   * @param {String} date - Any date in the week (ISO format YYYY-MM-DD)
   * @returns {Promise<Object>} The weekly analytics document
   */
  async generateWeeklyAnalytics(date) {
    try {
      const dateObj = new Date(date);
      
      // Get start of the week (Sunday)
      const startOfWeek = new Date(dateObj);
      startOfWeek.setDate(dateObj.getDate() - dateObj.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      
      // Get end of the week (Saturday)
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);
      
      const startDate = startOfWeek.toISOString();
      const endDate = endOfWeek.toISOString();
      const weekStr = startOfWeek.toISOString().split('T')[0];

      // Get total queries for the week
      const totalQueriesResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startDate} && q.timestamp <= ${endDate}
          COLLECT WITH COUNT INTO count
          RETURN count
      `);
      const totalQueries = await totalQueriesResult.next() || 0;

      // Get unique users for the week
      const uniqueUsersResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startDate} && q.timestamp <= ${endDate}
          COLLECT userId = q.userId WITH COUNT INTO count
          RETURN count
      `);
      const uniqueUsers = await uniqueUsersResult.next() || 0;

      // Calculate average response time for the week
      const avgResponseTimeResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startDate} && q.timestamp <= ${endDate}
          COLLECT AGGREGATE avgTime = AVG(q.responseTime)
          RETURN avgTime
      `);
      const averageResponseTime = await avgResponseTimeResult.next() || 0;

      // Calculate satisfaction rate from user feedback for the week
      const satisfactionResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startDate} && q.timestamp <= ${endDate}
          FILTER q.userFeedback != null
          COLLECT AGGREGATE avgRating = AVG(q.userFeedback.rating)
          RETURN avgRating
      `);
      const satisfactionRate = await satisfactionResult.next() || 0;

      // Get query distribution by category for the week
      const queryDistributionResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startDate} && q.timestamp <= ${endDate}
          FILTER q.categoryId != null
          COLLECT categoryId = q.categoryId WITH COUNT INTO count
          SORT count DESC
          RETURN { categoryId, count }
      `);
      const queryDistribution = await queryDistributionResult.all();

      // Get top 5 queries for the week
      const topQueriesResult = await this.db.query(aql`
        FOR q IN queries
          FILTER q.timestamp >= ${startDate} && q.timestamp <= ${endDate}
          COLLECT text = q.text WITH COUNT INTO count
          SORT count DESC
          LIMIT 5
          RETURN { text, count }
      `);
      const topQueries = await topQueriesResult.all();

      // Create weekly analytics document
      const analyticsDoc = {
        _key: `weekly-${weekStr}`,
        period: 'weekly',
        startDate,
        endDate,
        totalQueries,
        uniqueUsers,
        averageResponseTime,
        satisfactionRate,
        queryDistribution,
        topQueries,
        lastUpdated: new Date().toISOString()
      };

      // Save the analytics document
      return await this.analytics.save(analyticsDoc, { overwriteMode: 'replace' });
    } catch (error) {
      console.error(`Error generating weekly analytics for ${date}:`, error);
      throw error;
    }
  }
}

module.exports = AnalyticsService;
