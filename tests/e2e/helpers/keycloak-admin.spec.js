const { test, expect } = require('@playwright/test');
const auth = require('./auth');
const { E2E_FIXTURES } = require('./e2e-fixtures');
const {
  assignRealmRoles,
  removeRealmRoles,
  convergeUser,
  effectiveRealmRoles,
  createUser,
  rotateRealmKeys,
  getRealmSettings,
  updateRealmSettings,
  deleteUser,
  enableDirectAccessGrants,
  findClient,
  createClient,
  deleteClient
} = require('./keycloak-admin');

/**
 * Unit spec for the Keycloak admin helper's role resolution and the
 * convergeUser failure diagnoses. The transport (auth.request) is faked
 * per test — the assertions here are about WHICH endpoints the helper
 * calls and HOW it reports failures, not about Keycloak itself, so no
 * venue is needed. The real transport is restored after every test.
 */

// The fake transport: a table of [method, pathRegex] → {status, data}
// (or {throws}), plus a call log and a body log the endpoint assertions
// read.
let routes;
let calls;
let bodies;

function fakeRequest(method, path, options = {}) {
  calls.push(`${method} ${path}`);
  bodies.push(options.body);
  for (const [m, pattern, answer] of routes) {
    if (m === method && pattern.test(path)) {
      if (answer.throws) return Promise.reject(answer.throws);
      // A stateful route derives its answer from the call log — the
      // same-URL-twice sequences (lookup before/after a convergence PUT)
      // answer differently without a mutable route table.
      const resolved = answer.compute ? answer.compute(calls) : answer;
      return Promise.resolve({ status: resolved.status, data: resolved.data, headers: resolved.headers });
    }
  }
  return Promise.reject(new Error(`fake transport: no route for ${method} ${path}`));
}

// The untouched transport, captured before any test swaps it.
const realRequest = auth.request;

// The fixture identity comes from the fixtures module — the same source
// the venue provisioning reads, so a fixture change moves the spec with
// it instead of silently invalidating the queries below.
const ADMIN_FIXTURE = E2E_FIXTURES.find((f) => f.username === 'testadmin');
if (!ADMIN_FIXTURE) {
  throw new Error('the venue fixtures no longer carry a testadmin account — the spec cannot name it');
}
const ADMIN_USER = {
  username: ADMIN_FIXTURE.username,
  email: ADMIN_FIXTURE.email,
  password: ADMIN_FIXTURE.password
};

const REALM = 'genie';
const ROLE_PATH = (name) => new RegExp(`/auth/admin/realms/${REALM}/roles/${name}$`);
const REALM_PATH = new RegExp(`/auth/admin/realms/${REALM}$`);
const COMPONENTS_PATH = new RegExp(`/auth/admin/realms/${REALM}/components`);
const ROLE_MAPPINGS_PATH = new RegExp(`/auth/admin/realms/${REALM}/users/user-1/role-mappings/realm$`);
const USERS_PATH = new RegExp(`/auth/admin/realms/${REALM}/users$`);
const USERNAME_LOOKUP = new RegExp(
  `/auth/admin/realms/${REALM}/users\\?username=${ADMIN_FIXTURE.username}&exact=true$`
);
const EMAIL_LOOKUP = new RegExp(
  `/auth/admin/realms/${REALM}/users\\?email=${encodeURIComponent(ADMIN_FIXTURE.email)}&exact=true$`
);
const RESET_PASSWORD_PATH = new RegExp(`/auth/admin/realms/${REALM}/users/user-1/reset-password$`);
const USER_PATH = new RegExp(`/auth/admin/realms/${REALM}/users/user-1$`);

// Shared 409-diagnosis routes: both convergeUser's and createUser's
// describes run the same shape, so one definition keeps them in
// lockstep.
const POST_USERS_409 = ['POST', USERS_PATH, { status: 409, data: null }];
const USERNAME_LOOKUP_MISS = ['GET', USERNAME_LOOKUP, { status: 200, data: [] }];
const EMAIL_PROBE = (data) => [['GET', EMAIL_LOOKUP, { status: 200, data }]];
// The username-lookup answer for ONE account representation — the shape
// every health/creation contract resolves against.
const LOOKUP = (user) => ['GET', USERNAME_LOOKUP, { status: 200, data: [user] }];
const HEALTHY_USER = () => ({ id: 'user-1', username: ADMIN_FIXTURE.username, enabled: true, emailVerified: true });
// The lookup answer of a fixture-HEALTHY account (enabled, verified, no
// pending action) — the state the converge contracts and the create-only
// contract both resolve against.
const HEALTHY_LOOKUP = LOOKUP(HEALTHY_USER());

/**
 * The rejection a call produced, for the assertions that read its
 * properties (the verdict flags, the status it carries).
 *
 * The runner's own `rejects.toMatchObject` does NOT enforce a regex
 * against a string property — a message assertion written that way
 * passes whatever the message says — so the message is asserted here,
 * on the error itself.
 * @param {Promise} promise - The call expected to be rejected
 * @returns {Promise<Error>} The rejection
 */
async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to be rejected — it resolved');
}

test.beforeEach(() => {
  routes = [];
  calls = [];
  bodies = [];
  auth.request = fakeRequest;
});

test.afterEach(() => {
  // auth.js is shared module state across the worker's tests: restore the
  // real transport so a failing fake can never leak into another spec.
  auth.request = realRequest;
});

