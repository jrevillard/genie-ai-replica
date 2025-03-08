// user-profile-service.js
const { Database, aql } = require('arangojs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

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

class UserProfileService {
  constructor() {
    this.db = initDB();
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
      const userId = profileData._key || `user_${uuidv4()}`;
      
      // Process and store file uploads
      const processedData = await this.processProfileData(profileData, files, userId);
      
      // Set creation and update timestamps
      processedData._key = userId;
      processedData.createdAt = new Date().toISOString();
      processedData.updatedAt = new Date().toISOString();

      // Create the user document
      const user = await this.users.save(processedData);
      
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
      // Check if user exists
      const userExists = await this.userExists(userId);
      if (!userExists) {
        throw new Error(`User with ID ${userId} not found`);
      }

      // Process the updated profile data and files
      const processedData = await this.processProfileData(profileData, files, userId);
      
      // Update the timestamp
      processedData.updatedAt = new Date().toISOString();

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
   * Process user profile data and file uploads
   * @param {Object} profileData - User profile data
   * @param {Object} files - Files uploaded by the user
   * @param {String} userId - User ID
   * @returns {Promise<Object>} Processed profile data
   */
  async processProfileData(profileData, files, userId) {
    // Deep clone the profile data to avoid mutations
    const processedData = JSON.parse(JSON.stringify(profileData));
    
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

    for (const section of sections) {
      if (!processedData[section]) continue;
      
      // Process each field in the section
      for (const field in processedData[section]) {
        // Check if this field has a file upload
        const fileKey = `${section}-${field}`;
        if (files[fileKey]) {
          // Store the file and set URL in profile data
          const fileUrl = await this.storeFile(files[fileKey], userId, fileKey);
          processedData[section][`${field}Url`] = fileUrl;
          // Remove the file object from the data
          delete processedData[section][field];
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
    // Create user directory if it doesn't exist
    const userDir = path.join(this.uploadDir, userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    // Generate a unique filename
    const fileExt = path.extname(file.originalname);
    const fileName = `${fieldName}-${Date.now()}${fileExt}`;
    const filePath = path.join(userDir, fileName);

    // Save the file
    await fs.promises.writeFile(filePath, file.buffer);

    // Return file URL (relative to upload dir)
    return `/uploads/${userId}/${fileName}`;
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
      const filterQuery = filterConditions.length > 0
        ? aql`FILTER ${aql.join(filterConditions, ' AND ')}`
        : aql``;

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
}

module.exports = UserProfileService;
