const { Database, aql } = require('arangojs');
const path = require('path');
const fs = require('fs');
const keycloakProxyService = require('./keycloak-proxy-service');
const { JIT_PROTECTED_FIELDS } = require('../constants/jit-fields');
const { logger, dbService } = require('../shared-lib');

class UserProfileService {
  constructor() {
    this.dbService = dbService;
    this.db = null;
    this.users = null;
    this.uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'Uploads');
    this.initialized = false;
    this.sessionService = null; // Initialize sessionService for dependency injection

    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
      logger.info('UserProfileService.created_upload_dir', { path: this.uploadDir });
    }
    logger.info('UserProfileService.initialized');
  }

  // Inject SessionService singleton
  setSessionService(sessionService) {
    this.sessionService = sessionService;
    logger.info('UserProfileService.session_service_set');
  }

  async init() {
    if (this.initialized) {
      logger.debug('UserProfileService already initialized, skipping');
      return;
    }
    try {
      this.db = await this.dbService.getConnection('default');
      this.users = this.db.collection('users');
      this.initialized = true;
      logger.info('UserProfileService database initialized');
    } catch (error) {
      logger.error(`Error initializing UserProfileService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  // DEC-3: local passwords are gone — Keycloak owns credentials. The old
  // verifyPassword(userId, password) helper and its route gates were removed in A5.

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

      // Create basic user document with timestamps
      const basicDoc = {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      logger.debug('UserProfileService.creating_basic_user_doc', { basicDoc });
      const user = await this.users.save(basicDoc);
      const userId = user._key;
      logger.info('UserProfileService.user_created', { userId });

      // Process all profile data (including custom sections like muslimPreferences, christianPreferences, etc.)
      const processedData = await this.process(userId, profileData, files);

      delete processedData._key;

      // Update user with all processed data
      if (Object.keys(processedData).length > 0) {
        logger.debug('UserProfileService.updating_user_with_full_data', { userId, processedKeys: Object.keys(processedData) });
        await this.users.update(userId, processedData);

        // Fetch the complete user document after update to ensure all fields are returned
        const completeUser = await this.users.document(userId);

        logger.info('UserProfileService.user_profile_created', {
          userId,
          returnedKeys: Object.keys(completeUser),
          hasPersonalIdentification: !!completeUser.personalIdentification,
          hasCustomSettings: !!completeUser.customSettings,
          durationMs: Date.now() - startTime
        });
        return completeUser;
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
      logger.info('UserProfileService.update_user_profile_start', { userId, incomingKeys: Object.keys(profileData) });

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

      const processedKeys = Object.keys(processedData);
      const hasPersonalIdentification = !!processedData.personalIdentification;
      const hasIdentityTravel = !!processedData.identityTravel;
      const hasMuslimPreferences = !!processedData.muslimPreferences;

      console.log(`[DEBUG] Updating user document - userId: ${userId}, processedKeys: ${processedKeys.join(',')}, hasPersonalIdentification: ${hasPersonalIdentification}, hasIdentityTravel: ${hasIdentityTravel}, hasMuslimPreferences: ${hasMuslimPreferences}`);

      logger.info('UserProfileService.updating_user_document', { userId, processedKeys, hasPersonalIdentification, hasIdentityTravel, hasMuslimPreferences });
      await this.users.update(userId, processedData);

      // Fetch the complete user document after update to ensure all fields are returned
      // This is necessary because ArangoDB's update() with returnNew: true only returns updated fields
      const completeUser = await this.users.document(userId, { graceful: true });

      const returnedKeys = Object.keys(completeUser);
      const returnedHasPersonalIdentification = !!completeUser.personalIdentification;
      const returnedHasIdentityTravel = !!completeUser.identityTravel;
      const returnedHasMuslimPreferences = !!completeUser.muslimPreferences;
      const returnedHasCustomSettings = !!completeUser.customSettings;
      const personalIdentificationKeys = completeUser.personalIdentification ? Object.keys(completeUser.personalIdentification) : [];

      console.log(`[DEBUG] User profile updated - userId: ${userId}, returnedKeys: ${returnedKeys.join(',')}, hasPersonalIdentification: ${returnedHasPersonalIdentification}, hasIdentityTravel: ${returnedHasIdentityTravel}, hasMuslimPreferences: ${returnedHasMuslimPreferences}, hasCustomSettings: ${returnedHasCustomSettings}`);
      console.log(`[DEBUG] Complete user data keys:`, JSON.stringify(returnedKeys));
      console.log(`[DEBUG] personalIdentification exists:`, returnedHasPersonalIdentification);
      console.log(`[DEBUG] identityTravel exists:`, returnedHasIdentityTravel);
      console.log(`[DEBUG] muslimPreferences exists:`, returnedHasMuslimPreferences);

      // Log what we're returning for debugging
      logger.info('UserProfileService.user_profile_updated', {
        userId,
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

      // If customSettings exists, merge it back into the user object
      // for backward compatibility with clients that expect custom sections
      // at the top level (e.g., muslimPreferences, christianPreferences, etc.)
      if (user.customSettings && typeof user.customSettings === 'object') {
        logger.debug('UserProfileService.merging_custom_settings', {
          userId,
          customSettingsKeys: Object.keys(user.customSettings)
        });

        // Merge each custom setting back to the top level
        // This ensures clients can access data via user.muslimPreferences directly
        for (const key in user.customSettings) {
          if (!user[key]) {
            user[key] = user.customSettings[key];
            logger.debug('UserProfileService.merged_custom_key', { userId, key });
          }
        }
      }

      logger.info('UserProfileService.user_profile_retrieved', {
        userId,
        returnedKeys: Object.keys(user),
        hasCustomSettings: !!user.customSettings,
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

  // initiateEmailChange removed in A6: email self-service goes through the
  // Keycloak Account API (keycloak-proxy-service.updateOwnProfile) from the
  // PUT /users/email route; the pending-email-change machinery is dead.

  async process(userId, profileData, files) {
    const startTime = Date.now();
    logger.info('UserProfileService.process_profile_data_start', { userId, incomingKeys: Object.keys(profileData) });

    if (typeof profileData === 'string') {
      try {
        profileData = JSON.parse(profileData);
      } catch (error) {
        logger.error('UserProfileService.parse_profile_data_failed', { userId, error: error.message });
        profileData = {};
      }
    }

    const processedData = {};

    // Step 1: Copy all data from profileData to processedData (except _key and
    // JIT-managed fields — A5 fix, upstream mechanism: identity (iss/sub/iss_sub),
    // roles, deleted/active and timestamps are provisioned from verified JWTs only;
    // letting client payloads overwrite them is an identity-takeover vector)
    const protectedFields = new Set(['_key', ...JIT_PROTECTED_FIELDS]);
    for (const key in profileData) {
      if (!protectedFields.has(key)) {
        processedData[key] = profileData[key];
        logger.debug('UserProfileService.copied_key_to_processed', { userId, key, dataType: typeof profileData[key] });
      } else if (key !== '_key') {
        logger.warn('UserProfileService.jit_field_stripped_from_update', { userId, key });
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

    // Step 4: Identify and aggregate custom/unknown sections into customSettings
    // This provides a generic way for any application to extend user profile data
    const knownSections = new Set([
      ...sections,
      '_key',
      'createdAt',
      'updatedAt',
      'email',
      'loginName',
      'encPassword',
      'role',
      'emailVerified',
      'accessToken',
      'refreshToken',
      'tokenVersion'
    ]);

    const customSettings = {};
    for (const key in profileData) {
      if (!knownSections.has(key) && key !== '_key' && key !== 'customSettings') {
        // Include any object-type data that's not a known section
        if (profileData[key] !== null && typeof profileData[key] === 'object') {
          customSettings[key] = profileData[key];
          logger.debug('UserProfileService.added_to_custom_settings', { userId, customKey: key });
        }
      }
    }

    // Step 5: If there are custom settings, store them under customSettings key
    if (Object.keys(customSettings).length > 0) {
      processedData.customSettings = customSettings;
      logger.info('UserProfileService.custom_settings_aggregated', {
        userId,
        customSettingsKeys: Object.keys(customSettings),
        durationMs: Date.now() - startTime
      });
    }

    logger.info('UserProfileService.process_profile_data_completed', {
      userId,
      processedKeys: Object.keys(processedData),
      customSettingsCount: Object.keys(customSettings).length,
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

      const fileUrl = `/Uploads/${userId}/${fileName}`;
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
          RETURN KEEP(u, ['_key', 'email', 'loginName', 'role', 'roles', 'status', 'emailVerified', 'createdAt', 'personalIdentification', 'contactInfo'])
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

  // deleteUserAccountPermanently removed in A6: replaced by the upstream GDPR
  // delete (keycloak-proxy-service.deleteUser — KC user deleted + Arango PII
  // nullified). The verificationTokens/passwordResetTokens machinery it swept
  // is dead with it.

  /**
   * Force logout a user (A6 rework): revoke their Keycloak sessions via the
   * proxy and end Arango sessions BY iss_sub (sessions are created with
   * iss_sub as userId — session-routes; the old sweep queried by Arango _key
   * and matched nothing). The old accessToken/tokenVersion field-nulling is
   * gone — those fields are dead post-A5 and nulling them revoked nothing.
   * Ceiling (DEC-4): an already-minted access token still validates for ≤ its
   * lifespan (300s) — revocation kills refresh, not outstanding access tokens.
   * @param {string} userId - Arango _key of the user to force logout
   * @param {string} adminId - Admin user _key performing the action
   * @returns {Promise<Object>} Result of the operation
   */
  async forceUserLogout(userId, adminId) {
    const startTime = Date.now();
    logger.info('UserProfileService.force_user_logout_start', { userId, adminId });

    let user;
    try {
      user = await this.users.document(userId);
    } catch (err) {
      // Only a genuine not-found maps to the route's 404 — anything else
      // (network, auth) must surface as what it is
      if (err && (err.code === 404 || err.errorNum === 1202)) {
        throw new Error('User not found');
      }
      throw err;
    }

    // 1) End Arango sessions by iss_sub FIRST (bug fix: old sweep used _key) —
    // local state must not depend on Keycloak being up
    const now = new Date().toISOString();
    await this.db.query(aql`
      FOR s IN sessions
        FILTER s.userId == ${user.iss_sub}
        FILTER s.active == true
        UPDATE s WITH { active: false, endTime: ${now} } IN sessions
    `);

    // 2) Revoke Keycloak sessions (refresh/silent-renew dies with them)
    await keycloakProxyService.revokeUserSessions(userId);

    logger.info('UserProfileService.force_user_logout_completed', {
      userId,
      adminId,
      durationMs: Date.now() - startTime
    });

    return {
      success: true,
      message: 'User logged out successfully'
    };
  }

  // The verification-email helper was removed in A6: Keycloak's own VERIFY_EMAIL
  // action (keycloak-proxy-service.sendVerifyEmail) owns verification emails;
  // the verification-tokens machinery is dead.
}

// Singleton instance
const instance = new UserProfileService();
module.exports = instance;