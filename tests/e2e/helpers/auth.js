const https = require('https');

const BASE_URL = process.env.BASE_URL || 'https://localhost';

/**
 * Make an HTTPS request ignoring self-signed certificate errors.
 * @param {string} method - HTTP method
 * @param {string} path - URL path
 * @param {object} [options] - Additional options (headers, body)
 * @returns {Promise<{status: number, data: object}>}
 */
function request(method, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      rejectUnauthorized: false,
      timeout: 30000,
      headers: options.headers || {},
    };

    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let data;
        try {
          data = JSON.parse(body);
        } catch {
          data = body;
        }
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', reject);

    if (options.body) {
      const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.setHeader('Content-Type', options.contentType || 'application/json');
      req.write(bodyStr);
    }
    req.end();
  });
}

/**
 * Get a Keycloak admin token from the master realm.
 * Uses admin-cli client with password grant.
 * @param {string} [adminPassword] - Keycloak admin password (defaults to env KEYCLOAK_ADMIN_PASSWORD)
 * @returns {Promise<string>} Access token string
 */
async function getAdminToken(adminPassword) {
  const password = adminPassword || process.env.KEYCLOAK_ADMIN_PASSWORD;
  if (!password) {
    throw new Error('KEYCLOAK_ADMIN_PASSWORD env var is required');
  }

  const body = new URLSearchParams({
    client_id: 'admin-cli',
    grant_type: 'password',
    username: 'admin',
    password,
  }).toString();

  const res = await request('POST', '/auth/realms/master/protocol/openid-connect/token', {
    body,
    contentType: 'application/x-www-form-urlencoded',
  });

  if (res.status !== 200) {
    throw new Error(`Failed to get admin token: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data.access_token;
}

/**
 * Get a user token via ROPC (Resource Owner Password Credentials).
 * @param {string} username - Keycloak username
 * @param {string} password - User password
 * @param {object} [options] - Optional overrides
 * @param {string} [options.realm='genie'] - Keycloak realm
 * @param {string} [options.clientId='genie-app'] - Keycloak client ID
 * @returns {Promise<string>} Access token string
 */
async function getUserToken(username, password, options = {}) {
  const realm = options.realm || 'genie';
  const clientId = options.clientId || 'genie-app';

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'password',
    username,
    password,
  }).toString();

  const res = await request('POST', `/auth/realms/${realm}/protocol/openid-connect/token`, {
    body,
    contentType: 'application/x-www-form-urlencoded',
  });

  if (res.status !== 200) {
    throw new Error(`Failed to get user token: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data.access_token;
}

/**
 * Parse JWT claims without verification (decode payload only).
 * @param {string} token - JWT token string
 * @returns {object} Decoded claims object
 */
function parseJwtClaims(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid JWT: token must be a non-empty string');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format: expected 3 parts');
  }
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  } catch (e) {
    throw new Error(`Invalid JWT payload: ${e.message}`);
  }
}

module.exports = { getAdminToken, getUserToken, parseJwtClaims, request };
