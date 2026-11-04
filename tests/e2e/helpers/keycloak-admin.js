const auth = require('./auth');

// The transport is resolved at CALL time, so a unit spec can substitute it
// without this module knowing.
const request = (...args) => auth.request(...args);

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
 * Fail with the verdict a status deserves: a 5xx or a 408/425/429 is a
 * failure a later attempt may survive (transient), anything else is a
 * real failure.
 * @param {string} message - The diagnosis
 * @param {number} status - The HTTP status
 * @throws {Error} The error — transient when the status is transient
 */
function failWithStatus(message, status) {
  if (status >= 500 || TRANSIENT_STATUSES.includes(status)) {
    throw transientError(message);
  }
  throw new Error(message);
}

/**
 * The verdict for a rejected request: the transport helper rejects on a
 * transport failure AND on a non-JSON body (the endpoint answered, just
 * not with JSON — a permanent answer). Only the transport failure is
 * transient; the other keeps its own message, which names the status.
 * @param {Error} err - The rejection
 * @param {string} what - What was being read, for the message
 * @returns {Error} The error to throw
 */
function requestFailure(err, what) {
  if (err.nonJsonBody) return err;
  return transientError(`Cannot reach the Keycloak admin API for ${what}: ${err.message}`);
}

/**
 * The body of a failed response, rendered for a message.
 * @param {{data: *}} res - The response
 * @returns {string} The body as text
 */
function bodyText(res) {
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
}

// The account the create answered for is gone: a concurrent cleanup or an
// operator purge deleted it between two requests. The verdict is FATAL —
// the converge-only contract deliberately has no self-heal (a retry would
// recreate the account), so the message must name the cause instead.
const ACCOUNT_VANISHED = 'the account was deleted mid-provisioning (a concurrent cleanup or an operator purge)';

// The transient retry waits on a CONDITION (Keycloak answering without a
// transient verdict), bounded by a deadline rather than by a fixed number
// of attempts: the pause between attempts grows, and the budget expires
// into a failure that names the last observed error.
const TRANSIENT_RETRY_BUDGET_MS = 30000;
const TRANSIENT_RETRY_BASE_PAUSE_MS = 2000;

/**
 * The users of a realm matching ONE field exactly.
 * exact=true: ?username= is a prefix search otherwise — a stray
 * testadmin2 would misdirect the role assignment to data[0].
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {string} field - The search field ('username', 'email')
 * @param {string} value - The exact value
 * @returns {Promise<object[]>} The matching user representations
 */
async function findUsers(adminToken, realm, field, value, { exact = true } = {}) {
  let searchRes;
  try {
    const exactParam = exact ? '&exact=true' : '';
    searchRes = await request(
      'GET',
      `/auth/admin/realms/${realm}/users?${field}=${encodeURIComponent(value)}${exactParam}`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );
  } catch (err) {
    // A transport-level failure (connection refused, timeout) is the same
    // transient condition as the create's own: the retry budget must be
    // allowed to save the provisioning.
    const error = requestFailure(err, `the user lookup of ${value}`);
    error.lookupFailed = true;
    throw error;
  }

  // The status and the payload shape are checked: an expired admin token
  // answers 401 with an error body, and indexing that body would resolve
  // an undefined user instead of naming the cause.
  if (searchRes.status !== 200) {
    // The status travels with the error: the caller decides what it means
    // for its own operation (the retry budget re-derives the verdict).
    const error = new Error(`User lookup for ${value} in realm ${realm} failed: HTTP ${searchRes.status}`);
    error.lookupFailed = true;
    error.httpStatus = searchRes.status;
    throw error;
  }
  if (!Array.isArray(searchRes.data)) {
    // A broken answer is a failed lookup, but Keycloak said nothing
    // about a status: the marker that says so is `lookupFailed`, and
    // `httpStatus` stays unset (a 200 there would read as a verdict).
    const error = new Error(`User lookup for ${value} in realm ${realm} answered a non-array payload`);
    error.lookupFailed = true;
    error.invalidPayload = true;
    throw error;
  }
  return searchRes.data;
}

