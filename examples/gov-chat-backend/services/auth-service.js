// auth-service.js
require('dotenv').config();
const { Database, aql } = require('arangojs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const emailService = require('./email-service');

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

/**
 * Service to handle user authentication and password management
 */
class AuthService {
  constructor() {
    this.db = initDB();
    this.users = this.db.collection('users');
    this.passwordResetTokens = this.db.collection('passwordResetTokens');
    this.verificationTokens = this.db.collection('verificationTokens');

    // JWT settings
    this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key-here-change-in-production';
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';

    // Password reset settings
    this.tokenExpiryMinutes = 5; // Token expires in 5 minutes

    // Ensure collections exist
    this.initialize()
      .catch(err => console.error('Error during authentication service initialization:', err));
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
        console.log('Creating passwordResetTokens collection...');
        await this.db.createCollection('passwordResetTokens');
        console.log('Created passwordResetTokens collection successfully');

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
        console.log('Creating verificationTokens collection...');
        await this.db.createCollection('verificationTokens');
        console.log('Created verificationTokens collection successfully');

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

      console.log('Auth service initialized successfully');
    } catch (error) {
      console.error('Error initializing auth service:', error);
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
      // Validate required fields
      if (!userData.loginName || !userData.email || !userData.encPassword) {
        throw new Error('Missing required fields: loginName, email, and encPassword are required');
      }

      // Check if user already exists
      const existing = await this.getUserByLoginNameOrEmail(userData.loginName, userData.email);
      if (existing) {
        if (existing.loginName === userData.loginName) {
          throw new Error('Username already exists');
        } else {
          throw new Error('Email already exists');
        }
      }

      // Hash the password (SHA-256 from client) with bcrypt for storage
      const hashedPassword = await this.hashPassword(userData.encPassword);

      // Create the user document
      const user = {
        loginName: userData.loginName,
        email: userData.email,
        encPassword: hashedPassword,
        emailVerified: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),

        // Required schema fields for user profile
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

      // Save user to database
      const savedUser = await this.users.save(user);

      // Send verification email - update to this:
      try {
        await this.sendVerificationEmail(savedUser);
      } catch (emailError) {
        console.error('Email verification failed, but user was registered:', emailError.message);
        // Continue with registration instead of failing
      }

      // Generate access token
      const accessToken = this.generateToken(savedUser);
      // Update user with access token
      await this.users.update(savedUser._key, {
        accessToken: accessToken
      });

      // Return user data with token (exclude password)
      const { encPassword, ...userWithoutPassword } = savedUser;
      return {
        ...userWithoutPassword,
        accessToken
      };
    } catch (error) {
      console.error('Error registering user:', error);
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
      // Retrieve user by loginName or email
      const user = await this.getUserByLoginNameOrEmail(loginName, loginName);
      if (!user) {
        throw new Error('User not found');
      }

      // Determine password storage format and verify
      const isPasswordValid = await this.verifyPassword(encPassword, user.encPassword);
      if (!isPasswordValid) {
        throw new Error('Invalid password');
      }

      // Check if email is verified
      if (!user.emailVerified) {
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
      return {
        ...userWithoutPassword,
        accessToken
      };
    } catch (error) {
      console.error('Error during login:', error);
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
      // Remove access token from user
      await this.users.update(userId, {
        accessToken: null,
        updatedAt: new Date().toISOString()
      });

      return { success: true, message: 'Logged out successfully' };
    } catch (error) {
      console.error(`Error logging out user ${userId}:`, error);
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
        console.error('Missing user or email for verification email:', user);
        throw new Error('User or email is missing for verification');
      }

      // Log user email for debugging
      console.log(`Preparing to send verification email to ${user.email}`);

      // Generate a unique token
      const token = crypto.randomBytes(32).toString('hex');

      // Calculate expiration time (24 hours from now)
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (24 * 60 * 60 * 1000));

      // Save token to database
      await this.verificationTokens.save({
        userId: `users/${user._key}`,
        token: token,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        used: false
      });

      // Send email with verification token - with better error handling
      try {
        await emailService.sendVerificationEmail(
          user.email,
          token,
          user.personalIdentification?.fullName || user.loginName
        );

        // Log token in development environment for testing
        if (process.env.NODE_ENV === 'development') {
          console.log(`Email verification token for ${user.email}: ${token}`);
        }

        return { success: true, message: 'Verification email sent' };
      } catch (emailError) {
        console.error(`Error sending verification email for user ${user._key}:`, emailError);
        // Continue with registration despite email error in development
        if (process.env.NODE_ENV === 'development') {
          console.log('DEV MODE: Continuing with registration despite email error');
          console.log(`DEV MODE: Verification token for ${user.email}: ${token}`);
          return { success: false, message: 'Could not send verification email', token };
        }
        throw emailError;
      }
    } catch (error) {
      console.error(`Error in verification email process for user:`, error);
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
      // Find user by email
      const user = await this.getUserByEmail(email);
      if (!user) {
        // Don't reveal if user exists or not
        return {
          success: true,
          message: 'If your email exists in our system, a verification email has been sent'
        };
      }

      // Check if already verified
      if (user.emailVerified) {
        return {
          success: true,
          message: 'If your email exists in our system, a verification email has been sent'
        };
      }

      // Send a new verification email
      await this.sendVerificationEmail(user);

      return {
        success: true,
        message: 'If your email exists in our system, a verification email has been sent'
      };
    } catch (error) {
      console.error(`Error resending verification email for ${email}:`, error);
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
      const query = aql`
        FOR t IN verificationTokens
          FILTER t.token == ${token}
          RETURN t
      `;

      const cursor = await this.db.query(query);
      const tokenDoc = await cursor.next();

      if (!tokenDoc) {
        return { success: false, message: 'Invalid token' };
      }

      // Check if token is expired
      const expiresAt = new Date(tokenDoc.expiresAt);
      const now = new Date();

      if (now > expiresAt) {
        return { success: false, expired: true, message: 'Token has expired' };
      }

      // Check if token has been used
      if (tokenDoc.used) {
        return { success: false, used: true, message: 'Token has already been used' };
      }

      // Get user ID from token
      const userId = tokenDoc.userId.split('/')[1];

      // Update user as verified
      await this.users.update(userId, {
        emailVerified: true,
        updatedAt: new Date().toISOString()
      });

      // Mark token as used
      const tokenUpdateQuery = aql`
        FOR t IN verificationTokens
          FILTER t.token == ${token}
          UPDATE t WITH { used: true } IN verificationTokens
          RETURN NEW
      `;

      await this.db.query(tokenUpdateQuery);

      return { success: true, message: 'Email verified successfully' };
    } catch (error) {
      console.error(`Error verifying email with token ${token}:`, error);
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
      // Check if the email exists
      const user = await this.getUserByEmail(email);
      if (!user) {
        // For security reasons, don't reveal if the email exists or not
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
        console.log(`Password reset token for ${email}: ${token}`);
      }

      return {
        success: true,
        message: 'If your email exists in our system, a password reset link has been sent to your email',
        // Only include the token in development environment
        ...(process.env.NODE_ENV === 'development' && { token })
      };
    } catch (error) {
      console.error(`Error initiating password reset for email ${email}:`, error);
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
      const query = aql`
        FOR t IN passwordResetTokens
          FILTER t.token == ${token}
          RETURN t
      `;

      const cursor = await this.db.query(query);
      const tokenDoc = await cursor.next();

      if (!tokenDoc) {
        return { valid: false, message: 'Invalid token' };
      }

      // Check if token is expired
      const expiresAt = new Date(tokenDoc.expiresAt);
      const now = new Date();

      if (now > expiresAt) {
        return { valid: false, expired: true, message: 'Token has expired' };
      }

      // Check if token has been used
      if (tokenDoc.used) {
        return { valid: false, used: true, message: 'Token has already been used' };
      }

      // Token is valid
      return {
        valid: true,
        message: 'Token is valid',
        userId: tokenDoc.userId
      };
    } catch (error) {
      console.error(`Error validating reset token ${token}:`, error);
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
      // Validate token first
      const validation = await this.validateResetToken(token);
      if (!validation.valid) {
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

      return { success: true, message: 'Password has been reset successfully' };
    } catch (error) {
      console.error(`Error resetting password with token ${token}:`, error);
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
      // Get user
      const user = await this.users.document(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Verify current password
      const isPasswordValid = await this.verifyPassword(currentPassword, user.encPassword);
      if (!isPasswordValid) {
        throw new Error('Current password is incorrect');
      }

      // Hash the new password
      const hashedPassword = await this.hashPassword(newPassword);

      // Update user's password
      await this.users.update(userId, {
        encPassword: hashedPassword,
        updatedAt: new Date().toISOString()
      });

      return { success: true, message: 'Password changed successfully' };
    } catch (error) {
      console.error(`Error changing password for user ${userId}:`, error);
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
      return await this.users.document(userId);
    } catch (error) {
      if (error.code === 404) {
        return null;
      }
      console.error(`Error getting user ${userId}:`, error);
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
      const query = aql`
        FOR u IN users
          FILTER u.loginName == ${loginName} OR u.email == ${email}
          RETURN u
      `;

      const cursor = await this.db.query(query);
      return await cursor.next();
    } catch (error) {
      console.error(`Error getting user by login name or email:`, error);
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
      const query = aql`
        FOR u IN users
          FILTER u.email == ${email}
          RETURN u
      `;

      const cursor = await this.db.query(query);
      return await cursor.next();
    } catch (error) {
      console.error(`Error getting user by email:`, error);
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
      // Verify token signature
      const decoded = jwt.verify(token, this.jwtSecret);

      // Check if token is still valid in database
      const user = await this.getUserById(decoded.userId);
      if (!user || user.accessToken !== token) {
        return null;
      }

      return decoded;
    } catch (error) {
      console.error('Token verification error:', error);
      return null;
    }
  }

  /**
   * Generate a JWT token for a user
   * @param {Object} user - User object
   * @returns {string} JWT token
   */
  generateToken(user) {
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
    // The password is already a SHA-256 hash from the client (64 chars hex),
    // We hash it with bcrypt for secure storage
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
    // If the stored password is a bcrypt hash (starts with $2)
    if (storedPassword.startsWith('$2')) {
      // Use bcrypt to compare SHA-256 hash with bcrypt hash
      return await bcrypt.compare(clientPassword, storedPassword);
    }
    // If the stored password is a plain SHA-256 hash (64 hex chars)
    else if (/^[a-f0-9]{64}$/i.test(storedPassword)) {
      // Direct comparison of SHA-256 hashes
      return clientPassword === storedPassword;

      // Optionally, if you want to upgrade passwords on login:
      /*
      if (clientPassword === storedPassword) {
        // Consider upgrading the password to bcrypt format here
        // This would happen after a successful login
        return true;
      }
      return false;
      */
    }

    // Unknown format, return false
    return false;
  }

  /**
   * Compare a password with a hashed password (legacy method)
   * @param {string} password - Client-hashed password (SHA-256)
   * @param {string} hashedPassword - Hashed password from database
   * @returns {Promise<boolean>} True if password matches
   */
  async comparePasswords(password, hashedPassword) {
    // Use the more versatile verifyPassword method
    return this.verifyPassword(password, hashedPassword);
  }

  /**
   * Clean up expired tokens
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanupExpiredTokens() {
    try {
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

      return {
        success: true,
        removed: resetRemoved.length + verifyRemoved.length,
        message: `Removed ${resetRemoved.length} expired reset tokens and ${verifyRemoved.length} verification tokens`
      };
    } catch (error) {
      console.error('Error cleaning up expired tokens:', error);
      throw error;
    }
  }
}

// Export a singleton instance
module.exports = new AuthService();