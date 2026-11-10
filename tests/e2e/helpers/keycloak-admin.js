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
function transientError(message, options) {
  const error = new Error(message, options);
  error.transient = true;
  return error;
}

const TRANSIENT_STATUSES = [408, 425, 429];

/**
 * Is this status a failure a later attempt may survive? A 5xx is an
 * outage, a 408/425/429 is a rate-limited or retryable answer; anything
 * else is a real failure.
 * @param {number} status - The HTTP status
 * @returns {boolean} True when a later attempt may survive the status
 */
function isTransientStatus(status) {
  return status >= 500 || TRANSIENT_STATUSES.includes(status);
}

/**
 * Fail with the verdict a status deserves: a 5xx or a 408/425/429 is a
 * failure a later attempt may survive (transient), anything else is a
 * real failure. The status travels with the error, so the caller can
 * re-derive the verdict for its own operation.
 * @param {string} message - The diagnosis
 * @param {number} status - The HTTP status
 * @throws {Error} The error — transient when the status is transient
 */
function failWithStatus(message, status) {
  const error = isTransientStatus(status) ? transientError(message) : new Error(message);
  error.httpStatus = status;
  throw error;
}

/**
 * The verdict for a rejected request: the transport helper rejects on a
 * transport failure AND on a body that is not JSON (the endpoint
 * answered, just not with JSON). The verdict follows the server's state:
 * a 5xx is an outage a retry may survive, a 4xx is permanent, and a
 * rejection without a status is a transport break.
 *
 * Every verdict names what was being read — a rejection that carries a
 * status names it too, so the reader never has to parse the URL out of
 * the transport string.
 * @param {Error} err - The rejection
 * @param {string} what - What was being read, for the message
 * @returns {Error} The error to throw
 */
function requestFailure(err, what) {
  if (err.status !== undefined) {
    // The endpoint ANSWERED — only its body was unusable (auth.js rejects
    // a non-JSON body and carries the status). The verdict says so: a
    // reader must not go hunting for a network fault when the admin API
    // answered 401 with an HTML error page.
    const answered = `The Keycloak admin API did not answer ${what} usably`;
    if (isTransientStatus(err.status)) {
      const error = transientError(`${answered}: ${err.message}`);
      error.httpStatus = err.status;
      return error;
    }
    // A permanent refusal: the rejection's non-JSON marker travels with
    // the verdict (the caller tells a broken answer from a transport break
    // by it), and the transport's own error travels as the cause. The
    // verdict carries no httpStatus of its own — that field means
    // "Keycloak answered with a status this module could read", which is
    // not what happened here: the answer's body was unusable.
    const error = new Error(`${answered}: ${err.message}`, { cause: err });
    if (err.nonJsonBody) error.nonJsonBody = true;
    return error;
  }
  return transientError(`Cannot reach the Keycloak admin API for ${what}: ${err.message}`);
}

/**
 * The body of a failed response, rendered for a message.
 * @param {{data: *}} res - The response
 * @returns {string} The body as text
 */
function bodyText(res) {
  if (res.data === undefined || res.data === null) return '(no body)';
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
}

// The payload shapes a read can expect: a LIST of representations, or a
// single REPRESENTATION carrying the id its caller indexes. The descriptor
// travels with the read, so there is no name to mistype and no shape a
// read site can silently fall through.
const ARRAY_SHAPE = {
  ok: (data) => Array.isArray(data),
  complaint: 'with a non-array payload',
};
const REPRESENTATION_SHAPE = {
  ok: (data) => Boolean(data) && typeof data === 'object' && Boolean(data.id),
  complaint: 'without a usable representation',
};

/**
 * The verdict for a payload that does not carry the shape the read
 * expected: an error body indexed as a list (or as a role) resolves an
 * undefined entry instead of naming the cause.
 * @param {string} what - What was being read, for the verdict
 * @param {{data: *}} res - The response
 * @param {{ok: function, complaint: string}} shape - ARRAY_SHAPE or
 *   REPRESENTATION_SHAPE
 * @throws {Error} The verdict — flagged as an invalid payload
 */
