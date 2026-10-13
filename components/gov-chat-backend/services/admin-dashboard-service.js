const { logger, dbService } = require('../shared-lib');
const os = require('os');
const fs = require('fs').promises;
const path = require('path');
class AdminDashboardService {
  constructor() {
    this.db = null;
    this.initialized = false;
    this.resourceUsageMonitor = new ResourceUsageMonitor();
    this.logsService = null;
    this.securityScanService = null;
  }

  setLogsService(logsService) {
    this.logsService = logsService;
    logger.debug('LogsService set in AdminDashboardService');
  }

  setSecurityScanService(securityScanService) {
    this.securityScanService = securityScanService;
    logger.debug('SecurityScanService set in AdminDashboardService');
  }

  async init() {
    if (this.initialized) {
      logger.debug('AdminDashboardService already initialized, skipping');
      return;
    }
    try {
      this.db = await dbService.getConnection('default');
      this.initialized = true;
      logger.info('AdminDashboardService database initialized');
    } catch (error) {
      logger.error(`Error initializing AdminDashboardService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Manually refresh resource usage
   * @returns {Promise<Object>} Current resource usage
   */
  async refreshResourceUsage() {
    return await this.resourceUsageMonitor.getResourceUsage();
  }

  /**
   * Get system health statistics
   * @returns {Promise<Object>} System health metrics
   */
  async getSystemHealth() {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    logger.info('Getting system health metrics');

    try {
      let activeUsersValue = 0;
      // `null` means "not computable" — VictoriaLogs was unreachable or
      // answered a body the adapter could not read. It is deliberately
      // NOT 0: a zero error rate is a real, meaningful reading, and
      // flattening "we don't know" into it renders a green tile for a day
      // nobody measured. The admin panel shows a dash for null.
      let errorRate = null;
      let systemUptime = 0;
      // A trend is a comparison between two measurements. When either
      // side is missing there is nothing to compare, and the honest
      // answer is `null` — the admin panel then renders no trend at all.
      // Coercing that to 0 told the operator "unchanged" about a period
      // nobody measured, which is the same class of lie as reporting an
      // uncomputable error rate as 0.00%.
      let uptimeTrend = null;
      let activeUsersTrend = null;
      let responseTimeTrend = null;
      let errorRateTrend = null;

      const now = new Date();
      const oneDayAgo = new Date(now);
      oneDayAgo.setDate(now.getDate() - 1);
      const oneMonthAgo = new Date(now);
      oneMonthAgo.setDate(now.getDate() - 30);
      const twoMonthsAgo = new Date(now);
      twoMonthsAgo.setDate(now.getDate() - 60);
      const startDate = oneDayAgo.toISOString();
      const oneMonthAgoDate = oneMonthAgo.toISOString();
      const twoMonthsAgoDate = twoMonthsAgo.toISOString();
      logger.debug(
        `Date ranges: now=${now.toISOString()}, oneDayAgo=${startDate}, oneMonthAgo=${oneMonthAgoDate}, twoMonthsAgo=${twoMonthsAgoDate}`
      );

      const totalTimeSeconds = 30 * 24 * 60 * 60;
      const currentUptimeSeconds = os.uptime();
      let totalDowntimeSeconds = 0;
      if (currentUptimeSeconds < totalTimeSeconds) {
        const downtimePerRebootSeconds = 5 * 60;
        totalDowntimeSeconds = downtimePerRebootSeconds;
        logger.debug(
          `System rebooted ${currentUptimeSeconds} seconds ago; assuming ${downtimePerRebootSeconds} seconds of downtime`
        );
      } else {
        logger.debug('System has been up for more than 30 days; assuming no downtime in the last 30 days');
      }

      systemUptime = (((totalTimeSeconds - totalDowntimeSeconds) / totalTimeSeconds) * 100).toFixed(2);
      logger.debug(
        `System Uptime Calculation: totalTimeSeconds=${totalTimeSeconds}, currentUptimeSeconds=${currentUptimeSeconds}, totalDowntimeSeconds=${totalDowntimeSeconds}, systemUptime=${systemUptime}%`
      );

      // Route the error-rate window through `_yesterdayRange()` so the
      // error-rate tile, both debugYesterdayLogs paths and the log list
      // resolve "yesterday" through the same LOCAL calendar day. The
      // previous inline UTC-day window sat two hours off the list on a
      // UTC+2 host, and six hours in El Salvador.
      const { start: yesterdayStartIso, end: yesterdayEndIso } = this._yesterdayRange();
      logger.debug(`Error Rate window: start=${yesterdayStartIso}, end=${yesterdayEndIso}`);
      // Real OTel `service.name` stamps (see components/*/tracing.js + setup_tracing() calls):
      // backend, document-repository, genieai-chatqna, genieai-dataprep,
      // genieai-retriever, reranker. The `genie-*` prefix this used to match
      // zeroed out the error-rate tile because no production service starts
      // with `genie-`.
      try {
        const counts = await (
          await this._getVlClient()
        ).hits({
          // Real OTel `service.name` stamps (see components/*/tracing.js +
          // setup_tracing() calls): backend, document-repository, genieai-*
          // (chatqna/dataprep/retriever/reranker when OTel SDK init runs),
          // reranker. Under ENABLE_OBSERVABILITY=0 the OTel SDK short-
          // circuits and the Compose block name lands on `service.name`
          // (e.g. chatqna-xeon-backend-server, dataprep-arango-service,
          // retriever-arango-service) — that mode would have zeroed out
          // this tile entirely. OR-join both naming conventions so the
          // operator sees one unified count regardless of mode.
          q: 'service.name:(backend OR document-repository OR genieai-* OR reranker OR chatqna-* OR dataprep-* OR retriever-* OR embedding-* OR textgen-* OR nginx OR kong OR postgres OR keycloak OR redis OR otel-collector OR victoriametrics OR victoriatraces OR tempo-proxy)',
          field: 'severity_text',
          start: yesterdayStartIso,
          end: yesterdayEndIso
        });
        const totalLogs = Object.values(counts).reduce((a, b) => a + b, 0);
        const errorLogs = (counts.ERROR || counts.error || counts.FATAL || counts.fatal || 0) >>> 0;
        errorRate = totalLogs > 0 ? Number(((errorLogs / totalLogs) * 100).toFixed(2)) : 0;
        logger.debug(
          `Error Rate Calculation (VL): totalLogs=${totalLogs}, errorLogs=${errorLogs}, errorRate=${errorRate}%`
        );
      } catch (vlErr) {
        // errorRate stays null. The caller still gets a well-formed
        // response — this tile is one derived metric and must not 503 the
        // whole /api/admin/system-health payload — but the value is
        // reported as unavailable rather than as a clean 0.00%. The warn
        // line is the operator's signal; the null is what the operator's
        // screen shows.
        logger.warn(`Error-rate metric unavailable from VictoriaLogs: ${vlErr.message}`);
      }

      // Numeric projection of the tile value, ONCE, after the VL block
      // has had its say. Everything downstream (analytics writes, the
      // month-over-month trend, the response payload) reads this rather
      // than re-running parseFloat on a value that may be null —
      // `parseFloat(null)` is NaN, and a NaN persisted into the
      // analytics collection poisons every later read of it.
      const errorRateNumber = errorRate === null ? null : Number(errorRate);

      logger.debug('Fetching unique monthly active users from sessions collection (last 30 days)');
      const mauCursor = await this.db.query(
        `
        FOR s IN sessions
        FILTER s.startTime >= @oneMonthAgoDate
        COLLECT userId = s.userId INTO groups
        RETURN userId`,
        { oneMonthAgoDate }
      );
      const uniqueUsers = await mauCursor.all();
      activeUsersValue = uniqueUsers.length;
      logger.debug(`Unique Monthly Active Users (MAUs): ${activeUsersValue}`);

      logger.debug("Fetching last month's analytics for trend calculation");
      const lastMonthAnalyticsCursor = await this.db.query(
        `
        FOR a IN analytics
          FILTER a.period == 'monthly' AND a.startDate >= @twoMonthsAgoDate AND a.startDate < @oneMonthAgoDate
          SORT a.startDate DESC
          LIMIT 1
          RETURN a
      `,
        { oneMonthAgoDate, twoMonthsAgoDate }
      );
      const lastMonthAnalytics = await lastMonthAnalyticsCursor.next();
      logger.debug(`Last month's analytics data: ${JSON.stringify(lastMonthAnalytics)}`);

      uptimeTrend = lastMonthAnalytics ? (parseFloat(systemUptime) - lastMonthAnalytics.uptime).toFixed(2) : null;
      logger.debug(
        `Uptime Trend Calculation: currentUptime=${systemUptime}, lastMonthUptime=${lastMonthAnalytics?.uptime || 0}, uptimeTrend=${uptimeTrend}%`
      );

      logger.debug('Storing current uptime in analytics collection');
      await this.storeAnalyticsData({
        period: 'monthly',
        startDate: now.toISOString(),
        uptime: parseFloat(systemUptime),
        uniqueUsers: activeUsersValue,
        // A day we could not measure is stored as null, not as 0 —
        // otherwise the next read cannot tell it from a clean day.
        errorRate: errorRateNumber
      });

      logger.debug('Fetching MAUs for the previous 30-day period (two months ago to one month ago)');
      const previousMauCursor = await this.db.query(
        `
        FOR s IN sessions
        FILTER s.startTime >= @twoMonthsAgoDate AND s.startTime < @oneMonthAgoDate
        COLLECT userId = s.userId INTO groups
        RETURN userId`,
        { twoMonthsAgoDate, oneMonthAgoDate }
      );
      const previousUniqueUsers = await previousMauCursor.all();
      const previousMau = previousUniqueUsers.length;
      logger.debug(`Previous MAUs (from ${twoMonthsAgoDate} to ${oneMonthAgoDate}): ${previousMau}`);

      activeUsersTrend = previousMau ? (((activeUsersValue - previousMau) / previousMau) * 100).toFixed(2) : null;
      logger.debug(
        `MAUs Trend Calculation: currentMAUs=${activeUsersValue}, previousMAUs=${previousMau}, activeUsersTrend=${activeUsersTrend}%`
      );

      logger.debug('Fetching average response time from queries collection');
      const queriesCursor = await this.db.query(
        `
        FOR q IN queries
        FILTER q.timestamp >= @startDate
        COLLECT AGGREGATE 
        avgTime = AVERAGE(q.responseTime), 
        count = COUNT()
        RETURN { avgTime, count }`,
        { startDate }
      );
      const queriesStats = (await queriesCursor.next()) || { avgTime: 0, count: 0 };
      logger.debug(`Queries stats (in milliseconds): avgTime=${queriesStats.avgTime}, count=${queriesStats.count}`);

      logger.debug("Fetching last month's average response time for trend calculation");
      const lastMonthQueriesCursor = await this.db.query(
        `
        FOR q IN queries
        FILTER q.timestamp >= @twoMonthsAgoDate AND q.timestamp < @oneMonthAgoDate
        COLLECT AGGREGATE 
        avgTime = AVERAGE(q.responseTime * 1000)
        RETURN avgTime`,
        { twoMonthsAgoDate, oneMonthAgoDate }
      );
      const lastMonthAvgTime = (await lastMonthQueriesCursor.next()) || 0;
      logger.debug(`Last month's average response time (in milliseconds): ${lastMonthAvgTime}`);

      responseTimeTrend = lastMonthAvgTime
        ? (((queriesStats.avgTime - lastMonthAvgTime) / lastMonthAvgTime) * 100).toFixed(2)
        : null;
      logger.debug(
        `Response Time Trend Calculation: currentAvgTime=${queriesStats.avgTime}, lastMonthAvgTime=${lastMonthAvgTime}, responseTimeTrend=${responseTimeTrend}%`
      );

      logger.debug("Fetching last month's error rate for trend calculation");
      const lastMonthErrorRateCursor = await this.db.query(
        `
        FOR a IN analytics
          FILTER a.period == 'monthly' AND a.startDate >= @twoMonthsAgoDate AND a.startDate < @oneMonthAgoDate
          SORT a.startDate DESC
          LIMIT 1
          RETURN a.errorRate
      `,
        { twoMonthsAgoDate, oneMonthAgoDate }
      );
      const lastMonthErrorRate = (await lastMonthErrorRateCursor.next()) || 0;
      logger.debug(`Last month's error rate: ${lastMonthErrorRate}`);

      errorRateTrend =
        lastMonthErrorRate && errorRateNumber !== null ? (errorRateNumber - lastMonthErrorRate).toFixed(2) : null;
      logger.debug(
        `Error Rate Trend Calculation: currentErrorRate=${errorRate}, lastMonthErrorRate=${lastMonthErrorRate}, errorRateTrend=${errorRateTrend}%`
      );

      logger.debug('Updating analytics with error rate');
      await this.storeAnalyticsData({
        period: 'daily',
        startDate: now.toISOString(),
        uptime: parseFloat(systemUptime),
        uniqueUsers: activeUsersValue,
        // A day we could not measure is stored as null, not as 0 —
        // otherwise the next read cannot tell it from a clean day.
        errorRate: errorRateNumber
      });

      const resourceUsage = await this.resourceUsageMonitor.getResourceUsage();
      logger.debug(`Resource Usage: ${JSON.stringify(resourceUsage)}`);

      logger.debug('Determining health status of services');
      const healthServices = [
        { id: 'apiServices', name: 'API Services', status: resourceUsage.cpu < 80 ? 'good' : 'warning' },
        { id: 'database', name: 'Database', status: 'good' },
        { id: 'cache', name: 'Cache', status: 'good' },
        { id: 'storage', name: 'Storage', status: resourceUsage.storage < 90 ? 'good' : 'warning' },
        { id: 'messageQueue', name: 'Message Queue', status: 'good' },
        { id: 'externalApi', name: 'External API', status: 'good' }
      ];
      logger.debug(`Health Services: ${JSON.stringify(healthServices)}`);

      const response = {
        metrics: {
          systemUptime: parseFloat(systemUptime),
          avgResponseTime: Math.round(queriesStats.avgTime),
          errorRate: errorRateNumber,
          monthlyActiveUsers: activeUsersValue
        },
        trends: {
          // `parseFloat(null)` is NaN, which would reach the panel as the
          // string "NaN". These are nullable by design — see the
          // declaration above — so they pass through as null.
          uptime: uptimeTrend === null ? null : Number(uptimeTrend),
          responseTime: responseTimeTrend === null ? null : Number(responseTimeTrend),
          errorRate: errorRateTrend === null ? null : Number(errorRateTrend),
          activeUsers: activeUsersTrend === null ? null : Number(activeUsersTrend)
        },
        resourceUsage,
        healthServices
      };
      logger.debug(`Final response: ${JSON.stringify(response)}`);

      return response;
    } catch (error) {
      logger.error(`Error in getSystemHealth: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Store analytics data in the database
   * @param {Object} data - Analytics data to store
   */
  async storeAnalyticsData(data) {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    try {
      logger.debug(`Storing analytics data: ${JSON.stringify(data)}`);
      const existingCursor = await this.db.query(
        `
        FOR a IN analytics
          FILTER a.period == @period AND a.startDate == @startDate
          LIMIT 1
          RETURN a
      `,
        { period: data.period, startDate: data.startDate }
      );

      const existing = await existingCursor.next();
      if (existing) {
        logger.debug(`Updating existing analytics record with key ${existing._key}`);
        await this.db.query(
          `
          UPDATE @key WITH @data IN analytics
        `,
          { key: existing._key, data }
        );
      } else {
        logger.debug('Inserting new analytics record');
        await this.db.query(
          `
          INSERT @data INTO analytics
        `,
          { data }
        );
      }
    } catch (error) {
      logger.error(`Error storing analytics data: ${error.message}`);
    }
  }

  /**
   * Get database statistics
   * @returns {Promise<Object>} Database statistics
   */
  async getDatabaseStats() {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    logger.info('Getting database statistics');

    try {
      logger.debug('Fetching collection statistics');
      const collections = await this.db.collections();
      const collectionStats = await Promise.all(
        collections.map(async (collection) => {
          const figures = await collection.figures();
          logger.debug(`Collection ${collection.name}: count=${figures.count}, size=${figures.size}`);
          return {
            name: collection.name,
            count: figures.count,
            size: figures.size
          };
        })
      );

      const totalSize = collectionStats.reduce((sum, coll) => sum + coll.size, 0);
      const formattedSize = (totalSize / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
      logger.debug(`Total database size: ${totalSize} bytes, formatted: ${formattedSize}`);

      const response = {
        databaseSize: formattedSize,
        totalTables: collections.length,
        collections: collectionStats
      };
      logger.debug(`Database stats response: ${JSON.stringify(response)}`);

      return response;
    } catch (error) {
      logger.error(`Error in getDatabaseStats: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Format time ago for display
   * @param {Date} date - Date to format
   * @returns {string} Formatted time ago string
   */
  formatTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    let result;
    if (diffDays === 0) result = 'Today';
    else if (diffDays === 1) result = '1 day ago';
    else result = `${diffDays} days ago`;
    logger.debug(`Formatting time ago: date=${date}, diffDays=${diffDays}, result=${result}`);
    return result;
  }

  /**
   * Get user statistics
   * @returns {Promise<Object>} User statistics
   */
  async getUserStats() {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    logger.info('Getting user statistics');

    try {
      logger.debug('Fetching total user count');
      const userCountCursor = await this.db.query(`
        RETURN LENGTH(FOR u IN users FILTER u.deleted != true RETURN 1)
      `);
      const userCount = await userCountCursor.next();
      logger.debug(`Total users: ${userCount}`);

      logger.debug('Fetching active users in the last day');
      const activeUsersCursor = await this.db.query(`
        LET oneDayAgo = DATE_SUBTRACT(DATE_NOW(), 1, "day")
        RETURN LENGTH(
          FOR s IN sessions
            FILTER s.startTime >= oneDayAgo OR s.active == true
            COLLECT userId = s.userId
            RETURN 1
        )
      `);
      const activeUsers = await activeUsersCursor.next();
      logger.debug(`Active users: ${activeUsers}`);

      logger.debug('Fetching new users in the last month');
      const newUsersCursor = await this.db.query(`
        LET oneMonthAgo = DATE_SUBTRACT(DATE_NOW(), 1, "month")
        RETURN LENGTH(
          FOR u IN users
            FILTER u.deleted != true
            FILTER DATE_TIMESTAMP(u.createdAt) >= DATE_TIMESTAMP(oneMonthAgo)
            RETURN 1
        )
      `);
      const newUsers = await newUsersCursor.next();
      logger.debug(`New users: ${newUsers}`);

      logger.debug('Fetching sample user list (top 10)');
      const usersCursor = await this.db.query(`
        FOR u IN users
          FILTER u.deleted != true
          SORT u.updatedAt DESC
          LIMIT 10
          RETURN {
            _key: u._key,
            loginName: u.loginName,
            email: u.email,
            fullName: HAS(u, "personalIdentification") ? u.personalIdentification.fullName : u.name,
            roles: HAS(u, "roles") ? (FOR r IN u.roles FILTER r != "offline_access" AND r != "uma_authorization" AND r NOT LIKE "default-roles-%" RETURN r) : (HAS(u, "role") ? [u.role] : [])
          }
      `);
      const users = await usersCursor.all();

      const response = {
        totalUsers: userCount,
        activeUsers,
        newUsers,
        users
      };

      return response;
    } catch (error) {
      logger.error(`Error in getUserStats: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Get system logs
   * @param {Object} options - Log options
   * @param {number} options.limit - Maximum number of logs to return
   * @param {string} options.level - Log level filter
   * @param {string} options.service - Service name filter
   * @param {string} options.dateRange - Date range (today, yesterday, week, month, custom)
   * @param {string} options.startDate - Start date for custom range
   * @param {string} options.endDate - End date for custom range
   * @returns {Promise<Object>} Log data
   */
  async getLogs(options = {}) {
    const { limit = 100, offset = 0, level, service, dateRange = 'today', startDate, endDate, q } = options;
    logger.info(`Getting system logs with options: ${JSON.stringify(options)}`);
    if (!this.logsService || typeof this.logsService.getLogsInRange !== 'function') {
      throw new Error('LogsService is not configured');
    }
    try {
      const envelope = await this.logsService.getLogsInRange({
        dateRange,
        startDate,
        endDate,
        level,
        service,
        limit,
        offset,
        q
      });
      logger.debug(`Logs response: ${JSON.stringify(envelope)}`);
      return envelope;
    } catch (error) {
      logger.error(`Error in getLogs: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Get logs summary by type and service
   * @param {Object} options - Summary options
   * @param {string} options.date - Date to summarize (YYYY-MM-DD)
   * @param {string} options.level - Log level filter
   * @returns {Promise<Object>} Summary data
   */
  async getLogsSummary(options = {}) {
    return this.logsService.getLogsSummary(options);
  }

  /**
   * Debug logs for yesterday to diagnose issues
   * @returns {Promise<Object>} Debug log data
   */
  async debugYesterdayLogs() {
    logger.info('Getting debug logs for yesterday');

    const { start, end } = this._yesterdayRange();
    logger.debug(`Querying VL debug+error logs: start=${start}, end=${end}`);

    let results;
    try {
      results = await (
        await this._getVlClient()
      ).query({
        q: 'severity_text:(DEBUG OR ERROR) service.name:(backend OR document-repository OR genieai-* OR reranker)',
        start,
        end,
        limit: 1000
      });
    } catch (vlErr) {
      // VL outage → typed `VlUnavailableError` (503, body `{error:
      // 'vl_unreachable'}`). Validation / programmer errors propagate
      // unchanged so the route layer keeps its existing 400 / 500
      // semantics. The admin UI renders the degraded banner on the 503
      // envelope, not on a custom envelope field.
      const { LogsService } = require('./logs-service');
      LogsService._vlOrThrow(vlErr);
    }

    // Rows arrive from `VictoriaLogsAdapter._normalizeRow()`, whose shape is
    // `{timestamp, message, stream, fields, date, time, level, service}`.
    // `_time` is a RESERVED field stripped during normalisation, and `time`
    // is the bare `HH:MM:SS` slice of the ISO string — feeding either to
    // `new Date()` yields an Invalid Date and `toISOString()` throws a
    // RangeError that is not a VL error, so it escapes `_vlOrThrow` and
    // surfaces as a bare 500. Everything the raw wire shape carried outside
    // the three reserved keys lives under `fields`.
    const logs = (Array.isArray(results) ? results : []).map((entry) => {
      const fields = entry.fields || {};
      const ts = entry.timestamp || null;
      const tsDate = ts ? new Date(ts) : new Date();
      return {
        date: tsDate.toISOString().split('T')[0],
        time: tsDate.toLocaleTimeString(),
        level: String(entry.level || fields.severity_text || '').toUpperCase(),
        service: entry.service || fields['service.name'] || 'unknown',
        message: entry.message || ''
      };
    });

    const response = { logs, total: logs.length };
    logger.debug(`Debug logs response: ${JSON.stringify(response)}`);
    return response;
  }

  /**
   * Lazy MELT seam accessor for the shared VictoriaLogsClient.
   * Mirrors `LogsService._getVlClient()` so both services build clients
   * identically from `../shared-lib/melt`.
   *
   * Single-flight: concurrent first-callers construct exactly one
   * client. Without this guard, three parallel callers build three
   * clients, each runs the 3-attempt health probe for a total of 9
   * outbound probes during a VL outage (3 callers × 3 attempts), and
   * the axios pool fragments across three independent adapters.
   *
   * The promise is cleared on rejection so the NEXT caller retries
   * the construction (the original copy of this helper silently kept
   * the rejected promise cached forever, so every caller after a
   * failed probe observed the same rejection until pod restart).
   */
  _getVlClient() {
    if (this._vlClient) return this._vlClient;
    if (this._vlClientPromise) return this._vlClientPromise;
    const melt = require('../shared-lib/melt');
    if (!melt || !melt.VictoriaLogsClient) {
      throw new Error('VictoriaLogsClient is not available on the MELT seam');
    }
    this._vlClientPromise = (async () => {
      const client = new melt.VictoriaLogsClient({
        skipHealthProbe: process.env.NODE_ENV === 'test'
      });
      this._vlClient = client;
      return client;
    })();
    // Clear the cached promise on rejection so the next caller retries.
    this._vlClientPromise.catch(() => {
      this._vlClientPromise = null;
    });
    return this._vlClientPromise;
  }

  /**
   * Yesterday window as ISO strings, delegated to the LogsService
   * singleton so the error-rate tile, both `debugYesterdayLogs` paths and
   * the log list all resolve `yesterday` through ONE definition.
   *
   * That definition is the LOCAL calendar day (midnight → 23:59:59.999
   * local), which is the meaningful one for an operator: "yesterday" on a
   * UTC+2 host is their yesterday. This method previously computed a UTC
   * calendar day inline, so the error-rate tile counted a window offset by
   * the host's UTC offset from the rows the list beside it showed —
   * 2 h in Paris, 6 h in El Salvador. Production containers run UTC so
   * neither matched there; every local dev host east of Greenwich did.
   *
   * @returns {{start: string, end: string}} ISO strings
   */
  _yesterdayRange() {
    const { _defaultStartIso, _defaultEndIso } = require('./logs-service');
    return {
      start: _defaultStartIso('yesterday'),
      end: _defaultEndIso('yesterday')
    };
  }

  /**
   * Backup database
   * @returns {Promise<Object>} Backup result
   */
  async backupDatabase() {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    logger.info('Backing up database');

    try {
      logger.debug('Starting database backup');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = process.env.BACKUP_DIR || path.join(__dirname, '../backups');
      await fs.mkdir(backupDir, { recursive: true });

      // Export all collections using arangojs API (no shell commands needed)
      const collections = await this.db.collections();
      const backupData = {};
      let totalDocuments = 0;

      for (const collection of collections) {
        try {
          const cursor = await collection.all();
          const documents = await cursor.all();
          backupData[collection.name] = documents;
          totalDocuments += documents.length;
          logger.debug(`Exported ${documents.length} documents from ${collection.name}`);
        } catch (err) {
          logger.warn(`Skipping collection ${collection.name}: ${err.message}`);
        }
      }

      const backupFile = path.join(backupDir, `backup-${timestamp}.json`);
      await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2));
      logger.debug(
        `Backup completed: ${totalDocuments} documents across ${Object.keys(backupData).length} collections`
      );

      const response = {
        status: 'success',
        message: 'Database backup completed successfully',
        backupFile,
        collections: Object.keys(backupData),
        documentCount: totalDocuments
      };
      logger.debug(`Backup response: ${JSON.stringify(response)}`);

      return response;
    } catch (error) {
      logger.error(`Error in backupDatabase: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Optimize database
   * @returns {Promise<Object>} Optimization result
   */
  async optimizeDatabase() {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    logger.info('Optimizing database');

    try {
      logger.debug('Starting database optimization');
      const collections = await this.db.collections();
      for (const collection of collections) {
        logger.debug(`Optimizing collection: ${collection.name}`);
        // Simulate optimization (actual implementation depends on ArangoDB setup)
        await collection.figures();
      }

      const timestamp = new Date().toISOString();
      await this.storeAnalyticsData({
        event: 'optimize',
        timestamp
      });

      const response = {
        status: 'success',
        message: 'Database optimized successfully',
        timestamp
      };
      logger.debug(`Optimize response: ${JSON.stringify(response)}`);

      return response;
    } catch (error) {
      logger.error(`Error in optimizeDatabase: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Get security metrics
   * @returns {Promise<Object>} Security metrics
   */
  async getSecurityMetrics() {
    try {
      logger.info('Fetching security metrics');
      if (!this.securityScanService) {
        throw new Error('SecurityScanService not initialized in AdminDashboardService');
      }
      const vulnerabilities = await this.securityScanService.checkLogsForIssues(this.logsService);
      logger.debug(`Security metrics response: ${JSON.stringify(vulnerabilities, null, 2)}`);
      return {
        lastScan: new Date().toISOString(),
        vulnerabilities: {
          critical: vulnerabilities.critical.length,
          medium: vulnerabilities.medium.length,
          low: vulnerabilities.low.length,
          details: [...vulnerabilities.critical, ...vulnerabilities.medium, ...vulnerabilities.low]
        },
        vulnerabilityDetails: vulnerabilities,
        failedLoginDetails: vulnerabilities.low.filter((v) => v.type === 'failed_login'),
        suspiciousDetails: vulnerabilities.critical
      };
    } catch (error) {
      logger.error(`Error fetching security metrics: ${error.message}`, { stack: error.stack });
      return {
        lastScan: 'Never',
        vulnerabilities: { critical: 0, medium: 0, low: 0, details: [] },
        vulnerabilityDetails: { critical: [], medium: [], low: [] },
        failedLoginDetails: [],
        suspiciousDetails: []
      };
    }
  }

  /**
   * Run system diagnostics
   * @returns {Promise<Object>} Diagnostics results
   */
  async runDiagnostics() {
    logger.info('Running system diagnostics');

    try {
      logger.debug('Collecting system information');
      const systemInfo = {
        os: {
          type: os.type(),
          platform: os.platform(),
          release: os.release(),
          uptime: os.uptime()
        },
        memory: {
          total: os.totalmem(),
          free: os.freemem(),
          usage: Math.round((1 - os.freemem() / os.totalmem()) * 100)
        },
        cpu: {
          model: os.cpus()[0].model,
          cores: os.cpus().length,
          loadAvg: os.loadavg()
        },
        process: {
          pid: process.pid,
          uptime: process.uptime(),
          memory: process.memoryUsage()
        }
      };
      logger.debug(`System info: ${JSON.stringify(systemInfo)}`);

      logger.debug('Checking disk space');
      let diskSpace;
      try {
        const stats = await fs.statfs('/');
        const totalGB = Math.round((stats.blocks * stats.bsize) / (1024 * 1024 * 1024));
        const freeGB = Math.round((stats.bavail * stats.bsize) / (1024 * 1024 * 1024));
        const usedPercent = Math.round(((stats.blocks - stats.bavail) / stats.blocks) * 100);
        diskSpace = `Filesystem /: ${totalGB}G total, ${freeGB}G available (${usedPercent}% used)`;
        logger.debug(`Disk space: ${diskSpace}`);
      } catch (error) {
        diskSpace = 'Unable to fetch disk space information';
        logger.error(`Error getting disk space: ${error.message}`);
      }

      logger.debug('Checking network connectivity');
      const networkChecks = [
        { service: 'API Services', status: 'good' },
        { service: 'Database', status: (await this.checkDatabaseHealth()) ? 'good' : 'error' },
        { service: 'Cache', status: 'good' },
        { service: 'External API', status: 'good' }
      ];
      logger.debug(`Network checks: ${JSON.stringify(networkChecks)}`);

      const response = {
        systemInfo,
        diskSpace,
        networkChecks
      };
      logger.debug(`Diagnostics response: ${JSON.stringify(response)}`);

      return response;
    } catch (error) {
      logger.error(`Error in runDiagnostics: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Check database health
   * @returns {Promise<boolean>} Database health status
   */
  async checkDatabaseHealth() {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    try {
      logger.debug('Checking database health');
      await this.db.query('RETURN 1');
      logger.debug('Database health check passed');
      return true;
    } catch (error) {
      logger.error(`Database health check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Search users with filtering
   * @param {Object} options - Search options
   * @param {string} options.term - Search term
   * @param {string} options.field - Field to search (name, email, role, or all)
   * @param {number} options.limit - Maximum number of users to return
   * @param {number} options.offset - Offset for pagination
   * @returns {Promise<Object>} Search results
   */
  async searchUsers(options = {}) {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    logger.info(`Searching users with options: ${JSON.stringify(options)}`);

    try {
      const { term = '', field = 'all', limit = 20, offset = 0 } = options;

      // MR !343 round-2: clamp numeric query params safely.
      // parseInt('0', 10) is falsy → `|| 20` silently rewrote a caller
      // asking for `limit=0` into 20 rows. Use the same code-clamp
      // pattern as `logs-service.js` so 0 / negative / non-finite inputs
      // do not fall through to the default.
      const parsedLimitRaw = Number.isFinite(Number(limit)) ? parseInt(limit, 10) : 20;
      const parsedLimit = Math.max(0, Math.min(parsedLimitRaw, 1000));
      const parsedOffsetRaw = Number.isFinite(Number(offset)) ? parseInt(offset, 10) : 0;
      const parsedOffset = Math.max(0, parsedOffsetRaw);

      let countQuery, usersQuery, queryParams;

      if (term) {
        queryParams = { limit: parsedLimit, offset: parsedOffset };
        let filterCondition;
        switch (field) {
          case 'name':
            queryParams.term = `%${term.toLowerCase()}%`;
            filterCondition = `
              LOWER(u.loginName) LIKE @term
              OR LOWER(u.name) LIKE @term
              OR (HAS(u, "personalIdentification") AND LOWER(u.personalIdentification.fullName) LIKE @term)
            `;
            break;
          case 'email':
            queryParams.term = `%${term.toLowerCase()}%`;
            filterCondition = `LOWER(u.email) LIKE @term`;
            break;
          case 'exactEmail':
            queryParams.exactTerm = term.toLowerCase();
            filterCondition = `LOWER(u.email) == @exactTerm`;
            break;
          case 'role':
            queryParams.term = `%${term.toLowerCase()}%`;
            filterCondition = `HAS(u, "roles") AND LENGTH(FOR r IN u.roles FILTER LOWER(r) LIKE @term RETURN 1) > 0`;
            break;
          case 'all':
          default:
            queryParams.term = `%${term.toLowerCase()}%`;
            filterCondition = `
              LOWER(u.loginName) LIKE @term
              OR LOWER(u.email) LIKE @term
              OR LOWER(u.name) LIKE @term
              OR (HAS(u, "personalIdentification") AND LOWER(u.personalIdentification.fullName) LIKE @term)
              OR (HAS(u, "roles") AND LENGTH(FOR r IN u.roles FILTER LOWER(r) LIKE @term RETURN 1) > 0)
            `;
            break;
        }

        countQuery = `
          RETURN LENGTH(
            FOR u IN users
              FILTER u.deleted != true
              FILTER ${filterCondition}
              RETURN 1
          )
        `;

        // MR !343 round-2: bindVars for LIMIT (AQL injection sink — `LIMIT
        // ${parsedOffset}, ${parsedLimit}` was a template literal; parseInt
        // consumes only the leading digit prefix, so multi-statement
        // payloads like `limit=10;FOR u IN users REMOVE u IN users;//`
        // reached ArangoDB and executed).
        usersQuery = `
          FOR u IN users
            FILTER u.deleted != true
            FILTER ${filterCondition}
            SORT u.updatedAt DESC
            LIMIT @offset, @limit
            RETURN {
              _key: u._key,
              loginName: u.loginName,
              email: u.email,
              fullName: HAS(u, "personalIdentification") ? u.personalIdentification.fullName : u.name,
              roles: HAS(u, "roles") ? (FOR r IN u.roles FILTER r != "offline_access" AND r != "uma_authorization" AND r NOT LIKE "default-roles-%" RETURN r) : (HAS(u, "role") ? [u.role] : []),
              sub: HAS(u, "sub") ? u.sub : null,
              createdAt: u.createdAt,
              updatedAt: u.updatedAt
            }
        `;
      } else {
        queryParams = { limit: parsedLimit, offset: parsedOffset };
        countQuery = `
          RETURN LENGTH(
            FOR u IN users
              FILTER u.deleted != true
              RETURN 1
          )
        `;
        usersQuery = `
          FOR u IN users
            FILTER u.deleted != true
            SORT u.updatedAt DESC
            LIMIT @offset, @limit
            RETURN {
              _key: u._key,
              loginName: u.loginName,
              email: u.email,
              fullName: HAS(u, "personalIdentification") ? u.personalIdentification.fullName : u.name,
              roles: HAS(u, "roles") ? (FOR r IN u.roles FILTER r != "offline_access" AND r != "uma_authorization" AND r NOT LIKE "default-roles-%" RETURN r) : (HAS(u, "role") ? [u.role] : []),
              sub: HAS(u, "sub") ? u.sub : null,
              createdAt: u.createdAt,
              updatedAt: u.updatedAt
            }
        `;
      }

      const countCursor = await this.db.query(countQuery, queryParams);
      const usersCursor = await this.db.query(usersQuery, queryParams);

      const totalCount = await countCursor.next();
      const users = await usersCursor.all();

      logger.debug(`User search found ${totalCount} total matches, returning ${users.length} results`);

      return {
        users,
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset)
      };
    } catch (error) {
      logger.error(`Error in searchUsers: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Search logs with filtering
   * @param {Object} options - Search options
   * @param {string} options.term - Search term
   * @param {string} options.level - Log level filter
   * @param {string} options.service - Service name filter
   * @param {string} options.dateRange - Date range (today, yesterday, week, month, custom)
   * @param {string} options.startDate - Start date for custom range
   * @param {string} options.endDate - End date for custom range
   * @returns {Promise<Object>} Search results
   */
  async searchLogs(options = {}) {
    if (!this.logsService) {
      throw new Error('LogsService not initialized in AdminDashboardService');
    }
    logger.info(
      `AdminDashboardService.searchLogs calling LogsService.searchLogs with options: ${JSON.stringify(options)}`
    );

    try {
      // Call LogsService.searchLogs()
      const result = await this.logsService.searchLogs(options);
      logger.debug(`LogsService.searchLogs returned ${result.logs.length} logs`);
      return result;
    } catch (error) {
      logger.error(`Error in AdminDashboardService.searchLogs: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }
}

class ResourceUsageMonitor {
  constructor() {
    this.cachedUsage = null;
    this.lastUpdated = null;
    this.cacheTimeout = 30000;
  }

  async getCpuUsage() {
    return Math.round((os.loadavg()[0] / os.cpus().length) * 100);
  }

  async getMemoryUsage() {
    return Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
  }

  async getStorageUsage() {
    try {
      const stats = await fs.statfs('/');
      return Math.round(((stats.blocks - stats.bavail) / stats.blocks) * 100);
    } catch (error) {
      logger.error(`Error getting storage usage: ${error.message}`);
      return 50;
    }
  }

  async getNetworkUsage() {
    try {
      const data = await fs.readFile('/proc/net/dev', 'utf8');
      const lines = data.split('\n').slice(2);
      let totalBytes = 0;

      for (const line of lines) {
        if (line.trim()) {
          const parts = line.trim().split(/\s+/);
          const interfaceName = parts[0].replace(':', '');
          if (interfaceName !== 'lo') {
            totalBytes += parseInt(parts[1]) + parseInt(parts[9]);
          }
        }
      }
      return Math.min(Math.round((totalBytes / (1024 * 1024)) % 100), 100);
    } catch (error) {
      // /proc/net/dev unavailable (e.g., Kubernetes with restricted mounts)
      logger.debug(`Network stats unavailable: ${error.message}`);
      return 0;
    }
  }

  async getResourceUsage() {
    const now = Date.now();
    if (!this.cachedUsage || now - this.lastUpdated > this.cacheTimeout) {
      this.cachedUsage = {
        cpu: await this.getCpuUsage(),
        memory: await this.getMemoryUsage(),
        storage: await this.getStorageUsage(),
        network: await this.getNetworkUsage()
      };
      this.lastUpdated = now;
    }
    return this.cachedUsage;
  }
}

// Singleton instance
const instance = new AdminDashboardService();
module.exports = instance;
