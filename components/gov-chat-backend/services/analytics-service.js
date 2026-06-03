require("dotenv").config();
const { aql } = require("arangojs");
const { logger, dbService } = require("../shared-lib");
const ServiceCategoryService = require("../services/service-category-service");

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
    this.serviceCategoryService = ServiceCategoryService; // Store reference for use
    this.initialized = false;
    logger.info("AnalyticsService constructor called");
  }

  async init() {
    if (this.initialized) {
      logger.debug("AnalyticsService already initialized, skipping");
      return;
    }
    try {
      this.db = await this.dbService.getConnection("default");

      this.analytics = this.db.collection("analytics");
      this.events = this.db.collection("events");
      this.queriesCollection = this.db.collection("queries");
      this.usersCollection = this.db.collection("users");
      this.sessionsCollection = this.db.collection("sessions");
      this.serviceCategoriesCollection =
        this.db.collection("serviceCategories");

      logger.info("Initializing AnalyticsService...");

      // Initialize ServiceCategoryService
      logger.info(
        "Initializing ServiceCategoryService from AnalyticsService...",
      );
      await this.serviceCategoryService.init();
      logger.info("ServiceCategoryService initialized successfully");

      this.initialized = true;
      logger.info("AnalyticsService initialized successfully");
    } catch (error) {
      logger.error(`Error initializing AnalyticsService: ${error.message}`, {
        stack: error.stack,
      });
      throw error;
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
        type: "query",
        queryId: queryDoc._key,
        userId: queryDoc.userId,
        sessionId: queryDoc.sessionId,
        timestamp: new Date().toISOString(),
        data: {
          text: queryDoc.text,
          categoryId: queryDoc.categoryId,
          serviceId: queryDoc.serviceId,
          responseTime: queryDoc.responseTime || 0,
          isAnswered: queryDoc.isAnswered || false,
        },
      };

      logger.info("Recording query analytics...");
      const record = await this.analytics.save(analyticsDoc);
      logger.info(
        `Analytics record created with auto-generated key: ${record._key}`,
      );

      return record;
    } catch (error) {
      logger.error(`Error recording query analytics: ${error.message}`, {
        stack: error.stack,
      });
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
        type: "feedback",
        queryId: queryId,
        timestamp: new Date().toISOString(),
        data: feedback,
      };

      logger.info("Recording feedback analytics...");
      const record = await this.analytics.save(analyticsDoc);
      logger.info(
        `Feedback record created with auto-generated key: ${record._key}`,
      );

      return record;
    } catch (error) {
      logger.error(`Error recording feedback analytics: ${error.message}`, {
        stack: error.stack,
      });
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
      await this.init();

      const eventDoc = {
        userId,
        eventType,
        timestamp: new Date().toISOString(),
        data: eventData,
      };

      logger.info(`Tracking event: ${eventType} for user ${userId}`);
      const event = await this.events.save(eventDoc);
      logger.info(`Event created with auto-generated key: ${event._key}`);

      return event;
    } catch (error) {
      logger.error(
        `Error tracking event ${eventType} for user ${userId}: ${error.message}`,
        { stack: error.stack },
      );
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
      const validStartDate = startDate
        ? new Date(startDate).toISOString()
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const validEndDate = endDate
        ? new Date(endDate).toISOString()
        : new Date().toISOString();

      logger.info(
        `Getting unique users count from ${validStartDate} to ${validEndDate}`,
      );

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
        logger.error(`Test query failed: ${testError.message}`, {
          stack: testError.stack,
        });
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
        endDate: validEndDate,
      });

      const result = await cursor.next();
      logger.info(`Unique users count retrieved: ${result}`);
      return result || 0;
    } catch (error) {
      logger.error(`Error getting unique users count: ${error.message}`, {
        stack: error.stack,
      });
      return 0;
    }
  }

  /**
   * Get analytics for dashboard
   * @param {String} startDate - Start date (ISO string)
   * @param {String} endDate - End date (ISO string)
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Object>} Dashboard analytics
   */
  async getDashboardAnalytics(startDate, endDate, locale = "en") {
    try {
      const validStartDate = startDate
        ? new Date(startDate).toISOString()
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const validEndDate = endDate
        ? new Date(endDate).toISOString()
        : new Date().toISOString();

      logger.info(
        `Getting dashboard analytics from ${validStartDate} to ${validEndDate} with locale ${locale}`,
      );

      try {
        const testCursor = await this.db.query(`
          RETURN {
            test: "Connection is working"
          }
        `);
        const testResult = await testCursor.next();
        logger.info("Test query result:", testResult);
      } catch (testError) {
        logger.error(`Test query failed: ${testError.message}`, {
          stack: testError.stack,
        });
        return this.getEmptyDashboardData();
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

      const analyticsData = await this.db
        .query(analyticsQuery, {
          startDate: validStartDate,
          endDate: validEndDate,
        })
        .then((cursor) => cursor.next());

      if (!analyticsData) {
        logger.info("No analytics data found, returning empty data");
        return this.getEmptyDashboardData();
      }

      logger.info("======= DEBUG: CATEGORY NAMES LOCALIZATION =======");
      logger.info(
        `DEBUG: Processing locale "${locale}" for category name localization`,
      );

      // Use ServiceCategoryService to get properly translated categories
      logger.info(
        "Getting categories with translations using ServiceCategoryService...",
      );
      try {
        const categoriesWithTranslations =
          await this.serviceCategoryService.getAllCategoriesWithServices(
            locale,
          );
        logger.info(
          `DEBUG: Retrieved ${categoriesWithTranslations.length} categories from ServiceCategoryService`,
        );

        if (categoriesWithTranslations.length > 0) {
          logger.info(
            "DEBUG: First few categories from service:",
            JSON.stringify(
              categoriesWithTranslations.slice(0, 3).map((c) => ({
                catKey: c.catKey,
                name: c.name,
              })),
              null,
              2,
            ),
          );
        }

        // Build a map of categoryId to translated name
        const categoryMap = {};
        categoriesWithTranslations.forEach((cat) => {
          categoryMap[cat.catKey] = cat.name;
          logger.debug(`DEBUG: Mapped category ${cat.catKey} => "${cat.name}"`);
        });

        // Apply translated names to analytics data
        if (analyticsData.categories && analyticsData.categories.length > 0) {
          logger.info(
            `DEBUG: Processing ${analyticsData.categories.length} categories from analytics data`,
          );

          analyticsData.categories = analyticsData.categories.map(
            (category) => {
              const idParts = category.categoryId.split("/");
              const categoryKey =
                idParts.length > 1 ? idParts[1] : category.categoryId;

              logger.debug(
                `DEBUG: Looking up category for ID: ${category.categoryId}, extracted key: ${categoryKey}`,
              );

              const translatedName = categoryMap[categoryKey];

              if (translatedName) {
                logger.debug(
                  `DEBUG: Found translated name for category ${categoryKey}: "${translatedName}"`,
                );
                return {
                  ...category,
                  name: translatedName,
                };
              } else {
                logger.warn(
                  `DEBUG: No translation found for category ${categoryKey} in locale ${locale}`,
                );
                return {
                  ...category,
                  name: `Category ${categoryKey}`, // Generic fallback
                };
              }
            },
          );
        }
      } catch (serviceCategoryError) {
        logger.error(
          `Error getting categories from ServiceCategoryService: ${serviceCategoryError.message}`,
          {
            stack: serviceCategoryError.stack,
          },
        );
        // Analytics data will be returned without category names
      }

      logger.info("======= END DEBUG: CATEGORY NAMES LOCALIZATION =======");
      logger.info("Dashboard analytics processing completed successfully");
      return analyticsData;
    } catch (error) {
      logger.error(`Error getting dashboard analytics: ${error.message}`, {
        stack: error.stack,
      });
      return this.getEmptyDashboardData();
    }
  }

  /**
   * Get empty dashboard data with correct shape for safe consumption by clients
   * @private
   * @returns {Object} Empty dashboard data matching the success response shape
   */
  getEmptyDashboardData() {
    logger.info("Returning empty dashboard data (no fabricated values)");
    return {
      queries: {
        total: 0,
        unanswered: 0,
        answeredPercentage: 0,
        avgResponseTime: 0,
      },
      categories: [],
      feedback: {
        total: 0,
        positive: 0,
        neutral: 0,
        negative: 0,
        positivePercentage: 0,
        negativePercentage: 0,
      },
      users: {
        activeCount: 0,
      },
      topQueries: [],
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
  async getTimeSeriesData(metricType, interval, startDate, endDate) {
    try {
      const start = startDate
        ? new Date(startDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();

      const startDateISO = start.toISOString();
      const endDateISO = end.toISOString();

      logger.info(
        `Getting time series data for metric: ${metricType}, interval: ${interval}, from ${startDateISO} to ${endDateISO}`,
      );

      let dateFormat;
      switch (interval) {
        case "hourly":
          dateFormat = "%Y-%m-%dT%H:00:00Z";
          break;
        case "daily":
          dateFormat = "%Y-%m-%d";
          break;
        case "weekly":
          dateFormat = "%Y-W%W";
          break;
        case "monthly":
          dateFormat = "%Y-%m";
          break;
        default:
          dateFormat = "%Y-%m-%d";
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

      logger.info("Executing time series data query...");
      const cursor = await this.db.query(baseQuery, {
        startDate: startDateISO,
        endDate: endDateISO,
        dateFormat,
      });

      const dailyBreakdown = await cursor.all();

      const chartData = dailyBreakdown.map((day) => ({
        timestamp: day.date,
        dateLabel: this.formatDateLabel(day.date, interval),
        value: day.totalQueries,
        userCount: day.uniqueUsers,
      }));

      if (chartData.length === 0) {
        logger.info("No time series data found, returning empty array");
        return [];
      }

      logger.info(
        `Time series data retrieved successfully with ${chartData.length} data points`,
      );
      return chartData;
    } catch (error) {
      logger.error(`Error in getTimeSeriesData: ${error.message}`, {
        stack: error.stack,
      });
      return [];
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
      logger.warn("Missing timestamp for date label formatting");
      return "";
    }

    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (isNaN(date.getTime())) {
      logger.warn(`Invalid timestamp for formatting: ${timestamp}`);
      return String(timestamp);
    }

    try {
      switch (interval) {
        case "hourly":
          return date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
        case "daily":
          return date.toLocaleDateString([], {
            month: "short",
            day: "numeric",
          });
        case "weekly":
          return `Week ${Math.ceil((date.getDate() + 6 - date.getDay()) / 7)} ${date.toLocaleDateString([], { month: "short" })}`;
        case "monthly":
          return date.toLocaleDateString([], {
            month: "short",
            year: "numeric",
          });
        default:
          return date.toLocaleDateString();
      }
    } catch (error) {
      logger.error(`Error formatting date label: ${error.message}`, {
        stack: error.stack,
      });
      return String(timestamp);
    }
  }

  /**
   * Get satisfaction gauge data
   * @param {String} period - Period type (daily, weekly, monthly, all-time)
   * @param {String} selectedDate - Selected date (ISO string or YYYY-MM-DD)
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Object>} Satisfaction gauge data
   */
  async getSatisfactionGaugeData(period, selectedDate, locale = "en") {
    try {
      await this.init();
      logger.debug("getSatisfactionGaugeData: Starting execution", {
        period,
        selectedDate,
        locale,
        method: "getSatisfactionGaugeData",
      });

      // Calculate date range
      let endDate;
      const selectedDateObj = selectedDate
        ? new Date(selectedDate)
        : new Date();
      const endDateISO = selectedDateObj.toISOString();

      switch (period) {
        case "daily":
          endDate = new Date(
            selectedDateObj.setHours(23, 59, 59, 999),
          ).toISOString();
          break;
        case "weekly":
          endDate = endDateISO;
          break;
        case "monthly":
          endDate = endDateISO;
          break;
        case "all-time":
          endDate = endDateISO;
          break;
        default:
          endDate = endDateISO;
      }

      const weekDuration = 7 * 24 * 60 * 60 * 1000;
      const endTimestamp = Date.parse(endDate);

      // Define time periods
      const timePeriods = [
        {
          label:
            locale === "fr" ? "Actuel" : locale === "sw" ? "Sasa" : "Current",
          start: endTimestamp - weekDuration,
          end: endTimestamp,
        },
        {
          label:
            locale === "fr"
              ? "Semaine dernière"
              : locale === "sw"
                ? "Wiki iliyopita"
                : "Last Week",
          start: endTimestamp - 2 * weekDuration,
          end: endTimestamp - weekDuration,
        },
        {
          label:
            locale === "fr"
              ? "Il y a 2 semaines"
              : locale === "sw"
                ? "Wiki 2 iliyopita"
                : "2 Weeks Ago",
          start: endTimestamp - 3 * weekDuration,
          end: endTimestamp - 2 * weekDuration,
        },
        {
          label:
            locale === "fr"
              ? "Il y a 3 semaines"
              : locale === "sw"
                ? "Wiki 3 iliyopita"
                : "3 Weeks Ago",
          start: endTimestamp - 4 * weekDuration,
          end: endTimestamp - 3 * weekDuration,
        },
        {
          label:
            locale === "fr"
              ? "Il y a 4 semaines"
              : locale === "sw"
                ? "Wiki 4 iliyopita"
                : "4 Weeks Ago",
          start: endTimestamp - 5 * weekDuration,
          end: endTimestamp - 4 * weekDuration,
        },
      ];

      const result = {
        currentValue: 0,
        previousValue: 0,
        changePercentage: 0,
        target: 85,
        historicalData: [],
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
        const categoryValues = categoryResults
          .map((r) => Math.floor((r.average / 5) * 100))
          .filter((v) => v > 0);
        const periodValue =
          categoryValues.length > 0
            ? Math.floor(
                categoryValues.reduce((sum, val) => sum + val, 0) /
                  categoryValues.length,
              )
            : 0;

        result.historicalData.push({
          label: period.label,
          value: periodValue,
          periodStart: new Date(period.start).toISOString(),
          periodEnd: new Date(period.end).toISOString(),
        });

        if (
          period.label ===
          (locale === "fr" ? "Actuel" : locale === "sw" ? "Sasa" : "Current")
        ) {
          result.currentValue = periodValue;
        } else if (
          period.label ===
          (locale === "fr"
            ? "Semaine dernière"
            : locale === "sw"
              ? "Wiki iliyopita"
              : "Last Week")
        ) {
          result.previousValue = periodValue;
        }
      }

      // Calculate change percentage
      result.changePercentage =
        result.previousValue > 0
          ? Math.round(
              ((result.currentValue - result.previousValue) /
                result.previousValue) *
                100,
            )
          : 0;

      // Ensure historicalData is always 5 entries
      if (result.historicalData.length < 5) {
        const defaultLabels = [
          locale === "fr" ? "Actuel" : locale === "sw" ? "Sasa" : "Current",
          locale === "fr"
            ? "Semaine dernière"
            : locale === "sw"
              ? "Wiki iliyopita"
              : "Last Week",
          locale === "fr"
            ? "Il y a 2 semaines"
            : locale === "sw"
              ? "Wiki 2 iliyopita"
              : "2 Weeks Ago",
          locale === "fr"
            ? "Il y a 3 semaines"
            : locale === "sw"
              ? "Wiki 3 iliyopita"
              : "3 Weeks Ago",
          locale === "fr"
            ? "Il y a 4 semaines"
            : locale === "sw"
              ? "Wiki 4 iliyopita"
              : "4 Weeks Ago",
        ];
        const defaultHistoricalData = defaultLabels.map((label, i) => ({
          label,
          value: 0,
          periodStart: new Date(
            endTimestamp - (i + 1) * weekDuration,
          ).toISOString(),
          periodEnd: new Date(endTimestamp - i * weekDuration).toISOString(),
        }));
        result.historicalData = defaultHistoricalData
          .slice(0, 5 - result.historicalData.length)
          .concat(result.historicalData);
      }

      logger.info("getSatisfactionGaugeData: Successful data retrieval", {
        currentValue: result.currentValue,
        historicalDataLength: result.historicalData.length,
        historicalData: result.historicalData,
        method: "getSatisfactionGaugeData",
      });

      return result;
    } catch (error) {
      logger.error("getSatisfactionGaugeData: Query execution failed", {
        error: error.message,
        stack: error.stack,
        method: "getSatisfactionGaugeData",
      });
      return {
        currentValue: 0,
        previousValue: 0,
        changePercentage: 0,
        target: 85,
        historicalData: [],
      };
    }
  }

  /**
   * Get satisfaction heatmap data
   * @param {String} period - Period type (daily, weekly, monthly, all-time)
   * @param {String} selectedDate - Selected date (ISO string or YYYY-MM-DD)
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Array>} Heatmap data for all categories
   */
  async getSatisfactionHeatmapData(period, selectedDate, locale = "en") {
    try {
      await this.init();
      logger.debug("getSatisfactionHeatmapData: Starting execution", {
        period,
        selectedDate,
        locale,
        method: "getSatisfactionHeatmapData",
      });

      // Calculate date range
      let endDate;
      const selectedDateObj = selectedDate
        ? new Date(selectedDate)
        : new Date();
      const endDateISO = selectedDateObj.toISOString();

      switch (period) {
        case "daily":
          endDate = new Date(
            selectedDateObj.setHours(23, 59, 59, 999),
          ).toISOString();
          break;
        case "weekly":
          endDate = endDateISO;
          break;
        case "monthly":
          endDate = endDateISO;
          break;
        case "all-time":
          endDate = endDateISO;
          break;
        default:
          endDate = endDateISO;
      }

      const weekDuration = 7 * 24 * 60 * 60 * 1000;
      const endTimestamp = Date.parse(endDate);

      // Define time periods
      const timePeriods = [
        {
          label:
            locale === "fr" ? "Actuel" : locale === "sw" ? "Sasa" : "Current",
          start: endTimestamp - weekDuration,
          end: endTimestamp,
        },
        {
          label:
            locale === "fr"
              ? "Semaine dernière"
              : locale === "sw"
                ? "Wiki iliyopita"
                : "Last Week",
          start: endTimestamp - 2 * weekDuration,
          end: endTimestamp - weekDuration,
        },
        {
          label:
            locale === "fr"
              ? "Il y a 2 semaines"
              : locale === "sw"
                ? "Wiki 2 iliyopita"
                : "2 Weeks Ago",
          start: endTimestamp - 3 * weekDuration,
          end: endTimestamp - 2 * weekDuration,
        },
        {
          label:
            locale === "fr"
              ? "Il y a 3 semaines"
              : locale === "sw"
                ? "Wiki 3 iliyopita"
                : "3 Weeks Ago",
          start: endTimestamp - 4 * weekDuration,
          end: endTimestamp - 3 * weekDuration,
        },
        {
          label:
            locale === "fr"
              ? "Il y a 4 semaines"
              : locale === "sw"
                ? "Wiki 4 iliyopita"
                : "4 Weeks Ago",
          start: endTimestamp - 5 * weekDuration,
          end: endTimestamp - 4 * weekDuration,
        },
      ];

      // Use ServiceCategoryService to get all categories with translations
      logger.info(
        "Getting categories with translations using ServiceCategoryService for heatmap...",
      );
      let categories = [];

      try {
        const categoriesWithTranslations =
          await this.serviceCategoryService.getAllCategoriesWithServices(
            locale,
          );
        logger.info(
          `DEBUG: Retrieved ${categoriesWithTranslations.length} categories for heatmap from ServiceCategoryService`,
        );

        // Map to format needed for heatmap
        categories = categoriesWithTranslations.map((cat) => ({
          id: cat.catKey,
          name: cat.name, // Already translated by service
        }));

        logger.debug(
          `DEBUG: Mapped categories for heatmap:`,
          JSON.stringify(categories.slice(0, 3), null, 2),
        );
      } catch (serviceCategoryError) {
        logger.error(
          `Error getting categories from ServiceCategoryService for heatmap: ${serviceCategoryError.message}`,
          {
            stack: serviceCategoryError.stack,
          },
        );

        // Fallback to generic categories if service fails
        logger.warn("Using generic fallback categories for heatmap");
        categories = Array.from({ length: 10 }, (_, i) => ({
          id: String(i + 1),
          name: `Category ${i + 1}`,
        }));
      }

      // Initialize heatmap data with zeros for all categories
      const heatmapData = categories.map((category) => ({
        name: category.name,
        data: timePeriods.map((period) => ({ x: period.label, y: 0 })),
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

        try {
          const feedbackCursor = await this.db.query(feedbackQuery);
          const feedbackResults = await feedbackCursor.all();

          logger.debug(
            `DEBUG: Feedback results for period ${period.label}:`,
            feedbackResults.length,
          );

          // Update heatmap data for this period
          feedbackResults.forEach((result) => {
            const categoryIndex = categories.findIndex(
              (c) => c.id === result.categoryId,
            );
            if (categoryIndex !== -1) {
              const periodIndex = timePeriods.findIndex(
                (p) => p.label === period.label,
              );
              if (periodIndex !== -1) {
                const satisfactionPercentage = Math.floor(
                  (result.average / 5) * 100,
                );
                heatmapData[categoryIndex].data[periodIndex].y =
                  satisfactionPercentage;
                logger.debug(
                  `DEBUG: Set heatmap value for ${categories[categoryIndex].name} at ${period.label}: ${satisfactionPercentage}%`,
                );
              }
            }
          });
        } catch (queryError) {
          logger.error(
            `Error querying feedback for period ${period.label}: ${queryError.message}`,
            {
              stack: queryError.stack,
            },
          );
        }
      }

      logger.info("getSatisfactionHeatmapData: Successful data retrieval", {
        categories: categories.length,
        periods: timePeriods.length,
        heatmapDataSample: heatmapData.slice(0, 2).map((item) => ({
          name: item.name,
          dataLength: item.data.length,
        })),
        method: "getSatisfactionHeatmapData",
      });

      return heatmapData;
    } catch (error) {
      logger.error("getSatisfactionHeatmapData: Query execution failed", {
        error: error.message,
        stack: error.stack,
        method: "getSatisfactionHeatmapData",
      });

      // Return empty array on error
      return [];
    }
  }
}

// Singleton instance
const instance = new AnalyticsService();
module.exports = instance;
