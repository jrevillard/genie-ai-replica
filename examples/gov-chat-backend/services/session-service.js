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

class SessionService {
  constructor() {
    this.db = initDB;
    this.sessions = this.db.collection('sessions');
    this.userSessions = this.db.collection('userSessions');
    this.sessionExpirationTime = process.env.SESSION_EXPIRATION_TIME || 30 * 60 * 1000; // 30 minutes in milliseconds
    logger.info('SessionService initialized with expiration time:', this.sessionExpirationTime);
  }

  /**
   * Create a new session for a user
   * @param {String} userId - User ID
   * @param {Object} deviceInfo - Information about the user's device
   * @param {String} ipAddress - User's IP address
   * @returns {Promise<Object>} The created session
   */
  async createSession(userId, deviceInfo = {}, ipAddress = '') {
    try {
      logger.info(`Creating session for user ${userId}`);

      // Create basic session document - let ArangoDB generate the key
      const basicSessionDoc = {
        userId,
        startTime: new Date().toISOString(),
        active: true
      };
      
      logger.info(`Creating session for user ${userId}...`);
      const session = await this.sessions.save(basicSessionDoc);
      const sessionId = session._key;
      logger.info(`Session created with auto-generated key: ${sessionId}`);
      
      // Add additional information if provided
      const updateData = {};
      
      if (deviceInfo && typeof deviceInfo === 'object' && Object.keys(deviceInfo).length > 0) {
        updateData.deviceInfo = deviceInfo;
      }
      
      if (ipAddress && typeof ipAddress === 'string') {
        updateData.ipAddress = ipAddress;
      }
      
      // Update with additional data if needed
      if (Object.keys(updateData).length > 0) {
        logger.info(`Updating session ${sessionId} with additional data...`);
        await this.sessions.update(sessionId, updateData);
      }

      // Create edge between user and session
      try {
        logger.info(`Creating edge between user ${userId} and session ${sessionId}`);
        await this.userSessions.save({
          _from: `users/${userId}`,
          _to: `sessions/${sessionId}`,
          createdAt: new Date().toISOString()
        });
      } catch (error) {
        // If creating the edge fails, we'll log but continue
        logger.error(`Error creating user-session edge for user ${userId}:`, error);
      }

      // Return the full session document
      const fullSession = await this.sessions.document(sessionId);
      logger.info(`Session ${sessionId} created successfully for user ${userId}`);
      return fullSession;
    } catch (error) {
      logger.error(`Error creating session for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get active session for a user
   * @param {String} userId - User ID
   * @returns {Promise<Object|null>} The active session or null if none exists
   */
  async getActiveSession(userId) {
    try {
      logger.info(`Fetching active session for user ${userId}`);

      const query = aql`
        FOR session IN sessions
          FILTER session.userId == ${userId}
          FILTER session.active == true
          FILTER session.endTime == null
          SORT session.startTime DESC
          LIMIT 1
          RETURN session
      `;

      const cursor = await this.db.query(query);
      const session = await cursor.next();

      if (!session) {
        logger.info(`No active session found for user ${userId}`);
        return null;
      }

      // Check if session has expired
      const sessionStartTime = new Date(session.startTime).getTime();
      const currentTime = new Date().getTime();
      
      if (currentTime - sessionStartTime > this.sessionExpirationTime) {
        // Session has expired, end it
        logger.info(`Session ${session._key} for user ${userId} has expired`);
        await this.endSession(session._key);
        return null;
      }

      logger.info(`Active session ${session._key} found for user ${userId}`);
      return session;
    } catch (error) {
      logger.error(`Error getting active session for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Get or create a session for a user
   * @param {String} userId - User ID
   * @param {Object} deviceInfo - Information about the user's device
   * @param {String} ipAddress - User's IP address
   * @returns {Promise<Object>} The active or newly created session
   */
  async getOrCreateSession(userId, deviceInfo = {}, ipAddress = '') {
    try {
      logger.info(`Getting or creating session for user ${userId}`);

      const activeSession = await this.getActiveSession(userId);
      
      if (activeSession) {
        logger.info(`Returning existing active session ${activeSession._key} for user ${userId}`);
        return activeSession;
      }
      
      // No active session, create a new one
      logger.info(`No active session found, creating new session for user ${userId}`);
      return await this.createSession(userId, deviceInfo, ipAddress);
    } catch (error) {
      logger.error(`Error getting or creating session for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * End a session
   * @param {String} sessionId - Session ID
   * @returns {Promise<Object>} The updated session
   */
  async endSession(sessionId) {
    try {
      logger.info(`Ending session ${sessionId}`);

      const updatedSession = await this.sessions.update(
        sessionId,
        {
          active: false,
          endTime: new Date().toISOString()
        },
        { returnNew: true }
      );

      logger.info(`Session ${sessionId} ended successfully`);
      return updatedSession.new;
    } catch (error) {
      logger.error(`Error ending session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Keep a session alive (refresh expiration)
   * @param {String} sessionId - Session ID
   * @returns {Promise<Object>} The updated session
   */
  async keepSessionAlive(sessionId) {
    try {
      logger.info(`Keeping session ${sessionId} alive`);

      // This is a simple update to ensure the session doesn't expire
      // The logic is based on checking the startTime against current time
      const updatedSession = await this.sessions.update(
        sessionId,
        {
          lastActiveTime: new Date().toISOString()
        },
        { returnNew: true }
      );

      logger.info(`Session ${sessionId} kept alive successfully`);
      return updatedSession.new;
    } catch (error) {
      logger.error(`Error keeping session ${sessionId} alive:`, error);
      throw error;
    }
  }

  /**
   * Get all sessions for a user
   * @param {String} userId - User ID
   * @param {Boolean} activeOnly - Whether to return only active sessions
   * @returns {Promise<Array>} User sessions
   */
  async getUserSessions(userId, activeOnly = false) {
    try {
      logger.info(`Fetching sessions for user ${userId}${activeOnly ? ' (active only)' : ''}`);

      let query;
      
      if (activeOnly) {
        query = aql`
          FOR session IN sessions
            FILTER session.userId == ${userId}
            FILTER session.active == true
            SORT session.startTime DESC
            RETURN session
        `;
      } else {
        query = aql`
          FOR session IN sessions
            FILTER session.userId == ${userId}
            SORT session.startTime DESC
            RETURN session
        `;
      }

      const cursor = await this.db.query(query);
      const sessions = await cursor.all();
      logger.info(`Found ${sessions.length} sessions for user ${userId}`);
      return sessions;
    } catch (error) {
      logger.error(`Error getting sessions for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get session by ID
   * @param {String} sessionId - Session ID
   * @returns {Promise<Object>} The session
   */
  async getSession(sessionId) {
    try {
      logger.info(`Fetching session ${sessionId}`);

      const session = await this.sessions.document(sessionId);
      logger.info(`Session ${sessionId} retrieved successfully`);
      return session;
    } catch (error) {
      logger.error(`Error getting session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up expired sessions
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanupExpiredSessions() {
    try {
      logger.info('Starting cleanup of expired sessions');

      const expirationTime = new Date(Date.now() - this.sessionExpirationTime).toISOString();
      
      // Find active sessions that have expired
      const query = aql`
        FOR session IN sessions
          FILTER session.active == true
          FILTER session.startTime < ${expirationTime}
          FILTER session.lastActiveTime == null OR session.lastActiveTime < ${expirationTime}
          RETURN session
      `;
      
      const cursor = await this.db.query(query);
      const expiredSessions = await cursor.all();
      
      // End each expired session
      let endedCount = 0;
      for (const session of expiredSessions) {
        await this.endSession(session._key);
        endedCount++;
      }
      
      logger.info(`Cleanup completed: ${expiredSessions.length} expired sessions found, ${endedCount} sessions ended`);
      return {
        expiredSessionsFound: expiredSessions.length,
        sessionsEnded: endedCount
      };
    } catch (error) {
      logger.error('Error cleaning up expired sessions:', error);
      throw error;
    }
  }
  
  /**
   * Get session statistics
   * @param {String} startDate - Start date (ISO string)
   * @param {String} endDate - End date (ISO string)
   * @returns {Promise<Object>} Session statistics
   */
  async getSessionStats(startDate, endDate) {
    try {
      logger.info(`Fetching session statistics from ${startDate} to ${endDate}`);

      const query = aql`
        LET totalSessions = (
          FOR session IN sessions
            FILTER session.startTime >= ${startDate} && session.startTime <= ${endDate}
            COLLECT WITH COUNT INTO count
            RETURN count
        )[0]
        
        LET activeSessions = (
          FOR session IN sessions
            FILTER session.active == true
            COLLECT WITH COUNT INTO count
            RETURN count
        )[0]
        
        LET uniqueUsers = (
          FOR session IN sessions
            FILTER session.startTime >= ${startDate} && session.startTime <= ${endDate}
            COLLECT userId = session.userId WITH COUNT INTO count
            RETURN count
        )[0]
        
        LET avgSessionDuration = (
          FOR session IN sessions
            FILTER session.startTime >= ${startDate} && session.startTime <= ${endDate}
            FILTER session.endTime != null
            LET duration = DATE_DIFF(session.startTime, session.endTime, "ms")
            COLLECT AGGREGATE avgDuration = AVG(duration)
            RETURN avgDuration
        )[0]
        
        LET sessionsByDevice = (
          FOR session IN sessions
            FILTER session.startTime >= ${startDate} && session.startTime <= ${endDate}
            FILTER session.deviceInfo != null
            COLLECT deviceType = session.deviceInfo.type WITH COUNT INTO count
            RETURN { deviceType, count }
        )
        
        RETURN {
          totalSessions,
          activeSessions,
          uniqueUsers,
          avgSessionDuration,
          sessionsByDevice
        }
      `;
      
      const cursor = await this.db.query(query);
      const stats = await cursor.next();
      logger.info('Session statistics retrieved successfully:', stats);
      return stats;
    } catch (error) {
      logger.error('Error getting session statistics:', error);
      throw error;
    }
  }
}

module.exports = SessionService;