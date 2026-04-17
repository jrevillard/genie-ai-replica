'use strict';

const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
const PROXY_CLIENT_ID = process.env.KEYCLOAK_PROXY_CLIENT_ID;
const PROXY_CLIENT_SECRET = process.env.KEYCLOAK_PROXY_CLIENT_SECRET;

const ALLOWED_ROLES = ['admin', 'user'];
const FETCH_TIMEOUT_MS = 10000; // 10s timeout for Keycloak API calls

// Service account token cache (lazy refresh on 401)
let cachedToken = null;

/**
 * Keycloak Proxy Service — proxies user management operations to Keycloak
 *
 * Uses two auth modes:
 * 1. Service account (genie-proxy-client) — for admin operations (role assignment, enable/disable, email, delete)
 * 2. Self-service profile updates — also uses service account (Keycloak /account is the Console SPA, not a REST API)
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
        'Authorization': `Bearer ${token}`,
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
   * Update a user in Keycloak
   * @param {string} userKey - ArangoDB _key
   * @param {Object} data - Fields to update (e.g. { enabled: true, email: '...' })
   */
  async updateUser(userKey, data) {
    const uuid = await this._resolveKeycloakUserId(userKey);
    logger.info('[KeycloakProxy] Updating user', { userKey, uuid, fields: Object.keys(data) });
    return this._adminApiCall('PUT', `/users/${uuid}`, data);
  },

  /**
   * Assign realm roles to a user
   * @param {string} userKey - ArangoDB _key
   * @param {string[]} roleNames - Role names to assign (must be lowercase)
   */
  async assignRoles(userKey, roleNames) {
    // Validate role names before any I/O
    const invalidRoles = roleNames.filter(r => !ALLOWED_ROLES.includes(r));
    if (invalidRoles.length > 0) {
      throw new Error(`Invalid roles: ${invalidRoles.join(', ')}. Allowed: ${ALLOWED_ROLES.join(', ')}`);
    }

    const uuid = await this._resolveKeycloakUserId(userKey);

    // Fetch role representations from Keycloak
    const roleRepresentations = [];
    for (const name of roleNames) {
      const role = await this._adminApiCall('GET', `/roles/${name}`);
      roleRepresentations.push({ id: role.id, name: role.name });
    }

    logger.info('[KeycloakProxy] Assigning roles', { userKey, uuid, roles: roleNames });
    return this._adminApiCall('POST', `/users/${uuid}/role-mappings/realm`, roleRepresentations);
  },

  /**
   * Delete a user from Keycloak and erase personal data in ArangoDB (GDPR right to erasure)
   * @param {string} userKey - ArangoDB _key
   * @throws {Error} If Keycloak user not found (404) or authentication fails
   * @throws {Error} If ArangoDB erasure fails after Keycloak delete (partial erasure state)
   */
  async deleteUser(userKey) {
    const uuid = await this._resolveKeycloakUserId(userKey);
    logger.info('[KeycloakProxy] Deleting user', { userKey, uuid });

    // Delete from Keycloak first (authoritative source)
    try {
      await this._adminApiCall('DELETE', `/users/${uuid}`);
    } catch (error) {
      if (error.status === 404) {
        logger.info('[KeycloakProxy] User already deleted from Keycloak, skipping', { userKey, uuid });
        return;
      }
      throw error;
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
      throw new Error('Partial erasure: user deleted from Keycloak but ArangoDB erasure failed');
    }
  },

  // ---------------------------------------------------------------------------
  // Public API — Self-service operations
  // ---------------------------------------------------------------------------

  /**
   * Update a user's own profile fields in Keycloak via Admin API.
   * Uses the service account token (same as updateUser) because Keycloak's
   * /account endpoint is the Account Console (React SPA), not a REST API.
   * @param {string} userKey - ArangoDB _key (self-enforced by caller)
   * @param {Object} data - JIT fields to update (e.g. { email, firstName, lastName })
   */
  async updateOwnProfile(userKey, data) {
    const uuid = await this._resolveKeycloakUserId(userKey);
    logger.info('[KeycloakProxy] Updating own profile via Admin API', { userKey, uuid, fields: Object.keys(data) });
    return this._adminApiCall('PUT', `/users/${uuid}`, data);
  }
};

module.exports = keycloakProxyService;