function assertPayloadShape(what, res, shape) {
  if (shape.ok(res.data)) return;
  // The verdict reads as a sentence, so the subject starts capitalized.
  const subject = what.charAt(0).toUpperCase() + what.slice(1);
  const error = new Error(`${subject} answered HTTP 200 ${shape.complaint}: ${bodyText(res)}`);
  error.invalidPayload = true;
  throw error;
}

/**
 * Send one admin-API request and map a transport rejection to the
 * module's verdict: the answer, or the failure the request produced.
 * @param {string} method - HTTP method
 * @param {string} path - The admin API path
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} what - What was being asked for, for the verdict
 * @param {object} [body] - The request body
 * @returns {Promise<object>} The response
 */
async function adminRequest(method, path, adminToken, what, body) {
  try {
    return await request(method, path, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body,
    });
  } catch (err) {
    throw requestFailure(err, what);
  }
}

/**
 * Read one resource from the Keycloak admin API and verify the answer:
 * a transport failure and a refused status each get the module's verdict,
 * and the verdict names what was being read.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} path - The admin API path to read
 * @param {string} what - What was being read, for the verdicts
 * @param {object} [options] - What the read expects of the answer
 * @param {number} [options.absentStatus] - The status the caller answers
 *   itself (a 404 that means "not there", not "failed")
 * @param {string} [options.shape] - The payload shape the answer must carry
 * @returns {Promise<object|null>} The response, or null when the answer was
 *   the absent status
 */
