require('dotenv').config();
const { Database, aql } = require('arangojs');
const { v4: uuidv4 } = require('uuid');
const { logger, dbService } = require('../shared-lib');
const ServiceCategoryService = require('../services/service-category-service');

class AnalyticsService {
  constructor() {
    this.dbService = dbService;
    this.db = null;
    this.analytics = null;
    this.events = null;
    this.queriesCollection = null;
    this.usersCollection = null;
    this.sessionsCollection = null;
    this.serviceCategoriesCollection = null;
    this.initialized = false;
    logger.info('AnalyticsService constructor called');
  }

  async init() {
    if (this.initialized) {
      logger.debug('AnalyticsService already initialized, skipping');
      return;
    }
    try {
      this.db = await this.dbService.getConnection('default');
      this.analytics = this.db.collection('analytics');
      this.events = this.db.collection('events');
      this.queriesCollection = this.db.collection('queries');
      this.usersCollection = this.db.collection('users');
      this.sessionsCollection = this.db.collection('sessions');
      this.serviceCategoriesCollection = this.db.collection('serviceCategories');

      logger.info('Initializing AnalyticsService...');
      await this.initialize();
      await this.ensureServiceCategories();
      this.initialized = true;
      logger.info('AnalyticsService initialized successfully');
    } catch (error) {
      logger.error(`Error initializing AnalyticsService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Initialize collections if they don't exist
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      const collections = await this.db.listCollections();
      const collectionNames = collections.map(c => c.name);

      const ensureCollection = async (name) => {
        if (!collectionNames.includes(name)) {
          logger.info(`Creating ${name} collection...`);
          try {
            await this.db.createCollection(name);
            logger.info(`Created ${name} collection successfully`);
          } catch (err) {
            if (err.errorNum !== 1207) {
              throw err;
            }
            logger.warn(`Collection ${name} already exists, skipping creation`);
          }
        }
      };

      await ensureCollection('analytics');
      await ensureCollection('events');

      this.analytics = this.db.collection('analytics');
      this.events = this.db.collection('events');

      logger.info('Collections initialized successfully');
    } catch (error) {
      logger.error(`Error initializing collections: ${error.message}`, { stack: error.stack });
    }
  }

  /**
   * Ensure service categories exist and add sample data if empty
   * @returns {Promise<boolean>} Success indicator
   */
  async ensureServiceCategories() {
    try {
      const collections = await this.db.listCollections();
      const collectionNames = collections.map(c => c.name);

      if (!collectionNames.includes('serviceCategories')) {
        logger.info('Creating serviceCategories collection...');
        try {
          await this.db.createCollection('serviceCategories');
          logger.info('Created serviceCategories collection successfully');
        } catch (err) {
          if (err.errorNum !== 1207) {
            throw err;
          }
          logger.warn('serviceCategories collection already exists, skipping creation');
        }
      }

      const serviceCategories = this.db.collection('serviceCategories');

      const cursor = await this.db.query(`
        FOR doc IN serviceCategories
        LIMIT 1
        RETURN doc
      `);

      const existingCategories = await cursor.all();

      if (existingCategories.length === 0) {
        logger.info('Adding sample service categories...');

        const sampleCategories = [
          { _key: "1", nameEN: "Identity & Civil Registration", nameFR: "Identité et état civil", nameSW: "Utambulisho na Usajili wa Raia", order: 1 },
          { _key: "2", nameEN: "Transportation", nameFR: "Transport", nameSW: "Usafiri", order: 2 },
          { _key: "3", nameEN: "Taxes & Revenue", nameFR: "Impôts et Revenus", nameSW: "Kodi na Mapato", order: 3 },
          { _key: "4", nameEN: "Immigration & Citizenship", nameFR: "Immigration et Citoyenneté", nameSW: "Uhamiaji na Uraia", order: 4 },
          { _key: "5", nameEN: "Education & Learning", nameFR: "Éducation et Apprentissage", nameSW: "Elimu na Mafunzo", order: 5 },
          { _key: "6", nameEN: "Housing & Properties", nameFR: "Logement et Propriétés", nameSW: "Nyumba na Mali", order: 6 },
          { _key: "7", nameEN: "Health & Healthcare", nameFR: "Santé et Soins Médicaux", nameSW: "Afya na Huduma za Afya", order: 7 },
          { _key: "8", nameEN: "Public Safety", nameFR: "Sécurité Publique", nameSW: "Usalama wa Umma", order: 8 },
          { _key: "9", nameEN: "Business & Economy", nameFR: "Entreprise et Économie", nameSW: "Biashara na Uchumi", order: 9 },
          { _key: "10", nameEN: "Social Services", nameFR: "Services Sociaux", nameSW: "Huduma za Kijamii", order: 10 },
          { _key: "11", nameEN: "Environment", nameFR: "Environnement", nameSW: "Mazingira", order: 11 },
          { _key: "12", nameEN: "Culture & Recreation", nameFR: "Culture et Loisirs", nameSW: "Utamaduni na Burudani", order: 12 },
          { _key: "13", nameEN: "Legal Services", nameFR: "Services Juridiques", nameSW: "Huduma za Kisheria", order: 13 }
        ];

        for (const category of sampleCategories) {
          try {
            await serviceCategories.save(category);
            logger.info(`Sample category ${category._key} saved successfully`);
          } catch (err) {
            logger.error(`Error saving category ${category._key}: ${err.message}`, { stack: err.stack });
          }
        }

        logger.info('Sample service categories added successfully');
      } else {
        logger.info('Service categories already exist, skipping sample data insertion');
      }

      return true;
    } catch (error) {
      logger.error(`Error ensuring service categories: ${error.message}`, { stack: error.stack });
      return false;
    }
  }

  /**
   * Record a query in analytics
   * @param {Object} queryDoc - Query document
   * @returns {Promise<Object>} The created analytics record
   */
  async recordQuery(queryDoc) {
    try {
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

      logger.info('Recording query analytics...');
      const record = await this.analytics.save(analyticsDoc);
      logger.info(`Analytics record created with auto-generated key: ${record._key}`);

      return record;
    } catch (error) {
      logger.error(`Error recording query analytics: ${error.message}`, { stack: error.stack });
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
      const analyticsDoc = {
        type: 'feedback',
        queryId: queryId,
        timestamp: new Date().toISOString(),
        data: feedback
      };

      logger.info('Recording feedback analytics...');
      const record = await this.analytics.save(analyticsDoc);
      logger.info(`Feedback record created with auto-generated key: ${record._key}`);

      return record;
    } catch (error) {
      logger.error(`Error recording feedback analytics: ${error.message}`, { stack: error.stack });
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
      await this.initialize();

      const eventDoc = {
        userId,
        eventType,
        timestamp: new Date().toISOString(),
        data: eventData
      };

      logger.info(`Tracking event: ${eventType} for user ${userId}`);
      const event = await this.events.save(eventDoc);
      logger.info(`Event created with auto-generated key: ${event._key}`);

      return event;
    } catch (error) {
      logger.error(`Error tracking event ${eventType} for user ${userId}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Get count of unique users for a specific period
   * @param {String} startDate - Start date (ISO string)
   * @param {String} endDate - End date (ISO string)
   * @returns {Promise<Number>} Count of unique users
   */
  async getUniqueUsersCount(startDate, endDate) {
    try {
      const validStartDate = startDate ? new Date(startDate).toISOString() :
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const validEndDate = endDate ? new Date(endDate).toISOString() :
        new Date().toISOString();

      logger.info(`Getting unique users count from ${validStartDate} to ${validEndDate}`);

      try {
        const testCursor = await this.db.query(`
          FOR a IN analytics
            FILTER a.type == 'query'
            LIMIT 5
            RETURN a.userId
        `);
        const testResult = await testCursor.all();
        logger.info("Sample user IDs:", testResult);
      } catch (testError) {
        logger.error(`Test query failed: ${testError.message}`, { stack: testError.stack });
      }

      const query = `
        LET usersList = (
          FOR a IN analytics
            FILTER a.type == 'query'
            FILTER a.timestamp >= @startDate AND a.timestamp <= @endDate
            FILTER a.userId != null AND a.userId != ""
            RETURN DISTINCT a.userId
        )
        
        RETURN LENGTH(usersList)
      `;

      logger.info("Executing unique users count query...");
      const cursor = await this.db.query(query, {
        startDate: validStartDate,
        endDate: validEndDate
      });

      const result = await cursor.next();
      logger.info(`Unique users count retrieved: ${result}`);
      return result || 0;
    } catch (error) {
      logger.error(`Error getting unique users count: ${error.message}`, { stack: error.stack });
      logger.info("Returning fixed sample count of 60 instead");
      return 60;
    }
  }

  /**
   * Get analytics for dashboard
   * @param {String} startDate - Start date (ISO string)
   * @param {String} endDate - End date (ISO string)
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Object>} Dashboard analytics
   */
  async getDashboardAnalytics(startDate, endDate, locale = 'en') {
    try {
      const validStartDate = startDate ? new Date(startDate).toISOString() : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const validEndDate = endDate ? new Date(endDate).toISOString() : new Date().toISOString();

      logger.info(`Getting dashboard analytics from ${validStartDate} to ${validEndDate} with locale ${locale}`);

      try {
        const testCursor = await this.db.query(`
          RETURN {
            test: "Connection is working"
          }
        `);
        const testResult = await testCursor.next();
        logger.info("Test query result:", testResult);
      } catch (testError) {
        logger.error(`Test query failed: ${testError.message}`, { stack: testError.stack });
        return this.generateSampleDashboardData(locale);
      }

      const analyticsQuery = `
        LET totalQueriesCount = (
          FOR a IN analytics
            FILTER a.type == 'query'
            FILTER a.timestamp >= @startDate AND a.timestamp <= @endDate
            COLLECT WITH COUNT INTO count
            RETURN count
        )[0]
        
        LET unansweredQueriesCount = (
          FOR a IN analytics
            FILTER a.type == 'query'
            FILTER a.timestamp >= @startDate AND a.timestamp <= @endDate
            FILTER a.data.isAnswered == false
            COLLECT WITH COUNT INTO count
            RETURN count
        )[0]
        
        LET averageResponseTimeValue = (
          FOR a IN analytics
            FILTER a.type == 'query'
            FILTER a.timestamp >= @startDate AND a.timestamp <= @endDate
            FILTER a.data.responseTime > 0
            COLLECT AGGREGATE avgTime = AVG(a.data.responseTime)
            RETURN avgTime
        )[0]
        
        LET categoryDistributionData = (
          FOR a IN analytics
            FILTER a.type == 'query'
            FILTER a.timestamp >= @startDate AND a.timestamp <= @endDate
            FILTER a.data.categoryId != null
            COLLECT categoryId = a.data.categoryId WITH COUNT INTO catCount
            
            RETURN {
              categoryId: categoryId,
              count: catCount,
              value: catCount
            }
        )
        
        LET feedbackStatsData = (
          LET feedbacksData = (
            FOR a IN analytics
              FILTER a.type == 'feedback'
              FILTER a.timestamp >= @startDate AND a.timestamp <= @endDate
              RETURN a
          )
          
          LET totalFeedbackCount = LENGTH(feedbacksData)
          LET positiveFeedbackCount = (
            FOR f IN feedbacksData
              FILTER f.data.rating >= 4
              COLLECT WITH COUNT INTO count
              RETURN count
          )[0] || 0
          
          LET negativeFeedbackCount = (
            FOR f IN feedbacksData
              FILTER f.data.rating <= 2
              COLLECT WITH COUNT INTO count
              RETURN count
          )[0] || 0
          
          LET neutralFeedbackCount = totalFeedbackCount - positiveFeedbackCount - negativeFeedbackCount
          
          RETURN {
            total: totalFeedbackCount,
            positive: positiveFeedbackCount,
            neutral: neutralFeedbackCount,
            negative: negativeFeedbackCount,
            positivePercentage: totalFeedbackCount > 0 ? (positiveFeedbackCount / totalFeedbackCount) * 100 : 0,
            negativePercentage: totalFeedbackCount > 0 ? (negativeFeedbackCount / totalFeedbackCount) * 100 : 0
          }
        )
        
        LET userStatsData = (
          LET activeUsersData = (
            FOR a IN analytics
              FILTER a.type == 'query'
              FILTER a.timestamp >= @startDate AND a.timestamp <= @endDate
              FILTER a.userId != null
              
              COLLECT userId = a.userId
              
              RETURN userId
          )
          
          RETURN {
            activeCount: LENGTH(activeUsersData)
          }
        )
        
        LET topQueriesData = (
          FOR a IN analytics
            FILTER a.type == 'query'
            FILTER a.timestamp >= @startDate AND a.timestamp <= @endDate
            
            COLLECT queryText = a.data.text WITH COUNT INTO queryTextCount
            LET responseTimeData = (
              FOR q IN analytics
                FILTER q.type == 'query'
                FILTER q.data.text == queryText
                FILTER q.data.responseTime > 0
                RETURN q.data.responseTime
            )
            
            LET avgResponseTimeForQuery = LENGTH(responseTimeData) > 0 ? 
              AVERAGE(responseTimeData) : 0
              
            SORT queryTextCount DESC
            LIMIT 5
            
            RETURN {
              text: queryText,
              count: queryTextCount,
              avgTime: ROUND(avgResponseTimeForQuery * 10) / 10
            }
        )
        
        RETURN {
          queries: {
            total: totalQueriesCount || 0,
            unanswered: unansweredQueriesCount || 0,
            answeredPercentage: totalQueriesCount > 0 ? ((totalQueriesCount - unansweredQueriesCount) / totalQueriesCount) * 100 : 0,
            avgResponseTime: averageResponseTimeValue || 0
          },
          categories: categoryDistributionData,
          feedback: feedbackStatsData,
          users: userStatsData,
          topQueries: topQueriesData
        }
      `;

      logger.info("Executing dashboard analytics query...");

      const analyticsData = await this.db.query(analyticsQuery, {
        startDate: validStartDate,
        endDate: validEndDate
      }).then(cursor => cursor.next());

      if (!analyticsData) {
        logger.info("No analytics data found, returning sample data");
        return this.generateSampleDashboardData(locale);
      }

      logger.info("======= DEBUG: CATEGORY NAMES LOCALIZATION =======");
      logger.info(`DEBUG: Processing locale "${locale}" for category name localization`);

      logger.info("Getting service categories for name localization...");
      const categoriesQuery = `
        FOR cat IN serviceCategories
        RETURN {
          _id: cat._id,
          _key: cat._key,
          nameEN: cat.nameEN,
          nameFR: cat.nameFR,
          nameSW: cat.nameSW
        }
      `;

      const categories = await this.db.query(categoriesQuery).then(cursor => cursor.all());
      logger.info(`Found ${categories.length} service categories for localization`);

      if (categories.length > 0) {
        logger.info("DEBUG: First few categories from database:", JSON.stringify(categories.slice(0, 3), null, 2));
      }

      if (analyticsData.categories && analyticsData.categories.length > 0) {
        logger.info(`DEBUG: Processing ${analyticsData.categories.length} categories from analytics data`);
        logger.info("DEBUG: First category from analytics:", JSON.stringify(analyticsData.categories[0], null, 2));

        analyticsData.categories = analyticsData.categories.map(category => {
          const idParts = category.categoryId.split('/');
          const categoryKey = idParts.length > 1 ? idParts[1] : category.categoryId;

          logger.info(`DEBUG: Looking up category for ID: ${category.categoryId}, extracted key: ${categoryKey}`);

          const matchingCategory = categories.find(cat =>
            cat._key === categoryKey || cat._id === category.categoryId
          );

          if (matchingCategory) {
            logger.info(`DEBUG: Found matching category: ${JSON.stringify(matchingCategory, null, 2)}`);

            let name;
            if (locale === 'fr' && matchingCategory.nameFR) {
              name = matchingCategory.nameFR;
              logger.info(`DEBUG: Using French name: "${name}"`);
            } else if (locale === 'sw' && matchingCategory.nameSW) {
              name = matchingCategory.nameSW;
              logger.info(`DEBUG: Using Swahili name: "${name}"`);
            } else {
              name = matchingCategory.nameEN;
              logger.info(`DEBUG: Using English name: "${name}" (default)`);
            }

            logger.info(`DEBUG: Final name selected for locale ${locale}: "${name}"`);

            return {
              ...category,
              name: name
            };
          } else {
            logger.info(`DEBUG: No matching category found for ID: ${category.categoryId}`);
            logger.info(`DEBUG: Available category keys: ${categories.map(c => c._key).slice(0, 5).join(', ')}`);
            return category;
          }
        });
      }

      logger.info("======= END DEBUG: CATEGORY NAMES LOCALIZATION =======");
      logger.info("Dashboard analytics processing completed successfully");
      return analyticsData;
    } catch (error) {
      logger.error(`Error getting dashboard analytics: ${error.message}`, { stack: error.stack });
      return this.generateSampleDashboardData(locale);
    }
  }

  /**
   * Generate sample dashboard data for development and fallback
   * @private
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Object} Sample dashboard data
   */
  generateSampleDashboardData(locale = 'en') {
    logger.info(`Generating sample dashboard data for locale: ${locale}`);

    const sampleTopQueries = [
      { text: "How do I apply for a business license?", count: 2347, avgTime: 2.3 },
      { text: "Where can I find tax forms?", count: 1982, avgTime: 1.8 },
      { text: "How to renew my driver's license?", count: 1645, avgTime: 2.1 },
      { text: "What documents do I need for passport application?", count: 1423, avgTime: 3.4 },
      { text: "When are property taxes due?", count: 1289, avgTime: 1.5 }
    ];

    const categoryNames = {
      "1": {
        en: "Identity & Civil Registration",
        fr: "Identité et état civil",
        sw: "Utambulisho na Usajili wa Raia"
      },
      "2": {
        en: "Transportation",
        fr: "Transport",
        sw: "Usafiri"
      },
      "3": {
        en: "Taxes & Revenue",
        fr: "Impôts et Revenus",
        sw: "Kodi na Mapato"
      },
      "4": {
        en: "Immigration & Citizenship",
        fr: "Immigration et Citoyenneté",
        sw: "Uhamiaji na Uraia"
      },
      "5": {
        en: "Education & Learning",
        fr: "Éducation et Apprentissage",
        sw: "Elimu na Mafunzo"
      },
      "6": {
        en: "Housing & Properties",
        fr: "Logement et Propriétés",
        sw: "Nyumba na Mali"
      },
      "7": {
        en: "Health & Healthcare",
        fr: "Santé et Soins Médicaux",
        sw: "Afya na Huduma za Afya"
      },
      "8": {
        en: "Public Safety",
        fr: "Sécurité Publique",
        sw: "Usalama wa Umma"
      },
      "9": {
        en: "Business & Economy",
        fr: "Entreprise et Économie",
        sw: "Biashara na Uchumi"
      },
      "10": {
        en: "Social Services",
        fr: "Services Sociaux",
        sw: "Huduma za Kijamii"
      },
      "11": {
        en: "Environment",
        fr: "Environnement",
        sw: "Mazingira"
      },
      "12": {
        en: "Culture & Recreation",
        fr: "Culture et Loisirs",
        sw: "Utamaduni na Burudani"
      },
      "13": {
        en: "Legal Services",
        fr: "Services Juridiques",
        sw: "Huduma za Kisheria"
      }
    };

    const language = locale === 'fr' ? 'fr' : (locale === 'sw' ? 'sw' : 'en');

    const sampleCategories = [
      { categoryId: "1", name: categoryNames["1"][language], count: 2347, value: 15 },
      { categoryId: "2", name: categoryNames["2"][language], count: 1782, value: 12 },
      { categoryId: "3", name: categoryNames["3"][language], count: 1645, value: 15 },
      { categoryId: "4", name: categoryNames["4"][language], count: 1245, value: 12 },
      { categoryId: "5", name: categoryNames["5"][language], count: 980, value: 12 },
      { categoryId: "6", name: categoryNames["6"][language], count: 850, value: 12 },
      { categoryId: "7", name: categoryNames["7"][language], count: 720, value: 12 },
      { categoryId: "8", name: categoryNames["8"][language], count: 650, value: 14 },
      { categoryId: "9", name: categoryNames["9"][language], count: 550, value: 9 },
      { categoryId: "10", name: categoryNames["10"][language], count: 520, value: 8 },
      { categoryId: "11", name: categoryNames["11"][language], count: 490, value: 8 },
      { categoryId: "12", name: categoryNames["12"][language], count: 480, value: 8 },
      { categoryId: "13", name: categoryNames["13"][language], count: 470, value: 9 }
    ];

    logger.info('Sample dashboard data generated successfully');

    return {
      queries: {
        total: 12452,
        unanswered: 453,
        answeredPercentage: 96.4,
        avgResponseTime: 2.8
      },
      categories: sampleCategories,
      feedback: {
        total: 3561,
        positive: 2840,
        neutral: 450,
        negative: 271,
        positivePercentage: 79.8,
        negativePercentage: 7.6
      },
      users: {
        activeCount: 4231
      },
      topQueries: sampleTopQueries
    };
  }

  /**
   * Get time series data for analytics
   * @param {string} metricType - Type of metric (queries, users)
   * @param {string} interval - Time interval (hourly, daily, monthly)
   * @param {string} startDate - Start date (ISO string or YYYY-MM-DD)
   * @param {string} endDate - End date (ISO string or YYYY-MM-DD)
   * @returns {Promise<Array>} Time series data
   */
  // analytics-service.js (backend)
  async getTimeSeriesData(metricType, interval, startDate, endDate) {
    try {
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();

      const startDateISO = start.toISOString();
      const endDateISO = end.toISOString();

      logger.info(`Getting time series data for metric: ${metricType}, interval: ${interval}, from ${startDateISO} to ${endDateISO}`);

      let dateFormat;
      switch (interval) {
        case 'hourly': dateFormat = '%Y-%m-%dT%H:00:00Z'; break;
        case 'daily': dateFormat = '%Y-%m-%d'; break;
        case 'weekly': dateFormat = '%Y-W%W'; break;
        case 'monthly': dateFormat = '%Y-%m'; break;
        default: dateFormat = '%Y-%m-%d';
      }

      const baseQuery = `
      FOR q IN queries
        FILTER q.timestamp >= @startDate AND q.timestamp <= @endDate
        COLLECT dateGroup = DATE_FORMAT(q.timestamp, @dateFormat) INTO groups
        LET uniqueUsers = LENGTH(UNIQUE(groups[*].q.userId))
        LET totalQueries = LENGTH(groups)
        RETURN {
          date: dateGroup,
          totalQueries: totalQueries,
          uniqueUsers: uniqueUsers
        }
    `;

      logger.info('Executing time series data query...');
      const cursor = await this.db.query(baseQuery, {
        startDate: startDateISO,
        endDate: endDateISO,
        dateFormat
      });

      const dailyBreakdown = await cursor.all();

      const chartData = dailyBreakdown.map(day => ({
        timestamp: day.date,
        dateLabel: this.formatDateLabel(day.date, interval),
        value: day.totalQueries,
        userCount: day.uniqueUsers
      }));

      if (chartData.length === 0) {
        logger.info('No time series data found, generating sample data');
        return this.generateSampleTimeSeriesData(metricType, interval, start, end);
      }

      logger.info(`Time series data retrieved successfully with ${chartData.length} data points`);
      return chartData;
    } catch (error) {
      logger.error(`Error in getTimeSeriesData: ${error.message}`, { stack: error.stack });
      return this.generateSampleTimeSeriesData(metricType, interval, start, end);
    }
  }

  /**
   * Format date label based on interval
   * @param {string|Date} timestamp - Date to format
   * @param {string} interval - Time interval
   * @returns {string} Formatted date label
   */
  formatDateLabel(timestamp, interval) {
    if (!timestamp) {
      logger.warn('Missing timestamp for date label formatting');
      return '';
    }

    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (isNaN(date.getTime())) {
      logger.warn(`Invalid timestamp for formatting: ${timestamp}`);
      return String(timestamp);
    }

    try {
      switch (interval) {
        case 'hourly':
          return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        case 'daily':
          return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        case 'weekly':
          return `Week ${Math.ceil((date.getDate() + 6 - date.getDay()) / 7)} ${date.toLocaleDateString([], { month: 'short' })}`;
        case 'monthly':
          return date.toLocaleDateString([], { month: 'short', year: 'numeric' });
        default:
          return date.toLocaleDateString();
      }
    } catch (error) {
      logger.error(`Error formatting date label: ${error.message}`, { stack: error.stack });
      return String(timestamp);
    }
  }

  /**
   * Generate sample time series data for development
   * @param {string} metricType - Type of metric
   * @param {string} interval - Time interval
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Array} Sample time series data
   */
  generateSampleTimeSeriesData(metricType, interval, startDate, endDate) {
    logger.info(`Generating sample time series data for metric: ${metricType}, interval: ${interval}, from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    const data = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    let step;
    switch (interval) {
      case 'hourly':
        step = 60 * 60 * 1000;
        break;
      case 'daily':
        step = 24 * 60 * 60 * 1000;
        break;
      case 'weekly':
        step = 7 * 24 * 60 * 60 * 1000;
        break;
      case 'monthly':
        step = 30 * 24 * 60 * 60 * 1000;
        break;
      default:
        step = 24 * 60 * 60 * 1000;
    }

    let baseValue;
    switch (metricType) {
      case 'queries':
        baseValue = 100;
        break;
      case 'users':
        baseValue = 30;
        break;
      default:
        baseValue = 50;
    }

    while (current <= end) {
      let fluctuation = 0.75 + (Math.random() * 0.5);

      const hour = current.getHours();
      const day = current.getDay();
      const month = current.getMonth();

      if (interval === 'hourly' && hour >= 9 && hour <= 17) {
        fluctuation *= 1.5;
      } else if (interval === 'hourly' && hour >= 0 && hour <= 5) {
        fluctuation *= 0.3;
      }

      if ((interval === 'daily' || interval === 'weekly') && (day === 0 || day === 6)) {
        fluctuation *= 0.6;
      }

      if (interval === 'monthly') {
        if (month >= 5 && month <= 7) {
          fluctuation *= 0.8;
        } else if (month >= 9 && month <= 11) {
          fluctuation *= 1.2;
        }
      }

      const timeProgress = (current.getTime() - startDate.getTime()) / (endDate.getTime() - startDate.getTime());
      const trendFactor = 1 + (timeProgress * 0.2);

      const value = Math.round(baseValue * fluctuation * trendFactor);

      let formattedTimestamp;
      if (interval === 'hourly') {
        formattedTimestamp = current.toISOString().slice(0, 13) + ':00:00Z';
      } else if (interval === 'daily') {
        formattedTimestamp = current.toISOString().slice(0, 10);
      } else if (interval === 'weekly') {
        const weekNum = Math.ceil((((current - new Date(current.getFullYear(), 0, 1)) / 86400000) + 1) / 7);
        formattedTimestamp = `${current.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
      } else if (interval === 'monthly') {
        formattedTimestamp = current.toISOString().slice(0, 7) + '-01';
      } else {
        formattedTimestamp = current.toISOString();
      }

      data.push({
        timestamp: formattedTimestamp,
        value: value
      });

      current.setTime(current.getTime() + step);
    }

    logger.info(`Sample time series data generated successfully with ${data.length} points`);

    return data;
  }

  /**
 * Get satisfaction gauge data
 * @param {String} period - Period type (daily, weekly, monthly, all-time)
 * @param {String} selectedDate - Selected date (ISO string or YYYY-MM-DD)
 * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
 * @returns {Promise<Object>} Satisfaction gauge data
 */
  async getSatisfactionGaugeData(period, selectedDate, locale = 'en') {
    try {
      await this.init();
      logger.debug('getSatisfactionGaugeData: Starting execution', {
        period,
        selectedDate,
        locale,
        method: 'getSatisfactionGaugeData'
      });

      // Calculate date range
      let startDate, endDate;
      const now = new Date();
      const selectedDateObj = selectedDate ? new Date(selectedDate) : new Date();
      const endDateISO = selectedDateObj.toISOString();

      switch (period) {
        case 'daily':
          startDate = new Date(selectedDateObj.setHours(0, 0, 0, 0)).toISOString();
          endDate = new Date(selectedDateObj.setHours(23, 59, 59, 999)).toISOString();
          break;
        case 'weekly':
          startDate = new Date(selectedDateObj.setDate(selectedDateObj.getDate() - 6)).toISOString();
          endDate = endDateISO;
          break;
        case 'monthly':
          startDate = new Date(selectedDateObj.setDate(selectedDateObj.getDate() - 29)).toISOString();
          endDate = endDateISO;
          break;
        case 'all-time':
          startDate = '2020-01-01T00:00:00.000Z';
          endDate = endDateISO;
          break;
        default:
          startDate = new Date(now.setDate(now.getDate() - 30)).toISOString();
          endDate = endDateISO;
      }

      const weekDuration = 7 * 24 * 60 * 60 * 1000;
      const endTimestamp = Date.parse(endDate);

      // Define time periods
      const timePeriods = [
        {
          label: locale === 'fr' ? 'Actuel' : locale === 'sw' ? 'Sasa' : 'Current',
          start: endTimestamp - weekDuration,
          end: endTimestamp
        },
        {
          label: locale === 'fr' ? 'Semaine dernière' : locale === 'sw' ? 'Wiki iliyopita' : 'Last Week',
          start: endTimestamp - 2 * weekDuration,
          end: endTimestamp - weekDuration
        },
        {
          label: locale === 'fr' ? 'Il y a 2 semaines' : locale === 'sw' ? 'Wiki 2 iliyopita' : '2 Weeks Ago',
          start: endTimestamp - 3 * weekDuration,
          end: endTimestamp - 2 * weekDuration
        },
        {
          label: locale === 'fr' ? 'Il y a 3 semaines' : locale === 'sw' ? 'Wiki 3 iliyopita' : '3 Weeks Ago',
          start: endTimestamp - 4 * weekDuration,
          end: endTimestamp - 3 * weekDuration
        },
        {
          label: locale === 'fr' ? 'Il y a 4 semaines' : locale === 'sw' ? 'Wiki 4 iliyopita' : '4 Weeks Ago',
          start: endTimestamp - 5 * weekDuration,
          end: endTimestamp - 4 * weekDuration
        }
      ];

      const result = {
        currentValue: 0,
        previousValue: 0,
        changePercentage: 0,
        target: 85,
        historicalData: []
      };

      // Batch query for all categories per period
      for (const period of timePeriods) {
        const feedbackQuery = aql`
          FOR q IN queries
            FILTER q.userFeedback != null
            FILTER q.userFeedback.rating != null
            FILTER DATE_TIMESTAMP(q.timestamp) >= ${period.start} AND DATE_TIMESTAMP(q.timestamp) <= ${period.end}
            COLLECT categoryId = q.categoryId AGGREGATE
              totalRatings = COUNT(),
              sumRatings = SUM(TO_NUMBER(q.userFeedback.rating))
            FILTER totalRatings > 0
            RETURN {
              categoryId,
              average: (sumRatings / totalRatings)
            }
        `;
        const feedbackCursor = await this.db.query(feedbackQuery);
        const categoryResults = await feedbackCursor.all();

        // Calculate average of non-zero category values
        const categoryValues = categoryResults.map(r => Math.floor((r.average / 5) * 100)).filter(v => v > 0);
        const periodValue = categoryValues.length > 0 ? Math.floor(categoryValues.reduce((sum, val) => sum + val, 0) / categoryValues.length) : 0;

        result.historicalData.push({
          label: period.label,
          value: periodValue,
          periodStart: new Date(period.start).toISOString(),
          periodEnd: new Date(period.end).toISOString()
        });

        if (period.label === (locale === 'fr' ? 'Actuel' : locale === 'sw' ? 'Sasa' : 'Current')) {
          result.currentValue = periodValue;
        } else if (period.label === (locale === 'fr' ? 'Semaine dernière' : locale === 'sw' ? 'Wiki iliyopita' : 'Last Week')) {
          result.previousValue = periodValue;
        }
      }

      // Calculate change percentage
      result.changePercentage = result.previousValue > 0 ?
        Math.round(((result.currentValue - result.previousValue) / result.previousValue) * 100) : 0;

      // Ensure historicalData is always 5 entries
      if (result.historicalData.length < 5) {
        const defaultLabels = [
          locale === 'fr' ? 'Actuel' : locale === 'sw' ? 'Sasa' : 'Current',
          locale === 'fr' ? 'Semaine dernière' : locale === 'sw' ? 'Wiki iliyopita' : 'Last Week',
          locale === 'fr' ? 'Il y a 2 semaines' : locale === 'sw' ? 'Wiki 2 iliyopita' : '2 Weeks Ago',
          locale === 'fr' ? 'Il y a 3 semaines' : locale === 'sw' ? 'Wiki 3 iliyopita' : '3 Weeks Ago',
          locale === 'fr' ? 'Il y a 4 semaines' : locale === 'sw' ? 'Wiki 4 iliyopita' : '4 Weeks Ago'
        ];
        const defaultHistoricalData = defaultLabels.map((label, i) => ({
          label,
          value: 0,
          periodStart: new Date(endTimestamp - (i + 1) * weekDuration).toISOString(),
          periodEnd: new Date(endTimestamp - i * weekDuration).toISOString()
        }));
        result.historicalData = defaultHistoricalData.slice(0, 5 - result.historicalData.length).concat(result.historicalData);
      }

      logger.info('getSatisfactionGaugeData: Successful data retrieval', {
        currentValue: result.currentValue,
        historicalDataLength: result.historicalData.length,
        historicalData: result.historicalData,
        method: 'getSatisfactionGaugeData'
      });

      return result;
    } catch (error) {
      logger.error('getSatisfactionGaugeData: Query execution failed', {
        error: error.message,
        stack: error.stack,
        method: 'getSatisfactionGaugeData'
      });
      throw error;
    }
  }

  /**
   * Get sample satisfaction gauge data
   * @param {String} locale - Locale code
   * @returns {Object} Sample satisfaction gauge data
   */
  getSampleSatisfactionGaugeData(locale = 'en') {
    const getLocalizedPeriods = () => {
      if (locale === 'fr') {
        return [
          'Actuel',
          'Semaine dernière',
          'Il y a 2 semaines',
          'Il y a 3 semaines',
          'Il y a 4 semaines'
        ];
      } else if (locale === 'sw') {
        return [
          'Sasa',
          'Wiki iliyopita',
          'Wiki 2 iliyopita',
          'Wiki 3 iliyopita',
          'Wiki 4 iliyopita'
        ];
      } else {
        return [
          'Current',
          'Last Week',
          '2 Weeks Ago',
          '3 Weeks Ago',
          '4 Weeks Ago'
        ];
      }
    };

    const periods = getLocalizedPeriods();

    const currentValue = 72.5;
    const previousValue = 73.1;
    const changePercentage = -0.6;

    const historicalData = [
      { label: periods[0], value: 72.5 },
      { label: periods[1], value: 73.1 },
      { label: periods[2], value: 73.8 },
      { label: periods[3], value: 72.4 },
      { label: periods[4], value: 71.2 },
    ];

    logger.info('Sample satisfaction gauge data generated successfully');

    return {
      currentValue,
      previousValue,
      changePercentage,
      target: 85,
      historicalData
    };
  }

  /**
 * Get satisfaction heatmap data
 * @param {String} period - Period type (daily, weekly, monthly, all-time)
 * @param {String} selectedDate - Selected date (ISO string or YYYY-MM-DD)
 * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
 * @returns {Promise<Array>} Heatmap data for all categories
 */
  async getSatisfactionHeatmapData(period, selectedDate, locale = 'en') {
    try {
      await this.init();
      logger.debug('getSatisfactionHeatmapData: Starting execution', {
        period,
        selectedDate,
        locale,
        method: 'getSatisfactionHeatmapData'
      });

      // Calculate date range
      let startDate, endDate;
      const now = new Date();
      const selectedDateObj = selectedDate ? new Date(selectedDate) : new Date();
      const endDateISO = selectedDateObj.toISOString();

      switch (period) {
        case 'daily':
          startDate = new Date(selectedDateObj.setHours(0, 0, 0, 0)).toISOString();
          endDate = new Date(selectedDateObj.setHours(23, 59, 59, 999)).toISOString();
          break;
        case 'weekly':
          startDate = new Date(selectedDateObj.setDate(selectedDateObj.getDate() - 6)).toISOString();
          endDate = endDateISO;
          break;
        case 'monthly':
          startDate = new Date(selectedDateObj.setDate(selectedDateObj.getDate() - 29)).toISOString();
          endDate = endDateISO;
          break;
        case 'all-time':
          startDate = '2020-01-01T00:00:00.000Z';
          endDate = endDateISO;
          break;
        default:
          startDate = new Date(now.setDate(now.getDate() - 30)).toISOString();
          endDate = endDateISO;
      }

      const weekDuration = 7 * 24 * 60 * 60 * 1000;
      const endTimestamp = Date.parse(endDate);

      // Define time periods
      const timePeriods = [
        {
          label: locale === 'fr' ? 'Actuel' : locale === 'sw' ? 'Sasa' : 'Current',
          start: endTimestamp - weekDuration,
          end: endTimestamp
        },
        {
          label: locale === 'fr' ? 'Semaine dernière' : locale === 'sw' ? 'Wiki iliyopita' : 'Last Week',
          start: endTimestamp - 2 * weekDuration,
          end: endTimestamp - weekDuration
        },
        {
          label: locale === 'fr' ? 'Il y a 2 semaines' : locale === 'sw' ? 'Wiki 2 iliyopita' : '2 Weeks Ago',
          start: endTimestamp - 3 * weekDuration,
          end: endTimestamp - 2 * weekDuration
        },
        {
          label: locale === 'fr' ? 'Il y a 3 semaines' : locale === 'sw' ? 'Wiki 3 iliyopita' : '3 Weeks Ago',
          start: endTimestamp - 4 * weekDuration,
          end: endTimestamp - 3 * weekDuration
        },
        {
          label: locale === 'fr' ? 'Il y a 4 semaines' : locale === 'sw' ? 'Wiki 4 iliyopita' : '4 Weeks Ago',
          start: endTimestamp - 5 * weekDuration,
          end: endTimestamp - 4 * weekDuration
        }
      ];

      // Fetch all service categories
      const categoriesQuery = aql`
        FOR c IN serviceCategories
        SORT c._key
        RETURN {
          id: c._key,
          name: c[${locale == 'fr' ? 'nameFR' : locale == 'sw' ? 'nameSW' : 'nameEN'}]
        }
      `;
      const categoriesCursor = await this.db.query(categoriesQuery);
      const categories = await categoriesCursor.all();

      // Initialize heatmap data with zeros for all categories
      const heatmapData = categories.map(category => ({
        name: category.name,
        data: timePeriods.map(period => ({ x: period.label, y: 0 }))
      }));

      // Batch query for all feedback per period
      for (const period of timePeriods) {
        const feedbackQuery = aql`
          FOR q IN queries
            FILTER q.userFeedback != null
            FILTER q.userFeedback.rating != null
            FILTER DATE_TIMESTAMP(q.timestamp) >= ${period.start} AND DATE_TIMESTAMP(q.timestamp) <= ${period.end}
            COLLECT categoryId = q.categoryId AGGREGATE
              totalRatings = COUNT(),
              sumRatings = SUM(TO_NUMBER(q.userFeedback.rating))
            RETURN {
              categoryId,
              average: totalRatings > 0 ? (sumRatings / totalRatings) : 0
            }
        `;
        const feedbackCursor = await this.db.query(feedbackQuery);
        const feedbackResults = await feedbackCursor.all();

        // Update heatmap data for this period
        feedbackResults.forEach(result => {
          const categoryIndex = categories.findIndex(c => c.id === result.categoryId);
          if (categoryIndex !== -1) {
            const periodIndex = timePeriods.findIndex(p => p.label === period.label);
            if (periodIndex !== -1) {
              heatmapData[categoryIndex].data[periodIndex].y = Math.floor((result.average / 5) * 100);
            }
          }
        });
      }

      logger.info('getSatisfactionHeatmapData: Successful data retrieval', {
        categories: categories.length,
        periods: timePeriods.length,
        data: heatmapData,
        method: 'getSatisfactionHeatmapData'
      });

      return heatmapData;
    } catch (error) {
      logger.error('getSatisfactionHeatmapData: Query execution failed', {
        error: error.message,
        stack: error.stack,
        method: 'getSatisfactionHeatmapData'
      });
      throw error;
    }
  }

  /**
   * Get sample satisfaction heatmap data
   * @param {String} locale - Locale code
   * @returns {Array} Sample satisfaction heatmap data
   */
  getSampleSatisfactionHeatmapData(locale = 'en') {
    logger.info(`DEBUG: Generating sample heatmap data for locale: ${locale}`);

    const areas = [];
    if (locale === 'fr') {
      areas.push(
        'Immigration et Citoyenneté',
        'Entreprise et Commerce',
        'Identité et État Civil',
        'Sécurité Sociale et Retraites',
        'Éducation et Apprentissage',
        'Emploi et Services du Travail',
        'Santé et Services Sociaux'
      );
    } else if (locale === 'sw') {
      areas.push(
        'Uhamiaji na Uraia',
        'Biashara na Biashara',
        'Utambulisho na Usajili wa Kiraia',
        'Usalama wa Jamii na Pensheni',
        'Elimu na Mafunzo',
        'Ajira na Huduma za Kazi',
        'Afya na Huduma za Kijamii'
      );
    } else {
      areas.push(
        'Immigration & Citizenship',
        'Business & Trade',
        'Identity & Civil Registration',
        'Social Security & Pensions',
        'Education & Learning',
        'Employment & Labor Services',
        'Health & Social Services'
      );
    }

    const periods = [];
    if (locale === 'fr') {
      periods.push(
        'Il y a 4 semaines',
        'Il y a 3 semaines',
        'Il y a 2 semaines',
        'Semaine dernière',
        'Actuel'
      );
    } else if (locale === 'sw') {
      periods.push(
        'Wiki 4 iliyopita',
        'Wiki 3 iliyopita',
        'Wiki 2 iliyopita',
        'Wiki iliyopita',
        'Sasa'
      );
    } else {
      periods.push(
        '4 Weeks Ago',
        '3 Weeks Ago',
        '2 Weeks Ago',
        'Last Week',
        'Current'
      );
    }

    const sampleData = areas.map(area => {
      const data = {
        name: area,
        data: periods.map((period, index) => {
          let baseScore = 75 + Math.floor(Math.random() * 15);
          baseScore += index * (1 + Math.random());
          const score = Math.min(Math.round(baseScore), 100);

          return {
            x: period,
            y: score
          };
        })
      };
      return data;
    });

    logger.info(`Sample satisfaction heatmap data generated successfully with ${sampleData.length} areas`);

    return sampleData;
  }
}

// Singleton instance
const instance = new AnalyticsService();
module.exports = instance;