test.describe('assignRealmRoles resolves roles through the single-role endpoint', () => {
  test('resolves the role by exact name and posts its id', async () => {
    routes = [
      ['GET', ROLE_PATH('admin'), { status: 200, data: { id: 'role-id-1', name: 'admin' } }],
      ['POST', ROLE_MAPPINGS_PATH, { status: 204, data: null }]
    ];

    await assignRealmRoles('tok', REALM, 'user-1', ['admin']);

    expect(calls).toEqual([
      `GET /auth/admin/realms/${REALM}/roles/admin`,
      `POST /auth/admin/realms/${REALM}/users/user-1/role-mappings/realm`
    ]);
  });

  test('names a missing role and never posts the assignment', async () => {
    // Keycloak answers an unknown role with 404 AND an error body: the
    // absence must read as an absence, not as the body the read site
    // would otherwise hand back as a role.
    routes = [
      ['GET', ROLE_PATH('ghost'), { status: 404, data: { error: 'Role not found' } }],
      ['GET', REALM_PATH, { status: 200, data: { realm: REALM } }]
    ];

    await expect(assignRealmRoles('tok', REALM, 'user-1', ['ghost'])).rejects.toThrow(
      'Roles not found in realm genie: ghost'
    );
    expect(calls).toEqual([`GET /auth/admin/realms/${REALM}/roles/ghost`, `GET /auth/admin/realms/${REALM}`]);
  });

  test('a 404 on a realm that does not exist fails loudly instead of blaming the role', async () => {
    routes = [
      ['GET', ROLE_PATH('admin'), { status: 404, data: null }],
      ['GET', REALM_PATH, { status: 404, data: null }]
    ];

    await expect(assignRealmRoles('tok', REALM, 'user-1', ['admin'])).rejects.toThrow(/The realm genie does not exist/);
    expect(calls).not.toContain(`POST /auth/admin/realms/${REALM}/users/user-1/role-mappings/realm`);
  });

  test('a realm read that the admin API refuses is not reported as a missing realm', async () => {
    routes = [
      ['GET', ROLE_PATH('admin'), { status: 404, data: null }],
      ['GET', REALM_PATH, { status: 401, data: { error: 'HTTP 401 Unauthorized' } }]
    ];

    await expect(assignRealmRoles('tok', REALM, 'user-1', ['admin'])).rejects.toThrow(
      /Cannot read the realm genie: HTTP 401/
    );
  });

  test('a 200 without a usable representation is a hard failure naming the role', async () => {
    routes = [['GET', ROLE_PATH('admin'), { status: 200, data: null }]];

    await expect(assignRealmRoles('tok', REALM, 'user-1', ['admin'])).rejects.toThrow(
      /answered HTTP 200 without a usable representation/
    );
  });

  test('a lookup the admin API refuses is a hard failure naming the role', async () => {
    routes = [['GET', ROLE_PATH('admin'), { status: 403, data: { error: 'forbidden' } }]];

    await expect(assignRealmRoles('tok', REALM, 'user-1', ['admin'])).rejects.toThrow(
      /Cannot read the realm role admin of genie: HTTP 403/
    );
    expect(calls).toEqual([`GET /auth/admin/realms/${REALM}/roles/admin`]);
  });

  test('a failed lookup with no body says so instead of printing undefined', async () => {
    routes = [['GET', ROLE_PATH('admin'), { status: 403, data: null }]];

    await expect(assignRealmRoles('tok', REALM, 'user-1', ['admin'])).rejects.toThrow(
      /Cannot read the realm role admin of genie: HTTP 403 \(no body\)/
    );
  });

  test('a Keycloak outage during the role lookup is transient, so the retry budget can save the run', async () => {
    routes = [['GET', ROLE_PATH('admin'), { status: 503, data: null }]];

    let caught;
    try {
      await assignRealmRoles('tok', REALM, 'user-1', ['admin']);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.transient).toBe(true);
    expect(caught.message).toMatch(/Cannot read the realm role admin of genie: HTTP 503/);
  });

  test('a non-JSON 5xx to the create is an outage: transient, so the retry budget saves the run', async () => {
    // A Keycloak rolling restart behind the proxy answers 503 with an HTML
    // page: the verdict follows the server's state, not the content type.
    const notJson = new Error('POST /auth/admin/realms/genie/users returned a non-JSON body (HTTP 503): <html>...');
    notJson.nonJsonBody = true;
    notJson.status = 503;
    routes = [['POST', USERS_PATH, { throws: notJson }]];

    let caught;
    try {
      await convergeUser('tok', REALM, ADMIN_USER);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.transient).toBe(true);
    expect(caught.message).toMatch(/non-JSON body \(HTTP 503\)/);
  });

  test('a non-JSON 4xx to the create is permanent', async () => {
    // The nginx HTML fallback for a wrong path answers 404 with HTML: the
    // endpoint answered, and no retry will change that.
    const notJson = new Error('POST /auth/admin/realms/genie/users returned a non-JSON body (HTTP 404): <html>...');
    notJson.nonJsonBody = true;
    notJson.status = 404;
    routes = [['POST', USERS_PATH, { throws: notJson }]];

    let caught;
    try {
      await convergeUser('tok', REALM, ADMIN_USER);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.transient).toBeFalsy();
    expect(caught.message).toMatch(/non-JSON body \(HTTP 404\)/);
  });

  test('a non-JSON answer is a permanent failure, not a transport break', async () => {
    // The nginx HTML fallback for a wrong path answers 404 with HTML: the
    // endpoint answered, so the retry budget must not burn on it.
    const notJson = new Error(
      'GET /auth/admin/realms/genie/roles/admin returned a non-JSON body (HTTP 404): <html>...'
    );
    notJson.nonJsonBody = true;
    notJson.status = 404;
    routes = [['GET', ROLE_PATH('admin'), { throws: notJson }]];

    let caught;
    try {
      await assignRealmRoles('tok', REALM, 'user-1', ['admin']);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.transient).toBeFalsy();
    expect(caught.message).toMatch(/non-JSON body \(HTTP 404\)/);
  });

  test('a transport failure during the role lookup is transient too', async () => {
    routes = [['GET', ROLE_PATH('admin'), { throws: new Error('connection reset by peer') }]];

    let caught;
    try {
      await assignRealmRoles('tok', REALM, 'user-1', ['admin']);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.transient).toBe(true);
    expect(caught.message).toMatch(/Cannot reach the Keycloak admin API for the realm role admin/);
  });
});

test.describe('removeRealmRoles', () => {
  test('removes an existing role mapping and reports the removed name', async () => {
    routes = [
      ['GET', ROLE_PATH('admin'), { status: 200, data: { id: 'role-id-1', name: 'admin' } }],
      ['DELETE', ROLE_MAPPINGS_PATH, { status: 204, data: null }]
    ];

    const removed = await removeRealmRoles('tok', REALM, 'user-1', ['admin']);

    expect(removed).toEqual(['admin']);
    expect(calls).toEqual([
      `GET /auth/admin/realms/${REALM}/roles/admin`,
      `DELETE /auth/admin/realms/${REALM}/users/user-1/role-mappings/realm`
    ]);
  });

  test('a role the realm does not carry is skipped without a DELETE', async () => {
    routes = [
      ['GET', ROLE_PATH('ghost'), { status: 404, data: null }],
      ['GET', REALM_PATH, { status: 200, data: { realm: REALM } }]
    ];

    const removed = await removeRealmRoles('tok', REALM, 'user-1', ['ghost']);

    expect(removed).toEqual([]);
    expect(calls).toEqual([`GET /auth/admin/realms/${REALM}/roles/ghost`, `GET /auth/admin/realms/${REALM}`]);
  });

  test('a transport break during the removal names the removal', async () => {
    // The removal side of the fixture provisioning: a break must carry
    // the transient verdict, like every other write in the module.
    routes = [
      ['GET', ROLE_PATH('admin'), { status: 200, data: { id: 'role-id-1', name: 'admin' } }],
      ['DELETE', ROLE_MAPPINGS_PATH, { throws: new Error('socket hang up') }]
    ];

    const caught = await rejection(removeRealmRoles('tok', REALM, 'user-1', ['admin']));

    expect(caught.transient).toBe(true);
    expect(caught.message).toMatch(/Cannot reach the Keycloak admin API for the removal of the realm roles of user-1/);
  });

  test('a realm that does not exist leaves nothing to remove', async () => {
    routes = [
      ['GET', ROLE_PATH('admin'), { status: 404, data: null }],
      ['GET', REALM_PATH, { status: 404, data: null }]
    ];

    const removed = await removeRealmRoles('tok', REALM, 'user-1', ['admin']);

    expect(removed).toEqual([]);
    expect(calls).not.toContain(`DELETE /auth/admin/realms/${REALM}/users/user-1/role-mappings/realm`);
  });
});

test.describe('effectiveRealmRoles reads the role MAPPINGS, not the realm role list', () => {
  test('returns the effective names from the composite mappings and never reads the roles listing', async () => {
    const composite = new RegExp(`/auth/admin/realms/${REALM}/users/user-1/role-mappings/realm/composite$`);
    routes = [
      [
        'GET',
        composite,
        {
          status: 200,
          data: [
            { id: 'r1', name: 'admin' },
            { id: 'r2', name: 'default-roles-genie' }
          ]
        }
      ]
    ];

    const effective = await effectiveRealmRoles('tok', REALM, 'user-1');

    expect(effective).toEqual(['admin', 'default-roles-genie']);
    // The listing endpoint is paginated — the effective roles are the
    // MAPPINGS of the user, so the listing must not be consulted.
    expect(calls.some((call) => call.endsWith(`/auth/admin/realms/${REALM}/roles`))).toBe(false);
  });
});

