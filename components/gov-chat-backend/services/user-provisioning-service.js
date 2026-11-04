'use strict';

const { aql } = require('arangojs');
const Redis = require('ioredis');
const { randomUUID } = require('crypto');
const { logger, dbService, erasureTombstoneKey, parsePositiveInt } = require('../shared-lib');
const keycloakAuthService = require('./keycloak-auth-service');

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
 *
 * Reactivation is gated on Keycloak itself (#1438): a soft-deleted user is
 * only re-activated when Keycloak — the authoritative source of account
 * state — reports the account enabled, so an admin disable is not silently
 * undone by a still-valid JWT from another device.
 *
 * Cache evictions are broadcast over Redis pub/sub (#1443) so a scaled-out
 * backend does not keep serving a pre-erasure profile from another
 * replica's cache for the remainder of the TTL. It reuses the Redis
 * instance the translation cache already uses (TRANSLATION_CACHE_* vars);
 * a Redis outage degrades to the pre-existing behavior — a local-only
 * eviction bounded by the TTL.
 */

/** In-memory cache: iss_sub → { user, expiresAt } */
const _cache = new Map();
const CACHE_TTL_MS = 60_000;

/** Pub/sub channel carrying iss_sub eviction broadcasts between replicas. */
const INVALIDATION_CHANNEL = 'user-provisioning:invalidate';

let _publisher = null;
let _subscriber = null;
let _pubsubStarted = false;

function createRedisClient(clientOptions = {}) {
  return new Redis({
    host: process.env.TRANSLATION_CACHE_HOST || 'localhost',
    port: parsePositiveInt(process.env.TRANSLATION_CACHE_PORT, 6379),
    password: process.env.TRANSLATION_CACHE_PASSWORD || null,
    // Same resilience contract as the translation cache client: a capped
    // retry backoff, a bounded retry count per command, and no offline
    // queue — a Redis outage surfaces as a failed command, not a
    // silently-growing buffer
    retryStrategy(times) {
      return Math.min(times * 500, 2000);
    },
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    ...clientOptions
  });
}

/** Identifies this replica in invalidation envelopes so a client drops its own loopback delivery. */
const INSTANCE_ID = randomUUID();

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

/**
 * Local half of an eviction: drop the cache line and bump the epoch so an
 * in-flight provision that started before this eviction does not re-cache
 * its pre-eviction result. Used by invalidateCache and the pub/sub handler.
 */
function evictLocal(issSub) {
  _cache.delete(issSub);
  _cacheEpoch++;
}

/**
 * Broadcast an eviction to the other replicas over the Redis pub/sub channel.
 * Fire-and-forget: a publish failure must not break the caller (the GDPR
 * erasure path), it only degrades the other replicas to the TTL bound.
 */
function publishInvalidation(issSub) {
  try {
    // Fallback for a caller arriving before initialize() ran — normally the
    // publisher was already created (and connected) at boot
    if (!_publisher) {
      _publisher = createRedisClient();
      _publisher.on('error', (err) => {
        logger.warn('[UserProvisioning] Invalidation publisher error', { error: err.message });
      });
    }
    _publisher.publish(INVALIDATION_CHANNEL, JSON.stringify({ origin: INSTANCE_ID, issSub })).catch((err) => {
      logger.warn('[UserProvisioning] Invalidation publish failed', { error: err.message });
    });
  } catch (err) {
    logger.warn('[UserProvisioning] Invalidation publish failed', { error: err.message });
  }
}

let _initialized = false;

/**
 * The erasure tombstone lookup — the single definition of the filter that
 * recognizes an erased subject. Used both by the entry check in _doProvision
 * and its post-UPSERT re-check; the two MUST stay identical.
 * @param {string} erasedKey - SHA-256 digest of the token's iss_sub
 * @returns {Object} aql query
 */
function tombstoneLookup(erasedKey) {
  return aql`
    FOR u IN users
      FILTER u.iss_sub == null AND u.deleted == true AND u.erased_key == ${erasedKey}
      RETURN u
  `;
}

/**
 * The reactivation gate (#1438) — the single statement of the policy shared
 * by both write paths that clear the deleted flag (the legacy-migration
 * UPDATE and the deleted-check UPSERT). Keycloak is the authoritative source
 * of account state: a soft-deleted document may mean an admin disabled the
 * account, and flipping it back on a still-valid JWT from another device
 * would silently undo the disable.
 *
 * Returns the blocked document to serve when reactivation is refused, or
 * null when Keycloak confirmed the account enabled (gate opens). Fail-closed:
 * without an auth context — or when the check is inconclusive (null) — the
 * answer is never treated as enabled.
 */
async function gateReactivation(authContext, issSub, blockedDoc, epochAtStart, logLabel) {
  const status =
    authContext && authContext.token && authContext.issuer
      ? await keycloakAuthService.checkUserStatusInKeycloak(authContext.token, authContext.issuer)
      : null;
  // active/disabled are inverse pairs in the helper's contract — checking
  // active alone is the whole gate
  if (status && status.active) {
    return null;
  }
  logger.info(`[UserProvisioning] ${logLabel} refused — Keycloak did not confirm the account enabled: ${issSub}`);
  if (status && _cacheEpoch === epochAtStart) {
    // Confirmed disable only: cache the refusal like the erasure tombstone's
    // — within the TTL the next request is refused without re-consulting
    // Keycloak. An inconclusive answer (null: unreachable, ambiguous or no
    // auth context) is NOT cached — the next request re-asks, so a recovered
    // Keycloak reactivates without waiting out the TTL.
    _cache.set(issSub, { user: blockedDoc, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return blockedDoc;
}

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
    _cacheEpoch = 0;
    if (_publisher) {
      _publisher.disconnect();
      _publisher = null;
    }
    if (_subscriber) {
      _subscriber.disconnect();
      _subscriber = null;
    }
    _pubsubStarted = false;
  },

  /**
   * One-time schema initialization — ensures indexes and drops legacy indexes.
   * Called once at application startup from initializeServices().
   */
  async initialize() {
    if (_initialized) return;
    // Erasure tombstone lookup index. NOT sparse: the optimizer cannot prove
    // a bound equality value is non-null, so a sparse index may be skipped and
    // the lookup degrade to a full scan. (A non-sparse persistent index does
    // index documents lacking the field as null — sparse is the variant that
    // excludes them — which is why the explicit choice matters here.) Ensured
    // here (idempotent, boot-time) rather than only in the migration script so
    // existing deployments pick it up without an ops step.
    try {
      const db = await dbService.getConnection('default');
      await db.collection('users').ensureIndex({
        type: 'persistent',
        fields: ['erased_key'],
        unique: false,
        name: 'idx_users_erased_key'
      });
    } catch (indexError) {
      // A missing users collection (fresh, not-yet-migrated database), an
      // unreachable ArangoDB or any other boot-time hiccup must not crash the
      // boot — initialize() never rejected before this index existed. The
      // tombstone protection is unaffected; only the lookup speed degrades
      // until the next successful boot.
      logger.warn('[UserProvisioning] Failed to ensure erased_key index — tombstone lookups scan until next boot', {
        error: indexError.message
      });
    }
    // Set only after initialization completed — a failed initialize must be
    // retryable, not permanently skipped by the flag.
    _initialized = true;
    logger.info('[UserProvisioning] Schema initialization complete');

    // Cross-replica invalidation pub/sub (#1443). Fire-and-forget setup:
    // a Redis outage must not crash the boot — it only degrades eviction to
    // the TTL bound. Best-effort: retryable at the next boot. Started once:
    // the _initialized flag below is only set after the awaited index work,
    // so two overlapping initialize() calls would otherwise create two
    // subscribers and every broadcast would be applied twice per replica.
    if (_pubsubStarted) {
      return;
    }
    _pubsubStarted = true;
    // The publisher is created here (not lazily at the first eviction) so
    // its connection handshake is done long before the first erasure — a
    // publish issued before the connection is 'ready' would be rejected
    // and the first post-boot invalidation lost.
    try {
      // A lazily-created fallback client (an invalidation that fired before
      // boot reached this point) must be disconnected, not orphaned
      if (_publisher) {
        _publisher.disconnect();
        _publisher = null;
      }
      _publisher = createRedisClient();
      _publisher.on('error', (err) => {
        logger.warn('[UserProvisioning] Invalidation publisher error', { error: err.message });
      });
    } catch (publisherError) {
      logger.warn('[UserProvisioning] Failed to create Invalidation publisher — evictions stay local', {
        error: publisherError.message
      });
      _publisher = null;
    }
    try {
      // The subscriber is the one client that WANTS the offline queue: the
      // subscribe command must buffer until Redis answers, so a cold/slow
      // start still delivers broadcasts — and once subscribed, ioredis
      // auto-resubscribes after every reconnect. A rejected subscribe here
      // would permanently silence reception until the next boot.
      _subscriber = createRedisClient({
        enableOfflineQueue: true,
        maxRetriesPerRequest: null
      });
      _subscriber.on('error', (err) => {
        logger.warn('[UserProvisioning] Invalidation subscriber error', { error: err.message });
      });
      // 'message' only fires for channels this client subscribed to — and
      // it subscribes to exactly one
      _subscriber.on('message', (_channel, payload) => {
        try {
          const { origin, issSub } = JSON.parse(payload);
          if (typeof issSub !== 'string') return;
          // The publisher's own subscriber receives the loopback delivery —
          // the local eviction already ran; applying it again would double-
          // bump the epoch and discard unrelated in-flight provisions
          if (origin === INSTANCE_ID) return;
          evictLocal(issSub);
        } catch (parseError) {
          logger.warn('[UserProvisioning] Malformed invalidation message ignored', {
            error: parseError.message
          });
        }
      });
      // A rejection here meets index.js's process.exit(1) unhandledRejection
      // handler — a Redis outage must degrade eviction to the TTL bound,
      // never crash the backend
      _subscriber.subscribe(INVALIDATION_CHANNEL).catch((err) => {
        logger.warn('[UserProvisioning] Invalidation subscribe failed — evictions stay local', {
          error: err.message
        });
      });
    } catch (subscriberError) {
      logger.warn('[UserProvisioning] Failed to start Invalidation subscriber — evictions stay local', {
        error: subscriberError.message
      });
      _subscriber = null;
    }
  },

  /**
   * Provision or update a user from a verified JWT payload
   * @param {Object} decodedToken - Verified JWT payload (with iss_sub added by keycloak-auth-service)
   * @param {Object} [authContext] - { token, issuer } — the verified bearer
   *   token and its issuer. Required for reactivation: the gate consults
   *   Keycloak with the very token that was verified (#1438). Omitting it
   *   fail-closes any reactivation (the account state cannot be confirmed).
   * @returns {Promise<Object>} User document from ArangoDB (re-activates soft-deleted users only when Keycloak confirms the account enabled)
   * @throws {Error} On ArangoDB connection or query failure
   */
  async provisionUser(decodedToken, authContext) {
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
      if (cached.user && cached.user.deleted === true) {
        // Erasure tombstone refusal — never re-provisioned, and the claims
        // check is irrelevant: the identity does not exist anymore
        return cached.user;
      }
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

    const epochAtEntry = _cacheEpoch;

    // Staleness gates. The own-provision result was just written from this
    // token's claims, so only an eviction (e.g. the GDPR erasure committing
    // mid-flight) can make it stale. A lock-waiter serves ANOTHER request's
    // result, so its claims freshness must be checked too. A refusal result
    // (the erasure tombstone's deleted document) is served as-is — it never
    // matches the claims, and re-provisioning it would loop forever. Either
    // stale shape re-provisions through provisionUser so the retry re-enters
    // the lock machinery instead of racing another stale waiter.
    const finishOrReprovision = (user, checkClaims) => {
      const isRefusal = user && user.deleted === true;
      const stale = checkClaims && !profileMatches(user, decodedToken);
      if (!isRefusal && (_cacheEpoch !== epochAtEntry || stale)) {
        return this.provisionUser(decodedToken, authContext);
      }
      return user;
    };

    // If a provisioning is already in-flight for this user, wait for it
    const inFlight = _locks.get(issSub);
    if (inFlight) {
      return finishOrReprovision(await inFlight, true);
    }

    // Create provisioning promise and lock it so concurrent requests share the result
    const provisionPromise = this._doProvision(decodedToken, authContext).finally(() => {
      _locks.delete(issSub);
    });
    _locks.set(issSub, provisionPromise);
    return finishOrReprovision(await provisionPromise, false);
  },

  /**
   * Internal provisioning logic — called once per user per cache cycle
   */
  async _doProvision(decodedToken, authContext) {
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
    const erasedCursor = await db.query(tombstoneLookup(erasedKey));
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
        if (legacyUser.deleted === true) {
          // Migrating a soft-deleted legacy document IS a reactivation — the
          // same gate applies (#1438), or the admin's disable would be
          // undone one query path earlier than the one the gate covers
          const refused = await gateReactivation(authContext, issSub, legacyUser, epochAtStart, 'Legacy migration');
          if (refused) {
            return refused;
          }
        }
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
        // Evict this iss_sub's cache line so the UPSERT's own cache write
        // reflects the migrated profile. Plain delete: this is the provision's
        // own eviction — no epoch bump, or the wrapper would treat its own
        // result as stale and re-provision needlessly.
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
      const refused = await gateReactivation(authContext, issSub, deletedUser, epochAtStart, 'Reactivation');
      if (refused) {
        return refused;
      }
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

    // Re-run the tombstone lookup on EVERY provision result: the erasure may
    // have committed between the entry check and this UPSERT (the #1440 race
    // window) — on a fresh INSERT the result is a resurrected duplicate; on an
    // UPDATE it may have refreshed a racer's duplicate. Either way the result
    // document is removed (the erasure never sees it — it carries a new _key)
    // and the erased document is served instead.
    const recheckCursor = await db.query(tombstoneLookup(erasedKey));
    const erasedInWindow = await recheckCursor.next();
    if (erasedInWindow) {
      logger.info(
        `[UserProvisioning] Removed a provision written for an erased user (tombstone ${erasedKey.substring(0, 12)})`
      );
      try {
        await db.query(aql`REMOVE { _key: ${user._key} } IN users`);
      } catch (removeError) {
        // A concurrent waiter may have removed it first (error 1202) — the
        // erasure wins either way; never 500 an erased caller for losing it.
        logger.warn('[UserProvisioning] Duplicate removal raced another provision', {
          error: removeError.message
        });
      }
      if (_cacheEpoch === epochAtStart) {
        _cache.set(issSub, { user: erasedInWindow, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      return erasedInWindow;
    }

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
   * Evict a user from the provisioning cache, locally and on every other
   * replica (Redis pub/sub broadcast, #1443). Called by the GDPR erasure
   * (keycloak-proxy-service.deleteUser) so the pre-erasure profile stops
   * being served — locally immediately, elsewhere within the publish's
   * propagation instead of the cache TTL.
   * @param {string} issSub - User identifier (iss#sub format)
   * @returns {void}
   */
  invalidateCache(issSub) {
    evictLocal(issSub);
    publishInvalidation(issSub);
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
    // Invalidate only AFTER the UPDATE committed — a broadcast sent before
    // it lets another replica evict, re-provision (its deleted-check still
    // misses) and re-cache the still-active profile, recreating the very
    // window this eviction exists to close
    this.invalidateCache(issSub);
    if (result) {
      logger.info(`[UserProvisioning] User marked as deleted: ${issSub}`);
    } else {
      logger.warn(`[UserProvisioning] User not found for deletion marking: ${issSub}`);
    }
  }
};

module.exports = userProvisioningService;
