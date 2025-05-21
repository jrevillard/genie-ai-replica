require('dotenv').config();
const { Database, aql } = require('arangojs');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../logger'); // Import logger from logger.js

// Initialize ArangoDB connection
const dbService = require('../utils/db-connect-service');

const initDB = dbService.getConnection();

class SessionService {
  constructor() {
    this.db = initDB;
    this.sessions = this.db.collection('sessions');
    this.userSessions = this.db.collection('userSessions');
    this.sessionExpirationTime = process.env.SESSION_EXPIRATION_TIME || 30 * 60 * 1000; // 30 minutes in milliseconds
    logger.info(`SessionService initialized successfully with expiration time: ${this.sessionExpirationTime}ms`);
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
      
      logger.info(`Creating session document for user ${userId}`);
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
        logger.info(`Updating session ${sessionId} with additional data: ${JSON.stringify(updateData)}`);
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
        logger.info(`Edge created successfully between user ${userId} and session ${sessionId}`);
      } catch (error) {
        logger.error(`Error creating user-session edge for user ${userId}: ${error.message}`, { stack: error.stack });
      }

      // Return the full session document
      const fullSession = await this.sessions.document(sessionId);
      logger.info(`Session created successfully: ${sessionId} for user ${userId}`);
      return fullSession;
    } catch (error) {
      logger.error(`Error creating session for user ${userId}: ${error.message}`, { stack: error.stack });
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
        logger.info(`Session ${session._key} for user ${userId} has expired`);
        await this.endSession(session._key);
        return null;
      }

      logger.info(`Active session retrieved successfully: ${session._key} for user ${userId}`);
      return session;
    } catch (error) {
      logger.error(`Error getting active session for user ${userId}: ${error.message}`, { stack: error.stack });
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
        logger.info(`Returning existing active session: ${activeSession._key} for user ${userId}`);
        return activeSession;
      }
      
      logger.info(`No active session found, creating new session for user ${userId}`);
      const newSession = await this.createSession(userId, deviceInfo, ipAddress);
      logger.info(`Session retrieved or created successfully: ${newSession._key} for user ${userId}`);
      return newSession;
    } catch (error) {
      logger.error(`Error getting or creating session for user ${userId}: ${error.message}`, { stack: error.stack });
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

      // Verify session exists and get current state
      try {
        const currentSession = await this.sessions.document(sessionId);
        logger.info(`Current session state before update: ${JSON.stringify(currentSession)}`);

        if (!currentSession.active) {
          logger.info(`Session ${sessionId} is already inactive, no update needed`);
          return currentSession;
        }
      } catch (readError) {
        logger.error(`Error reading session before update: ${readError.message}`, { stack: readError.stack });
      }

      // Perform update with debugging
      logger.info(`Attempting to update session ${sessionId}`);

      const updateData = {
        active: false,
        endTime: new Date().toISOString()
      };

      logger.info(`Update data: ${JSON.stringify(updateData)}`);

      const updatedSession = await this.sessions.update(
        sessionId,
        updateData,
        { returnNew: true }
      );

      logger.info(`Session update result: ${JSON.stringify(updatedSession.new)}`);

      // Verify the update was successful
      try {
        const verifiedSession = await this.sessions.document(sessionId);
        logger.info(`Verified session state after update: ${JSON.stringify(verifiedSession)}`);

        if (verifiedSession.active) {
          logger.warn(`Session ${sessionId} is still active after update`);
        } else {
          logger.info(`Session ${sessionId} is now inactive with endTime: ${verifiedSession.endTime}`);
        }
      } catch (verifyError) {
        logger.error(`Error verifying session after update: ${verifyError.message}`, { stack: verifyError.stack });
      }

      logger.info(`Session ended successfully: ${sessionId}`);
      return updatedSession.new;
    } catch (error) {
      logger.error(`Error ending session ${sessionId}: ${error.message}`, { stack: error.stack });
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

      const updatedSession = await this.sessions.update(
        sessionId,
        {
          lastActiveTime: new Date().toISOString()
        },
        { returnNew: true }
      );

      logger.info(`Session kept alive successfully: ${sessionId}`);
      return updatedSession.new;
    } catch (error) {
      logger.error(`Error keeping session ${sessionId} alive: ${error.message}`, { stack: error.stack });
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
      logger.info(`User sessions retrieved successfully: ${sessions.length} sessions for user ${userId}`);
      return sessions;
    } catch (error) {
      logger.error(`Error getting sessions for user ${userId}: ${error.message}`, { stack: error.stack });
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
      logger.info(`Session retrieved successfully: ${sessionId}`);
      return session;
    } catch (error) {
      logger.error(`Error getting session ${sessionId}: ${error.message}`, { stack: error.stack });
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
      
      const query = aql`
        FOR session IN sessions
          FILTER session.active == true
          FILTER session.startTime < ${expirationTime}
          FILTER session.lastActiveTime == null OR session.lastActiveTime < ${expirationTime}
          RETURN session
      `;
      
      const cursor = await this.db.query(query);
      const expiredSessions = await cursor.all();
      
      let endedCount = 0;
      for (const session of expiredSessions) {
        await this.endSession(session._key);
        endedCount++;
      }
      
      logger.info(`Expired sessions cleanup completed successfully: ${expiredSessions.length} found, ${endedCount} ended`);
      return {
        expiredSessionsFound: expiredSessions.length,
        sessionsEnded: endedCount
      };
    } catch (error) {
      logger.error(`Error cleaning up expired sessions: ${error.message}`, { stack: error.stack });
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
      logger.info(`Session statistics retrieved successfully: ${JSON.stringify(stats)}`);
      return stats;
    } catch (error) {
      logger.error(`Error getting session statistics: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }
}

module.exports = SessionService;