test.describe('convergeUser diagnoses a 409 whose username lookup misses', () => {
  test('an account owning the fixture email is named as an email conflict', async () => {
    routes = [
      POST_USERS_409,
      USERNAME_LOOKUP_MISS,
      ...EMAIL_PROBE([{ username: 'someone-else', email: ADMIN_FIXTURE.email }])
    ];

    await expect(convergeUser('tok', REALM, ADMIN_USER)).rejects.toThrow(
      new RegExp(`${ADMIN_FIXTURE.email}: an email conflict`)
    );
  });

  test('an empty email probe names the account as deleted mid-provisioning', async () => {
    routes = [POST_USERS_409, USERNAME_LOOKUP_MISS, ...EMAIL_PROBE([])];

    let caught;
    try {
      await convergeUser('tok', REALM, ADMIN_USER);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/was deleted mid-provisioning/);
    // Fatal, not transient: the converge-only contract has no self-heal
    // (a retry would recreate the account), so the message must name the
    // cause instead.
    expect(caught.transient).toBeFalsy();
  });

  test('a failed email probe fails loudly instead of guessing', async () => {
    routes = [POST_USERS_409, USERNAME_LOOKUP_MISS, ['GET', EMAIL_LOOKUP, { status: 403, data: null }]];

    await expect(convergeUser('tok', REALM, ADMIN_USER)).rejects.toThrow(
      new RegExp(`email-ownership probe for ${ADMIN_FIXTURE.email.replace('.', '\\.')} could not run \\(HTTP 403\\)`)
    );
  });

  test('a non-JSON probe answer is a permanent failure, not a transport break', async () => {
    // The nginx HTML fallback for a wrong path answers 404 with HTML: the
    // endpoint answered, so the retry budget must not burn on it.
    const notJson = new Error(
      'GET /auth/admin/realms/genie/users?email=testadmin%40e2e.test returned a non-JSON body (HTTP 404): <html>...'
    );
    notJson.nonJsonBody = true;
    notJson.status = 404;
    routes = [POST_USERS_409, USERNAME_LOOKUP_MISS, ['GET', EMAIL_LOOKUP, { throws: notJson }]];

    let caught;
    try {
      await convergeUser('tok', REALM, ADMIN_USER);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.transient).toBeFalsy();
    expect(caught.message).toMatch(/non-JSON body \(HTTP 404\)/);
  });

  test('a transport failure of the probe is transient, so the retry budget can save the provisioning', async () => {
    routes = [
      POST_USERS_409,
      USERNAME_LOOKUP_MISS,
      ['GET', EMAIL_LOOKUP, { throws: new Error('connection reset by peer') }]
    ];

    let caught;
    try {
      await convergeUser('tok', REALM, ADMIN_USER);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.transient).toBe(true);
    // The probe's verdict names the user lookup it ran; the diagnosis step
    // is named after it, not stitched into it.
    expect(caught.message).toMatch(/Cannot reach the Keycloak admin API for the user lookup of/);
    expect(caught.message).toMatch(/while running the email-ownership probe of/);
  });

  test('a username lookup that FAILED diagnoses nothing about the account', async () => {
    // The account's state is unknown when the lookup itself failed: the
    // email-ownership probe must not turn that into a conflict verdict.
    routes = [POST_USERS_409, ['GET', USERNAME_LOOKUP, { status: 500, data: null }]];

    let caught;
    try {
      await convergeUser('tok', REALM, ADMIN_USER);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/Cannot read the user lookup of testadmin in realm genie: HTTP 500/);
    expect(caught.message).not.toMatch(/email conflict|deleted mid-provisioning/);
    expect(calls.some((call) => call.includes('email='))).toBe(false);
    expect(caught.transient).toBe(true);
  });

  test('a transport failure of the username lookup stays transient and probes nothing', async () => {
    // A network blip is not a conflict: the probe must not turn it into a
    // hard "email conflict" verdict, and the retry budget must see it.
    routes = [POST_USERS_409, ['GET', USERNAME_LOOKUP, { throws: new Error('connection reset by peer') }]];

    let caught;
    try {
      await convergeUser('tok', REALM, ADMIN_USER);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.transient).toBe(true);
    expect(caught.message).not.toMatch(/email conflict/);
    expect(calls.some((call) => call.includes('email='))).toBe(false);
  });

  test('a broken lookup payload is a failed lookup, not a missing account', async () => {
    routes = [POST_USERS_409, ['GET', USERNAME_LOOKUP, { status: 200, data: { error: 'not a list' } }]];

    let caught;
    try {
      await convergeUser('tok', REALM, ADMIN_USER);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/answered HTTP 200 with a non-array payload/);
    expect(calls.some((call) => call.includes('email='))).toBe(false);
  });
});

test.describe('convergeUser diagnoses a password reset on a vanished account', () => {
  test('a 404 reset names the account as deleted between lookup and reset', async () => {
    routes = [
      ['POST', USERS_PATH, { status: 409, data: null }],
      HEALTHY_LOOKUP,
      ['PUT', RESET_PASSWORD_PATH, { status: 404, data: null }]
    ];

    let caught;
    try {
      await convergeUser('tok', REALM, ADMIN_USER);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/deleted between the lookup and the password reset/);
    expect(caught.transient).toBeFalsy();
  });
});

test.describe('createUser diagnoses a 409 whose username lookup misses', () => {
  test('an account owning the fixture email is named as an email conflict', async () => {
    routes = [
      POST_USERS_409,
      USERNAME_LOOKUP_MISS,
      ...EMAIL_PROBE([{ username: 'someone-else', email: ADMIN_FIXTURE.email }])
    ];

    await expect(createUser('tok', REALM, ADMIN_USER)).rejects.toThrow(
      new RegExp(`${ADMIN_FIXTURE.email.replaceAll('.', '\\.')}: an email conflict`)
    );
    expect(calls.some((call) => call.includes('email='))).toBe(true);
  });

  test('an empty email probe names the account as deleted mid-provisioning', async () => {
    routes = [POST_USERS_409, USERNAME_LOOKUP_MISS, ['GET', EMAIL_LOOKUP, { status: 200, data: [] }]];

    let caught;
    try {
      await createUser('tok', REALM, ADMIN_USER);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/was deleted mid-provisioning/);
    expect(caught.transient).toBeFalsy();
  });

  test('a failed email probe fails loudly instead of guessing', async () => {
    routes = [POST_USERS_409, USERNAME_LOOKUP_MISS, ['GET', EMAIL_LOOKUP, { status: 403, data: null }]];

    // The verdict names the status Keycloak answered: the caller must be
    // able to tell a rate limit from an expired admin token.
    await expect(createUser('tok', REALM, ADMIN_USER)).rejects.toThrow(
      new RegExp(`email-ownership probe for ${ADMIN_FIXTURE.email.replaceAll('.', '\\.')} could not run \\(HTTP 403\\)`)
    );
  });

  test('a username lookup that FAILED diagnoses nothing about the account', async () => {
    // The account's state is unknown when the lookup itself failed: the
    // email-ownership probe must not turn that into a conflict verdict.
    routes = [POST_USERS_409, ['GET', USERNAME_LOOKUP, { status: 401, data: null }]];

    let caught;
    try {
      await createUser('tok', REALM, ADMIN_USER);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/Cannot read the user lookup of testadmin in realm genie: HTTP 401/);
    expect(caught.message).not.toMatch(/email conflict|deleted mid-provisioning/);
    expect(calls.some((call) => call.includes('email='))).toBe(false);
  });

  test('a create that did NOT answer 409 is reported as-is, with no probe', async () => {
    // The diagnosis exists for the 409 shape only: a vanished account on a
    // 201 create has no conflict to explain, and probing would invent one.
    routes = [
      ['POST', USERS_PATH, { status: 201, data: null }],
      ['GET', USERNAME_LOOKUP, { status: 200, data: [] }]
    ];

    let caught;
    try {
      await createUser('tok', REALM, ADMIN_USER);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/User testadmin not found in realm genie/);
    expect(caught.message).not.toMatch(/email conflict|deleted mid-provisioning/);
    expect(calls.some((call) => call.includes('email='))).toBe(false);
  });
});

