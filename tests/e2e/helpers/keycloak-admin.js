const { request } = require('./auth');

/**
 * Resolve a user's id in a realm by exact username.
 * exact=true: ?username= is a prefix search otherwise — a stray
 * testadmin2 would misdirect the role assignment to data[0].
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {string} username - Exact username
 * @returns {Promise<object>} The Keycloak user representation
 */
async function resolveUser(adminToken, realm, username) {
  const searchRes = await request('GET', `/auth/admin/realms/${realm}/users?username=${username}&exact=true`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (!searchRes.data || searchRes.data.length === 0) {
    throw new Error(`User ${username} not found in realm ${realm}`);
  }

  return searchRes.data[0];
}

/**
 * Assign realm roles to a user (no-op when no role is requested).
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {string} userId - The user's UUID
 * @param {string[]} roleNames - Realm role names to assign
 * @returns {Promise<void>}
 */
async function assignRealmRoles(adminToken, realm, userId, roleNames) {
  if (!roleNames || roleNames.length === 0) return;

  // Get available realm roles
  const rolesRes = await request('GET', `/auth/admin/realms/${realm}/roles`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  const rolesToAssign = rolesRes.data
    .filter((r) => roleNames.includes(r.name))
    .map((r) => ({ id: r.id, name: r.name }));

  const missingRoles = roleNames.filter((r) => !rolesRes.data.some((avail) => avail.name === r));
  if (missingRoles.length > 0) {
    throw new Error(`Roles not found in realm ${realm}: ${missingRoles.join(', ')}`);
  }

  await request('POST', `/auth/admin/realms/${realm}/users/${userId}/role-mappings/realm`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: rolesToAssign,
  });
}

/**
 * Create a user in a Keycloak realm.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {object} userData - User data { username, email, password, firstName?, lastName?, realmRoles? }
 * @returns {Promise<string>} Created user UUID
 */
async function createUser(adminToken, realm, userData) {
  const { username, email, firstName, lastName, enabled = true } = userData;

  const userRes = await request('POST', `/auth/admin/realms/${realm}/users`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      username,
      email,
      firstName: firstName || username,
      lastName: lastName || 'Test',
      enabled,
      emailVerified: true,
      credentials: userData.password ? [{
        type: 'password',
        value: userData.password,
        temporary: false,
      }] : undefined,
    },
  });

  if (userRes.status !== 201 && userRes.status !== 409) {
    throw new Error(`Failed to create user ${username}: ${userRes.status} ${JSON.stringify(userRes.data)}`);
  }

  const user = await resolveUser(adminToken, realm, username);
  await assignRealmRoles(adminToken, realm, user.id, userData.realmRoles);

  return user.id;
}

/**
 * Ensure a fixture user exists with a KNOWN password and role set.
 *
 * createUser is create-only: it tolerates a 409 and moves on, which leaves
 * three failure modes for a long-lived realm — a stale password (the realm
 * refuses direct access grants, so only the browser login can reveal it),
 * an account the realm left disabled/unverified or carrying a required
 * action, and a transient 429/5xx from Keycloak that would otherwise kill
 * the provisioning step. Each of those surfaces as a login failure minutes
 * later, far from its cause.
 *
 * So: create with a bounded retry on transient answers, converge the
 * password on the already-exists path, then verify the login-visible state
 * and (re)assign the roles.
 *
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {object} userData - { username, email, password, firstName?, lastName?, realmRoles? }
 * @returns {Promise<string>} The user UUID
 */
