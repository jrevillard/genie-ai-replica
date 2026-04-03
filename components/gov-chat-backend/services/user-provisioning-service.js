'use strict';

const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');

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
   * @returns {Promise<Object|null>} User document from ArangoDB, or null if soft-deleted
   * @throws {Error} On ArangoDB connection or query failure
   */
  async provisionUser(decodedToken) {
    const issSub = decodedToken.iss_sub;
    if (!issSub) {
      throw new Error('Missing iss_sub in decoded token');
    }

    const now = new Date().toISOString();

    // Check if user exists and is soft-deleted before upserting
    const db = await dbService.getConnection('default');
    const checkCursor = await db.query(
      aql`
        FOR u IN users
          FILTER u.iss_sub == ${issSub} AND u.deleted == true
          RETURN u
      `
    );
    const deletedUser = await checkCursor.next();
    if (deletedUser) {
      logger.warn(`[UserProvisioning] Soft-deleted user attempted login: ${issSub}`);
      return null;
    }

    const newDoc = {
      iss_sub: issSub,
      iss: decodedToken.iss,
      sub: decodedToken.sub,
      email: decodedToken.email || null,
      name: decodedToken.name || decodedToken.preferred_username || null,
      roles: decodedToken.realm_access?.roles || [],
      active: true,
      deleted: false,
      createdAt: now,
      updatedAt: now
    };

    const updateDoc = {
      email: decodedToken.email || null,
      name: decodedToken.name || decodedToken.preferred_username || null,
      roles: decodedToken.realm_access?.roles || [],
      updatedAt: now
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
    if (!result.old) {
      logger.info(`[UserProvisioning] User provisioned: ${issSub}`);
    } else {
      logger.info(`[UserProvisioning] User profile updated: ${issSub}`);
    }

    return user;
  }
};

module.exports = userProvisioningService;