test.describe('createUser is the create-only path: no password convergence, no health gate', () => {
  test('a fresh create resolves the account, assigns the roles and returns the id', async () => {
    routes = [
      ['POST', USERS_PATH, { status: 201, data: null }],
      HEALTHY_LOOKUP,
      ['GET', ROLE_PATH('admin'), { status: 200, data: { id: 'role-id-1', name: 'admin' } }],
      ['POST', ROLE_MAPPINGS_PATH, { status: 204, data: null }]
    ];

    const id = await createUser('tok', REALM, { ...ADMIN_USER, realmRoles: ['admin'] });

    expect(id).toBe('user-1');
    // The credentials went with the create itself: the create-only path
    // resolves and assigns, and never touches the account afterwards —
    // the whole call set is pinned, not only the absence of a reset.
    expect(calls).toEqual([
      `POST /auth/admin/realms/${REALM}/users`,
      `GET /auth/admin/realms/${REALM}/users?username=${ADMIN_FIXTURE.username}&exact=true`,
      `GET /auth/admin/realms/${REALM}/roles/admin`,
      `POST /auth/admin/realms/${REALM}/users/user-1/role-mappings/realm`
    ]);
  });

  test('a 409 whose account exists converges nothing — an account the realm left disabled still proceeds', async () => {
    // THE contract distinction from convergeUser: createUser tolerates the
    // conflict and moves on. It does not converge the password of the
    // existing account (an unconverged password surfaces at login, far
    // from the create — which is why convergeUser exists) and it does not
    // gate on fixture health: an unhealthy account still gets its roles
    // and the call still answers with the id.
    routes = [
      POST_USERS_409,
      LOOKUP({ ...HEALTHY_USER(), enabled: false, emailVerified: false }),
      ['GET', ROLE_PATH('admin'), { status: 200, data: { id: 'role-id-1', name: 'admin' } }],
      ['POST', ROLE_MAPPINGS_PATH, { status: 204, data: null }]
    ];

    const id = await createUser('tok', REALM, { ...ADMIN_USER, realmRoles: ['admin'] });

    expect(id).toBe('user-1');
    // The WHOLE call set is pinned, not only the absence of a password
    // reset: no follow-up write on the existing account (a repair of the
    // disabled representation, a second create) would otherwise slip past
    // the "tolerates the conflict and moves on" contract.
    expect(calls).toEqual([
      `POST /auth/admin/realms/${REALM}/users`,
      `GET /auth/admin/realms/${REALM}/users?username=${ADMIN_FIXTURE.username}&exact=true`,
      `GET /auth/admin/realms/${REALM}/roles/admin`,
      `POST /auth/admin/realms/${REALM}/users/user-1/role-mappings/realm`
    ]);
  });

  test('a create the realm refuses is reported as-is, with no follow-up read', async () => {
    // Neither 201 nor 409: there is no account to resolve and no conflict
    // to diagnose — the failure is the verdict.
    routes = [['POST', USERS_PATH, { status: 400, data: { error: 'Realm min password length not met' } }]];

    const caught = await rejection(createUser('tok', REALM, ADMIN_USER));

    expect(caught.message).toMatch(/Failed to create user testadmin: HTTP 400/);
    // The status contract: a 4xx create refusal is PERMANENT (the retry
    // budget must not burn on it) and carries the status for the callers.
    expect(caught.transient).toBeFalsy();
    expect(caught.httpStatus).toBe(400);
    expect(calls.some((call) => call.startsWith('GET'))).toBe(false);
  });
});

test.describe('convergeUser on a fresh create and on an existing account', () => {
  test('a fresh create answers the id without a password reset', async () => {
    // On the 201 path the credentials went with the create: converging a
    // password it just set would be a wasted write on every first run.
    routes = [
      ['POST', USERS_PATH, { status: 201, data: null }],
      HEALTHY_LOOKUP,
      ['GET', ROLE_PATH('admin'), { status: 200, data: { id: 'role-id-1', name: 'admin' } }],
      ['POST', ROLE_MAPPINGS_PATH, { status: 204, data: null }]
    ];

    const id = await convergeUser('tok', REALM, { ...ADMIN_USER, realmRoles: ['admin'] });

    expect(id).toBe('user-1');
    // The whole call set is pinned, like the createUser siblings: the
    // 201 path resolves, health-checks and assigns — nothing else.
    expect(calls).toEqual([
      `POST /auth/admin/realms/${REALM}/users`,
      `GET /auth/admin/realms/${REALM}/users?username=${ADMIN_FIXTURE.username}&exact=true`,
      `GET /auth/admin/realms/${REALM}/roles/admin`,
      `POST /auth/admin/realms/${REALM}/users/user-1/role-mappings/realm`
    ]);
  });

  test('a fresh create resolving to an unhealthy account refuses to provision', async () => {
    // The fixture-health gate runs on the FRESH-CREATE path too (the realm
    // can attach required actions to brand-new users through its import):
    // a 201 whose resolved account is unhealthy must refuse exactly like
    // the 409 path, or a realm-mangled account provisions silently and
    // dies minutes later at login.
    routes = [['POST', USERS_PATH, { status: 201, data: null }], LOOKUP({ ...HEALTHY_USER(), emailVerified: false })];

    const caught = await rejection(convergeUser('tok', REALM, ADMIN_USER));

    expect(caught.message).toMatch(/not fixture-healthy/);
    expect(caught.message).toMatch(/emailVerified=false/);
    expect(calls.some((call) => call.includes('role-mappings'))).toBe(false);
  });

  test('a 409 whose account exists converges the password BEFORE assigning the roles', async () => {
    // The password convergence is the reason convergeUser exists (a stale
    // password surfaces only at login): on the already-exists path it must
    // run — and before the roles, so a broken convergence never leaves a
    // half-provisioned account behind.
    routes = [
      POST_USERS_409,
      HEALTHY_LOOKUP,
      ['PUT', RESET_PASSWORD_PATH, { status: 204, data: null }],
      ['GET', ROLE_PATH('admin'), { status: 200, data: { id: 'role-id-1', name: 'admin' } }],
      ['POST', ROLE_MAPPINGS_PATH, { status: 204, data: null }]
    ];

    const id = await convergeUser('tok', REALM, { ...ADMIN_USER, realmRoles: ['admin'] });

    expect(id).toBe('user-1');
    const resetIndex = calls.findIndex((call) => call.includes('reset-password'));
    const rolesIndex = calls.findIndex((call) => call.includes('role-mappings'));
    expect(resetIndex).toBeGreaterThan(-1);
    expect(rolesIndex).toBeGreaterThan(resetIndex);
    // The converged credential is the fixture's, not a temporary one the
    // browser login would refuse.
    const resetBody = bodies[resetIndex];
    expect(resetBody).toEqual({ type: 'password', value: ADMIN_FIXTURE.password, temporary: false });
  });

  test('an account carrying a required action refuses to provision, naming the state', async () => {
    // Fixture health: the browser session depends on a login-visible
    // account (enabled, verified, no pending action). An unhealthy one is
    // a realm-import problem — provisioning it would die minutes later at
    // login, far from the cause. The password convergence runs BEFORE the
    // health gate (the credential is fixed either way); the gate refuses
    // before any role is assigned.
    routes = [
      POST_USERS_409,
      LOOKUP({ ...HEALTHY_USER(), requiredActions: ['VERIFY_EMAIL'] }),
      ['PUT', RESET_PASSWORD_PATH, { status: 204, data: null }]
    ];

    const caught = await rejection(convergeUser('tok', REALM, ADMIN_USER));

    expect(caught.message).toMatch(/not fixture-healthy/);
    expect(caught.message).toMatch(/VERIFY_EMAIL/);
    expect(caught.message).toMatch(/check the realm import/);
    // The password convergence RAN (the credential is fixed either way —
    // that is what the comment above claims, so the call must be observed)
    // and no role was assigned to an account that failed the gate.
    expect(calls.some((call) => call.includes('reset-password'))).toBe(true);
    expect(calls.some((call) => call.includes('role-mappings'))).toBe(false);
  });

  test('a disabled account refuses to provision, naming the state', async () => {
    // The other arm of the same gate: enabled=false is login-visible too.
    routes = [
      POST_USERS_409,
      LOOKUP({ ...HEALTHY_USER(), enabled: false }),
      ['PUT', RESET_PASSWORD_PATH, { status: 204, data: null }]
    ];

    const caught = await rejection(convergeUser('tok', REALM, ADMIN_USER));

    expect(caught.message).toMatch(/not fixture-healthy/);
    expect(caught.message).toMatch(/enabled=false/);
    expect(calls.some((call) => call.includes('reset-password'))).toBe(true);
    expect(calls.some((call) => call.includes('role-mappings'))).toBe(false);
  });

  test('a 409 whose fixture declares attributes converges the FULL payload, then health-checks the CONVERGED account', async () => {
    // The attribute convergence PUT replaces the user's whole attributes
    // map, and Keycloak CLEARS every profile field the payload omits — so
    // the PUT must carry the full payload. Its write is the point of the
    // branch: the health check after it must read the account AS CONVERGED
    // (a second lookup), not the pre-PUT snapshot — a carried-over
    // disabled account the PUT just healed would otherwise fail its own
    // provisioning. The attributes come from the fixture module itself, so
    // a fixture change moves the spec with it.
    const lookupCalls = () =>
      calls.filter((call) => call.startsWith('GET /auth/admin/realms/genie/users?username=testadmin')).length;
    routes = [
      POST_USERS_409,
      // The pre-PUT lookup answers with the carried-over DISABLED account;
      // every lookup from the second one on answers with the healed one.
      // (Route order note: this entry must be the only username-lookup
      // route — the plain LOOKUP route would always match first and the
      // healed answer would never be served.)
      [
        'GET',
        USERNAME_LOOKUP,
        {
          compute: () => ({
            status: 200,
            data: [lookupCalls() >= 2 ? HEALTHY_USER() : { ...HEALTHY_USER(), enabled: false }]
          })
        }
      ],
      ['PUT', USER_PATH, { status: 204, data: null }],
      ['PUT', RESET_PASSWORD_PATH, { status: 204, data: null }],
      ['GET', ROLE_PATH('admin'), { status: 200, data: { id: 'role-id-1', name: 'admin' } }],
      ['POST', ROLE_MAPPINGS_PATH, { status: 204, data: null }]
    ];

    const id = await convergeUser('tok', REALM, {
      ...ADMIN_USER,
      realmRoles: ['admin'],
      attributes: ADMIN_FIXTURE.attributes
    });

    expect(id).toBe('user-1');
    const putIndex = calls.findIndex((call) => call.startsWith('PUT /auth/admin/realms/genie/users/user-1'));
    expect(putIndex).toBeGreaterThan(-1);
    expect(bodies[putIndex]).toEqual({
      firstName: ADMIN_FIXTURE.username,
      lastName: 'Test',
      email: ADMIN_FIXTURE.email,
      enabled: true,
      emailVerified: true,
      attributes: ADMIN_FIXTURE.attributes
    });
    // The pre-PUT lookup and the post-PUT re-read: both must have run.
    expect(lookupCalls()).toBeGreaterThanOrEqual(2);
  });

  test('a failed attribute convergence refuses the provisioning, naming the write', async () => {
    // The write is the whole point of the branch: a swallowed failure
    // would provision an account without the grant and surface as a 403
    // far from the cause (the harness's seed create).
    routes = [
      POST_USERS_409,
      HEALTHY_LOOKUP,
      ['PUT', USER_PATH, { status: 400, data: { errorMessage: 'invalid attributes' } }]
    ];

    const caught = await rejection(convergeUser('tok', REALM, { ...ADMIN_USER, attributes: ADMIN_FIXTURE.attributes }));

    expect(caught.message).toMatch(/Failed to converge the attributes/);
    expect(caught.message).toMatch(/HTTP 400/);
    expect(calls.some((call) => call.includes('role-mappings'))).toBe(false);
  });
});

