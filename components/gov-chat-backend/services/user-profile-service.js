const { Database, aql } = require('arangojs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const emailService = require('./email-service');
const crypto = require('crypto');
const { logger } = require('../logger'); // Corrected import

const dbService = require('../utils/db-connect-service');

const initDB = dbService.getConnection();

class UserProfileService {
  constructor() {
    this.db = initDB;
    this.users = this.db.collection('users');
    this.uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
      logger.info('UserProfileService.created_upload_dir', { path: this.uploadDir });
    }
    logger.info('UserProfileService.initialized');
  }

  async createUserProfile(profileData, files = {}) {
    const startTime = Date.now();
    try {
      logger.info('UserProfileService.create_user_profile_start', { dataLength: JSON.stringify(profileData).length });

      if (typeof profileData === 'string') {
        try {
          profileData = JSON.parse(profileData);
        } catch (error) {
          logger.error('UserProfileService.parse_profile_data_failed', { error: error.message });
          profileData = {};
        }
      }

      const basicDoc = {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (profileData.personalIdentification) {
        basicDoc.personalIdentification = profileData.personalIdentification;
      }

      logger.debug('UserProfileService.creating_basic_user_doc', { basicDoc });
      const user = await this.users.save(basicDoc);
      const userId = user._key;
      logger.info('UserProfileService.user_created', { userId });

      const processedData = await this.process(userId, profileData, files);

      delete processedData._key;

      if (Object.keys(processedData).length > 0) {
        logger.debug('UserProfileService.updating_user_with_full_data', { userId });
        const updatedUser = await this.users.update(userId, processedData, { returnNew: true });
        logger.info('UserProfileService.user_profile_created', {
          userId,
          durationMs: Date.now() - startTime
        });
        return updatedUser.new;
      }

      logger.info('UserProfileService.user_profile_created', {
        userId,
        durationMs: Date.now() - startTime
      });
      return user;
    } catch (error) {
      logger.error('UserProfileService.create_user_profile_failed', {
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  async updateUserProfile(userId, profileData, files = {}) {
    const startTime = Date.now();
    try {
      logger.info('UserProfileService.update_user_profile_start', { userId });

      if (typeof profileData === 'string') {
        try {
          profileData = JSON.parse(profileData);
        } catch (error) {
          logger.error('UserProfileService.parse_profile_data_failed', { userId, error: error.message });
          profileData = {};
        }
      }

      const userExists = await this.userExists(userId);
      if (!userExists) {
        logger.warn('UserProfileService.user_not_found', { userId });
        throw new Error(`User with ID ${userId} not found`);
      }

      const processedData = await this.process(userId, profileData, files);

      processedData.updatedAt = new Date().toISOString();

      delete processedData._key;

      const updatedUser = await this.users.update(userId, processedData, { returnNew: true });

      logger.info('UserProfileService.user_profile_updated', {
        userId,
        durationMs: Date.now() - startTime
      });
      return updatedUser.new;
    } catch (error) {
      logger.error('UserProfileService.update_user_profile_failed', {
        userId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  async getUserProfile(userId) {
    const startTime = Date.now();
    try {
      logger.info('UserProfileService.get_user_profile_start', { userId });

      const user = await this.users.document(userId);
      logger.info('UserProfileService.user_profile_retrieved', {
        userId,
        durationMs: Date.now() - startTime
      });
      return user;
    } catch (error) {
      logger.error('UserProfileService.get_user_profile_failed', {
        userId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  async deleteUserProfile(userId) {
    const startTime = Date.now();
    try {
      logger.info('UserProfileService.delete_user_profile_start', { userId });

      const user = await this.getUserProfile(userId);

      await this.deleteUserFiles(user);
      logger.info('UserProfileService.user_files_deleted', { userId });

      const result = await this.users.remove(userId);
      logger.info('UserProfileService.user_profile_deleted', {
        userId,
        durationMs: Date.now() - startTime
      });

      return result;
    } catch (error) {
      logger.error('UserProfileService.delete_user_profile_failed', {
        userId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  async userExists(userId) {
    const startTime = Date.now();
    try {
      logger.debug('UserProfileService.check_user_exists', { userId });

      await this.users.document(userId);
      logger.debug('UserProfileService.user_exists', { userId, durationMs: Date.now() - startTime });
      return true;
    } catch (error) {
      if (error.code === 404) {
        logger.debug('UserProfileService.user_not_exists', { userId });
        return false;
      }
      logger.error('UserProfileService.check_user_exists_failed', {
        userId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  async initiateEmailChange(userId, newEmail) {
    const startTime = Date.now();
    try {
      logger.info('UserProfileService.initiate_email_change_start', { userId, newEmail });

      const user = await this.getUserProfile(userId);
      if (!user) {
        logger.warn('UserProfileService.user_not_found', { userId });
        throw new Error(`User with ID ${userId} not found`);
      }

      const token = crypto.randomBytes(32).toString('hex');

      const updateData = {
        pendingEmailChange: {
          email: newEmail,
          token: token
        },
        updatedAt: new Date().toISOString()
      };

      await this.users.update(userId, updateData);
      logger.info('UserProfileService.pending_email_change_updated', { userId, newEmail });

      const userName = user.personalIdentification?.fullName || user.loginName || 'User';
      await emailService.sendVerificationEmail(newEmail, token, userName);
      logger.info('UserProfileService.verification_email_sent', { userId, newEmail });

      logger.info('UserProfileService.initiate_email_change_completed', {
        userId,
        durationMs: Date.now() - startTime
      });
      return {
        success: true,
        message: 'Verification email sent to new address'
      };
    } catch (error) {
      logger.error('UserProfileService.initiate_email_change_failed', {
        userId,
        newEmail,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  async process(userId, profileData, files) {
    const startTime = Date.now();
    logger.info('UserProfileService.process_profile_data_start', { userId });

    if (typeof profileData === 'string') {
      try {
        profileData = JSON.parse(profileData);
      } catch (error) {
        logger.error('UserProfileService.parse_profile_data_failed', { userId, error: error.message });
        profileData = {};
      }
    }

    const processedData = {};

    for (const key in profileData) {
      if (key !== '_key') {
        processedData[key] = profileData[key];
      }
    }

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
      if (profileData[section] && !processedData[section]) {
        processedData[section] = {};
      }
    }

    for (const section of sections) {
      if (!processedData[section]) continue;

      if (files && (Array.isArray(files) || typeof files === 'object')) {
        const fileArray = Array.isArray(files) ? files : Object.values(files);

        for (const file of fileArray) {
          const fileNameParts = (file.fieldname || file.name || '').split('-');
          if (fileNameParts.length >= 2 && fileNameParts[0] === section) {
            const fieldName = fileNameParts[1];
            try {
              const fileUrl = await this.storeFile(file, userId, `${section}-${fieldName}`);
              if (fileUrl) {
                processedData[section][`${fieldName}Url`] = fileUrl;
                logger.info('UserProfileService.file_stored', {
                  userId,
                  section,
                  fieldName,
                  fileUrl
                });
              }
            } catch (error) {
              logger.error('UserProfileService.store_file_failed', {
                userId,
                section,
                fieldName,
                error: error.message
              });
            }
          }
        }
      }
    }

    logger.info('UserProfileService.process_profile_data_completed', {
      userId,
      durationMs: Date.now() - startTime
    });
    return processedData;
  }

  async storeFile(file, userId, fieldName) {
    const startTime = Date.now();
    try {
      logger.debug('UserProfileService.store_file_start', { userId, fieldName });

      const userDir = path.join(this.uploadDir, userId);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
        logger.info('UserProfileService.created_user_directory', { userId, path: userDir });
      }

      const fileExt = path.extname(file.originalname || file.name || 'unknown');
      const fileName = `${fieldName}-${Date.now()}${fileExt}`;
      const filePath = path.join(userDir, fileName);

      if (file.buffer) {
        await fs.promises.writeFile(filePath, file.buffer);
      } else if (file.path) {
        const fileContent = await fs.promises.readFile(file.path);
        await fs.promises.writeFile(filePath, fileContent);
      } else {
        throw new Error('Unsupported file object format');
      }

      const fileUrl = `/uploads/${userId}/${fileName}`;
      logger.info('UserProfileService.file_stored_success', {
        userId,
        fieldName,
        fileUrl,
        durationMs: Date.now() - startTime
      });
      return fileUrl;
    } catch (error) {
      logger.error('UserProfileService.store_file_failed', {
        userId,
        fieldName,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      return null;
    }
  }

  async deleteUserFiles(user) {
    const startTime = Date.now();
    const userId = user._key;
    const userDir = path.join(this.uploadDir, userId);

    logger.info('UserProfileService.delete_user_files_start', { userId });

    if (fs.existsSync(userDir)) {
      await fs.promises.rm(userDir, { recursive: true, force: true });
      logger.info('UserProfileService.user_directory_deleted', {
        userId,
        durationMs: Date.now() - startTime
      });
    } else {
      logger.debug('UserProfileService.no_user_directory_found', { userId });
    }
  }

  async searchUsers(criteria, limit = 20, offset = 0) {
    const startTime = Date.now();
    try {
      logger.info('UserProfileService.search_users_start', { criteria, limit, offset });

      const bindVars = { limit, offset };
      let filterConditions = [];

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

      let filterQuery;
      if (filterConditions.length > 0) {
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

      const query = aql`
        FOR u IN users
          ${filterQuery}
          SORT u.createdAt DESC
          LIMIT ${offset}, ${limit}
          RETURN u
      `;

      const cursor = await this.db.query(query);
      const users = await cursor.all();

      const countQuery = aql`
        FOR u IN users
          ${filterQuery}
          COLLECT WITH COUNT INTO total
          RETURN total
      `;
      const countCursor = await this.db.query(countQuery);
      const totalCount = await countCursor.next() || 0;

      logger.info('UserProfileService.search_users_completed', {
        resultCount: users.length,
        totalCount,
        durationMs: Date.now() - startTime
      });
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
      logger.error('UserProfileService.search_users_failed', {
        criteria,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  async isEmailAvailable(email) {
    const startTime = Date.now();
    try {
      logger.info('UserProfileService.check_email_availability_start', { email });

      const query = aql`
        FOR u IN users
          FILTER u.email == ${email}
          RETURN u
      `;

      const cursor = await this.db.query(query);
      const existingUser = await cursor.next();

      const isAvailable = !existingUser;
      logger.info('UserProfileService.email_availability_checked', {
        email,
        isAvailable,
        durationMs: Date.now() - startTime
      });
      return isAvailable;
    } catch (error) {
      logger.error('UserProfileService.check_email_availability_failed', {
        email,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      return false;
    }
  }

  async resetUserData(userId) {
    const startTime = Date.now();
    try {
      logger.info('UserProfileService.reset_user_data_start', { userId });

      const currentUserDoc = await this.getUserProfile(userId);
      if (!currentUserDoc) {
        logger.warn('UserProfileService.user_not_found', { userId });
        throw new Error(`User with ID ${userId} not found`);
      }

      const preservedData = {
        loginName: currentUserDoc.loginName,
        email: currentUserDoc.email,
        encPassword: currentUserDoc.encPassword,
        emailVerified: currentUserDoc.emailVerified || false,
        createdAt: currentUserDoc.createdAt,
        updatedAt: new Date().toISOString(),
        accessToken: currentUserDoc.accessToken
      };

      logger.debug('UserProfileService.preserving_fields', {
        userId,
        fields: Object.keys(preservedData)
      });

      await this.deleteUserFiles(currentUserDoc);

      try {
        await this.users.replace(userId, preservedData);
        logger.info('UserProfileService.user_document_replaced', { userId });
      } catch (replaceError) {
        logger.warn('UserProfileService.replace_operation_failed', {
          userId,
          error: replaceError.message
        });

        await this.users.update(userId, preservedData, {
          keepNull: true,
          mergeObjects: false,
          overwrite: true
        });
        logger.info('UserProfileService.user_document_updated_with_overwrite', { userId });
      }

      logger.info('UserProfileService.reset_user_data_completed', {
        userId,
        fieldsPreserved: Object.keys(preservedData).length,
        durationMs: Date.now() - startTime
      });
      return {
        userId,
        fieldsPreserved: Object.keys(preservedData).length,
        success: true
      };
    } catch (error) {
      logger.error('UserProfileService.reset_user_data_failed', {
        userId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  async deleteUserAccountPermanently(userId) {
    const startTime = Date.now();
    try {
      logger.info('UserProfileService.delete_user_account_permanently_start', { userId });

      const user = await this.getUserProfile(userId);
      if (!user) {
        logger.warn('UserProfileService.user_not_found', { userId });
        throw new Error(`User not found`);
      }

      await this.deleteUserFiles(user);
      logger.info('UserProfileService.user_files_deleted', { userId });

      try {
        const verificationTokens = this.db.collection('verificationTokens');
        const passwordResetTokens = this.db.collection('passwordResetTokens');

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
        logger.info('UserProfileService.related_tokens_deleted', { userId });
      } catch (error) {
        logger.warn('UserProfileService.clean_related_data_failed', {
          userId,
          error: error.message
        });
      }

      await this.users.remove(userId);
      logger.info('UserProfileService.user_account_permanently_deleted', {
        userId,
        durationMs: Date.now() - startTime
      });

      return { userId, success: true, deletedAt: new Date().toISOString() };
    } catch (error) {
      logger.error('UserProfileService.delete_user_account_permanently_failed', {
        userId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }
}

module.exports = UserProfileService;