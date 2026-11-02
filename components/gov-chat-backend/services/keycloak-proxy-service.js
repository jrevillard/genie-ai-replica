'use strict';
// Ported from upstream v2.0.1 components/gov-chat-backend/services/keycloak-proxy-service.js (Epic A6).
// Upstream: opensource.unicc.org/un/itu/genie-ai @ upstream-v2.0.1.
// LOCAL EXTENSIONS (marked below): assignRealmRole, removeRealmRole,
// revokeUserSessions, sendVerifyEmail — operations the realm's genie-proxy-client
// service account already permits (manage-users); the rest is verbatim upstream.

const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
const PROXY_CLIENT_ID = process.env.KEYCLOAK_PROXY_CLIENT_ID;
const PROXY_CLIENT_SECRET = process.env.KEYCLOAK_PROXY_CLIENT_SECRET;

// Fail loudly at boot (A5 verifier pattern) — an unset var would otherwise turn
// into `undefined/realms/undefined` fetch URLs at first use.
if (!KEYCLOAK_URL || !KEYCLOAK_REALM || !PROXY_CLIENT_ID || !PROXY_CLIENT_SECRET) {
  throw new Error(
    'KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_PROXY_CLIENT_ID and KEYCLOAK_PROXY_CLIENT_SECRET environment variables are required for the Keycloak proxy service'
  );
}

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
   * @returns {Promise<string>} Keycloak UUID (sub field)
   * @throws {Error} If user not found or sub field missing
   */
  async _resolveKeycloakUserId(userKey) {
    const db = await dbService.getConnection('default');
    const cursor = await db.query(
      aql`
        FOR u IN users
          FILTER u._key == ${userKey}
          RETURN u.sub
      `
    );
    const sub = await cursor.next();

    if (!sub) {
      throw new Error(`User ${userKey} has no Keycloak UUID (sub field) — user may not have logged in via Keycloak`);
    }

    return sub;
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
    if (!data.access_token) {
      // A 200 without a token must not poison the cache for later calls
      logger.error('[KeycloakProxy] Token endpoint returned no access_token', { body: JSON.stringify(data).substring(0, 200) });
      throw new Error('Keycloak token endpoint returned no access_token');
    }
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
    const uuid = await this._resolveKeycloakUserId(userKey);
    logger.info('[KeycloakProxy] Deleting user', { userKey, uuid });

    // Delete from Keycloak first (authoritative source). KC 404 (already gone)
    // falls THROUGH to the Arango nullify below — the route must not answer
    // success while product PII survives (the nullify is idempotent).
    try {
      await this._adminApiCall('DELETE', `/users/${uuid}`);
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
      logger.info('[KeycloakProxy] User already deleted from Keycloak — continuing with Arango erasure', { userKey, uuid });
    }

    // Then erase PII from ArangoDB
    // If ArangoDB update fails, user is already deleted from Keycloak (defense-in-depth)
    const db = await dbService.getConnection('default');
    try {
      await db.query(
        aql`
          FOR u IN users
            FILTER u._key == ${userKey}
            UPDATE u WITH {
              deleted: true,
              erasedAt: DATE_ISO8601(DATE_NOW()),
              updatedAt: DATE_ISO8601(DATE_NOW()),
              email: null,
              name: null,
              loginName: null,
              sub: null,
              iss: null,
              iss_sub: null,
              roles: [],
              active: false,
              personalIdentification: null,
              addressResidency: null,
              farmerProfile: null
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
  // LOCAL EXTENSIONS (A6 product deltas — not upstream)
  // Realm operations the genie-proxy-client service account permits (manage-users).
  // ---------------------------------------------------------------------------

  /**
   * Assign a realm-level role to a user (LOCAL EXTENSION, A6).
   * Used by admin approval / role change so realm role `admin` applies to the
   * next token — roles are only ever authorized from JWT claims (requireAdmin).
   * @param {string} userKey - ArangoDB _key
   * @param {string} roleName - Realm role name (e.g. 'admin')
   */
  async assignRealmRole(userKey, roleName) {
    const uuid = await this._resolveKeycloakUserId(userKey);
    // Role mappings require the role's KC id — resolve it first.
    // Live-smoke correction: assignment is POST (PUT role-mappings → 405 on KC 26.x).
    const role = await this._adminApiCall('GET', `/roles/${encodeURIComponent(roleName)}`);
    await this._adminApiCall('POST', `/users/${uuid}/role-mappings/realm`, [{ id: role.id, name: role.name }]);
    logger.info('[KeycloakProxy] Realm role assigned', { userKey, uuid, roleName });
  },

  /**
   * Remove a realm-level role from a user (LOCAL EXTENSION, A6).
   * @param {string} userKey - ArangoDB _key
   * @param {string} roleName - Realm role name (e.g. 'admin')
   */
  async removeRealmRole(userKey, roleName) {
    const uuid = await this._resolveKeycloakUserId(userKey);
    const role = await this._adminApiCall('GET', `/roles/${encodeURIComponent(roleName)}`);
    await this._adminApiCall('DELETE', `/users/${uuid}/role-mappings/realm`, [{ id: role.id, name: role.name }]);
    logger.info('[KeycloakProxy] Realm role removed', { userKey, uuid, roleName });
  },

  /**
   * Revoke all Keycloak sessions of a user (LOCAL EXTENSION, A6).
   * Kills refresh tokens — already-minted access tokens live ≤ their lifespan
   * (DEC-4: 300s ceiling, documented).
   * Live-smoke correction: KC 26.x has no DELETE /users/{id}/sessions (404);
   * the Admin API endpoint is POST /users/{id}/logout (verified 204 on 26.7.2).
   * @param {string} userKey - ArangoDB _key
   */
  async revokeUserSessions(userKey) {
    const uuid = await this._resolveKeycloakUserId(userKey);
    await this._adminApiCall('POST', `/users/${uuid}/logout`);
    logger.info('[KeycloakProxy] User sessions revoked', { userKey, uuid });
  },

  /**
   * Trigger Keycloak's own VERIFY_EMAIL required-action email (LOCAL EXTENSION, A6).
   * KC sends its own templates; emailVerified refreshes from claims on next login.
   * @param {string} userKey - ArangoDB _key
   */
  async sendVerifyEmail(userKey) {
    const uuid = await this._resolveKeycloakUserId(userKey);
    await this._adminApiCall('PUT', `/users/${uuid}/execute-actions-email`, ['VERIFY_EMAIL']);
    logger.info('[KeycloakProxy] VERIFY_EMAIL action email sent', { userKey, uuid });
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