test.describe('convergeUser keeps a transport break retryable', () => {
  test('a transport break during the role assignment stays transient, so the retry budget can save the provisioning', async () => {
    // The role assignment runs on EVERY converge: a break there must carry
    // the transient verdict, or the retry budget cannot see it and the
    // provisioning dies on a blip the budget exists to survive.
    routes = [
      ['POST', USERS_PATH, { status: 409, data: null }],
      HEALTHY_LOOKUP,
      ['PUT', RESET_PASSWORD_PATH, { status: 204, data: null }],
      ['GET', ROLE_PATH('admin'), { status: 200, data: { id: 'role-id-1', name: 'admin' } }],
      ['POST', ROLE_MAPPINGS_PATH, { throws: new Error('socket hang up') }]
    ];

    const caught = await rejection(convergeUser('tok', REALM, { ...ADMIN_USER, realmRoles: ['admin'] }));

    expect(caught.transient).toBe(true);
    expect(caught.message).toMatch(
      /Cannot reach the Keycloak admin API for the assignment of the realm roles admin to user-1/
    );
  });

  test('a transport break during the password convergence names the convergence', async () => {
    // The password reset runs on every converge of an existing account (the
    // 409 branch — the hot path on every re-run): a break there must carry
    // the transient verdict, or the retry budget cannot see it.
    routes = [
      ['POST', USERS_PATH, { status: 409, data: null }],
      HEALTHY_LOOKUP,
      ['PUT', RESET_PASSWORD_PATH, { throws: new Error('socket hang up') }]
    ];

    const caught = await rejection(convergeUser('tok', REALM, ADMIN_USER));

    expect(caught.transient).toBe(true);
    expect(caught.message).toMatch(
      /Cannot reach the Keycloak admin API for the password convergence of testadmin \(user-1\)/
    );
  });
});

