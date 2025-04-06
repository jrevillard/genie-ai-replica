require('dotenv').config();
const { Database, aql } = require('arangojs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const emailService = require('./email-service');
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

/**
 * Service to handle user authentication and password management
 */
class AuthService {
  constructor() {
    this.db = initDB;
    this.users = this.db.collection('users');
    this.passwordResetTokens = this.db.collection('passwordResetTokens');
    this.verificationTokens = this.db.collection('verificationTokens');

    // JWT settings
    this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key-here-change-in-production';
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';

    // Password reset settings
    this.tokenExpiryMinutes = 5; // Token expires in 5 minutes

    // Ensure collections exist
    logger.info('Initializing AuthService...');
    this.initialize()
      .catch(err => logger.error('Error during authentication service initialization:', err));
  }

  /**
   * Initialize necessary collections and indexes
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Check if collections exist and create them if they don't
      const collections = await this.db.listCollections();
      const collectionNames = collections.map(c => c.name);

      // Ensure passwordResetTokens collection exists
      if (!collectionNames.includes('passwordResetTokens')) {
        logger.info('Creating passwordResetTokens collection...');
        await this.db.createCollection('passwordResetTokens');
        logger.info('Created passwordResetTokens collection successfully');

        // Create indexes for passwordResetTokens
        await this.passwordResetTokens.ensureIndex({
          type: 'persistent',
          fields: ['userId']
        });

        await this.passwordResetTokens.ensureIndex({
          type: 'persistent',
          fields: ['token'],
          unique: true
        });

        await this.passwordResetTokens.ensureIndex({
          type: 'persistent',
          fields: ['expiresAt']
        });

        await this.passwordResetTokens.ensureIndex({
          type: 'persistent',
          fields: ['used']
        });
      }

      // Ensure verificationTokens collection exists
      if (!collectionNames.includes('verificationTokens')) {
        logger.info('Creating verificationTokens collection...');
        await this.db.createCollection('verificationTokens');
        logger.info('Created verificationTokens collection successfully');

        // Create indexes for verificationTokens
        await this.verificationTokens.ensureIndex({
          type: 'persistent',
          fields: ['userId']
        });

        await this.verificationTokens.ensureIndex({
          type: 'persistent',
          fields: ['token'],
          unique: true
        });

        await this.verificationTokens.ensureIndex({
          type: 'persistent',
          fields: ['expiresAt']
        });

        await this.verificationTokens.ensureIndex({
          type: 'persistent',
          fields: ['used']
        });
      }

      // Ensure indexes for users collection
      await this.users.ensureIndex({
        type: 'persistent',
        fields: ['loginName'],
        unique: true
      });

      await this.users.ensureIndex({
        type: 'persistent',
        fields: ['email'],
        unique: true
      });

      logger.info('Auth service initialized successfully');
    } catch (error) {
      logger.error('Error initializing auth service:', error);
      throw error;
    }
  }

  /**
   * Register a new user
   * @param {Object} userData - User registration data
   * @returns {Promise<Object>} The registered user with token
   */
  async register(userData) {
    try {
      logger.info('Registering new user with loginName:', userData.loginName);

      // Validate required fields
      if (!userData.loginName || !userData.email || !userData.encPassword) {
        logger.warn('Missing required fields: loginName, email, and encPassword are required');
        throw new Error('Missing required fields: loginName, email, and encPassword are required');
      }

      // Check if user already exists
      const existing = await this.getUserByLoginNameOrEmail(userData.loginName, userData.email);
      if (existing) {
        if (existing.loginName === userData.loginName) {
          logger.warn('Username already exists:', userData.loginName);
          throw new Error('Username already exists');
        } else {
          logger.warn('Email already exists:', userData.email);
          throw new Error('Email already exists');
        }
      }

      // Hash the password (SHA-256 from client) with bcrypt for storage
      const hashedPassword = await this.hashPassword(userData.encPassword);

      // Create the user document
      const user = {
        loginName: userData.loginName,
        email: userData.email,  // Ensure email is explicitly set
        encPassword: hashedPassword,
        emailVerified: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),

        personalIdentification: {
          fullName: userData.fullName || userData.loginName,
          dob: userData.dob || '',
          gender: userData.gender || '',
          nationality: userData.nationality || '',
          maritalStatus: userData.maritalStatus || ''
        },
        addressResidency: {
          currentAddress: userData.address || ''
        }
      };

      // Save user to database first
      const savedUser = await this.users.save(user);

      // Explicitly log saved user to verify
      logger.info('Saved user before email verification:', savedUser);

      // Send verification email AFTER user is saved
      // Use setImmediate or process.nextTick to ensure it runs asynchronously
      setImmediate(async () => {
        try {
          // Retrieve the user again to ensure we have the latest data
          const freshUser = await this.getUserById(savedUser._key);

          if (freshUser) {
            await this.sendVerificationEmail(freshUser);
          } else {
            logger.error('Could not retrieve fresh user for email verification');
          }
        } catch (emailError) {
          logger.error('Email verification failed, but user was registered:', emailError.message);
        }
      });

      // Generate access token
      const accessToken = this.generateToken(savedUser);

      // Update user with access token
      await this.users.update(savedUser._key, {
        accessToken: accessToken
      });

      // Return user data with token (exclude password)
      const { encPassword, ...userWithoutPassword } = savedUser;
      logger.info(`User registered successfully with ID: ${savedUser._key}`);
      return {
        ...userWithoutPassword,
        accessToken
      };
    } catch (error) {
      logger.error('Error registering user:', error);
      throw error;
    }
  }

  /**
   * Authenticate a user
   * @param {string} loginName - Username or email
   * @param {string} encPassword - Encrypted/hashed password from client (SHA-256)
   * @returns {Promise<Object>} Authenticated user with token
   */
  async login(loginName, encPassword) {
    try {
      logger.info(`Attempting login for user: ${loginName}`);

      // Retrieve user by loginName or email
      const user = await this.getUserByLoginNameOrEmail(loginName, loginName);
      if (!user) {
        logger.warn(`User not found for loginName/email: ${loginName}`);
        throw new Error('User not found');
      }

      // Determine password storage format and verify
      const isPasswordValid = await this.verifyPassword(encPassword, user.encPassword);
      if (!isPasswordValid) {
        logger.warn(`Invalid password for user: ${loginName}`);
        throw new Error('Invalid password');
      }

      // Check if the account is disabled
      if (user.disabled === true) {
        logger.warn(`Disabled account login attempt for user: ${loginName}`);
        throw new Error('This account has been disabled');
      }

      // Check if email is verified
      if (!user.emailVerified) {
        logger.warn(`Email not verified for user: ${loginName}`);
        throw new Error('Email not verified');
      }

      // Generate access token
      const accessToken = this.generateToken(user);

      // Update user with access token
      await this.users.update(user._key, {
        accessToken: accessToken,
        updatedAt: new Date().toISOString()
      });

      // Return user data with token (exclude password)
      const { encPassword: password, ...userWithoutPassword } = user;
      logger.info(`User logged in successfully: ${loginName}`);
      return {
        ...userWithoutPassword,
        accessToken
      };
    } catch (error) {
      logger.error('Error during login:', error);
      throw error;
    }
  }

  /**
   * Log out a user (invalidate token)
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Logout result
   */
  async logout(userId) {
    try {
      logger.info(`Logging out user with ID: ${userId}`);

      // Remove access token from user
      await this.users.update(userId, {
        accessToken: null,
        updatedAt: new Date().toISOString()
      });

      logger.info(`User logged out successfully: ${userId}`);
      return { success: true, message: 'Logged out successfully' };
    } catch (error) {
      logger.error(`Error logging out user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Send verification email to user
   * @param {Object} user - User object
   * @returns {Promise<Object>} Send result
   */
  async sendVerificationEmail(user) {
    try {
      // Add validation to ensure user and email exist
      if (!user || !user.email) {
        logger.error('Missing user or email for verification email:', user);
        throw new Error('User or email is missing for verification');
      }

      // Log user email for debugging
      logger.info(`Preparing to send verification email to ${user.email}`);

      // Remove any existing unused tokens for this user
      const cleanupQuery = aql`
        FOR t IN verificationTokens
          FILTER t.userId == ${'users/' + user._key} AND t.used == false
          REMOVE t IN verificationTokens
      `;
      await this.db.query(cleanupQuery);

      // Generate a unique token
      const token = crypto.randomBytes(32).toString('hex');

      // Calculate expiration time (24 hours from now)
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (24 * 60 * 60 * 1000));

      // Save token to database with additional uniqueness constraints
      try {
        await this.verificationTokens.save({
          userId: `users/${user._key}`,
          token: token,
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          used: false,
          email: user.email  // Add email to token for extra verification
        });
      } catch (saveError) {
        logger.error('Error saving verification token:', saveError);
        throw new Error('Failed to create verification token');
      }

      // Send email with verification token
      try {
        await emailService.sendVerificationEmail(
          user.email,
          token,
          user.personalIdentification?.fullName || user.loginName
        );

        // Log token in development environment for testing
        if (process.env.NODE_ENV === 'development') {
          logger.info(`Email verification token for ${user.email}: ${token}`);
        }

        logger.info(`Verification email sent to ${user.email}`);
        return { success: true, message: 'Verification email sent' };
      } catch (emailError) {
        logger.error(`Error sending verification email for user ${user._key}:`, emailError);

        // Remove the just-created token if email sending fails
        const removeTokenQuery = aql`
          FOR t IN verificationTokens
            FILTER t.token == ${token}
            REMOVE t IN verificationTokens
        `;
        await this.db.query(removeTokenQuery);

        // Continue with registration despite email error in development
        if (process.env.NODE_ENV === 'development') {
          logger.info('DEV MODE: Continuing with registration despite email error');
          logger.info(`DEV MODE: Verification token for ${user.email}: ${token}`);
          return { success: false, message: 'Could not send verification email', token };
        }
        throw emailError;
      }
    } catch (error) {
      logger.error(`Error in verification email process for user:`, error);
      throw error;
    }
  }

  /**
   * Resend verification email
   * @param {string} email - User's email
   * @returns {Promise<Object>} Send result
   */
  async resendVerificationEmail(email) {
    try {
      logger.info(`Resending verification email to: ${email}`);

      // Find user by email
      const user = await this.getUserByEmail(email);
      if (!user) {
        // Don't reveal if user exists or not
        logger.info(`User not found for email: ${email}, returning generic response`);
        return {
          success: true,
          message: 'If your email exists in our system, a verification email has been sent'
        };
      }

      // Check if already verified
      if (user.emailVerified) {
        logger.info(`Email already verified for: ${email}, returning generic response`);
        return {
          success: true,
          message: 'If your email exists in our system, a verification email has been sent'
        };
      }

      // Send a new verification email
      await this.sendVerificationEmail(user);

      logger.info(`Verification email resent to: ${email}`);
      return {
        success: true,
        message: 'If your email exists in our system, a verification email has been sent'
      };
    } catch (error) {
      logger.error(`Error resending verification email for ${email}:`, error);
      throw error;
    }
  }

  /**
   * Verify user's email with token
   * @param {string} token - Verification token
   * @returns {Promise<Object>} Verification result
   */
  async verifyEmail(token) {
    try {
      logger.info('Verification Token Received:', token);

      // First, check verificationTokens collection
      const tokenQuery = aql`
        FOR t IN verificationTokens
          FILTER t.token == ${token}
          RETURN t
      `;

      const tokenCursor = await this.db.query(tokenQuery);
      let tokenDoc = await tokenCursor.next();
      let isEmailChangeToken = false;

      // Check for email change token if not found in verificationTokens
      if (!tokenDoc) {
        logger.info('Token not found in verificationTokens, checking pendingEmailChange');

        const pendingEmailQuery = aql`
          FOR u IN users
            FILTER u.pendingEmailChange.token == ${token}
            RETURN {
              userId: u._id,
              token: u.pendingEmailChange.token,
              email: u.pendingEmailChange.email,
              expiresAt: DATE_ADD(u.updatedAt, 24, 'hour'),
              used: false
            }
        `;

        const pendingCursor = await this.db.query(pendingEmailQuery);
        tokenDoc = await pendingCursor.next();

        if (tokenDoc) {
          logger.info('Found token in pendingEmailChange:', tokenDoc);
          isEmailChangeToken = true;
        } else {
          logger.info('No token found in either location');
        }
      }

      if (!tokenDoc) {
        logger.error('No token document found for token:', token);
        return { success: false, message: 'Invalid token' };
      }

      // Check if token is expired
      const expiresAt = new Date(tokenDoc.expiresAt);
      const now = new Date();

      if (now > expiresAt) {
        logger.warn('Token has expired:', token);
        return { success: false, expired: true, message: 'Token has expired' };
      }

      // Check if token has been used
      if (tokenDoc.used) {
        logger.warn('Token has already been used:', token);
        return { success: false, used: true, message: 'Token has already been used' };
      }

      // For email change verification
      if (isEmailChangeToken) {
        // Get user ID from token
        const userId = tokenDoc.userId.split('/')[1];

        // Update user's email and clear pendingEmailChange
        await this.users.update(userId, {
          email: tokenDoc.email,
          emailVerified: true,
          pendingEmailChange: null,
          updatedAt: new Date().toISOString()
        });

        logger.info(`Email changed successfully for user ${userId} to ${tokenDoc.email}`);
        return { success: true, message: 'Email changed successfully' };
      } 
      // For regular email verification
      else {
        // Get user ID from token
        const userId = tokenDoc.userId.split('/')[1];

        // Update user's verification status
        await this.users.update(userId, {
          emailVerified: true,
          updatedAt: new Date().toISOString()
        });

        // Mark token as used
        await this.verificationTokens.update(tokenDoc._key, {
          used: true
        });

        logger.info(`Email verified successfully for user ${userId}`);
        return { success: true, message: 'Email verified successfully' };
      }
    } catch (error) {
      logger.error('Error in verifyEmail:', error);
      throw error;
    }
  }

  /**
   * Generate a reset token and send it to the user's email
   * @param {string} email - User's email
   * @returns {Promise<Object>} Reset token result
   */
  async initiatePasswordReset(email) {
    try {
      logger.info(`Initiating password reset for email: ${email}`);

      // Check if the email exists
      const user = await this.getUserByEmail(email);
      if (!user) {
        // For security reasons, don't reveal if the email exists or not
        logger.info(`User not found for email: ${email}, returning generic response`);
        return {
          success: true,
          message: 'If your email exists in our system, a password reset link has been sent to your email'
        };
      }

      // Generate a unique token
      const token = crypto.randomBytes(32).toString('hex');

      // Calculate expiration time (5 minutes from now)
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (this.tokenExpiryMinutes * 60 * 1000));

      // Save token to database
      await this.passwordResetTokens.save({
        userId: `users/${user._key}`,
        token: token,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        used: false
      });

      // Send email with reset token
      await emailService.sendPasswordResetEmail(
        email,
        token,
        user.personalIdentification?.fullName || user.loginName
      );

      // Log token in development environment for testing
      if (process.env.NODE_ENV === 'development') {
        logger.info(`Password reset token for ${email}: ${token}`);
      }

      logger.info(`Password reset email sent to: ${email}`);
      return {
        success: true,
        message: 'If your email exists in our system, a password reset link has been sent to your email',
        // Only include the token in development environment
        ...(process.env.NODE_ENV === 'development' && { token })
      };
    } catch (error) {
      logger.error(`Error initiating password reset for email ${email}:`, error);
      throw error;
    }
  }

  /**
   * Validate a password reset token
   * @param {string} token - Reset token
   * @returns {Promise<Object>} Token validation result
   */
  async validateResetToken(token) {
    try {
      logger.info(`Validating password reset token: ${token}`);

      const query = aql`
        FOR t IN passwordResetTokens
          FILTER t.token == ${token}
          RETURN t
      `;

      const cursor = await this.db.query(query);
      const tokenDoc = await cursor.next();

      if (!tokenDoc) {
        logger.warn('Invalid reset token:', token);
        return { valid: false, message: 'Invalid token' };
      }

      // Check if token is expired
      const expiresAt = new Date(tokenDoc.expiresAt);
      const now = new Date();

      if (now > expiresAt) {
        logger.warn('Reset token has expired:', token);
        return { valid: false, expired: true, message: 'Token has expired' };
      }

      // Check if token has been used
      if (tokenDoc.used) {
        logger.warn('Reset token has already been used:', token);
        return { valid: false, used: true, message: 'Token has already been used' };
      }

      // Token is valid
      logger.info('Reset token is valid:', token);
      return {
        valid: true,
        message: 'Token is valid',
        userId: tokenDoc.userId
      };
    } catch (error) {
      logger.error(`Error validating reset token ${token}:`, error);
      throw error;
    }
  }

  /**
   * Complete password reset process
   * @param {string} token - Reset token
   * @param {string} newPassword - New password (already hashed from client)
   * @returns {Promise<Object>} Password reset result
   */
  async resetPassword(token, newPassword) {
    try {
      logger.info(`Completing password reset with token: ${token}`);

      // Validate token first
      const validation = await this.validateResetToken(token);
      if (!validation.valid) {
        logger.warn('Invalid or expired token during password reset:', token);
        return validation; // Return validation error
      }

      // Get user ID from token
      const userId = validation.userId.split('/')[1]; // users/123 -> 123

      // Hash the password (even if it's already hashed from client)
      const hashedPassword = await this.hashPassword(newPassword);

      // Update user's password
      await this.users.update(userId, {
        encPassword: hashedPassword,
        updatedAt: new Date().toISOString()
      });

      // Mark token as used
      const tokenQuery = aql`
        FOR t IN passwordResetTokens
          FILTER t.token == ${token}
          UPDATE t WITH { used: true } IN passwordResetTokens
          RETURN NEW
      `;

      await this.db.query(tokenQuery);

      logger.info(`Password reset successfully for user ${userId}`);
      return { success: true, message: 'Password has been reset successfully' };
    } catch (error) {
      logger.error(`Error resetting password with token ${token}:`, error);
      throw error;
    }
  }

  /**
   * Change password for authenticated user
   * @param {string} userId - User ID
   * @param {string} currentPassword - Current password (hashed from client)
   * @param {string} newPassword - New password (hashed from client) 
   * @returns {Promise<Object>} Password change result
   */
  async changePassword(userId, currentPassword, newPassword) {
    try {
      logger.info(`Changing password for user ${userId}`);

      // Get user
      const user = await this.users.document(userId);
      if (!user) {
        logger.warn(`User not found for ID: ${userId}`);
        throw new Error('User not found');
      }

      // Verify current password
      const isPasswordValid = await this.verifyPassword(currentPassword, user.encPassword);
      if (!isPasswordValid) {
        logger.warn(`Current password incorrect for user ${userId}`);
        throw new Error('Current password is incorrect');
      }

      // Hash the new password
      const hashedPassword = await this.hashPassword(newPassword);

      // Update user's password
      await this.users.update(userId, {
        encPassword: hashedPassword,
        updatedAt: new Date().toISOString()
      });

      logger.info(`Password changed successfully for user ${userId}`);
      return { success: true, message: 'Password changed successfully' };
    } catch (error) {
      logger.error(`Error changing password for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get user by ID
   * @param {string} userId - User ID 
   * @returns {Promise<Object>} User or null
   */
  async getUserById(userId) {
    try {
      logger.info(`Fetching user by ID: ${userId}`);
      return await this.users.document(userId);
    } catch (error) {
      if (error.code === 404) {
        logger.info(`User not found for ID: ${userId}`);
        return null;
      }
      logger.error(`Error getting user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get user by login name or email
   * @param {string} loginName - Login name to check
   * @param {string} email - Email to check
   * @returns {Promise<Object>} User or null
   */
  async getUserByLoginNameOrEmail(loginName, email) {
    try {
      logger.info(`Fetching user by loginName: ${loginName} or email: ${email}`);
      const query = aql`
        FOR u IN users
          FILTER u.loginName == ${loginName} OR u.email == ${email}
          RETURN u
      `;

      const cursor = await this.db.query(query);
      const user = await cursor.next();
      if (!user) {
        logger.info(`No user found for loginName: ${loginName} or email: ${email}`);
      }
      return user;
    } catch (error) {
      logger.error(`Error getting user by login name or email:`, error);
      throw error;
    }
  }

  /**
   * Get user by email
   * @param {string} email - Email to check
   * @returns {Promise<Object>} User or null
   */
  async getUserByEmail(email) {
    try {
      logger.info(`Fetching user by email: ${email}`);
      const query = aql`
        FOR u IN users
          FILTER u.email == ${email}
          RETURN u
      `;

      const cursor = await this.db.query(query);
      const user = await cursor.next();
      if (!user) {
        logger.info(`No user found for email: ${email}`);
      }
      return user;
    } catch (error) {
      logger.error(`Error getting user by email:`, error);
      throw error;
    }
  }

  /**
   * Verify a JWT token
   * @param {string} token - JWT token
   * @returns {Promise<Object>} Decoded token payload or null
   */
  async verifyToken(token) {
    try {
      logger.info('Verifying JWT token');

      // Verify token signature
      const decoded = jwt.verify(token, this.jwtSecret);

      // Check if token is still valid in database
      const user = await this.getUserById(decoded.userId);
      if (!user || user.accessToken !== token) {
        logger.warn('Token invalid or not associated with user:', decoded.userId);
        return null;
      }

      logger.info('Token verified successfully for user:', decoded.userId);
      return decoded;
    } catch (error) {
      logger.error('Token verification error:', error);
      return null;
    }
  }

  /**
   * Generate a JWT token for a user
   * @param {Object} user - User object
   * @returns {string} JWT token
   */
  generateToken(user) {
    logger.info(`Generating JWT token for user: ${user._key}`);
    return jwt.sign(
      {
        userId: user._key,
        loginName: user.loginName,
        email: user.email
      },
      this.jwtSecret,
      { expiresIn: this.jwtExpiresIn }
    );
  }

  /**
   * Hash a password with bcrypt
   * @param {string} password - Client-hashed password (SHA-256)
   * @returns {Promise<string>} Server-hashed password (bcrypt)
   */
  async hashPassword(password) {
    logger.info('Hashing password with bcrypt');
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * Verify a password against stored hash, supporting both formats
   * @param {string} clientPassword - SHA-256 hash from client
   * @param {string} storedPassword - Password hash from database
   * @returns {Promise<boolean>} True if password matches
   */
  async verifyPassword(clientPassword, storedPassword) {
    logger.info('Verifying password');
    // If the stored password is a bcrypt hash (starts with $2)
    if (storedPassword.startsWith('$2')) {
      // Use bcrypt to compare SHA-256 hash with bcrypt hash
      return await bcrypt.compare(clientPassword, storedPassword);
    }
    // If the stored password is a plain SHA-256 hash (64 hex chars)
    else if (/^[a-f0-9]{64}$/i.test(storedPassword)) {
      // Direct comparison of SHA-256 hashes
      return clientPassword === storedPassword;
    }

    // Unknown format, return false
    logger.warn('Unknown password format, verification failed');
    return false;
  }

  /**
   * Compare a password with a hashed password (legacy method)
   * @param {string} password - Client-hashed password (SHA-256)
   * @param {string} hashedPassword - Hashed password from database
   * @returns {Promise<boolean>} True if password matches
   */
  async comparePasswords(password, hashedPassword) {
    logger.info('Comparing passwords (legacy method)');
    // Use the more versatile verifyPassword method
    return this.verifyPassword(password, hashedPassword);
  }

  /**
   * Clean up expired tokens
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanupExpiredTokens() {
    try {
      logger.info('Cleaning up expired tokens');
      const now = new Date().toISOString();

      // Clean up password reset tokens
      const resetQuery = aql`
        FOR t IN passwordResetTokens
          FILTER t.expiresAt < ${now} AND t.used == false
          REMOVE t IN passwordResetTokens
          RETURN OLD
      `;

      const resetCursor = await this.db.query(resetQuery);
      const resetRemoved = await resetCursor.all();

      // Clean up verification tokens
      const verifyQuery = aql`
        FOR t IN verificationTokens
          FILTER t.expiresAt < ${now} AND t.used == false
          REMOVE t IN verificationTokens
          RETURN OLD
      `;

      const verifyCursor = await this.db.query(verifyQuery);
      const verifyRemoved = await verifyCursor.all();

      logger.info(`Removed ${resetRemoved.length} expired reset tokens and ${verifyRemoved.length} verification tokens`);
      return {
        success: true,
        removed: resetRemoved.length + verifyRemoved.length,
        message: `Removed ${resetRemoved.length} expired reset tokens and ${verifyRemoved.length} verification tokens`
      };
    } catch (error) {
      logger.error('Error cleaning up expired tokens:', error);
      throw error;
    }
  }
}

// Export a singleton instance
module.exports = new AuthService();