async function ensureUser(adminToken, realm, userData) {
  const { username, password } = userData;
  const transient = [408, 425, 429];
  let status = 0;
  let body = '';

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await request('POST', `/auth/admin/realms/${realm}/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        username,
        email: userData.email,
        firstName: userData.firstName || username,
        lastName: userData.lastName || 'Test',
        enabled: true,
        emailVerified: true,
        credentials: password ? [{ type: 'password', value: password, temporary: false }] : undefined,
      },
    });
    status = res.status;
    body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const isTransient = status === 0 || status >= 500 || transient.includes(status);
    if (!isTransient) break;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (status !== 201 && status !== 409) {
    throw new Error(`Failed to provision user ${username}: HTTP ${status} ${body}`);
  }

  const user = await resolveUser(adminToken, realm, username);

  if (status === 409) {
    // Converge the password: an account carried over from an earlier
    // fixture revision keeps its old one, and the realm refuses direct
    // access grants, so nothing else can detect the drift.
    if (password) {
      const resetRes = await request('PUT', `/auth/admin/realms/${realm}/users/${user.id}/reset-password`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { type: 'password', value: password, temporary: false },
      });
      if (resetRes.status !== 204) {
        throw new Error(`Failed to converge the password of ${username}: HTTP ${resetRes.status}`);
      }
    }
  }

  // Fixture health — the login-visible state the browser session depends
  // on (the exact-match lookup already carries it, so no extra read is
  // needed). The email is deliberately NOT part of it: the login reads
  // the username, and the venues spell the fixture emails differently.
  const healthy = user.enabled === true && user.emailVerified === true;
  if (!healthy || (user.requiredActions && user.requiredActions.length > 0)) {
    throw new Error(
      `User ${username} is not fixture-healthy (enabled=${user.enabled}, ` +
        `emailVerified=${user.emailVerified}, email=${user.email}, ` +
        `requiredActions=${JSON.stringify(user.requiredActions || [])}) — ` +
        'realm defaults are attaching state to new users; check the realm import'
    );
  }

  // Assign the realm roles (the admin half needs the `admin` role; the
  // role-less fixture must carry none, so nothing is assigned for it).
  await assignRealmRoles(adminToken, realm, user.id, userData.realmRoles);

  return user.id;
}

/**
 * Rotate realm signing keys: generate a new RSA key and demote the old one.
 * Uses the Keycloak 26 components API (no /keys POST endpoint exists).
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @returns {Promise<{newKeyId: string, oldKeyIds: string[]}>}
 */
async function rotateRealmKeys(adminToken, realm) {
  // Get realm UUID (parentId for key components)
  const realmId = (await getRealmSettings(adminToken, realm)).id;

  // Get existing key providers
  const keysRes = await request(
    'GET',
    `/auth/admin/realms/${realm}/components?type=org.keycloak.keys.KeyProvider`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  const existingKeys = keysRes.data || [];
  const oldKeyIds = existingKeys.map((k) => k.id);

  // Generate new RSA key with higher priority (becomes active signing key)
  const newKeyRes = await request('POST', `/auth/admin/realms/${realm}/components`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      name: `rsa-generated-rotated-${Date.now()}`,
      providerId: 'rsa-generated',
      providerType: 'org.keycloak.keys.KeyProvider',
      parentId: realmId,
      config: {
        priority: ['101'],
        enabled: ['true'],
        active: ['true'],
        keySize: ['2048'],
      },
    },
  });

  if (newKeyRes.status !== 201) {
    throw new Error(`Failed to generate new key: ${newKeyRes.status} ${JSON.stringify(newKeyRes.data)}`);
  }

  // Extract new key ID from location header
  const newKeyId = newKeyRes.data;

  // Demote old keys (set active to false)
  for (const oldKey of existingKeys) {
    const updatedConfig = { ...oldKey.config, active: ['false'] };
    const res = await request('PUT', `/auth/admin/realms/${realm}/components/${oldKey.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { ...oldKey, config: updatedConfig },
    });
    if (res.status !== 204) {
      throw new Error(`Failed to demote key ${oldKey.id}: ${res.status} ${JSON.stringify(res.data)}`);
    }
  }

  return { newKeyId, oldKeyIds };
}

/**
 * Read a realm's settings.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @returns {Promise<object>} The realm representation
 */
async function getRealmSettings(adminToken, realm) {
  const res = await request('GET', `/auth/admin/realms/${realm}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (res.status !== 200) {
    throw new Error(`Failed to get realm settings for ${realm}: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

/**
 * Update realm settings (partial update).
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {object} settings - Settings to update (e.g., { accessTokenLifespan: '10' })
 * @returns {Promise<void>}
 */
async function updateRealmSettings(adminToken, realm, settings) {
  const res = await request('PUT', `/auth/admin/realms/${realm}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: settings,
  });

  if (res.status !== 204) {
    throw new Error(`Failed to update realm settings: ${res.status} ${JSON.stringify(res.data)}`);
  }
}

/**
 * Delete a user from a realm.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {string} userId - User UUID
 * @returns {Promise<void>}
 */
async function deleteUser(adminToken, realm, userId) {
  const res = await request('DELETE', `/auth/admin/realms/${realm}/users/${userId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (res.status !== 204) {
    throw new Error(`Failed to delete user ${userId}: ${res.status}`);
  }
}

/**
 * Enable ROPC (direct access grants) on a client, preserving the rest of
 * its representation. The primary `genie` realm refuses ROPC by design —
 * only ever call this for a test-only realm (e.g. `genie2`) whose specs
 * mint tokens directly and have no UI login posture.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {string} clientId - Client ID (e.g. 'genie-app')
 * @returns {Promise<void>}
 */
async function enableDirectAccessGrants(adminToken, realm, clientId) {
  if (realm === 'genie') {
    throw new Error('enableDirectAccessGrants must never target the primary realm — ROPC is disabled there by design');
  }

  const searchRes = await request('GET', `/auth/admin/realms/${realm}/clients?clientId=${clientId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (searchRes.status !== 200 || !Array.isArray(searchRes.data) || searchRes.data.length === 0) {
    throw new Error(`Client ${clientId} not found in realm ${realm} (HTTP ${searchRes.status})`);
  }

  const client = searchRes.data[0];
  if (client.directAccessGrantsEnabled) return;

  const res = await request('PUT', `/auth/admin/realms/${realm}/clients/${client.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { ...client, directAccessGrantsEnabled: true },
  });

  if (res.status !== 204) {
    throw new Error(`Failed to enable direct access grants on ${clientId}: ${res.status} ${JSON.stringify(res.data)}`);
  }
}

module.exports = {
  createUser,
  ensureUser,
  rotateRealmKeys,
  getRealmSettings,
  updateRealmSettings,
  deleteUser,
  enableDirectAccessGrants,
};