test.describe('rotateRealmKeys reads the new key id from the Location header', () => {
  const OLD_KEYS = [
    {
      id: 'old-key-1',
      name: 'rsa-generated',
      providerId: 'rsa-generated',
      providerType: 'org.keycloak.keys.KeyProvider',
      config: { priority: ['0'], enabled: ['true'], active: ['true'] }
    },
    {
      id: 'old-key-2',
      name: 'rsa-generated-rotated-1',
      providerId: 'rsa-generated',
      providerType: 'org.keycloak.keys.KeyProvider',
      config: { priority: ['100'], enabled: ['true'], active: ['false'] }
    }
  ];

  // The two reads every rotation performs before the create: the realm's
  // id and the existing key providers.
  const BASE_ROUTES = [
    ['GET', REALM_PATH, { status: 200, data: { id: 'realm-uuid' } }],
    ['GET', COMPONENTS_PATH, { status: 200, data: OLD_KEYS }]
  ];

  test('returns the id parsed from the Location header, not the empty body', async () => {
    routes = [
      ...BASE_ROUTES,
      [
        'POST',
        COMPONENTS_PATH,
        {
          status: 201,
          data: null,
          headers: { location: `/auth/admin/realms/${REALM}/components/new-key-id` }
        }
      ],
      ['PUT', /\/auth\/admin\/realms\/genie\/components\/old-key-[12]$/, { status: 204, data: null }]
    ];

    const result = await rotateRealmKeys('tok', REALM);

    expect(result.newKeyId).toBe('new-key-id');
    expect(result.oldKeyIds).toEqual(['old-key-1', 'old-key-2']);
    // Both old keys were demoted.
    const putCalls = calls.filter((c) => c.startsWith('PUT '));
    expect(putCalls).toHaveLength(2);
  });

  test('a 201 without a Location header fails loudly instead of returning null', async () => {
    routes = [...BASE_ROUTES, ['POST', COMPONENTS_PATH, { status: 201, data: null }]];

    let caught;
    try {
      await rotateRealmKeys('tok', REALM);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/answered 201 without a usable Location header/);
    // The created key component is named: it is already ACTIVE and untracked.
    expect(caught.message).toMatch(/rsa-generated-rotated-\d+/);
    expect(caught.message).toMatch(/already created.*active/s);
    // No old key was demoted behind a creation whose id was never resolved.
    expect(calls.some((c) => c.startsWith('PUT '))).toBe(false);
  });

  test('a components read the admin API refuses fails loudly instead of feeding its body to .map()', async () => {
    // An expired admin token answers 401 with an error body: indexing that
    // body would surface as `existingKeys.map is not a function` — a
    // TypeError with no named verdict.
    routes = [
      ['GET', REALM_PATH, { status: 200, data: { id: 'realm-uuid' } }],
      ['GET', COMPONENTS_PATH, { status: 401, data: { error: 'HTTP 401 Unauthorized' } }]
    ];

    let caught;
    try {
      await rotateRealmKeys('tok', REALM);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/Cannot read the existing key providers of genie: HTTP 401/);
    // Nothing was created behind a read that failed: the realm stays untouched.
    expect(calls.some((c) => c.startsWith('POST '))).toBe(false);
  });

  test('a transport break while minting the rotated key names the rotation', async () => {
    // The operator must be able to read the verdict: a bare socket error
    // says nothing about the signing-key generation having broken.
    routes = [...BASE_ROUTES, ['POST', COMPONENTS_PATH, { throws: new Error('socket hang up') }]];

    const caught = await rejection(rotateRealmKeys('tok', REALM));

    expect(caught.transient).toBe(true);
    expect(caught.message).toMatch(/Cannot reach the Keycloak admin API for the creation of the rotated key/);
  });

  test('a components read answering 200 with a non-array payload fails loudly instead of demoting nothing', async () => {
    // A broken answer is not an empty key set: an empty oldKeyIds would let
    // the create proceed and demote nothing — a half-rotation.
    routes = [
      ['GET', REALM_PATH, { status: 200, data: { id: 'realm-uuid' } }],
      ['GET', COMPONENTS_PATH, { status: 200, data: { error: 'not a list' } }]
    ];

    let caught;
    try {
      await rotateRealmKeys('tok', REALM);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/answered HTTP 200 with a non-array payload/);
    expect(calls.some((c) => c.startsWith('POST '))).toBe(false);
  });

  test('a failed demotion names the new key that is already the active signer', async () => {
    // The realm is half-mutated: the new key was created and signs. The
    // message must say so, or a re-run creates a second rotated key.
    routes = [
      ...BASE_ROUTES,
      [
        'POST',
        COMPONENTS_PATH,
        {
          status: 201,
          data: null,
          headers: { location: `/auth/admin/realms/${REALM}/components/new-key-id` }
        }
      ],
      ['PUT', /\/auth\/admin\/realms\/genie\/components\/old-key-1$/, { status: 403, data: null }]
    ];

    let caught;
    try {
      await rotateRealmKeys('tok', REALM);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/Failed to demote key old-key-1: HTTP 403/);
    expect(caught.message).toMatch(/new-key-id/);
    expect(caught.message).toMatch(/already created.*active signer/s);
  });

  test('a demotion transport break carries the half-mutation diagnosis', async () => {
    // A timeout after the create is the realistic path to a second
    // rotated key: the raw transport message must not bypass the
    // re-run-safety verdict this failure position exists to state.
    routes = [
      ...BASE_ROUTES,
      [
        'POST',
        COMPONENTS_PATH,
        { status: 201, data: null, headers: { location: `/auth/admin/realms/${REALM}/components/new-key-id` } }
      ],
      ['PUT', /\/auth\/admin\/realms\/genie\/components\/old-key-1$/, { throws: new Error('connection reset by peer') }]
    ];

    let caught;
    try {
      await rotateRealmKeys('tok', REALM);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/the demotion of key old-key-1/);
    expect(caught.message).toMatch(/new-key-id/);
    expect(caught.message).toMatch(/already created.*active signer/s);
  });

  test('a Location header carrying no id segment fails loudly instead of yielding garbage', async () => {
    // A proxy-rewritten or truncated header answers with the collection
    // URL only: reading its last segment would mint the id 'components'.
    routes = [
      ...BASE_ROUTES,
      [
        'POST',
        COMPONENTS_PATH,
        { status: 201, data: null, headers: { location: `/auth/admin/realms/${REALM}/components/` } }
      ]
    ];

    let caught;
    try {
      await rotateRealmKeys('tok', REALM);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/answered 201 without a usable Location header/);
    expect(caught.message).toMatch(/rsa-generated-rotated-\d+/);
    expect(caught.message).toMatch(/already created.*active/s);
    expect(calls.some((c) => c.startsWith('PUT '))).toBe(false);
  });
});

