"use strict";

const { aql } = require("arangojs");
const { logger, dbService } = require("../shared-lib");

/**
 * User Provisioning Service — JIT user provisioning via ArangoDB UPSERT
 *
 * Creates or updates a user record in ArangoDB on each successful
 * Keycloak authentication. Uses atomic UPSERT to prevent duplicates.
 *
 * An in-memory cache avoids hitting ArangoDB on every authenticated request.
 * The cache TTL is short (60s) so profile changes from Keycloak propagate
 * within a minute without repeated DB writes on every API call.
 */

/** In-memory cache: iss_sub → { user, expiresAt } */
const _cache = new Map();
const CACHE_TTL_MS = 60_000;

/** In-flight locks: iss_sub → Promise — prevents concurrent upserts for the same user */
const _locks = new Map();

/**
 * Evict expired entries from the provisioning cache.
 */
function evictExpired() {
  const now = Date.now();
  for (const [key, entry] of _cache) {
    if (entry.expiresAt <= now) {
      _cache.delete(key);
    }
  }
}

let _initialized = false;

const userProvisioningService = {
  /**
   * Clear cache and reset initialization flag.
   * For testing only.
   */
  _reset() {
    _cache.clear();
    _locks.clear();
    _initialized = false;
  },

  /**
   * One-time schema initialization — ensures indexes and drops legacy indexes.
   * Called once at application startup from initializeServices().
   */
  async initialize() {
    if (_initialized) return;
    _initialized = true;
    logger.info("[UserProvisioning] Schema initialization complete");
  },

  /**
   * Provision or update a user from a verified JWT payload
   * @param {Object} decodedToken - Verified JWT payload (with iss_sub added by keycloak-auth-service)
   * @returns {Promise<Object>} User document from ArangoDB (re-activates soft-deleted users)
   * @throws {Error} On ArangoDB connection or query failure
   */
  async provisionUser(decodedToken) {
    const issSub = decodedToken.iss_sub;
    if (!issSub) {
      throw new Error("Missing iss_sub in decoded token");
    }

    logger.debug(
      `[UserProvisioning] name: "${decodedToken.name}", preferred_username: "${decodedToken.preferred_username}", email: "${decodedToken.email}", realm_access: ${JSON.stringify(decodedToken.realm_access)}, resource_access: ${JSON.stringify(decodedToken.resource_access)}`,
    );

    // Check cache first — avoids ArangoDB round-trip on every request
    evictExpired();
    const cached = _cache.get(issSub);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }

    // If a provisioning is already in-flight for this user, wait for it
    const inFlight = _locks.get(issSub);
    if (inFlight) {
      return inFlight;
    }

    // Create provisioning promise and lock it so concurrent requests share the result
    const provisionPromise = this._doProvision(decodedToken).finally(() => {
      _locks.delete(issSub);
    });
    _locks.set(issSub, provisionPromise);
    return provisionPromise;
  },

  /**
   * Internal provisioning logic — called once per user per cache cycle
   */
  async _doProvision(decodedToken) {
    const issSub = decodedToken.iss_sub;
    const db = await dbService.getConnection("default");

    const now = new Date().toISOString();

    // Migrate legacy user: if a user without iss_sub shares the same email,
    // update it with iss_sub so the UPSERT below finds and updates it
    // instead of inserting a duplicate.
    const email = decodedToken.email || null;
    if (email) {
      const legacyCursor = await db.query(
        aql`
          FOR u IN users
            FILTER u.email == ${email} AND u.iss_sub == null
            RETURN u
        `,
      );
      const legacyUser = await legacyCursor.next();
      if (legacyUser) {
        logger.info(
          `[UserProvisioning] Migrating legacy user ${legacyUser._key} → iss_sub: ${issSub}`,
        );
        await db.query(
          aql`
            FOR u IN users
              FILTER u._key == ${legacyUser._key}
              UPDATE u WITH {
                iss_sub: ${issSub},
                iss: ${decodedToken.iss},
                sub: ${decodedToken.sub},
                name: ${decodedToken.name || decodedToken.preferred_username || legacyUser.name || null},
                emailVerified: ${decodedToken.email_verified || false},
                roles: ${decodedToken.realm_access?.roles || []},
                active: true,
                deleted: false,
                deletedAt: null,
                updatedAt: ${now}
              } IN users
          `,
        );
        // Invalidate any cache for this iss_sub to force fresh read after migration
        _cache.delete(issSub);
      }
    }

    // Check if user exists and is soft-deleted before upserting
    const checkCursor = await db.query(
      aql`
        FOR u IN users
          FILTER u.iss_sub == ${issSub} AND u.deleted == true
          RETURN u
      `,
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
      updatedAt: now,
    };

    const updateDoc = {
      email: decodedToken.email || null,
      name: decodedToken.name || decodedToken.preferred_username || null,
      emailVerified: decodedToken.email_verified || false,
      roles: decodedToken.realm_access?.roles || [],
      updatedAt: now,
      ...(isReactivation
        ? { deleted: false, deletedAt: null, active: true }
        : {}),
    };

    const cursor = await db.query(
      aql`
        UPSERT { iss_sub: ${issSub} }
        INSERT ${newDoc}
        UPDATE ${updateDoc} IN users
        RETURN { new: NEW, old: OLD }
      `,
    );

    const result = await cursor.next();

    if (!result || !result.new) {
      throw new Error("User provisioning returned no result");
    }

    const user = result.new;

    // Store in cache
    _cache.set(issSub, { user, expiresAt: Date.now() + CACHE_TTL_MS });

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
    // Invalidate cache so next request re-provisions (and hits deleted check)
    _cache.delete(issSub);

    const db = await dbService.getConnection("default");
    const now = new Date().toISOString();

    const cursor = await db.query(
      aql`
        FOR u IN users
          FILTER u.iss_sub == ${issSub}
          UPDATE u WITH { deleted: true, deletedAt: ${now}, updatedAt: ${now} } IN users
          RETURN NEW
      `,
    );

    const result = await cursor.next();
    if (result) {
      logger.info(`[UserProvisioning] User marked as deleted: ${issSub}`);
    } else {
      logger.warn(
        `[UserProvisioning] User not found for deletion marking: ${issSub}`,
      );
    }
  },
};

module.exports = userProvisioningService;
