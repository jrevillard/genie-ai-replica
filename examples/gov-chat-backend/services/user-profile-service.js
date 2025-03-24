// user-profile-service.js
const { Database, aql } = require('arangojs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const emailService = require('./email-service');
const crypto = require('crypto');
// Initialize ArangoDB connection
const dbService = require('../utils/db-connect-service');

const initDB = dbService.getConnection();

class UserProfileService {
  constructor() {
    this.db = initDB;
    this.users = this.db.collection('users');
    this.uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

    // Ensure uploads directory exists
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  /**
   * Create a new user profile
   * @param {Object} profileData - User profile data
   * @param {Object} files - Files uploaded by the user
   * @returns {Promise<Object>} The created user profile
   */
  async createUserProfile(profileData, files = {}) {
    try {
      // Ensure profileData is an object
      if (typeof profileData === 'string') {
        try {
          profileData = JSON.parse(profileData);
        } catch (error) {
          console.error('Error parsing profile data string:', error);
          profileData = {};
        }
      }

      console.log('Creating user profile with data:', JSON.stringify(profileData).substring(0, 100) + '...');

      // Create a minimal document first - let ArangoDB generate the key
      const basicDoc = {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Add essential user data if available
      if (profileData.personalIdentification) {
        basicDoc.personalIdentification = profileData.personalIdentification;
      }

      console.log('Creating basic user document...');
      const user = await this.users.save(basicDoc);
      const userId = user._key;
      console.log(`User created with auto-generated key: ${userId}`);

      // Process and store file uploads if any
      const processedData = await this.processProfileData(profileData, files, userId);

      // Remove any _key property to avoid conflicts
      delete processedData._key;

      // Update with full processed data
      if (Object.keys(processedData).length > 0) {
        console.log(`Updating user ${userId} with full profile data...`);
        const updatedUser = await this.users.update(userId, processedData, { returnNew: true });
        return updatedUser.new;
      }

      return user;
    } catch (error) {
      console.error('Error creating user profile:', error);
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
      // Ensure profileData is an object
      if (typeof profileData === 'string') {
        try {
          profileData = JSON.parse(profileData);
        } catch (error) {
          console.error('Error parsing profile data string:', error);
          profileData = {};
        }
      }

      // Check if user exists
      const userExists = await this.userExists(userId);
      if (!userExists) {
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

      return updatedUser.new;
    } catch (error) {
      console.error(`Error updating user profile ${userId}:`, error);
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
      const user = await this.users.document(userId);
      return user;
    } catch (error) {
      console.error(`Error getting user profile ${userId}:`, error);
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
      // Get user to check for file paths to delete
      const user = await this.getUserProfile(userId);

      // Delete user files
      await this.deleteUserFiles(user);

      // Delete user document
      const result = await this.users.remove(userId);

      return result;
    } catch (error) {
      console.error(`Error deleting user profile ${userId}:`, error);
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
      await this.users.document(userId);
      return true;
    } catch (error) {
      if (error.code === 404) {
        return false;
      }
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
      // Check if user exists
      const user = await this.getUserProfile(userId);
      if (!user) {
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

      // Send verification email to the new email address
      const userName = user.personalIdentification?.fullName || user.loginName || 'User';
      await emailService.sendVerificationEmail(newEmail, token, userName);

      return {
        success: true,
        message: 'Verification email sent to new address'
      };
    } catch (error) {
      console.error(`Error initiating email change for user ${userId}:`, error);
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
    // Ensure profileData is an object
    if (typeof profileData === 'string') {
      try {
        profileData = JSON.parse(profileData);
      } catch (error) {
        console.error('Error parsing profile data in processProfileData:', error);
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
              }
            } catch (error) {
              console.error(`Error storing file for field ${section}-${fieldName}:`, error);
            }
          }
        }
      }
    }

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
      // Create user directory if it doesn't exist
      const userDir = path.join(this.uploadDir, userId);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
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
      return `/uploads/${userId}/${fileName}`;
    } catch (error) {
      console.error(`Error storing file for user ${userId}:`, error);
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

    // Check if user directory exists
    if (fs.existsSync(userDir)) {
      // Delete all files in the directory
      await fs.promises.rm(userDir, { recursive: true, force: true });
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
      console.error('Error searching users:', error);
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
      console.log(`Checking if email ${email} is available`);

      const query = aql`
      FOR u IN users
        FILTER u.email == ${email}
        RETURN u
    `;

      const cursor = await this.db.query(query);
      const existingUser = await cursor.next();

      const isAvailable = !existingUser;
      console.log(`Email ${email} is ${isAvailable ? 'available' : 'already in use'}`);

      return isAvailable;
    } catch (error) {
      console.error('Error checking email availability:', error);
      return false; // Default to unavailable on error for safety
    }
  }
}

module.exports = UserProfileService;