test.describe('rotateRealmKeys rotates the RSA signing keys only', () => {
  // The realm read every rotation performs before it touches a key.
  const REALM_ROUTE = ['GET', REALM_PATH, { status: 200, data: { id: 'realm-uuid' } }];

  // The key providers a Keycloak 26 realm carries by default. The
  // components API answers with the config entries the provider declares
  // (priority, enabled, active, key size) — the default providers carry
  // the priority alone, and the use of a key is not in the answer.
  const REALM_KEYS = [
    {
      id: 'rsa-signing-id',
      name: 'rsa-generated',
      providerId: 'rsa-generated',
      providerType: 'org.keycloak.keys.KeyProvider',
      config: { priority: ['100'] }
    },
    {
      id: 'rsa-encryption-id',
      name: 'rsa-enc-generated',
      providerId: 'rsa-enc-generated',
      providerType: 'org.keycloak.keys.KeyProvider',
      config: { priority: ['100'], algorithm: ['RSA-OAEP'] }
    },
    {
      id: 'hmac-id',
      name: 'hmac-generated-hs512',
      providerId: 'hmac-generated',
      providerType: 'org.keycloak.keys.KeyProvider',
      config: { priority: ['100'], algorithm: ['HS512'] }
    },
    {
      id: 'aes-id',
      name: 'aes-generated',
      providerId: 'aes-generated',
      providerType: 'org.keycloak.keys.KeyProvider',
      config: { priority: ['100'] }
    }
  ];

  // The key a rotation mints: the same shape the helper POSTs.
  const ROTATED_KEY = {
    id: 'rotated-key-id',
    name: 'rsa-generated-rotated-1700000000000',
    providerId: 'rsa-generated',
    providerType: 'org.keycloak.keys.KeyProvider',
    config: { priority: ['101'], enabled: ['true'], active: ['true'], keySize: ['2048'] }
  };

  const CREATED_KEY = {
    status: 201,
    data: null,
    headers: { location: `/auth/admin/realms/${REALM}/components/new-key-id` }
  };

  test('demotes the RSA signing key and leaves the encryption, HMAC and AES providers alone', async () => {
    routes = [
      REALM_ROUTE,
      ['GET', COMPONENTS_PATH, { status: 200, data: REALM_KEYS }],
      ['POST', COMPONENTS_PATH, CREATED_KEY],
      ['PUT', new RegExp(`/auth/admin/realms/${REALM}/components/rsa-signing-id$`), { status: 204, data: null }]
    ];

    const result = await rotateRealmKeys('tok', REALM);

    expect(result.newKeyId).toBe('new-key-id');
    // Only the RSA signing key was demoted: the encryption, HMAC and AES
    // providers keep signing and encrypting what they signed and encrypted.
    expect(result.oldKeyIds).toEqual(['rsa-signing-id']);
    const putCalls = calls.filter((c) => c.startsWith('PUT '));
    expect(putCalls).toEqual([`PUT /auth/admin/realms/${REALM}/components/rsa-signing-id`]);
  });

  test('reuses the active rotated key instead of minting a second one', async () => {
    // The realm after a first rotation: the original signing key is
    // demoted and the rotated key is the active signer. A second
    // rotation must not create a second active rotated key.
    routes = [
      REALM_ROUTE,
      [
        'GET',
        COMPONENTS_PATH,
        {
          status: 200,
          data: [{ ...REALM_KEYS[0], config: { ...REALM_KEYS[0].config, active: ['false'] } }, ROTATED_KEY]
        }
      ],
      ['PUT', new RegExp(`/auth/admin/realms/${REALM}/components/rsa-signing-id$`), { status: 204, data: null }]
    ];

    const result = await rotateRealmKeys('tok', REALM);

    // The key of the previous rotation IS the rotation's key.
    expect(result.newKeyId).toBe('rotated-key-id');
    // Nothing was minted: a second active rotated key would leave the
    // realm with two signers and no way to tell which one is the rotation.
    expect(calls.some((c) => c.startsWith('POST '))).toBe(false);
    // The reused key keeps signing: it is not demoted along with the old one.
    expect(result.oldKeyIds).toEqual(['rsa-signing-id']);
    const putCalls = calls.filter((c) => c.startsWith('PUT '));
    expect(putCalls).toEqual([`PUT /auth/admin/realms/${REALM}/components/rsa-signing-id`]);
  });

  test('a rotated key that is no longer active is not reused', async () => {
    // A passive rotated key cannot sign: reusing it would leave the
    // realm without an active signer.
    routes = [
      REALM_ROUTE,
      [
        'GET',
        COMPONENTS_PATH,
        {
          status: 200,
          data: [
            REALM_KEYS[0],
            {
              id: 'passive-rotated-id',
              name: 'rsa-generated-rotated-1700000000000',
              providerId: 'rsa-generated',
              providerType: 'org.keycloak.keys.KeyProvider',
              config: { priority: ['101'], enabled: ['true'], active: ['false'], keySize: ['2048'] }
            }
          ]
        }
      ],
      ['POST', COMPONENTS_PATH, CREATED_KEY],
      [
        'PUT',
        new RegExp(`/auth/admin/realms/${REALM}/components/(rsa-signing-id|passive-rotated-id)$`),
        { status: 204, data: null }
      ]
    ];

    const result = await rotateRealmKeys('tok', REALM);

    expect(result.newKeyId).toBe('new-key-id');
    expect(calls.some((c) => c.startsWith('POST '))).toBe(true);
    expect(result.oldKeyIds).toEqual(['rsa-signing-id', 'passive-rotated-id']);
  });

  test('a rotated key that carries no active flag is reused — Keycloak reads a missing flag as active', async () => {
    // Keycloak derives the key status from the flags with a default of
    // active: a provider that carries no active flag signs. Reading it
    // as inactive would mint a second active rotated key.
    routes = [
      REALM_ROUTE,
      [
        'GET',
        COMPONENTS_PATH,
        {
          status: 200,
          data: [REALM_KEYS[0], { ...ROTATED_KEY, config: { priority: ['101'], enabled: ['true'], keySize: ['2048'] } }]
        }
      ],
      ['PUT', new RegExp(`/auth/admin/realms/${REALM}/components/rsa-signing-id$`), { status: 204, data: null }]
    ];

    const result = await rotateRealmKeys('tok', REALM);

    expect(result.newKeyId).toBe('rotated-key-id');
    expect(calls.some((c) => c.startsWith('POST '))).toBe(false);
  });

  test('a disabled rotated key is not reused — a disabled provider never signs', async () => {
    routes = [
      REALM_ROUTE,
      [
        'GET',
        COMPONENTS_PATH,
        {
          status: 200,
          data: [REALM_KEYS[0], { ...ROTATED_KEY, config: { priority: ['101'], enabled: ['false'], active: ['true'] } }]
        }
      ],
      ['POST', COMPONENTS_PATH, CREATED_KEY],
      [
        'PUT',
        new RegExp(`/auth/admin/realms/${REALM}/components/(rsa-signing-id|rotated-key-id)$`),
        { status: 204, data: null }
      ]
    ];

    const result = await rotateRealmKeys('tok', REALM);

    // The disabled key cannot sign: reusing it would demote the realm's
    // real signer and leave it without one.
    expect(result.newKeyId).toBe('new-key-id');
    expect(calls.some((c) => c.startsWith('POST '))).toBe(true);
    expect(result.oldKeyIds).toEqual(['rsa-signing-id', 'rotated-key-id']);
  });

  test('a rotated name on a provider that is no RSA signing key is not reused', async () => {
    // The name alone does not make a key a signer: adopting an encryption
    // provider would demote the realm's real signing key and leave the
    // realm without one.
    routes = [
      REALM_ROUTE,
      [
        'GET',
        COMPONENTS_PATH,
        {
          status: 200,
          data: [
            REALM_KEYS[0],
            {
              ...ROTATED_KEY,
              id: 'rotated-encryption-id',
              name: 'rsa-generated-rotated-backup',
              providerId: 'rsa-enc-generated'
            }
          ]
        }
      ],
      ['POST', COMPONENTS_PATH, CREATED_KEY],
      ['PUT', new RegExp(`/auth/admin/realms/${REALM}/components/rsa-signing-id$`), { status: 204, data: null }]
    ];

    const result = await rotateRealmKeys('tok', REALM);

    expect(result.newKeyId).toBe('new-key-id');
    expect(calls.some((c) => c.startsWith('POST '))).toBe(true);
    // The encryption provider is not a signing key: it survives.
    expect(result.oldKeyIds).toEqual(['rsa-signing-id']);
  });

  test('a provider whose flag carries no value does not break the rotation', async () => {
    // A malformed config entry is a broken answer, not a crash: the
    // rotation reads it as Keycloak does — a flag without a value is the
    // default, active.
    routes = [
      REALM_ROUTE,
      [
        'GET',
        COMPONENTS_PATH,
        {
          status: 200,
          data: [{ ...REALM_KEYS[0], config: { priority: ['100'], active: [null] } }]
        }
      ],
      ['POST', COMPONENTS_PATH, CREATED_KEY],
      ['PUT', new RegExp(`/auth/admin/realms/${REALM}/components/rsa-signing-id$`), { status: 204, data: null }]
    ];

    const result = await rotateRealmKeys('tok', REALM);

    expect(result.newKeyId).toBe('new-key-id');
    expect(result.oldKeyIds).toEqual(['rsa-signing-id']);
  });
});

