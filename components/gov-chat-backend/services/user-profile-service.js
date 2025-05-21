const { Database, aql } = require('arangojs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const emailService = require('./email-service');
const crypto = require('crypto');
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

class UserProfileService {
  constructor() {
    this.db = initDB;
    this.users = this.db.collection('users');
    this.uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

    // Ensure uploads directory exists
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
      logger.info(`Created uploads directory at ${this.uploadDir}`);
    }
    logger.info('UserProfileService initialized');
  }

  /**
   * Create a new user profile
   * @param {Object} profileData - User profile data
   * @param {Object} files - Files uploaded by the user
   * @returns {Promise<Object>} The created user profile
   */
  async createUserProfile(profileData, files = {}) {
    try {
      logger.info('Creating user profile');

      // Ensure profileData is an object
      if (typeof profileData === 'string') {
        try {
          profileData = JSON.parse(profileData);
        } catch (error) {
          logger.error('Error parsing profile data string:', error);
          profileData = {};
        }
      }

      logger.info('Creating user profile with data:', JSON.stringify(profileData).substring(0, 100) + '...');

      // Create a minimal document first - let ArangoDB generate the key
      const basicDoc = {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Add essential user data if available
      if (profileData.personalIdentification) {
        basicDoc.personalIdentification = profileData.personalIdentification;
      }

      logger.info('Creating basic user document...');
      const user = await this.users.save(basicDoc);
      const userId = user._key;
      logger.info(`User created with auto-generated key: ${userId}`);

      // Process and store file uploads if any
      const processedData = await this.processProfileData(profileData, files, userId);

      // Remove any _key property to avoid conflicts
      delete processedData._key;

      // Update with full processed data
      if (Object.keys(processedData).length > 0) {
        logger.info(`Updating user ${userId} with full profile data...`);
        const updatedUser = await this.users.update(userId, processedData, { returnNew: true });
        logger.info(`User profile ${userId} created successfully`);
        return updatedUser.new;
      }

      logger.info(`User profile ${userId} created successfully`);
      return user;
    } catch (error) {
      logger.error('Error creating user profile:', error);
      throw error;
    }
  }

  /**
   * Update an existing user profile
   * @param {String} userId - User ID
   * @param {Object} profileData - User profile data to update
   * @param {Object} files - Files uploaded by the user
   * @returns {Promise<Object>} The updated user profile
   */
  async updateUserProfile(userId, profileData, files = {}) {
    try {
      logger.info(`Updating user profile for user ${userId}`);

      // Ensure profileData is an object
      if (typeof profileData === 'string') {
        try {
          profileData = JSON.parse(profileData);
        } catch (error) {
          logger.error('Error parsing profile data string:', error);
          profileData = {};
        }
      }

      // Check if user exists
      const userExists = await this.userExists(userId);
      if (!userExists) {
        logger.warn(`User with ID ${userId} not found`);
        throw new Error(`User with ID ${userId} not found`);
      }

      // Process the updated profile data and files
      const processedData = await this.processProfileData(profileData, files, userId);

      // Update the timestamp
      processedData.updatedAt = new Date().toISOString();

      // Don't include _key in update data
      delete processedData._key;

      // Update the user document
      const updatedUser = await this.users.update(userId, processedData, { returnNew: true });

      logger.info(`User profile ${userId} updated successfully`);
      return updatedUser.new;
    } catch (error) {
      logger.error(`Error updating user profile ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get a user profile by ID
   * @param {String} userId - User ID
   * @returns {Promise<Object>} The user profile
   */
  async getUserProfile(userId) {
    try {
      logger.info(`Fetching user profile for user ${userId}`);

      const user = await this.users.document(userId);
      logger.info(`User profile ${userId} retrieved successfully`);
      return user;
    } catch (error) {
      logger.error(`Error getting user profile ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a user profile
   * @param {String} userId - User ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteUserProfile(userId) {
    try {
      logger.info(`Deleting user profile for user ${userId}`);

      // Get user to check for file paths to delete
      const user = await this.getUserProfile(userId);

      // Delete user files
      await this.deleteUserFiles(user);
      logger.info(`User files deleted for user ${userId}`);

      // Delete user document
      const result = await this.users.remove(userId);
      logger.info(`User profile ${userId} deleted successfully`);

      return result;
    } catch (error) {
      logger.error(`Error deleting user profile ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Check if a user exists
   * @param {String} userId - User ID
   * @returns {Promise<Boolean>} True if user exists
   */
  async userExists(userId) {
    try {
      logger.info(`Checking if user ${userId} exists`);

      await this.users.document(userId);
      logger.info(`User ${userId} exists`);
      return true;
    } catch (error) {
      if (error.code === 404) {
        logger.info(`User ${userId} does not exist`);
        return false;
      }
      logger.error(`Error checking if user ${userId} exists:`, error);
      throw error;
    }
  }

  /**
   * Initiate email change process
   * @param {String} userId - User ID
   * @param {String} newEmail - New email address
   * @returns {Promise<Object>} Operation result
   */
  async initiateEmailChange(userId, newEmail) {
    try {
      logger.info(`Initiating email change for user ${userId} to ${newEmail}`);

      // Check if user exists
      const user = await this.getUserProfile(userId);
      if (!user) {
        logger.warn(`User with ID ${userId} not found`);
        throw new Error(`User with ID ${userId} not found`);
      }

      // Generate verification token
      const token = crypto.randomBytes(32).toString('hex');

      // Store token and new email in user document
      const updateData = {
        pendingEmailChange: {
          email: newEmail,
          token: token
        },
        updatedAt: new Date().toISOString()
      };

      // Update user document with pending email change
      await this.users.update(userId, updateData);
      logger.info(`Pending email change updated for user ${userId}`);

      // Send verification email to the new email address
      const userName = user.personalIdentification?.fullName || user.loginName || 'User';
      await emailService.sendVerificationEmail(newEmail, token, userName);
      logger.info(`Verification email sent to ${newEmail} for user ${userId}`);

      return {
        success: true,
        message: 'Verification email sent to new address'
      };
    } catch (error) {
      logger.error(`Error initiating email change for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Process user profile data and file uploads
   * @param {Object} profileData - User profile data
   * @param {Object} files - Files uploaded by the user
   * @param {String} userId - User ID
   * @returns {Promise<Object>} Processed profile data
   */
  async processProfileData(profileData, files, userId) {
    logger.info(`Processing profile data for user ${userId}`);

    // Ensure profileData is an object
    if (typeof profileData === 'string') {
      try {
        profileData = JSON.parse(profileData);
      } catch (error) {
        logger.error('Error parsing profile data in processProfileData:', error);
        profileData = {};
      }
    }

    // Create a new object to avoid mutations
    const processedData = {};

    // Copy all properties except _key
    for (const key in profileData) {
      if (key !== '_key') {
        processedData[key] = profileData[key];
      }
    }

    // Process each section that might contain file uploads
    const sections = [
      'personalIdentification',
      'civilRegistration',
      'addressResidency',
      'identityTravel',
      'healthMedical',
      'employment',
      'financialTax',
      'criminalLegal',
      'transportation'
    ];

    // Make sure each section exists in processedData if it exists in profileData
    for (const section of sections) {
      if (profileData[section] && !processedData[section]) {
        processedData[section] = {};
      }
    }

    // Process files for each section
    for (const section of sections) {
      // Skip if section doesn't exist in processed data
      if (!processedData[section]) continue;

      // Process each field in the section
      if (files && (Array.isArray(files) || typeof files === 'object')) {
        const fileArray = Array.isArray(files) ? files : Object.values(files);

        for (const file of fileArray) {
          // Check if this file belongs to this section
          const fileNameParts = (file.fieldname || file.name || '').split('-');
          if (fileNameParts.length >= 2 && fileNameParts[0] === section) {
            const fieldName = fileNameParts[1];
            try {
              // Store the file and set URL in profile data
              const fileUrl = await this.storeFile(file, userId, `${section}-${fieldName}`);
              if (fileUrl) {
                processedData[section][`${fieldName}Url`] = fileUrl;
                logger.info(`Stored file for ${section}-${fieldName} for user ${userId}: ${fileUrl}`);
              }
            } catch (error) {
              logger.error(`Error storing file for field ${section}-${fieldName}:`, error);
            }
          }
        }
      }
    }

    logger.info(`Profile data processed for user ${userId}`);
    return processedData;
  }

  /**
   * Store a file upload
   * @param {Object} file - File object
   * @param {String} userId - User ID
   * @param {String} fieldName - Field name
   * @returns {Promise<String>} File URL
   */
  async storeFile(file, userId, fieldName) {
    try {
      logger.info(`Storing file for user ${userId}, field ${fieldName}`);

      // Create user directory if it doesn't exist
      const userDir = path.join(this.uploadDir, userId);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
        logger.info(`Created user directory for user ${userId} at ${userDir}`);
      }

      // Generate a unique filename
      const fileExt = path.extname(file.originalname || file.name || 'unknown');
      const fileName = `${fieldName}-${Date.now()}${fileExt}`;
      const filePath = path.join(userDir, fileName);

      // Save the file - handle different file object formats
      if (file.buffer) {
        // If file has buffer property (multer memory storage)
        await fs.promises.writeFile(filePath, file.buffer);
      } else if (file.path) {
        // If file has path property (multer disk storage)
        const fileContent = await fs.promises.readFile(file.path);
        await fs.promises.writeFile(filePath, fileContent);
      } else {
        throw new Error('Unsupported file object format');
      }

      // Return file URL (relative to upload dir)
      const fileUrl = `/uploads/${userId}/${fileName}`;
      logger.info(`File stored successfully for user ${userId}: ${fileUrl}`);
      return fileUrl;
    } catch (error) {
      logger.error(`Error storing file for user ${userId}:`, error);
      return null; // Return null instead of throwing to prevent the entire process from failing
    }
  }

  /**
   * Delete user files
   * @param {Object} user - User profile object
   * @returns {Promise<void>}
   */
  async deleteUserFiles(user) {
    const userId = user._key;
    const userDir = path.join(this.uploadDir, userId);

    logger.info(`Deleting user files for user ${userId}`);

    // Check if user directory exists
    if (fs.existsSync(userDir)) {
      // Delete all files in the directory
      await fs.promises.rm(userDir, { recursive: true, force: true });
      logger.info(`User directory deleted for user ${userId}`);
    } else {
      logger.info(`No user directory found for user ${userId}`);
    }
  }

  /**
   * Search for users based on criteria
   * @param {Object} criteria - Search criteria
   * @param {Number} limit - Maximum number of results (default: 20)
   * @param {Number} offset - Offset for pagination (default: 0)
   * @returns {Promise<Object>} Search results
   */
  async searchUsers(criteria, limit = 20, offset = 0) {
    try {
      logger.info('Searching users with criteria:', criteria);

      const bindVars = { limit, offset };
      let filterConditions = [];

      // Build filter conditions based on criteria
      if (criteria.fullName) {
        filterConditions.push(aql`LOWER(u.personalIdentification.fullName) LIKE CONCAT("%", LOWER(${criteria.fullName}), "%")`);
      }

      if (criteria.nationality) {
        filterConditions.push(aql`LOWER(u.personalIdentification.nationality) LIKE CONCAT("%", LOWER(${criteria.nationality}), "%")`);
      }

      if (criteria.address) {
        filterConditions.push(aql`LOWER(u.addressResidency.currentAddress) LIKE CONCAT("%", LOWER(${criteria.address}), "%")`);
      }

      if (criteria.email) {
        filterConditions.push(aql`LOWER(u.contactInfo.email) LIKE CONCAT("%", LOWER(${criteria.email}), "%")`);
      }

      if (criteria.phone) {
        filterConditions.push(aql`LOWER(u.contactInfo.phone) LIKE CONCAT("%", LOWER(${criteria.phone}), "%")`);
      }

      if (criteria.idCard) {
        filterConditions.push(aql`LOWER(u.identityTravel.idCard) LIKE CONCAT("%", LOWER(${criteria.idCard}), "%")`);
      }

      // If no specific criteria provided, return all users
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
        FOR u IN users
          ${filterQuery}
          SORT u.createdAt DESC
          LIMIT ${offset}, ${limit}
          RETURN u
      `;

      // Execute the query and get results
      const cursor = await this.db.query(query);
      const users = await cursor.all();

      // Get total count for pagination
      const countQuery = aql`
        FOR u IN users
          ${filterQuery}
          COLLECT WITH COUNT INTO total
          RETURN total
      `;
      const countCursor = await this.db.query(countQuery);
      const totalCount = await countCursor.next() || 0;

      logger.info(`Found ${users.length} users matching criteria`);
      return {
        users,
        pagination: {
          total: totalCount,
          limit,
          offset,
          pages: Math.ceil(totalCount / limit),
          currentPage: Math.floor(offset / limit) + 1
        }
      };
    } catch (error) {
      logger.error('Error searching users:', error);
      throw error;
    }
  }

  /**
   * Check if an email is available (not used by another user)
   * @param {String} email - Email to check
   * @returns {Promise<Boolean>} True if email is available, false if already in use
   */
  async isEmailAvailable(email) {
    try {
      logger.info(`Checking if email ${email} is available`);

      const query = aql`
        FOR u IN users
          FILTER u.email == ${email}
          RETURN u
      `;

      const cursor = await this.db.query(query);
      const existingUser = await cursor.next();

      const isAvailable = !existingUser;
      logger.info(`Email ${email} is ${isAvailable ? 'available' : 'already in use'}`);

      return isAvailable;
    } catch (error) {
      logger.error('Error checking email availability:', error);
      return false; // Default to unavailable on error for safety
    }
  }

  /**
   * Reset user data while preserving essential account information
   * @param {String} userId - User ID
   * @returns {Promise<Object>} Result of the reset operation
   */
  async resetUserData(userId) {
    try {
      logger.info(`[USER PROFILE SERVICE] Resetting data for user: ${userId}`);

      // Get current user document
      const currentUserDoc = await this.getUserProfile(userId);

      if (!currentUserDoc) {
        logger.warn(`User with ID ${userId} not found`);
        throw new Error(`User with ID ${userId} not found`);
      }

      // Create a completely new document with ONLY the fields we want to preserve
      const preservedData = {
        // Preserve essential account information
        loginName: currentUserDoc.loginName,
        email: currentUserDoc.email,
        encPassword: currentUserDoc.encPassword,
        emailVerified: currentUserDoc.emailVerified || false,
        createdAt: currentUserDoc.createdAt,
        updatedAt: new Date().toISOString(),
        accessToken: currentUserDoc.accessToken
      };

      // Log which fields we're preserving
      logger.info(`[USER PROFILE SERVICE] Preserving fields: ${Object.keys(preservedData).join(', ')}`);

      // Check if there are any uploaded files to clean up
      await this.deleteUserFiles(currentUserDoc);

      // Now COMPLETELY REPLACE the document with only our preserved fields
      // This will remove all other fields like personalIdentification, addressResidency, etc.
      try {
        // Use replace operation which completely replaces the document
        await this.users.replace(userId, preservedData);
        logger.info(`[USER PROFILE SERVICE] User document replaced successfully`);
      } catch (replaceError) {
        logger.warn(`[USER PROFILE SERVICE] Replace operation failed, falling back to update: ${replaceError.message}`);

        // Fallback to update with options that make it act like replace
        await this.users.update(userId, preservedData, {
          keepNull: true,
          mergeObjects: false,  // Don't merge with existing document
          overwrite: true       // Completely overwrite the document
        });
        logger.info(`[USER PROFILE SERVICE] User document updated with overwrite`);
      }

      logger.info(`[USER PROFILE SERVICE] User data reset completed for user: ${userId}`);

      return {
        userId,
        fieldsPreserved: Object.keys(preservedData).length,
        success: true
      };
    } catch (error) {
      logger.error(`[USER PROFILE SERVICE] Error resetting user data for ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Permanently delete a user account
   * @param {String} userId - User ID
   * @returns {Promise<Object>} Result of the deletion operation
   */
  async deleteUserAccountPermanently(userId) {
    try {
      logger.info(`Permanently deleting user account for user ${userId}`);

      // Get user document
      const user = await this.getUserProfile(userId);
      if (!user) {
        logger.warn(`User with ID ${userId} not found`);
        throw new Error(`User not found`);
      }

      // Delete user files
      await this.deleteUserFiles(user);
      logger.info(`User files deleted for user ${userId}`);

      // Delete related tokens
      try {
        const verificationTokens = this.db.collection('verificationTokens');
        const passwordResetTokens = this.db.collection('passwordResetTokens');

        // Delete tokens
        const verifyQuery = aql`
          FOR t IN verificationTokens
            FILTER t.userId == ${'users/' + userId}
            REMOVE t IN verificationTokens
        `;
        const resetQuery = aql`
          FOR t IN passwordResetTokens
            FILTER t.userId == ${'users/' + userId}
            REMOVE t IN passwordResetTokens
        `;

        await this.db.query(verifyQuery);
        await this.db.query(resetQuery);
        logger.info(`Related tokens deleted for user ${userId}`);
      } catch (error) {
        logger.warn(`Error cleaning related data: ${error.message}`);
      }

      // Delete user document
      await this.users.remove(userId);
      logger.info(`User account ${userId} permanently deleted`);

      return { userId, success: true, deletedAt: new Date().toISOString() };
    } catch (error) {
      logger.error(`Error deleting account for ${userId}:`, error);
      throw error;
    }
  }
}

module.exports = UserProfileService;