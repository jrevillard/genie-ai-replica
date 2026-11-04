'use strict';

const { aql } = require('arangojs');
const { logger, dbService, erasureTombstoneKey } = require('../shared-lib');
const userProvisioningService = require('./user-provisioning-service');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
const PROXY_CLIENT_ID = process.env.KEYCLOAK_PROXY_CLIENT_ID;
const PROXY_CLIENT_SECRET = process.env.KEYCLOAK_PROXY_CLIENT_SECRET;

const FETCH_TIMEOUT_MS = 10000; // 10s timeout for Keycloak API calls

// Service account token cache (lazy refresh on 401)
let cachedToken = null;

/**
 * Keycloak Proxy Service — proxies user management operations to Keycloak
 *
 * Uses two auth modes:
 * 1. Service account (genie-proxy-client) — for admin operations (delete user)
 * 2. User's own token (pass-through) — for self-service profile updates via Account API
 */
const keycloakProxyService = {
  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve a Keycloak UUID from an ArangoDB user record
   * @param {string} userKey - ArangoDB _key
   * @returns {Promise<{sub: string|null, issSub: string|null}>} The Keycloak UUID (sub field)
   *   and the provisioning identifier (iss_sub); either may be null (user never logged
   *   in via Keycloak, or record already erased)
   * @throws {Error} If user not found
   */
  async _resolveKeycloakUserId(userKey) {
    const db = await dbService.getConnection('default');
    const cursor = await db.query(
      aql`
        FOR u IN users
          FILTER u._key == ${userKey}
          RETURN { sub: u.sub, issSub: u.iss_sub }
      `
    );
    const user = await cursor.next();

    if (!user) {
      throw new Error(`User ${userKey} not found`);
    }

    return { sub: user.sub || null, issSub: user.issSub || null };
  },

  /**
   * Clear the cached service account token (for testing)
   */
  _clearTokenCache() {
    cachedToken = null;
  },

  /**
   * Get a service account access token (client credentials grant)
   * Token is cached and lazily refreshed on 401
   * @param {boolean} forceRefresh - Force token re-acquisition
   * @returns {Promise<string>} Access token
   */
  async getServiceAccountToken(forceRefresh = false) {
    if (cachedToken && !forceRefresh) {
      return cachedToken;
    }

    const tokenUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: PROXY_CLIENT_ID,
        client_secret: PROXY_CLIENT_SECRET
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error('[KeycloakProxy] Failed to obtain service account token', {
        status: response.status,
        body: text
      });
      throw new Error(`Failed to obtain service account token: ${response.status}`);
    }

    const data = await response.json();
    cachedToken = data.access_token;
    logger.info('[KeycloakProxy] Service account token obtained');
    return cachedToken;
  },

  /**
   * Execute a Keycloak Admin API call with automatic token refresh on 401
   * @param {string} method - HTTP method
   * @param {string} path - API path (relative to KEYCLOAK_URL/admin/realms/{realm})
   * @param {Object|null} body - Request body (will be JSON-stringified)
   * @returns {Promise<Object>} Parsed response
   */
  async _adminApiCall(method, path, body = null) {
    let token = await this.getServiceAccountToken();
    const url = `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}${path}`;

    const options = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    if (body !== null) {
      options.body = JSON.stringify(body);
    }

    let response = await fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

    // Lazy refresh on 401
    if (response.status === 401) {
      logger.warn('[KeycloakProxy] Token expired, refreshing...');
      token = await this.getServiceAccountToken(true);
      options.headers.Authorization = `Bearer ${token}`;
      response = await fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    }

    if (!response.ok) {
      const text = await response.text();
      throw this._mapKeycloakError(response.status, text, path);
    }

    // 204 No Content (e.g. DELETE)
    if (response.status === 204) {
      return {};
    }

    return response.json();
  },

  /**
   * Translate Keycloak HTTP errors to GENIE.AI format
   * @param {number} status - HTTP status code
   * @param {string} body - Response body text
   * @param {string} path - API path for context
   * @returns {Error} Structured error
   */
  _mapKeycloakError(status, body, path) {
    let message;
    switch (status) {
      case 401:
        message = 'Keycloak authentication failed';
        break;
      case 403:
        message = 'Insufficient permissions for Keycloak operation';
        break;
      case 404:
        message = 'User not found in Keycloak';
        break;
      case 409:
        message = 'Conflict in Keycloak operation (e.g. duplicate email)';
        break;
      default:
        message = `Keycloak API error: ${status}`;
    }

    logger.error('[KeycloakProxy] API error', { status, path, body: body.substring(0, 200) });
    const error = new Error(message);
    error.status = status;
    error.keycloakBody = body;
    return error;
  },

  // ---------------------------------------------------------------------------
  // Public API — Admin operations (service account)
  // ---------------------------------------------------------------------------

  /**
   * Delete a user from Keycloak and erase personal data in ArangoDB (GDPR right to erasure)
   * @param {string} userKey - ArangoDB _key
   * @throws {Error} If Keycloak user not found (404) or authentication fails
   * @throws {Error} If ArangoDB erasure fails after Keycloak delete (partial erasure state)
   */
  async deleteUser(userKey) {
    const resolved = await this._resolveKeycloakUserId(userKey);
    const uuid = resolved.sub;
    const issSub = resolved.issSub;
    logger.info('[KeycloakProxy] Deleting user', { userKey, uuid });

    // Evict the provisioning cache BEFORE erasing, so the middleware stops
    // serving the pre-erasure profile for the remainder of the cache TTL.
    if (issSub) {
      userProvisioningService.invalidateCache(issSub);
    }

    // Delete from Keycloak first (authoritative source). A missing Keycloak UUID
    // or a 404 (user already deleted in Keycloak) does NOT abort the erasure:
    // the ArangoDB record may still hold the user's PII, and the erasure —
    // including the provisioning tombstone — must happen regardless.
    if (uuid) {
      try {
        await this._adminApiCall('DELETE', `/users/${uuid}`);
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
        logger.info('[KeycloakProxy] User already deleted from Keycloak, continuing with ArangoDB erasure', {
          userKey,
          uuid
        });
      }
    } else {
      logger.warn('[KeycloakProxy] No Keycloak UUID on user record, skipping Keycloak delete', { userKey });
    }

    // Then erase PII from ArangoDB
    // If ArangoDB update fails, user is already deleted from Keycloak (defense-in-depth)
    const erasedKey = issSub ? erasureTombstoneKey(issSub) : null;
    const db = await dbService.getConnection('default');
    try {
      await db.query(
        aql`
          FOR u IN users
            FILTER u._key == ${userKey}
            UPDATE u WITH {
              deleted: true,
              // Tombstone digest — contract: shared/lib/erasure-tombstone.js.
              // Written BEFORE iss_sub is nulled below, so provisioning can
              // recognize and refuse the erased subject instead of re-INSERTing
              // it from the still-valid token.
              erased_key: ${erasedKey},
              erasedAt: DATE_ISO8601(DATE_NOW()),
              updatedAt: DATE_ISO8601(DATE_NOW()),
              email: null,
              name: null,
              sub: null,
              iss: null,
              iss_sub: null,
              roles: [],
              active: false,
              personalIdentification: null
            } IN users
        `
      );
      logger.info('[KeycloakProxy] User erased', { userKey });
    } catch (arangoError) {
      logger.error('[KeycloakProxy] ArangoDB erasure failed after Keycloak delete', {
        userKey,
        error: arangoError.message,
        state: 'PARTIAL_ERASURE'
      });
      throw new Error('Partial erasure: user deleted from Keycloak but ArangoDB erasure failed', {
        cause: arangoError
      });
    }
  },

  // ---------------------------------------------------------------------------
  // Public API — Self-service operations
  // ---------------------------------------------------------------------------

  /**
   * Update a user's own profile fields in Keycloak via Account API.
   * Uses the user's own access token (pass-through) — no service account needed.
   * @param {string} accessToken - User's OIDC access token
   * @param {Object} data - JIT fields to update (e.g. { email, firstName, lastName })
   */
  async updateOwnProfile(accessToken, data) {
    const url = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/account`;
    logger.info('[KeycloakProxy] Updating own profile via Account API', { fields: Object.keys(data) });

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

    if (!response.ok) {
      const text = await response.text();
      throw this._mapKeycloakError(response.status, text, '/account');
    }

    return {};
  }
};

module.exports = keycloakProxyService;