test.describe('the realm settings helpers report a failure with the module verdict', () => {
  test('a realm read the admin API refuses names the read', async () => {
    routes = [['GET', REALM_PATH, { status: 401, data: { error: 'HTTP 401 Unauthorized' } }]];

    await expect(getRealmSettings('tok', REALM)).rejects.toThrow(/Cannot read the realm settings of genie: HTTP 401/);
  });

  test('a realm read whose body carries no representation fails loudly', async () => {
    // The rotation indexes realm.id on the answer: a 200 without one is a
    // broken answer, and the verdict must name it instead of letting the
    // caller read 'undefined' off a null.
    routes = [['GET', REALM_PATH, { status: 200, data: null }]];

    await expect(getRealmSettings('tok', REALM)).rejects.toThrow(
      /The realm settings of genie answered HTTP 200 without a usable representation/
    );
  });

  test('a transport break on a realm read names the read and stays transient', async () => {
    routes = [['GET', REALM_PATH, { throws: new Error('connection reset by peer') }]];

    const caught = await rejection(getRealmSettings('tok', REALM));

    expect(caught.transient).toBe(true);
    expect(caught.message).toMatch(/Cannot reach the Keycloak admin API for the realm settings of genie/);
  });

  test('a refused realm update names the update and carries the status', async () => {
    routes = [['PUT', REALM_PATH, { status: 409, data: { errorMessage: 'Conflict' } }]];

    const caught = await rejection(updateRealmSettings('tok', REALM, { accessTokenLifespan: '10' }));

    expect(caught.httpStatus).toBe(409);
    expect(caught.message).toMatch(/Failed to update the realm settings of genie: HTTP 409/);
  });

  test('a realm update the admin API fails with a 5xx is transient', async () => {
    routes = [['PUT', REALM_PATH, { status: 503, data: null }]];

    const caught = await rejection(updateRealmSettings('tok', REALM, { accessTokenLifespan: '10' }));

    expect(caught.transient).toBe(true);
    expect(caught.httpStatus).toBe(503);
  });

  test('a transport break on a realm update names the update', async () => {
    routes = [['PUT', REALM_PATH, { throws: new Error('connection reset by peer') }]];

    const caught = await rejection(updateRealmSettings('tok', REALM, { accessTokenLifespan: '10' }));

    expect(caught.transient).toBe(true);
    expect(caught.message).toMatch(/Cannot reach the Keycloak admin API for the realm settings update of genie/);
  });

  test('a refused deletion names the user and carries the status', async () => {
    routes = [['DELETE', USER_PATH, { status: 500, data: null }]];

    const caught = await rejection(deleteUser('tok', REALM, 'user-1'));

    expect(caught.transient).toBe(true);
    expect(caught.httpStatus).toBe(500);
    expect(caught.message).toMatch(/Failed to delete user user-1: HTTP 500/);
  });

  test('a user that is already gone is the end state every caller wants', async () => {
    routes = [['DELETE', USER_PATH, { status: 404, data: null }]];

    await expect(deleteUser('tok', REALM, 'user-1')).resolves.toBeUndefined();
  });

  test('an answered but unusable reply is not a transport break, and the verdict does not rewrite it', async () => {
    // The transport owns the error it throws: the verdict must not write
    // into it. A verdict that rewrote the transport's message would leave
    // the transport's error carrying the verdict's own prefix.
    const notJson = new Error('GET /auth/admin/realms/genie returned a non-JSON body (HTTP 403): <html>');
    notJson.status = 403;
    notJson.nonJsonBody = true;
    routes = [['GET', REALM_PATH, { throws: notJson }]];

    await expect(getRealmSettings('tok', REALM)).rejects.toThrow(
      /The Keycloak admin API did not answer the realm settings of genie usably/
    );
    expect(notJson.message).toContain('non-JSON body (HTTP 403)');
    expect(notJson.message).not.toContain('The Keycloak admin API did not answer');
  });
});

test.describe('enableDirectAccessGrants reads the client list like every other read', () => {
  const CLIENTS_PATH = new RegExp('/auth/admin/realms/genie2/clients\\?clientId=genie-app');
  const CLIENT_UPDATE_PATH = new RegExp('/auth/admin/realms/genie2/clients/client-1$');

  test('an outage is not reported as a missing client', async () => {
    // A 5xx is an outage, not a verdict about the client: the caller must
    // be able to retry it, and the reader must not hunt for a client that
    // is in fact there.
    routes = [['GET', CLIENTS_PATH, { status: 500, data: null }]];

    const caught = await rejection(enableDirectAccessGrants('tok', 'genie2', 'genie-app'));

    expect(caught.transient).toBe(true);
    expect(caught.message).toMatch(/^Cannot read the client genie-app of genie2: HTTP 500/);
  });

  test('a realm that carries no client of that name says so', async () => {
    routes = [['GET', CLIENTS_PATH, { status: 200, data: [] }]];

    await expect(enableDirectAccessGrants('tok', 'genie2', 'genie-app')).rejects.toThrow(
      'Client genie-app not found in realm genie2'
    );
  });

  test('a transport break while enabling ROPC names the enablement', async () => {
    routes = [
      ['GET', CLIENTS_PATH, { status: 200, data: [{ id: 'client-1', directAccessGrantsEnabled: false }] }],
      ['PUT', CLIENT_UPDATE_PATH, { throws: new Error('socket hang up') }]
    ];

    const caught = await rejection(enableDirectAccessGrants('tok', 'genie2', 'genie-app'));

    expect(caught.transient).toBe(true);
    expect(caught.message).toMatch(/Cannot reach the Keycloak admin API for the ROPC enablement of genie-app/);
  });

  test('enabling ROPC puts the whole client representation with the grant flipped', async () => {
    // Keycloak replaces the client on PUT: the update must carry the
    // representation it read, or the enablement would wipe the client's
    // other settings.
    routes = [
      [
        'GET',
        CLIENTS_PATH,
        { status: 200, data: [{ id: 'client-1', secret: 's3cret', directAccessGrantsEnabled: false }] }
      ],
      ['PUT', CLIENT_UPDATE_PATH, { status: 204, data: null }]
    ];

    await enableDirectAccessGrants('tok', 'genie2', 'genie-app');

    expect(calls).toEqual([
      `GET /auth/admin/realms/genie2/clients?clientId=genie-app`,
      `PUT /auth/admin/realms/genie2/clients/client-1`
    ]);
    // Keycloak replaces the client wholesale: the whole representation it
    // read travels back, with the grant flipped on.
    expect(bodies[1]).toEqual({ id: 'client-1', secret: 's3cret', directAccessGrantsEnabled: true });
  });

  test('an already-enabled client is left untouched', async () => {
    routes = [['GET', CLIENTS_PATH, { status: 200, data: [{ id: 'client-1', directAccessGrantsEnabled: true }] }]];

    await enableDirectAccessGrants('tok', 'genie2', 'genie-app');

    expect(calls).toEqual([`GET /auth/admin/realms/genie2/clients?clientId=genie-app`]);
  });
});

test.describe('the client helpers behind the K.2 expiry client', () => {
  const CLIENT_LOOKUP = new RegExp(`/auth/admin/realms/${REALM}/clients\\?clientId=e2e-expiry$`);
  const CLIENT_CREATE_PATH = new RegExp(`/auth/admin/realms/${REALM}/clients$`);
  const CLIENT_PATH = new RegExp(`/auth/admin/realms/${REALM}/clients/client-1$`);

  test('findClient returns the representation on a hit and null on a miss', async () => {
    routes = [['GET', CLIENT_LOOKUP, { status: 200, data: [{ id: 'client-1', clientId: 'e2e-expiry' }] }]];
    const found = await findClient('tok', REALM, 'e2e-expiry');
    expect(found.id).toBe('client-1');

    routes = [['GET', CLIENT_LOOKUP, { status: 200, data: [] }]];
    expect(await findClient('tok', REALM, 'e2e-expiry')).toBeNull();
  });

  test('createClient posts the representation verbatim and accepts 201', async () => {
    routes = [['POST', CLIENT_CREATE_PATH, { status: 201, data: null }]];
    const representation = {
      clientId: 'e2e-expiry',
      secret: 's3cret',
      serviceAccountsEnabled: true,
      attributes: { 'access.token.lifespan': '10' }
    };
    await createClient('tok', REALM, representation);
    expect(calls).toEqual([`POST /auth/admin/realms/${REALM}/clients`]);
    expect(bodies[0]).toEqual(representation);
  });

  test('createClient names the refused create in its verdict', async () => {
    routes = [['POST', CLIENT_CREATE_PATH, { status: 409, data: null }]];
    const err = await rejection(createClient('tok', REALM, { clientId: 'e2e-expiry' }));
    expect(err.message).toContain('Failed to create client e2e-expiry');
    expect(err.message).toContain('HTTP 409');
  });

  test('deleteClient accepts 204 and tolerates 404', async () => {
    routes = [['DELETE', CLIENT_PATH, { status: 204, data: null }]];
    await deleteClient('tok', REALM, 'client-1', 'e2e-expiry');
    expect(calls).toEqual([`DELETE /auth/admin/realms/${REALM}/clients/client-1`]);

    routes = [['DELETE', CLIENT_PATH, { status: 404, data: null }]];
    await deleteClient('tok', REALM, 'client-1', 'e2e-expiry');
  });

  test('deleteClient names the refused delete in its verdict', async () => {
    routes = [['DELETE', CLIENT_PATH, { status: 500, data: null }]];
    const err = await rejection(deleteClient('tok', REALM, 'client-1', 'e2e-expiry'));
    expect(err.message).toContain('Failed to delete client e2e-expiry');
    expect(err.message).toContain('HTTP 500');
  });
});