async function readAdminApi(adminToken, path, what, options = {}) {
  const res = await adminRequest('GET', path, adminToken, what);
  if (options.absentStatus !== undefined && res.status === options.absentStatus) {
    // Absence is a VALUE, not a status the caller has to remember to
    // re-inspect: a read site that forgets the check would read an absent
    // role as a present one.
    return null;
  }
  if (res.status !== 200) {
    failWithStatus(`Cannot read ${what}: HTTP ${res.status} ${bodyText(res)}`, res.status);
  }
  if (options.shape) {
    assertPayloadShape(what, res, options.shape);
  }
  return res;
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

// The operator wording of the two 409-conflict verdicts, shared by
// createUser and convergeUser so the diagnosis reads the same whichever
// entry point hit it.
const EMAIL_CONFLICT_VERDICT = (missMessage, owner, email) =>
  `${missMessage} — the create answered 409 because ${owner} owns ` +
  `${email}: an email conflict; remove or rename that account (or change the fixture email)`;
const ACCOUNT_VANISHED_VERDICT = (missMessage, username, email) =>
  `${missMessage} — the create answered 409, but no account carries ${email} either: ` +
  `the account named ${username} existed at create time and ${ACCOUNT_VANISHED}; re-run the provisioning`;

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
async function findUsers(adminToken, realm, field, value) {
  try {
    // The status and the payload shape are checked like every other read: an
    // expired admin token answers 401 with an error body, and indexing that
    // body would resolve an undefined user instead of naming the cause.
    const searchRes = await readAdminApi(
      adminToken,
      `/auth/admin/realms/${realm}/users?${field}=${encodeURIComponent(value)}&exact=true`,
      `the user lookup of ${value} in realm ${realm}`,
      { shape: ARRAY_SHAPE }
    );
    return searchRes.data;
  } catch (err) {
    // Every way the lookup fails says the same thing to the callers: the
    // account's state is unknown, so no diagnosis about it is possible.
    err.lookupFailed = true;
    throw err;
  }
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
  const res = await readAdminApi(
    adminToken,
    `/auth/admin/realms/${realm}/roles/${encodeURIComponent(roleName)}`,
    `the realm role ${roleName} of ${realm}`,
    {
      // A 404 is not a failed read: the realm may simply carry no role of
      // that name — the single-role endpoint answers 404 for a missing role
      // as well as for a missing realm, and resolveRealmRoles tells the two
      // apart with a realm read.
      absentStatus: 404,
      // A 200 with no usable representation is a broken answer, not a role:
      // the callers index role.id on it.
      shape: REPRESENTATION_SHAPE,
    }
  );
  if (res === null) return null;
  return res.data;
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
    const realmRes = await readAdminApi(adminToken, `/auth/admin/realms/${realm}`, `the realm ${realm}`, {
      absentStatus: 404,
    });
    if (realmRes === null) {
      // The realm itself is gone. The caller decides what that means: the
      // assignment side fails loudly (the venue must exist), the removal
      // side has nothing left to remove.
      return { roles, missing, realmMissing: true };
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

  const assignRes = await adminRequest(
    'POST',
    `/auth/admin/realms/${realm}/users/${userId}/role-mappings/realm`,
    adminToken,
    `the assignment of the realm roles ${roleNames.join(', ')} to ${userId}`,
    rolesToAssign
  );
  if (assignRes.status !== 204 && assignRes.status !== 200) {
    failWithStatus(
      `Failed to assign the realm roles ${roleNames.join(', ')} to ${userId}: HTTP ${assignRes.status} ${bodyText(
        assignRes
      )}`,
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

  const userRes = await adminRequest(
    'POST',
    `/auth/admin/realms/${realm}/users`,
    adminToken,
    `the creation of ${username} in realm ${realm}`,
    {
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
              temporary: false,
            },
          ]
        : undefined,
    }
  );

  if (userRes.status !== 201 && userRes.status !== 409) {
    failWithStatus(`Failed to create user ${username}: HTTP ${userRes.status} ${bodyText(userRes)}`, userRes.status);
  }

  let user;
  try {
    user = await resolveUser(adminToken, realm, username);
  } catch (err) {
    if (err.lookupFailed) {
      // The lookup itself failed (an expired admin token answers 401, a
      // transport break): the account's state is unknown, so no diagnosis
      // about it is possible. The verdict carries the server's state (a 5xx
      // is transient); createUser has no retry budget, so that flag is
      // inert here — no caller retries a create.
      throw err;
    }
    if (userRes.status === 409) {
      // The create answered 409 but no account carries the username: the
      // conflict has two live causes — another account may own the fixture
      // email (the realm forbids duplicate emails), or the account that
      // answered 409 was DELETED between the create and this lookup. The
      // email-ownership probe separates them (the same diagnosis
      // convergeUser runs); createUser has no retry budget, so a failed
      // probe is a plain failure naming the cause, not a transient one.
      let owners;
      try {
        owners = await findUsers(adminToken, realm, 'email', email);
      } catch (probeErr) {
        if (probeErr.httpStatus !== undefined) {
          // Keycloak answered: the probe's verdict is the cause (an expired
          // admin token answers 401, a rate limit 429). createUser has no
          // retry budget, so the failure stays a plain one — but it must
          // name the status, or the caller cannot tell a rate limit from
          // an expired admin token.
          throw new Error(
            `${err.message} — the create answered 409, but the email-ownership probe for ${email} ` +
              `could not run (HTTP ${probeErr.httpStatus})`,
            { cause: probeErr }
          );
        }
        throw new Error(
          `${err.message} — the create answered 409, but the email-ownership probe for ${email} ` +
            `could not run: ${probeErr.message}`,
          { cause: probeErr }
        );
      }
      if (owners.length > 0) {
        throw new Error(EMAIL_CONFLICT_VERDICT(err.message, owners[0].username, email), { cause: err });
      }
      throw new Error(ACCOUNT_VANISHED_VERDICT(err.message, username, email), { cause: err });
    }
    throw err;
  }
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

  const res = await adminRequest(
    'DELETE',
    `/auth/admin/realms/${realm}/users/${userId}/role-mappings/realm`,
    adminToken,
    `the removal of the realm roles of ${userId}`,
    toRemove
  );
  if (res.status !== 204) {
    failWithStatus(`Failed to remove the realm roles of ${userId}: HTTP ${res.status} ${bodyText(res)}`, res.status);
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
  const res = await readAdminApi(
    adminToken,
    `/auth/admin/realms/${realm}/users/${userId}/role-mappings/realm/composite`,
    `the effective realm roles of ${userId}`,
    { shape: ARRAY_SHAPE }
  );
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

  const res = await adminRequest(
    'POST',
    `/auth/admin/realms/${realm}/users`,
    adminToken,
    `the creation of ${username} in realm ${realm}`,
    {
      username,
      email,
      firstName: userData.firstName || username,
      lastName: userData.lastName || 'Test',
      enabled: true,
      emailVerified: true,
      credentials: password ? [{ type: 'password', value: password, temporary: false }] : undefined,
    }
  );

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
      // no diagnosis about it is possible. The verdict carries the
      // server's state — the retry budget reads it.
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
        // The exact lookup is enough: Keycloak stores emails lowercased and
        // its exact search compares them case-insensitively (measured on
        // the live realm), so an owner that differs only in case is found.
        owners = await findUsers(adminToken, realm, 'email', email);
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
              `could not run: ${probeErr.message}`,
            { cause: probeErr }
          );
        }
        // A transport-level failure of the probe is transient, exactly like
        // the create's own: it must not kill a provisioning that the
        // deadline-based retry exists to save. The probe's verdict already
        // names the operation — it is kept whole, with the diagnosis step
        // added after it, so no verdict is stitched inside another.
        throw transientError(`${probeErr.message} (while running the email-ownership probe of ${email})`, { cause: probeErr });
      }
      if (owners.length > 0) {
        throw new Error(EMAIL_CONFLICT_VERDICT(err.message, owners[0].username, email), { cause: err });
      }
      throw new Error(ACCOUNT_VANISHED_VERDICT(err.message, username, email), { cause: err });
    }
    throw err;
  }

  if (status === 409 && password) {
    // Converge the password: an account carried over from an earlier
    // fixture revision keeps its old one, and the realm refuses direct
    // access grants, so nothing else can detect the drift.
    const resetRes = await adminRequest(
      'PUT',
      `/auth/admin/realms/${realm}/users/${user.id}/reset-password`,
      adminToken,
      `the password convergence of ${username} (${user.id})`,
      { type: 'password', value: password, temporary: false }
    );
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
      failWithStatus(
        `Failed to converge the password of ${username}: HTTP ${resetRes.status} ${bodyText(resetRes)}`,
        resetRes.status
      );
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
  for (let attempt = 1; ; attempt++) {
    try {
      return await convergeUser(adminToken, realm, userData);
    } catch (err) {
      // A non-transient error is a real failure: it propagates at once.
      if (!err.transient) throw err;
      // The budget expired while Keycloak kept answering transiently:
      // the wait ends in a FAILURE carrying the last observed error.
      if (Date.now() >= deadline) {
        throw new Error(
          `Keycloak kept answering transiently for ${TRANSIENT_RETRY_BUDGET_MS}ms while ` +
            `provisioning ${userData.username}: ${err.message}`,
          { cause: err }
        );
      }
      // Back off between attempts: the pause grows so a struggling
      // Keycloak is not hammered, and it stays inside the deadline.
      const pause = Math.min(TRANSIENT_RETRY_BASE_PAUSE_MS * attempt, deadline - Date.now());
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
  }
}

// The key providers a signing rotation may demote. Keycloak 26 creates
// four of them in a realm: rsa-generated (SIG), rsa-enc-generated (ENC),
// hmac-generated (SIG) and aes-generated (ENC).
//
// The provider id is the only signal the components API carries: it
// strips every config entry a provider does not declare, and the key
// providers declare only priority, enabled, active and key size — the
// use of a key is not in the answer. A realm that kept an old
// rsa-generated provider configured for encryption therefore reads back
// as a signing provider.
const RSA_SIGNING_PROVIDER_IDS = new Set(['rsa', 'rsa-generated']);

// The name prefix the rotation gives the key it mints.
const ROTATED_KEY_NAME_PREFIX = 'rsa-generated-rotated-';

/**
 * The value of a component's config entry. Keycloak stores the config
 * values as lists of strings, one value per entry.
 * @param {object} component - The key provider component
 * @param {string} key - The config key
 * @returns {string} The value, or '' when the config carries no value
 */
function configValue(component, key) {
  const raw = component.config && component.config[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Is this key provider an RSA signing key — the only kind a signing
 * rotation demotes? The HMAC and AES providers and the RSA encryption
 * provider must survive the rotation: deactivating them breaks the
 * HMAC-signed tokens and the token encryption, which is not what a
 * rotation is for.
 * @param {object} component - The key provider component
 * @returns {boolean} True when the provider is an RSA signing key
 */
function isRsaSigningKey(component) {
  return RSA_SIGNING_PROVIDER_IDS.has(component.providerId);
}

/**
 * Is this key provider the active one for its use? Keycloak derives the
 * key status from the two flags: a provider that carries neither is
 * active and enabled, enabled=false is DISABLED (it never signs and is
 * not published) and active=false is PASSIVE (published, but it does
 * not sign).
 * @param {object} component - The key provider component
 * @returns {boolean} True when the provider is the active one
 */
function isActiveKey(component) {
  return configValue(component, 'enabled') !== 'false' && configValue(component, 'active') !== 'false';
}

/**
 * Mint a new RSA signing key for the realm and return its component id.
 * The components API answers 201 with an EMPTY body — auth.request
 * resolves an empty body as data: null — and the new component id in
 * the Location header (/…/components/<id>): the id is read from the
 * header, never from the body.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @param {string} realmId - The realm uuid, the parent of the component
 * @returns {Promise<string>} The id of the new key component
 */
async function createRotatedKey(adminToken, realm, realmId) {
  const rotatedKeyName = `${ROTATED_KEY_NAME_PREFIX}${Date.now()}`;
  const newKeyRes = await adminRequest(
    'POST',
    `/auth/admin/realms/${realm}/components`,
    adminToken,
    `the creation of the rotated key ${rotatedKeyName}`,
    {
      name: rotatedKeyName,
      providerId: 'rsa-generated',
      providerType: 'org.keycloak.keys.KeyProvider',
      parentId: realmId,
      config: {
        priority: ['101'],
        enabled: ['true'],
        active: ['true'],
        keySize: ['2048'],
      },
    }
  );

  if (newKeyRes.status !== 201) {
    failWithStatus(`Failed to generate new key: HTTP ${newKeyRes.status} ${bodyText(newKeyRes)}`, newKeyRes.status);
  }

  const location = newKeyRes.headers && newKeyRes.headers.location;
  const createdKeyId = location && (location.match(/\/components\/([^/?]+)\/?$/) || [])[1];
  if (!createdKeyId) {
    // The key component was already created and is the realm's ACTIVE
    // signer, but its id is untracked: the message must say so, or a
    // re-run accumulates untracked active rotated keys.
    throw new Error(
      `Failed to generate new key: Keycloak answered 201 without a usable Location header ` +
        `(${location || 'none'}) — the new key id cannot be resolved. The key component ${rotatedKeyName} ` +
        `was already created and is the active signer but is untracked: delete it or resolve its id ` +
        `via the components list before re-running`
    );
  }
  return createdKeyId;
}

/**
 * Rotate realm signing keys: generate a new RSA key and demote the old one.
 * Uses the Keycloak 26 components API (no /keys POST endpoint exists).
 * The rotation demotes the RSA SIGNING providers only, and it reuses the
 * active key a previous rotation already minted instead of creating a
 * second one.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @returns {Promise<{newKeyId: string, oldKeyIds: string[]}>} The active
 *   signing key and the ids of the RSA signing keys it demoted
 */
async function rotateRealmKeys(adminToken, realm) {
  // Get realm UUID (parentId for key components)
  const realmId = (await getRealmSettings(adminToken, realm)).id;

  // Get existing key providers. The status and the payload shape are
  // checked like every other read: an expired admin token answers 401
  // with an error body that .map() would choke on without a verdict, and
  // a 200 with a non-array payload is a broken answer — reading it as an
  // empty key set would create the new key and demote nothing.
  const keysRes = await readAdminApi(
    adminToken,
    `/auth/admin/realms/${realm}/components?type=org.keycloak.keys.KeyProvider`,
    `the existing key providers of ${realm}`,
    { shape: ARRAY_SHAPE }
  );
  const existingKeys = keysRes.data;

  // A re-run must not mint a second active rotated key: when the realm
  // already carries an active key a previous rotation minted, that key IS
  // the rotation's key and the rotation continues from it. The candidate
  // must be an RSA signing key: a provider that carries the rotated name
  // but serves another purpose is not a signer, and adopting it would
  // demote the realm's real signer.
  const reusableKey = existingKeys.find(
    (k) =>
      typeof k.name === 'string' &&
      k.name.startsWith(ROTATED_KEY_NAME_PREFIX) &&
      isRsaSigningKey(k) &&
      isActiveKey(k)
  );

  const newKeyId = reusableKey ? reusableKey.id : await createRotatedKey(adminToken, realm, realmId);

  // Demote the old RSA signing keys (set active to false). The key the
  // rotation keeps — the reused one or the one it just created — is the
  // realm's active signer and stays untouched.
  const keysToDemote = existingKeys.filter((k) => isRsaSigningKey(k) && k.id !== newKeyId);
  for (const oldKey of keysToDemote) {
    const updatedConfig = { ...oldKey.config, active: ['false'] };
    let res;
    try {
      res = await adminRequest(
        'PUT',
        `/auth/admin/realms/${realm}/components/${oldKey.id}`,
        adminToken,
        `the demotion of key ${oldKey.id}`,
        { ...oldKey, config: updatedConfig }
      );
    } catch (failure) {
      // A transport break here is past the mutation boundary: the new key
      // already exists and signs, so the verdict must not bypass the
      // re-run-safety diagnosis.
      failure.message +=
        ` — the new rotated key ${newKeyId} was already created and is the active signer: ` +
        `a re-run must NOT create a second rotated key (reuse or delete ${newKeyId})`;
      throw failure;
    }
    if (res.status !== 204) {
      // The realm is half-mutated: the new key signs while this old key
      // stayed active. The message names the new key so a re-run does not
      // create a second rotated key.
      throw new Error(
        `Failed to demote key ${oldKey.id}: HTTP ${res.status} ${bodyText(res)} — the new rotated key ` +
          `${newKeyId} was already created and is the active signer: a re-run must NOT create a ` +
          `second rotated key (reuse or delete ${newKeyId})`
      );
    }
  }

  return { newKeyId, oldKeyIds: keysToDemote.map((k) => k.id) };
}

/**
 * Read a realm's settings.
 * @param {string} adminToken - Keycloak admin access token
 * @param {string} realm - Realm name
 * @returns {Promise<object>} The realm representation
 */
async function getRealmSettings(adminToken, realm) {
  // The realm representation carries the id its caller indexes (the key
  // rotation parents the new key on it) — a 200 without one is a broken
  // answer, not a realm.
  const res = await readAdminApi(adminToken, `/auth/admin/realms/${realm}`, `the realm settings of ${realm}`, {
    shape: REPRESENTATION_SHAPE,
  });
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
  const res = await adminRequest(
    'PUT',
    `/auth/admin/realms/${realm}`,
    adminToken,
    `the realm settings update of ${realm}`,
    settings
  );

  if (res.status !== 204) {
    failWithStatus(`Failed to update the realm settings of ${realm}: HTTP ${res.status} ${bodyText(res)}`, res.status);
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
  const res = await adminRequest(
    'DELETE',
    `/auth/admin/realms/${realm}/users/${userId}`,
    adminToken,
    `the deletion of user ${userId}`
  );

  // 404 means the user is already gone — that IS the end state every
  // caller wants (no test account left behind). Anything else is a real
  // failure and must fail the cleanup that asked for it.
  if (res.status !== 204 && res.status !== 404) {
    failWithStatus(`Failed to delete user ${userId}: HTTP ${res.status} ${bodyText(res)}`, res.status);
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

  const searchRes = await readAdminApi(
    adminToken,
    `/auth/admin/realms/${realm}/clients?clientId=${encodeURIComponent(clientId)}`,
    `the client ${clientId} of ${realm}`,
    { shape: ARRAY_SHAPE }
  );

  // An empty list is the admin API's way of saying the realm carries no
  // client of that name — not an outage, and not a broken answer.
  if (searchRes.data.length === 0) {
    throw new Error(`Client ${clientId} not found in realm ${realm}`);
  }

  const client = searchRes.data[0];
  if (client.directAccessGrantsEnabled) return;

  const res = await adminRequest(
    'PUT',
    `/auth/admin/realms/${realm}/clients/${client.id}`,
    adminToken,
    `the ROPC enablement of ${clientId} in realm ${realm}`,
    { ...client, directAccessGrantsEnabled: true }
  );

  if (res.status !== 204) {
    failWithStatus(
      `Failed to enable direct access grants on ${clientId}: HTTP ${res.status} ${bodyText(res)}`,
      res.status
    );
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
