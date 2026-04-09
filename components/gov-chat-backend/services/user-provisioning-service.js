'use strict';

const { aql } = require('arangojs');
const { logger, dbService, ensureCollection } = require('../shared-lib');

/**
 * User Provisioning Service — JIT user provisioning via ArangoDB UPSERT
 *
 * Creates or updates a user record in ArangoDB on each successful
 * Keycloak authentication. Uses atomic UPSERT to prevent duplicates.
 */
const userProvisioningService = {

  /**
   * Provision or update a user from a verified JWT payload
   * @param {Object} decodedToken - Verified JWT payload (with iss_sub added by keycloak-auth-service)
   * @returns {Promise<Object>} User document from ArangoDB (re-activates soft-deleted users)
   * @throws {Error} On ArangoDB connection or query failure
   */
  async provisionUser(decodedToken) {
    const db = await dbService.getConnection('default');
    await ensureCollection(db, 'users');

    const issSub = decodedToken.iss_sub;
    if (!issSub) {
      throw new Error('Missing iss_sub in decoded token');
    }

    const now = new Date().toISOString();

    // Check if user exists and is soft-deleted before upserting
    const checkCursor = await db.query(
      aql`
        FOR u IN users
          FILTER u.iss_sub == ${issSub} AND u.deleted == true
          RETURN u
      `
    );
    const deletedUser = await checkCursor.next();
    const isReactivation = !!deletedUser;
    if (isReactivation) {
      logger.info(`[UserProvisioning] User re-activated: ${issSub}`);
    }

    const newDoc = {
      iss_sub: issSub,
      iss: decodedToken.iss,
      sub: decodedToken.sub,
      email: decodedToken.email || null,
      name: decodedToken.name || decodedToken.preferred_username || null,
      emailVerified: decodedToken.email_verified || false,
      roles: decodedToken.realm_access?.roles || [],
      active: true,
      deleted: false,
      createdAt: now,
      updatedAt: now
    };

    const updateDoc = {
      email: decodedToken.email || null,
      name: decodedToken.name || decodedToken.preferred_username || null,
      emailVerified: decodedToken.email_verified || false,
      roles: decodedToken.realm_access?.roles || [],
      updatedAt: now,
      ...(isReactivation ? { deleted: false, deletedAt: null, active: true } : {})
    };

    const cursor = await db.query(
      aql`
        UPSERT { iss_sub: ${issSub} }
        INSERT ${newDoc}
        UPDATE ${updateDoc} IN users
        RETURN { new: NEW, old: OLD }
      `
    );

    const result = await cursor.next();

    if (!result || !result.new) {
      throw new Error('User provisioning returned no result');
    }

    const user = result.new;

    // Log differentiated events
    if (!isReactivation && !result.old) {
      logger.info(`[UserProvisioning] User provisioned: ${issSub}`);
    } else if (!isReactivation) {
      logger.info(`[UserProvisioning] User profile updated: ${issSub}`);
    }

    return user;
  },

  /**
   * Mark a user as deleted in ArangoDB (soft delete)
   * Called when Keycloak introspection confirms user is disabled/deleted
   * @param {string} issSub - User identifier (iss#sub format)
   * @returns {Promise<void>}
   */
  async markUserAsDeleted(issSub) {
    const db = await dbService.getConnection('default');
    const now = new Date().toISOString();

    const cursor = await db.query(
      aql`
        FOR u IN users
          FILTER u.iss_sub == ${issSub}
          UPDATE u WITH { deleted: true, deletedAt: ${now}, updatedAt: ${now} } IN users
          RETURN NEW
      `
    );

    const result = await cursor.next();
    if (result) {
      logger.info(`[UserProvisioning] User marked as deleted: ${issSub}`);
    } else {
      logger.warn(`[UserProvisioning] User not found for deletion marking: ${issSub}`);
    }
  }
};

module.exports = userProvisioningService;
