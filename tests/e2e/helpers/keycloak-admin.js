const auth = require('./auth');

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

// The transient retry waits on a CONDITION (Keycloak answering without a
// transient verdict), bounded by a deadline rather than by a fixed number
// of attempts: the pause between attempts grows, and the budget expires
// into a failure that names the last observed error.
const TRANSIENT_RETRY_BUDGET_MS = 30000;
const TRANSIENT_RETRY_BASE_PAUSE_MS = 2000;

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
  const searchRes = await auth.request(
    'GET',
    `/auth/admin/realms/${realm}/users?username=${encodeURIComponent(username)}&exact=true`,
    {
      headers: { Authorization: `Bearer ${adminToken}` }
    }
  );

  // The status and the payload shape are checked: an expired admin token
  // answers 401 with an error body, and indexing that body would resolve
  // an undefined user instead of naming the cause.
  if (searchRes.status !== 200) {
    throw new Error(`User lookup for ${username} in realm ${realm} failed: HTTP ${searchRes.status}`);
  }
  if (!Array.isArray(searchRes.data) || searchRes.data.length === 0) {
    throw new Error(`User ${username} not found in realm ${realm}`);
  }

  return searchRes.data[0];
}

/**
 * One realm role, resolved by its EXACT name through the single-role
 * endpoint. The roles listing endpoint is paginated (first/max), so a
 * list-and-filter resolves only the roles that fit the first page — a
 * role past the cutoff reads as missing and is then falsely reported as
 * not found (or silently skipped on removal). The single-role lookup is
 * exact and unpaginated.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {string} roleName - Exact realm role name
 * @returns {Promise<object|null>} The role representation, or null when
 *   the realm carries no role of that name (HTTP 404 on a realm that
 *   exists)
 */
