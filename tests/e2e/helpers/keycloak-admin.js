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
/**
 * A failure that a later attempt may survive: a transport error, a
 * timeout, a 408/425/429 or a 5xx from the Keycloak admin API.
 * @param {string} message - The diagnosis
 * @returns {Error} The error, flagged transient
 */
function transientError(message) {
  const error = new Error(message);
  error.transient = true;
  return error;
}

const TRANSIENT_STATUSES = [408, 425, 429];

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
  const searchRes = await request('GET', `/auth/admin/realms/${realm}/users?username=${encodeURIComponent(username)}&exact=true`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  // The status and the payload shape are checked: an expired admin token
  // answers 401 with an error body, and indexing that body would resolve
  // an undefined user instead of naming the cause.
  if (searchRes.status !== 200) {
    throw new Error(
      `User lookup for ${username} in realm ${realm} failed: HTTP ${searchRes.status}`
    );
  }
  if (!Array.isArray(searchRes.data) || searchRes.data.length === 0) {
    throw new Error(`User ${username} not found in realm ${realm}`);
  }

  return searchRes.data[0];
}

/**
 * The realm roles of a realm, as {id, name} pairs.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @returns {Promise<object[]>} The realm roles
 */
async function listRealmRoles(adminToken, realm) {
  const rolesRes = await request('GET', `/auth/admin/realms/${realm}/roles`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (rolesRes.status !== 200 || !Array.isArray(rolesRes.data)) {
    throw new Error(
      `Cannot read the realm roles of ${realm}: HTTP ${rolesRes.status} ` +
        `${typeof rolesRes.data === 'string' ? rolesRes.data : JSON.stringify(rolesRes.data)}`
    );
  }
  return rolesRes.data;
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

  const roles = await listRealmRoles(adminToken, realm);
  const rolesToAssign = roles.filter((r) => roleNames.includes(r.name)).map((r) => ({ id: r.id, name: r.name }));

  const missingRoles = roleNames.filter((r) => !roles.some((avail) => avail.name === r));
  if (missingRoles.length > 0) {
    throw new Error(`Roles not found in realm ${realm}: ${missingRoles.join(', ')}`);
  }

  const assignRes = await request('POST', `/auth/admin/realms/${realm}/users/${userId}/role-mappings/realm`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: rolesToAssign,
  });
  if (assignRes.status !== 204 && assignRes.status !== 200) {
    const message =
      `Failed to assign the realm roles ${roleNames.join(', ')} to ${userId}: HTTP ${assignRes.status}`;
    if (assignRes.status >= 500 || TRANSIENT_STATUSES.includes(assignRes.status)) {
      throw transientError(message);
    }
    throw new Error(message);
  }
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
 * Remove realm roles from a user.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {string} userId - The user's UUID
 * @param {string[]} roleNames - Realm role names to remove
 * @returns {Promise<string[]>} The role names that were actually removed
 */
async function removeRealmRoles(adminToken, realm, userId, roleNames) {
  if (!roleNames || roleNames.length === 0) return [];

  const roles = await listRealmRoles(adminToken, realm);
  const toRemove = roles.filter((r) => roleNames.includes(r.name)).map((r) => ({ id: r.id, name: r.name }));
  if (toRemove.length === 0) return [];

  const res = await request('DELETE', `/auth/admin/realms/${realm}/users/${userId}/role-mappings/realm`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: toRemove,
  });
  if (res.status !== 204) {
    throw new Error(`Failed to remove the realm roles of ${userId}: HTTP ${res.status}`);
  }
  return toRemove.map((r) => r.name);
}

/**
 * The EFFECTIVE realm roles of a user — the direct mappings plus the
 * composites they pull in (the realm's default role is one of them).
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {string} userId - The user's UUID
 * @returns {Promise<string[]>} The effective role names
 */
