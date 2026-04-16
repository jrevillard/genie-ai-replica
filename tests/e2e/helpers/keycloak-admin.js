const { request } = require('./auth');

/**
 * Create a new Keycloak realm with a client.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realmName - Name of the realm to create
 * @param {string} clientId - Client ID to create in the realm
 * @returns {Promise<{realmId: string}>} Created realm ID
 */
async function createRealm(adminToken, realmName, clientId) {
  // Create realm
  const realmRes = await request('POST', '/auth/admin/realms', {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      realm: realmName,
      enabled: true,
      sslRequired: 'none',
      roles: {
        realm: [
          { name: 'GENIE.AI_USER', description: 'Standard user role' },
          { name: 'GENIE.AI_ADMIN', description: 'Admin role' },
        ],
      },
    },
  });

  if (realmRes.status !== 201) {
    throw new Error(`Failed to create realm ${realmName}: ${realmRes.status} ${JSON.stringify(realmRes.data)}`);
  }

  // Get realm UUID
  const realmInfo = await request('GET', `/auth/admin/realms/${realmName}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const realmId = realmInfo.data.id;

  // Create client
  const clientRes = await request('POST', `/auth/admin/realms/${realmName}/clients`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      clientId,
      enabled: true,
      publicClient: true,
      directAccessGrantsEnabled: true,
      standardFlowEnabled: true,
      redirectUris: ['https://localhost/*'],
      webOrigins: ['https://localhost'],
    },
  });

  if (clientRes.status !== 201) {
    throw new Error(`Failed to create client ${clientId}: ${clientRes.status}`);
  }

  return { realmId };
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

  // Get user ID from location header or search
  const searchRes = await request('GET', `/auth/admin/realms/${realm}/users?username=${username}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (!searchRes.data || searchRes.data.length === 0) {
    throw new Error(`User ${username} created but not found in search`);
  }

  const userId = searchRes.data[0].id;

  // Assign realm roles if specified
  if (userData.realmRoles && userData.realmRoles.length > 0) {
    // Get available realm roles
    const rolesRes = await request('GET', `/auth/admin/realms/${realm}/roles`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    const rolesToAssign = rolesRes.data
      .filter((r) => userData.realmRoles.includes(r.name))
      .map((r) => ({ id: r.id, name: r.name }));

    const missingRoles = userData.realmRoles.filter(r => !rolesRes.data.some(avail => avail.name === r));
    if (missingRoles.length > 0) {
      throw new Error(`Roles not found in realm ${realm}: ${missingRoles.join(', ')}`);
    }

    await request('POST', `/auth/admin/realms/${realm}/users/${userId}/role-mappings/realm`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: rolesToAssign,
    });
  }

  return userId;
}

/**
 * Get the internal UUID of a Keycloak client.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {string} clientId - Client ID to look up
 * @returns {Promise<string>} Client UUID
 */
async function getClientId(adminToken, realm, clientId) {
  const res = await request('GET', `/auth/admin/realms/${realm}/clients?clientId=${clientId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (res.status !== 200 || !res.data || res.data.length === 0) {
    throw new Error(`Client ${clientId} not found in realm ${realm}`);
  }
  return res.data[0].id;
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
  const realmRes = await request('GET', `/auth/admin/realms/${realm}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const realmId = realmRes.data.id;

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
 * Delete a Keycloak realm.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realmName - Name of the realm to delete
 * @returns {Promise<void>}
 */
async function deleteRealm(adminToken, realmName) {
  const res = await request('DELETE', `/auth/admin/realms/${realmName}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (res.status !== 204 && res.status !== 404) {
    throw new Error(`Failed to delete realm ${realmName}: ${res.status} ${JSON.stringify(res.data)}`);
  }
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
 * Get realm key provider components.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @returns {Promise<object[]>} List of key provider components
 */
async function getRealmKeys(adminToken, realm) {
  const res = await request(
    'GET',
    `/auth/admin/realms/${realm}/components?type=org.keycloak.keys.KeyProvider`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );

  if (res.status !== 200) {
    throw new Error(`Failed to get realm keys: ${res.status}`);
  }
  return res.data || [];
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

module.exports = {
  createRealm,
  createUser,
  getClientId,
  rotateRealmKeys,
  deleteRealm,
  updateRealmSettings,
  getRealmKeys,
  deleteUser,
};