async function findRealmRole(adminToken, realm, roleName) {
  const res = await auth.request('GET', `/auth/admin/realms/${realm}/roles/${encodeURIComponent(roleName)}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  if (res.status === 200) {
    // A 200 with no usable representation is a broken answer, not a role:
    // the callers index role.id on it.
    if (!res.data || typeof res.data !== 'object' || !res.data.id) {
      throw new Error(
        `The realm role ${roleName} of ${realm} answered HTTP 200 without a usable representation: ` +
          `${typeof res.data === 'string' ? res.data : JSON.stringify(res.data)}`
      );
    }
    return res.data;
  }
  if (res.status === 404) {
    // Keycloak answers 404 for a role the realm does not carry AND for a
    // realm that does not exist. The two must not be conflated: a missing
    // realm is a broken venue (fail loudly), a missing role is a plain
    // "not granted here" (skip on removal, named on assignment).
    await getRealmSettings(adminToken, realm);
    return null;
  }
  throw new Error(
    `Cannot read the realm role ${roleName} of ${realm}: HTTP ${res.status} ` +
      `${typeof res.data === 'string' ? res.data : JSON.stringify(res.data)}`
  );
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

  const rolesToAssign = [];
  const missingRoles = [];
  const seen = new Set();
  for (const name of roleNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    const role = await findRealmRole(adminToken, realm, name);
    if (role) rolesToAssign.push({ id: role.id, name: role.name });
    else missingRoles.push(name);
  }
  if (missingRoles.length > 0) {
    throw new Error(`Roles not found in realm ${realm}: ${missingRoles.join(', ')}`);
  }

  const assignRes = await auth.request('POST', `/auth/admin/realms/${realm}/users/${userId}/role-mappings/realm`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: rolesToAssign
  });
  if (assignRes.status !== 204 && assignRes.status !== 200) {
    const message = `Failed to assign the realm roles ${roleNames.join(', ')} to ${userId}: HTTP ${assignRes.status}`;
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

  const userRes = await auth.request('POST', `/auth/admin/realms/${realm}/users`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      username,
      email,
      firstName: firstName || username,
      lastName: lastName || 'Test',
      enabled,
      emailVerified: true,
      credentials: userData.password
        ? [
            {
              type: 'password',
              value: userData.password,
              temporary: false
            }
          ]
        : undefined
    }
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

  // A role the realm does not carry cannot be mapped on the user, so a
  // 404 lookup is a skip — the same semantics the assignment side treats
  // as a hard failure, because removal has no state to protect.
  const toRemove = [];
  for (const name of new Set(roleNames)) {
    const role = await findRealmRole(adminToken, realm, name);
    if (role) toRemove.push({ id: role.id, name: role.name });
  }
  if (toRemove.length === 0) return [];

  const res = await auth.request('DELETE', `/auth/admin/realms/${realm}/users/${userId}/role-mappings/realm`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: toRemove
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
  const res = await auth.request('GET', `/auth/admin/realms/${realm}/users/${userId}/role-mappings/realm/composite`, {
    headers: { Authorization: `Bearer ${adminToken}` }
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
    res = await auth.request('POST', `/auth/admin/realms/${realm}/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        username,
        email,
        firstName: userData.firstName || username,
        lastName: userData.lastName || 'Test',
        enabled: true,
        emailVerified: true,
        credentials: password ? [{ type: 'password', value: password, temporary: false }] : undefined
      }
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
      // The create answered 409 but no account carries the username: the
      // conflict has two live causes. ANOTHER account may own the fixture
      // email (the realm forbids duplicate emails), or the account that
      // answered 409 was DELETED between the create and this lookup (a
      // concurrent cleanup, an operator purge). An email-ownership probe
      // separates them — blaming a vanished account on an email conflict
      // sends the operator hunting for a conflict that does not exist.
      let probe;
      try {
        probe = await auth.request(
          'GET',
          `/auth/admin/realms/${realm}/users?email=${encodeURIComponent(email)}&exact=true`,
          { headers: { Authorization: `Bearer ${adminToken}` } }
        );
      } catch (probeErr) {
        // A transport-level failure of the probe is transient, exactly like
        // the create's own: it must not kill a provisioning that the
        // deadline-based retry exists to save.
        throw transientError(
          `Cannot reach the Keycloak admin API for the email-ownership probe of ${email}: ${probeErr.message}`
        );
      }
      if (probe.status !== 200 || !Array.isArray(probe.data)) {
        const message =
          `${err.message} — the create answered 409, but the email-ownership probe for ${email} ` +
          `could not run (HTTP ${probe.status})`;
        if (probe.status >= 500 || TRANSIENT_STATUSES.includes(probe.status)) {
          throw transientError(message);
        }
        throw new Error(message);
      }
      if (probe.data.length > 0) {
        throw new Error(
          `${err.message} — the create answered 409 because ${probe.data[0].username} owns ` +
            `${email}: an email conflict; remove or rename that account (or change the fixture email)`
        );
      }
      throw new Error(
        `${err.message} — the create answered 409, but no account carries ${email} either: ` +
          `the account named ${username} existed at create time and was deleted mid-provisioning ` +
          '(a concurrent cleanup or an operator purge); re-run the provisioning'
      );
    }
    throw err;
  }

  if (status === 409 && password) {
    // Converge the password: an account carried over from an earlier
    // fixture revision keeps its old one, and the realm refuses direct
    // access grants, so nothing else can detect the drift.
    const resetRes = await auth.request('PUT', `/auth/admin/realms/${realm}/users/${user.id}/reset-password`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { type: 'password', value: password, temporary: false }
    });
    if (resetRes.status === 404) {
      // The account was just looked up by its exact username: a 404 here
      // means it was deleted between that lookup and this reset (a
      // concurrent cleanup, an operator purge) — not a password problem.
      throw new Error(
        `Cannot converge the password of ${username} (${user.id}): HTTP 404 — the account ` +
          'was deleted between the lookup and the password reset (a concurrent cleanup or an operator purge); ' +
          're-run the provisioning'
      );
    }
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
 * So: the whole convergence (create, password, roles) is retried while
 * Keycloak answers transiently, the password is converged on the
 * already-exists path, then the login-visible state is verified and the
 * roles are (re)assigned.
 *
 * The retry waits on the CONDITION (Keycloak answering without a
 * transient verdict), not on a duration: the pause between attempts
 * grows, and the budget is a deadline — a wait that expires is a
 * failure naming the last observed error, never a silent give-up.
 *
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {object} userData - { username, email, password, firstName?, lastName?, realmRoles? }
 * @returns {Promise<string>} The user UUID
 */