async function effectiveRealmRoles(adminToken, realm, userId) {
  const res = await request('GET', `/auth/admin/realms/${realm}/users/${userId}/role-mappings/realm/composite`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (res.status !== 200 || !Array.isArray(res.data)) {
    throw new Error(
      `Cannot read the effective realm roles of ${userId}: HTTP ${res.status} ` +
        `${typeof res.data === 'string' ? res.data : JSON.stringify(res.data)}`
    );
  }
  return res.data.map((r) => r.name);
}

/**
 * One convergence attempt: create (or find), converge the password,
 * check the login-visible state, assign the roles.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {object} userData - { username, email, password, firstName?, lastName?, realmRoles? }
 * @returns {Promise<string>} The user UUID
 */
async function convergeUser(adminToken, realm, userData) {
  const { username, email, password } = userData;

  let res;
  try {
    res = await request('POST', `/auth/admin/realms/${realm}/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        username,
        email,
        firstName: userData.firstName || username,
        lastName: userData.lastName || 'Test',
        enabled: true,
        emailVerified: true,
        credentials: password ? [{ type: 'password', value: password, temporary: false }] : undefined,
      },
    });
  } catch (err) {
    // A transport-level failure (connection refused, timeout) rejects the
    // promise instead of answering — Keycloak not listening yet is the
    // most likely transient, and it must not kill the provisioning.
    throw transientError(`Cannot reach the Keycloak admin API: ${err.message}`);
  }

  const status = res.status;
  if (status !== 201 && status !== 409) {
    const message = `Failed to provision user ${username}: HTTP ${status} ${
      typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    }`;
    if (status >= 500 || TRANSIENT_STATUSES.includes(status)) {
      throw transientError(message);
    }
    throw new Error(message);
  }

  let user;
  try {
    user = await resolveUser(adminToken, realm, username);
  } catch (err) {
    if (status === 409) {
      // The realm forbids duplicate emails, so a 409 can also mean that
      // ANOTHER account owns the fixture email — the username lookup then
      // finds nothing, and the bare "not found" would point the operator
      // at the wrong cause.
      throw new Error(
        `${err.message} — the create answered 409, which may also be an email conflict ` +
          `(another account owns ${email})`
      );
    }
    throw err;
  }

  if (status === 409 && password) {
    // Converge the password: an account carried over from an earlier
    // fixture revision keeps its old one, and the realm refuses direct
    // access grants, so nothing else can detect the drift.
    const resetRes = await request('PUT', `/auth/admin/realms/${realm}/users/${user.id}/reset-password`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { type: 'password', value: password, temporary: false },
    });
    if (resetRes.status !== 204) {
      const message = `Failed to converge the password of ${username}: HTTP ${resetRes.status}`;
      if (resetRes.status >= 500 || TRANSIENT_STATUSES.includes(resetRes.status)) {
        throw transientError(message);
      }
      throw new Error(message);
    }
  }

  // Fixture health — the login-visible state the browser session depends
  // on (the exact-match lookup already carries it, so no extra read is
  // needed). The email is deliberately NOT part of it: an account created
  // before the fixtures module existed carries the previous address, and
  // the login reads the username, not the email.
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
 * Ensure a fixture user exists with a KNOWN password and role set.
 *
 * createUser is create-only: it tolerates a 409 and moves on, which leaves
 * three failure modes for a long-lived realm — a stale password (the realm
 * refuses direct access grants, so only the browser login can reveal it),
 * an account the realm left disabled/unverified or carrying a required
 * action, and a transient 429/5xx/timeout from Keycloak that would
 * otherwise kill the provisioning step. Each of those surfaces as a login
 * failure minutes later, far from its cause.
 *
 * So: the whole convergence (create, password, roles) is retried on a
 * transient or unanswered Keycloak call, the password is converged on the
 * already-exists path, then the login-visible state is verified and the
 * roles are (re)assigned.
 *
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {object} userData - { username, email, password, firstName?, lastName?, realmRoles? }
 * @returns {Promise<string>} The user UUID
 */
async function ensureUser(adminToken, realm, userData) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await convergeUser(adminToken, realm, userData);
    } catch (err) {
      lastError = err;
      if (!err.transient || attempt === 3) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
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
  removeRealmRoles,
  effectiveRealmRoles,
  rotateRealmKeys,
  getRealmSettings,
  updateRealmSettings,
  deleteUser,
  enableDirectAccessGrants,
};
