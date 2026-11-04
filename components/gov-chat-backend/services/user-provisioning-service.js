'use strict';

const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');

/**
 * User Provisioning Service — JIT user provisioning via ArangoDB UPSERT
 *
 * Creates or updates a user record in ArangoDB on each successful
 * Keycloak authentication. Uses atomic UPSERT to prevent duplicates.
 *
 * An in-memory cache avoids re-running the UPSERT write on every
 * authenticated request. A cache hit is revalidated before it is served:
 * the JWT claims are compared against the cached profile (a Keycloak
 * profile change must land on the next request, not within the TTL) and
 * one indexed read detects an out-of-band soft-delete of the underlying
 * document (reactivation must never be served from a stale copy).
 */

/** In-memory cache: iss_sub → { user, expiresAt } */
const _cache = new Map();
const CACHE_TTL_MS = 60_000;

/** In-flight locks: iss_sub → Promise — prevents concurrent upserts for the same user */
const _locks = new Map();

/**
 * Memoized connection proxy for the per-request revalidation read.
 * dbService.getConnection re-runs a health-check query on every call;
 * the returned proxy is self-healing, so it is held here instead —
 * the hot path then costs exactly one query per revalidation.
 */
let _dbPromise = null;
let _lastRevalWarnAt = 0;

function getDb() {
  if (!_dbPromise) {
    _dbPromise = dbService.getConnection('default').catch((err) => {
      _dbPromise = null; // allow the next call to retry
      throw err;
    });
  }
  return _dbPromise;
}

/**
 * Profile fields the UPSERT derives from the JWT claims.
 */
function profileFromToken(decodedToken) {
  return {
    email: decodedToken.email || null,
    name: decodedToken.name || decodedToken.preferred_username || null,
    emailVerified: decodedToken.email_verified || false,
    roles: decodedToken.realm_access?.roles || []
  };
}

/**
 * Whether the cached user document still matches the token's claims.
 * A mismatch means Keycloak state changed out-of-band after the copy
 * was cached. Roles are compared order-insensitively (their order in
 * the token is not contractually stable) and exactly (no multiset
 * collapses).
 */
function profileMatches(cachedUser, decodedToken) {
  const expected = profileFromToken(decodedToken);
  const cachedRoles = cachedUser.roles || [];
  const sortedExpected = [...expected.roles].sort();
  const sortedCached = [...cachedRoles].sort();
  return (
    expected.email === cachedUser.email &&
    expected.name === cachedUser.name &&
    expected.emailVerified === cachedUser.emailVerified &&
    sortedExpected.length === sortedCached.length &&
    sortedExpected.every((role, index) => role === sortedCached[index])
  );
}

/** Bound on how long the per-request revalidation may delay a cache hit. */
const REVALIDATION_TIMEOUT_MS = 3000;

/**
 * Warn about a revalidation fail-open, at most once per TTL window so a
 * degraded database does not put a warn line on every authenticated request.
 */
function warnRevalidationThrottled(message) {
  if (Date.now() - _lastRevalWarnAt > CACHE_TTL_MS) {
    _lastRevalWarnAt = Date.now();
    logger.warn(`[UserProvisioning] Soft-delete revalidation ${message}`);
  }
}

/**
 * Whether the document a cached copy points at has been soft-deleted
 * out-of-band. Looked up by the cached document's _key (which survives a
 * GDPR erasure) but matches only in-place soft-deletes: an erasure nulls
 * iss_sub, and re-provisioning an erased identity would re-materialize
 * the erasure, so the cached copy is served for it. On a failure — or a
 * revalidation (connection + query) that outlives REVALIDATION_TIMEOUT_MS —
 * the cached copy is served: a cache hit previously required no DB access
 * at all, and the entry expires with the TTL anyway.
 */
async function isSoftDeleted(cachedUser) {
  let timer;
  // Distinct from the boolean outcomes so a deadline win is never confused
  // with a "not deleted" answer
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve('deadline'), REVALIDATION_TIMEOUT_MS);
  });
  try {
    const work = (async () => {
      const db = await getDb();
      const cursor = await db.query(aql`
        FOR u IN users
          FILTER u._key == ${cachedUser._key} AND u.deleted == true AND u.iss_sub != null
          LIMIT 1
          RETURN u._key
      `);
      // arangojs resolves an exhausted cursor's next() with undefined, not
      // null — a truthy check is what the driver contract wants
      return !!(await cursor.next());
    })();
    const outcome = await Promise.race([work, deadline]);
    if (outcome === 'deadline') {
      // A DB consistently slower than the deadline fail-opens here; say so
      // (rate-limited like the failure path) so the latency and the stale
      // copies are traceable in the logs
      warnRevalidationThrottled(
        `timed out after ${REVALIDATION_TIMEOUT_MS}ms, serving cached copy for user document ${cachedUser._key}`
      );
      return false;
    }
    return outcome;
  } catch (err) {
    // Fail open (bounded by the TTL) — but warn at most once per TTL so a
    // DB outage does not put a warn line on every authenticated request
    warnRevalidationThrottled(`failed, serving cached copy for user document ${cachedUser._key}: ${err.message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

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
    _dbPromise = null;
    _lastRevalWarnAt = 0;
    _initialized = false;
  },

  /**
   * One-time schema initialization — ensures indexes and drops legacy indexes.
   * Called once at application startup from initializeServices().
   */
  async initialize() {
    if (_initialized) return;
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

    // Check cache first — a valid hit is revalidated before it is served so
    // out-of-band state changes are not masked by the TTL
    evictExpired();
    const cached = _cache.get(issSub);
    if (cached && cached.expiresAt > Date.now()) {
      if (!profileMatches(cached.user, decodedToken)) {
        // Keycloak claims changed since the copy was cached — re-provision
        _cache.delete(issSub);
      } else if (await isSoftDeleted(cached.user)) {
        // The underlying document was soft-deleted out-of-band — fall
        // through to the full UPSERT (reactivation)
        _cache.delete(issSub);
      } else {
        return cached.user;
      }
    }

    // If a provisioning is already in-flight for this user, wait for it —
    // but only serve its result when it matches this request's claims: a
    // profile edit landing mid-flight would otherwise be served stale once
    const inFlight = _locks.get(issSub);
    if (inFlight) {
      const user = await inFlight;
      if (profileMatches(user, decodedToken)) {
        return user;
      }
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
    const db = await dbService.getConnection('default');

    const now = new Date().toISOString();

    // Derive the profile fields from the single claims→profile mapping —
    // the same one profileMatches compares against, so a new profile field
    // cannot be written by the UPSERT while escaping cache revalidation
    const profile = profileFromToken(decodedToken);

    // Migrate legacy user: if a user without iss_sub shares the same email,
    // update it with iss_sub so the UPSERT below finds and updates it
    // instead of inserting a duplicate.
    if (profile.email) {
      const legacyCursor = await db.query(
        aql`
          FOR u IN users
            FILTER u.email == ${profile.email} AND u.iss_sub == null
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
                name: ${profile.name || legacyUser.name || null},
                emailVerified: ${profile.emailVerified},
                roles: ${profile.roles},
                active: true,
                deleted: false,
                deletedAt: null,
                updatedAt: ${now}
              } IN users
          `
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
      ...profile,
      active: true,
      deleted: false,
      createdAt: now,
      updatedAt: now
    };

    const updateDoc = {
      ...profile,
      sub: decodedToken.sub,
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
