'use strict';

const { aql } = require('arangojs');
const { logger, dbService, erasureTombstoneKey } = require('../shared-lib');

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

/**
 * Bumped on every cache eviction. A provision that started before an eviction
 * (e.g. the GDPR erasure's) must not re-cache its pre-eviction result after
 * the eviction — the epoch check at cache-write time discards it, so the next
 * request re-provisions against the post-eviction state.
 */
let _cacheEpoch = 0;

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
    // Erasure tombstone lookup index. NOT sparse: the optimizer cannot prove
    // a bound equality value is non-null, so a sparse index may be skipped and
    // the lookup degrade to a full scan — a persistent index already excludes
    // documents lacking the field. Ensured here (idempotent, boot-time) rather
    // than only in the migration script so existing deployments pick it up
    // without an ops step.
    const db = await dbService.getConnection('default');
    try {
      await db.collection('users').ensureIndex({
        type: 'persistent',
        fields: ['erased_key'],
        unique: false,
        name: 'idx_users_erased_key'
      });
    } catch (indexError) {
      // A missing users collection (fresh, not-yet-migrated database) or an
      // ArangoDB hiccup must not crash the boot. The tombstone protection is
      // unaffected — only the lookup speed degrades until the next boot.
      logger.warn('[UserProvisioning] Failed to ensure erased_key index — tombstone lookups scan until next boot', {
        error: indexError.message
      });
    }
    // Set only after initialization completed — a failed initialize must be
    // retryable, not permanently skipped by the flag.
    _initialized = true;
    logger.info('[UserProvisioning] Schema initialization complete');
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
      throw new Error('Missing iss_sub in decoded token');
    }

    logger.debug(
      `[UserProvisioning] name: "${decodedToken.name}", preferred_username: "${decodedToken.preferred_username}", email: "${decodedToken.email}", realm_access: ${JSON.stringify(decodedToken.realm_access)}, resource_access: ${JSON.stringify(decodedToken.resource_access)}`
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
    const epochAtStart = _cacheEpoch;
    const db = await dbService.getConnection('default');

    const now = new Date().toISOString();

    // Erasure tombstone check — MUST run before the UPSERT: the GDPR erasure
    // nulls iss_sub (the UPSERT key), so without this check the still-valid
    // token would re-INSERT the erased identity. Contract: erasure-tombstone.js.
    // The digest is bound from here (not computed in AQL) so the index on
    // erased_key serves the lookup (the index is deliberately not sparse —
    // see initialize()). The erased document is returned as-is
    // (deleted: true) — the middleware answers 403 for deleted users.
    const erasedKey = erasureTombstoneKey(issSub);
    const erasedCursor = await db.query(
      aql`
        FOR u IN users
          FILTER u.iss_sub == null AND u.deleted == true AND u.erased_key == ${erasedKey}
          RETURN u
      `
    );
    const erasedUser = await erasedCursor.next();
    if (erasedUser) {
      // Log the tombstone digest prefix only — persisting the erased iss_sub
      // here would re-materialize the identity this check exists to protect.
      logger.info(
        `[UserProvisioning] Blocked re-provisioning of erased user (tombstone ${erasedKey.substring(0, 12)})`
      );
      if (_cacheEpoch === epochAtStart) {
        _cache.set(issSub, { user: erasedUser, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      return erasedUser;
    }

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
        `
      );
      const legacyUser = await legacyCursor.next();
      if (legacyUser) {
        logger.info(`[UserProvisioning] Migrating legacy user ${legacyUser._key} → iss_sub: ${issSub}`);
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
          `
        );
        // Invalidate any cache for this iss_sub to force fresh read after migration
        this.invalidateCache(issSub);
      }
    }

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

    // Store in cache — skipped if an eviction happened while this provision
    // was in flight (the profile may predate the eviction, e.g. an erasure)
    if (_cacheEpoch === epochAtStart) {
      _cache.set(issSub, { user, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    // Log differentiated events
    if (!isReactivation && !result.old) {
      logger.info(`[UserProvisioning] User provisioned: ${issSub}`);
    } else if (!isReactivation) {
      logger.info(`[UserProvisioning] User profile updated: ${issSub}`);
    }

    return user;
  },

  /**
   * Evict a user from the in-memory provisioning cache.
   * Called by the GDPR erasure (keycloak-proxy-service.deleteUser) so the
   * pre-erasure profile stops being served for the remainder of the cache TTL.
   * @param {string} issSub - User identifier (iss#sub format)
   * @returns {void}
   */
  invalidateCache(issSub) {
    _cache.delete(issSub);
    _cacheEpoch++;
  },

  /**
   * Mark a user as deleted in ArangoDB (soft delete)
   * Called when Keycloak introspection confirms user is disabled/deleted
   * @param {string} issSub - User identifier (iss#sub format)
   * @returns {Promise<void>}
   */
  async markUserAsDeleted(issSub) {
    // Invalidate cache so next request re-provisions (and hits deleted check)
    this.invalidateCache(issSub);

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
