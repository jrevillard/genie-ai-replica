const path = require('path');
const fs = require('fs');
const { logger, dbService, ensureCollection } = require('../shared-lib');
const { NotFoundError } = require('../middleware/errors');
const { sanitizePath } = require('./path-sanitizer');
const { JIT_PROTECTED_FIELDS } = require('../constants/jit-fields');

class UserProfileService {
  constructor() {
    this.dbService = dbService;
    this.db = null;
    this.users = null;
    this.uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'Uploads');
    this.initialized = false;
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
      logger.info('UserProfileService.created_upload_dir', { path: this.uploadDir });
    }
    logger.info('UserProfileService.initialized');
  }

  async init() {
    if (this.initialized) {
      logger.debug('UserProfileService already initialized, skipping');
      return;
    }
    try {
      this.db = await this.dbService.getConnection('default');
      await ensureCollection(this.db, 'users');
      this.users = this.db.collection('users');
      this.initialized = true;
      logger.info('UserProfileService database initialized');
    } catch (error) {
      logger.error(`Error initializing UserProfileService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  async updateUserProfile(userKey, profileData, files = {}) {
    const startTime = Date.now();
    try {
      logger.info('UserProfileService.update_user_profile_start', { userKey, incomingKeys: Object.keys(profileData) });

      if (typeof profileData === 'string') {
        try {
          profileData = JSON.parse(profileData);
        } catch (error) {
          logger.error('UserProfileService.parse_profile_data_failed', { userKey, error: error.message });
          profileData = {};
        }
      }

      // Strip JIT-provisioned fields — these are managed by Keycloak, not ArangoDB
      const strippedFields = Object.keys(profileData).filter(k => JIT_PROTECTED_FIELDS.includes(k));
      if (strippedFields.length > 0) {
        logger.warn('UserProfileService.stripped_jit_fields', { userKey, strippedFields });
        strippedFields.forEach(f => delete profileData[f]);
      }

      const userExists = await this.userExists(userKey);
      if (!userExists) {
        logger.warn('UserProfileService.user_not_found', { userKey });
        throw new NotFoundError(`User with ID ${userKey} not found`);
      }

      const processedData = await this.process(userKey, profileData, files);

      processedData.updatedAt = new Date().toISOString();

      delete processedData._key;

      const processedKeys = Object.keys(processedData);
      const hasPersonalIdentification = !!processedData.personalIdentification;
      const hasIdentityTravel = !!processedData.identityTravel;
      const hasMuslimPreferences = !!processedData.muslimPreferences;

      logger.debug('UserProfileService.updating_user_document', { userKey, processedKeys: processedKeys.join(','), hasPersonalIdentification, hasIdentityTravel, hasMuslimPreferences });

      logger.info('UserProfileService.updating_user_document', { userKey, processedKeys, hasPersonalIdentification, hasIdentityTravel, hasMuslimPreferences });
      await this.users.update(userKey, processedData);

      // Fetch the complete user document after update to ensure all fields are returned
      // This is necessary because ArangoDB's update() with returnNew: true only returns updated fields
      const completeUser = await this.users.document(userKey, { graceful: true });

      const returnedKeys = Object.keys(completeUser);
      const returnedHasPersonalIdentification = !!completeUser.personalIdentification;
      const returnedHasIdentityTravel = !!completeUser.identityTravel;
      const returnedHasMuslimPreferences = !!completeUser.muslimPreferences;
      const returnedHasCustomSettings = !!completeUser.customSettings;
      const personalIdentificationKeys = completeUser.personalIdentification ? Object.keys(completeUser.personalIdentification) : [];

      logger.debug('UserProfileService.user_profile_updated_debug', {
        userKey,
        returnedKeys,
        hasPersonalIdentification: returnedHasPersonalIdentification,
        hasIdentityTravel: returnedHasIdentityTravel,
        hasMuslimPreferences: returnedHasMuslimPreferences,
        hasCustomSettings: returnedHasCustomSettings,
      });

      // Log what we're returning for debugging
      logger.info('UserProfileService.user_profile_updated', {
        userKey,
        returnedKeys,
        hasPersonalIdentification: returnedHasPersonalIdentification,
        hasIdentityTravel: returnedHasIdentityTravel,
        hasMuslimPreferences: returnedHasMuslimPreferences,
        hasCustomSettings: returnedHasCustomSettings,
        personalIdentificationKeys,
        durationMs: Date.now() - startTime
      });
      return completeUser;
    } catch (error) {
      logger.error('UserProfileService.update_user_profile_failed', {
        userKey,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  async getUserProfile(userKey) {
    const startTime = Date.now();
    try {
      logger.info('UserProfileService.get_user_profile_start', { userKey });

      const user = await this.users.document(userKey);

      // If customSettings exists, merge it back into the user object
      // for backward compatibility with clients that expect custom sections
      // at the top level (e.g., muslimPreferences, christianPreferences, etc.)
      if (user.customSettings && typeof user.customSettings === 'object') {
        logger.debug('UserProfileService.merging_custom_settings', {
          userKey,
          customSettingsKeys: Object.keys(user.customSettings)
        });

        // Merge each custom setting back to the top level
        // This ensures clients can access data via user.muslimPreferences directly
        for (const key in user.customSettings) {
          if (!user[key]) {
            user[key] = user.customSettings[key];
            logger.debug('UserProfileService.merged_custom_key', { userKey, key });
          }
        }
      }

      logger.info('UserProfileService.user_profile_retrieved', {
        userKey,
        returnedKeys: Object.keys(user),
        hasCustomSettings: !!user.customSettings,
        durationMs: Date.now() - startTime
      });
      return user;
    } catch (error) {
      logger.error('UserProfileService.get_user_profile_failed', {
        userKey,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  async userExists(userKey) {
    const startTime = Date.now();
    try {
      logger.debug('UserProfileService.check_user_exists', { userKey });

      await this.users.document(userKey);
      logger.debug('UserProfileService.user_exists', { userKey, durationMs: Date.now() - startTime });
      return true;
    } catch (error) {
      if (error.code === 404) {
        logger.debug('UserProfileService.user_not_exists', { userKey });
        return false;
      }
      logger.error('UserProfileService.check_user_exists_failed', {
        userKey,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  async process(userKey, profileData, files) {
    const startTime = Date.now();
    logger.info('UserProfileService.process_profile_data_start', { userKey, incomingKeys: Object.keys(profileData) });

    if (typeof profileData === 'string') {
      try {
        profileData = JSON.parse(profileData);
      } catch (error) {
        logger.error('UserProfileService.parse_profile_data_failed', { userKey, error: error.message });
        profileData = {};
      }
    }

    const processedData = {};

    // Step 1: Copy all data from profileData to processedData (except _key)
    // This ensures ALL sections are preserved, including custom ones
    for (const key in profileData) {
      if (key !== '_key') {
        processedData[key] = profileData[key];
        logger.debug('UserProfileService.copied_key_to_processed', { userKey, key, dataType: typeof profileData[key] });
      }
    }

    // Step 2: Define known sections for file handling only
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

    // Step 3: Handle file uploads only for known sections
    for (const section of sections) {
      if (!processedData[section]) continue;

      if (files && (Array.isArray(files) || typeof files === 'object')) {
        const fileArray = Array.isArray(files) ? files : Object.values(files);

        for (const file of fileArray) {
          const fileNameParts = (file.fieldname || file.name || '').split('-');
          if (fileNameParts.length >= 2 && fileNameParts[0] === section) {
            const fieldName = fileNameParts[1];
            try {
              const fileUrl = await this.storeFile(file, userKey, `${section}-${fieldName}`);
              if (fileUrl) {
                processedData[section][`${fieldName}Url`] = fileUrl;
                logger.info('UserProfileService.file_stored', {
                  userKey,
                  section,
                  fieldName,
                  fileUrl
                });
              }
            } catch (error) {
              logger.error('UserProfileService.store_file_failed', {
                userKey,
                section,
                fieldName,
                error: error.message
              });
            }
          }
        }
      }
    }

    // Step 4: Identify and aggregate custom/unknown sections into customSettings
    // This provides a generic way for any application to extend user profile data
    const knownSections = new Set([
      ...sections,
      '_key',
      'createdAt',
      'updatedAt',
      'email'
    ]);

    const customSettings = {};
    for (const key in profileData) {
      if (!knownSections.has(key) && key !== '_key' && key !== 'customSettings') {
        // Include any object-type data that's not a known section
        if (profileData[key] !== null && typeof profileData[key] === 'object') {
          customSettings[key] = profileData[key];
          logger.debug('UserProfileService.added_to_custom_settings', { userKey, customKey: key });
        }
      }
    }

    // Step 5: If there are custom settings, store them under customSettings key
    if (Object.keys(customSettings).length > 0) {
      processedData.customSettings = customSettings;
      logger.info('UserProfileService.custom_settings_aggregated', {
        userKey,
        customSettingsKeys: Object.keys(customSettings),
        durationMs: Date.now() - startTime
      });
    }

    logger.info('UserProfileService.process_profile_data_completed', {
      userKey,
      processedKeys: Object.keys(processedData),
      customSettingsCount: Object.keys(customSettings).length,
      durationMs: Date.now() - startTime
    });
    return processedData;
  }

  async storeFile(file, userKey, fieldName) {
    const startTime = Date.now();
    try {
      logger.debug('UserProfileService.store_file_start', { userKey, fieldName });

      const userDir = sanitizePath(this.uploadDir, userKey);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
        logger.info('UserProfileService.created_user_directory', { userKey, path: userDir });
      }

      const fileExt = path.extname(file.originalname || file.name || 'unknown');
      const fileName = `${fieldName}-${Date.now()}${fileExt}`;
      const filePath = sanitizePath(userDir, fileName);

      if (file.buffer) {
        await fs.promises.writeFile(filePath, file.buffer);
      } else if (file.path) {
        const fileContent = await fs.promises.readFile(file.path);
        await fs.promises.writeFile(filePath, fileContent);
      } else {
        throw new Error('Unsupported file object format');
      }

      const fileUrl = `/Uploads/${userKey}/${fileName}`;
      logger.info('UserProfileService.file_stored_success', {
        userKey,
        fieldName,
        fileUrl,
        durationMs: Date.now() - startTime
      });
      return fileUrl;
    } catch (error) {
      logger.error('UserProfileService.store_file_failed', {
        userKey,
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
    const userKey = user._key;
    const userDir = sanitizePath(this.uploadDir, userKey);

    logger.info('UserProfileService.delete_user_files_start', { userKey });

    if (fs.existsSync(userDir)) {
      await fs.promises.rm(userDir, { recursive: true, force: true });
      logger.info('UserProfileService.user_directory_deleted', {
        userKey,
        durationMs: Date.now() - startTime
      });
    } else {
      logger.debug('UserProfileService.no_user_directory_found', { userKey });
    }
  }

  /**
   * Reset user profile data while preserving essential account information
   * @param {string} userKey - User ID
   * @returns {Promise<Object>} Result with preserved fields count
   */
  async resetUserData(userKey) {
    const startTime = Date.now();
    try {
      logger.info('UserProfileService.reset_user_data_start', { userKey });

      const currentUserDoc = await this.getUserProfile(userKey);
      if (!currentUserDoc) {
        logger.warn('UserProfileService.user_not_found', { userKey });
        throw new NotFoundError(`User with ID ${userKey} not found`);
      }

      const preservedData = {
        createdAt: currentUserDoc.createdAt,
        updatedAt: new Date().toISOString()
      };

      logger.debug('UserProfileService.preserving_fields', {
        userKey,
        fields: Object.keys(preservedData)
      });

      await this.deleteUserFiles(currentUserDoc);

      try {
        await this.users.replace(userKey, preservedData);
        logger.info('UserProfileService.user_document_replaced', { userKey });
      } catch (replaceError) {
        logger.warn('UserProfileService.replace_operation_failed', {
          userKey,
          error: replaceError.message
        });

        await this.users.update(userKey, preservedData, {
          keepNull: true,
          mergeObjects: false,
          overwrite: true
        });
        logger.info('UserProfileService.user_document_updated_with_overwrite', { userKey });
      }

      logger.info('UserProfileService.reset_user_data_completed', {
        userKey,
        fieldsPreserved: Object.keys(preservedData).length,
        durationMs: Date.now() - startTime
      });
      return {
        userKey,
        fieldsPreserved: Object.keys(preservedData).length,
        success: true
      };
    } catch (error) {
      logger.error('UserProfileService.reset_user_data_failed', {
        userKey,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }
}

// Singleton instance
const instance = new UserProfileService();
module.exports = instance;