/**
 * The accounts that own an email address. The realm rejects a duplicate
 * email case-insensitively, so an owner whose address differs only in case
 * still conflicts: the exact lookup is widened to a case-insensitive match
 * when it finds nothing.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {string} email - The email address
 * @returns {Promise<object[]>} The accounts owning that address
 */
async function emailOwners(adminToken, realm, email) {
  const exact = await findUsers(adminToken, realm, 'email', email);
  if (exact.length > 0) return exact;

  const wanted = email.toLowerCase();
  const candidates = await findUsers(adminToken, realm, 'email', email, { exact: false });
  return candidates.filter((user) => (user.email || '').toLowerCase() === wanted);
}

/**
 * Resolve a user in a realm by exact username.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {string} username - Exact username
 * @returns {Promise<object>} The Keycloak user representation
 */
async function resolveUser(adminToken, realm, username) {
  const users = await findUsers(adminToken, realm, 'username', username);
  if (users.length === 0) {
    throw new Error(`User ${username} not found in realm ${realm}`);
  }
  return users[0];
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
  let res;
  try {
    res = await request('GET', `/auth/admin/realms/${realm}/roles/${encodeURIComponent(roleName)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  } catch (err) {
    // A transport-level failure is the same transient condition as the
    // create's own: the retry budget must be allowed to save the run.
    throw requestFailure(err, `the realm role ${roleName}`);
  }
  if (res.status === 200) {
    // A 200 with no usable representation is a broken answer, not a role:
    // the callers index role.id on it.
    if (!res.data || typeof res.data !== 'object' || !res.data.id) {
      throw new Error(
        `The realm role ${roleName} of ${realm} answered HTTP 200 without a usable representation: ${bodyText(res)}`
      );
    }
    return res.data;
  }
  if (res.status === 404) return null;
  failWithStatus(`Cannot read the realm role ${roleName} of ${realm}: HTTP ${res.status} ${bodyText(res)}`, res.status);
}

/**
 * Resolve realm roles by exact name.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {string[]} roleNames - Exact realm role names
 * @returns {Promise<{roles: object[], missing: string[]}>} The resolved
 *   roles ({id, name}) and the names the realm does not carry
 */
async function resolveRealmRoles(adminToken, realm, roleNames) {
  const roles = [];
  const missing = [];
  for (const name of new Set(roleNames)) {
    const role = await findRealmRole(adminToken, realm, name);
    if (role) roles.push({ id: role.id, name: role.name });
    else missing.push(name);
  }
  if (missing.length > 0) {
    // Keycloak answers 404 on the role endpoint for a role the realm does
    // not carry AND for a realm that does not exist. One realm read tells
    // the two apart: a missing realm is a broken venue (fatal), a missing
    // role is a plain "not granted here". Any other verdict is the
    // Keycloak's own — an expired admin token answers 401, and that must
    // not be reported as a missing realm.
    let realmRes;
    try {
      realmRes = await request('GET', `/auth/admin/realms/${realm}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    } catch (err) {
      throw requestFailure(err, `the realm ${realm}`);
    }
    if (realmRes.status === 404) {
      // The realm itself is gone. The caller decides what that means: the
      // assignment side fails loudly (the venue must exist), the removal
      // side has nothing left to remove.
      return { roles, missing, realmMissing: true };
    }
    if (realmRes.status !== 200) {
      failWithStatus(`Cannot read the realm ${realm}: HTTP ${realmRes.status} ${bodyText(realmRes)}`, realmRes.status);
    }
  }
  return { roles, missing, realmMissing: false };
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

  const {
    roles: rolesToAssign,
    missing: missingRoles,
    realmMissing,
  } = await resolveRealmRoles(adminToken, realm, roleNames);
  if (realmMissing) {
    throw new Error(`The realm ${realm} does not exist — the venue is not provisioned`);
  }
  if (missingRoles.length > 0) {
    throw new Error(`Roles not found in realm ${realm}: ${missingRoles.join(', ')}`);
  }

  const assignRes = await request('POST', `/auth/admin/realms/${realm}/users/${userId}/role-mappings/realm`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    body: rolesToAssign,
  });
  if (assignRes.status !== 204 && assignRes.status !== 200) {
    failWithStatus(
      `Failed to assign the realm roles ${roleNames.join(', ')} to ${userId}: HTTP ${assignRes.status}`,
      assignRes.status
    );
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

  // A role the realm does not carry cannot be mapped on the user, so a
  // 404 lookup is a skip — the same semantics the assignment side treats
  // as a hard failure, because removal has no state to protect.
  const { roles: toRemove, realmMissing } = await resolveRealmRoles(adminToken, realm, roleNames);
  if (realmMissing) return [];
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
    throw new Error(`Cannot read the effective realm roles of ${userId}: HTTP ${res.status} ${bodyText(res)}`);
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
    failWithStatus(`Failed to provision user ${username}: HTTP ${status} ${bodyText(res)}`, status);
  }

  let user;
  try {
    user = await resolveUser(adminToken, realm, username);
  } catch (err) {
    if (err.lookupFailed) {
      // The lookup itself failed (an expired admin token answers 401, a
      // transport break is transient): the account's state is unknown, so
      // no diagnosis about it is possible — and a transient failure must
      // keep its verdict for the retry budget.
      if (err.httpStatus !== undefined) {
        failWithStatus(err.message, err.httpStatus);
      }
      throw err;
    }
    if (status === 409) {
      // The create answered 409 but no account carries the username: the
      // conflict has two live causes. ANOTHER account may own the fixture
      // email (the realm forbids duplicate emails), or the account that
      // answered 409 was DELETED between the create and this lookup (a
      // concurrent cleanup, an operator purge). An email-ownership probe
      // separates them — blaming a vanished account on an email conflict
      // sends the operator hunting for a conflict that does not exist.
      let owners;
      try {
        owners = await emailOwners(adminToken, realm, email);
      } catch (probeErr) {
        if (probeErr.httpStatus !== undefined) {
          // Keycloak answered: the probe's verdict is the cause (an
          // expired admin token answers 401, a rate limit 429 — the
          // latter is transient and the retry budget may save the run).
          failWithStatus(
            `${err.message} — the create answered 409, but the email-ownership probe for ${email} ` +
              `could not run (HTTP ${probeErr.httpStatus})`,
            probeErr.httpStatus
          );
        }
        if (probeErr.invalidPayload || probeErr.nonJsonBody) {
          // Keycloak answered — with a broken payload or with something
          // that is not JSON. The probe could not run, and that is not a
          // transport break: retrying it would only burn the budget.
          throw new Error(
            `${err.message} — the create answered 409, but the email-ownership probe for ${email} ` +
              `could not run: ${probeErr.message}`
          );
        }
        // A transport-level failure of the probe is transient, exactly like
        // the create's own: it must not kill a provisioning that the
        // deadline-based retry exists to save.
        throw transientError(
          `Cannot reach the Keycloak admin API for the email-ownership probe of ${email}: ${probeErr.message}`
        );
      }
      if (owners.length > 0) {
        throw new Error(
          `${err.message} — the create answered 409 because ${owners[0].username} owns ` +
            `${email}: an email conflict; remove or rename that account (or change the fixture email)`
        );
      }
      throw new Error(
        `${err.message} — the create answered 409, but no account carries ${email} either: ` +
          `the account named ${username} existed at create time and ${ACCOUNT_VANISHED}; re-run the provisioning`
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
    if (resetRes.status === 404) {
      // The account was just looked up by its exact username: a 404 here
      // means it was deleted between that lookup and this reset — not a
      // password problem. The verdict is fatal (the converge-only contract
      // has no self-heal), and the message names the cause.
      throw new Error(
        `Cannot converge the password of ${username} (${user.id}): HTTP 404 — the account ` +
          `was deleted between the lookup and the password reset, so ${ACCOUNT_VANISHED}; re-run the provisioning`
      );
    }
    if (resetRes.status !== 204) {
      failWithStatus(`Failed to converge the password of ${username}: HTTP ${resetRes.status}`, resetRes.status);
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
  convergeUser,
  assignRealmRoles,
  removeRealmRoles,
  effectiveRealmRoles,
  rotateRealmKeys,
  getRealmSettings,
  updateRealmSettings,
  deleteUser,
  enableDirectAccessGrants,
};