async function ensureUser(adminToken, realm, userData) {
  const deadline = Date.now() + TRANSIENT_RETRY_BUDGET_MS;
  let lastError;
  for (let attempt = 1; ; attempt++) {
    try {
      return await convergeUser(adminToken, realm, userData);
    } catch (err) {
      lastError = err;
      // A non-transient error is a real failure: it propagates at once.
      if (!err.transient) throw err;
      // The budget expired while Keycloak kept answering transiently:
      // the wait ends in a FAILURE carrying the last observed error.
      if (Date.now() >= deadline) {
        throw new Error(
          `Keycloak kept answering transiently for ${TRANSIENT_RETRY_BUDGET_MS}ms while ` +
            `provisioning ${userData.username}: ${err.message}`
        );
      }
      // Back off between attempts: the pause grows so a struggling
      // Keycloak is not hammered, and it stays inside the deadline.
      const pause = Math.min(TRANSIENT_RETRY_BASE_PAUSE_MS * attempt, deadline - Date.now());
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
  }
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
  const keysRes = await auth.request(
    'GET',
    `/auth/admin/realms/${realm}/components?type=org.keycloak.keys.KeyProvider`,
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  const existingKeys = keysRes.data || [];
  const oldKeyIds = existingKeys.map((k) => k.id);

  // Generate new RSA key with higher priority (becomes active signing key)
  const newKeyRes = await auth.request('POST', `/auth/admin/realms/${realm}/components`, {
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
        keySize: ['2048']
      }
    }
  });

  if (newKeyRes.status !== 201) {
    throw new Error(`Failed to generate new key: ${newKeyRes.status} ${JSON.stringify(newKeyRes.data)}`);
  }

  // Extract new key ID from location header
  const newKeyId = newKeyRes.data;

  // Demote old keys (set active to false)
  for (const oldKey of existingKeys) {
    const updatedConfig = { ...oldKey.config, active: ['false'] };
    const res = await auth.request('PUT', `/auth/admin/realms/${realm}/components/${oldKey.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { ...oldKey, config: updatedConfig }
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
  const res = await auth.request('GET', `/auth/admin/realms/${realm}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
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
  const res = await auth.request('PUT', `/auth/admin/realms/${realm}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: settings
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
  const res = await auth.request('DELETE', `/auth/admin/realms/${realm}/users/${userId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  // 404 means the user is already gone — that IS the end state every
  // caller wants (no test account left behind). Anything else is a real
  // failure and must fail the cleanup that asked for it.
  if (res.status !== 204 && res.status !== 404) {
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

  const searchRes = await auth.request('GET', `/auth/admin/realms/${realm}/clients?clientId=${clientId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  if (searchRes.status !== 200 || !Array.isArray(searchRes.data) || searchRes.data.length === 0) {
    throw new Error(`Client ${clientId} not found in realm ${realm} (HTTP ${searchRes.status})`);
  }

  const client = searchRes.data[0];
  if (client.directAccessGrantsEnabled) return;

  const res = await auth.request('PUT', `/auth/admin/realms/${realm}/clients/${client.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { ...client, directAccessGrantsEnabled: true }
  });

  if (res.status !== 204) {
    throw new Error(`Failed to enable direct access grants on ${clientId}: ${res.status} ${JSON.stringify(res.data)}`);
  }
}

module.exports = {
  createUser,
  ensureUser,
  convergeUser,
  assignRealmRoles,
  removeRealmRoles,
  effectiveRealmRoles,
  rotateRealmKeys,
  getRealmSettings,
  updateRealmSettings,
  deleteUser,
  enableDirectAccessGrants
};
