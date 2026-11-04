const { test, expect } = require('@playwright/test');
const auth = require('./auth');
const { E2E_FIXTURES } = require('./e2e-fixtures');
const { assignRealmRoles, removeRealmRoles, convergeUser } = require('./keycloak-admin');

/**
 * Unit spec for the Keycloak admin helper's role resolution and the
 * convergeUser failure diagnoses. The transport (auth.request) is faked
 * per test — the assertions here are about WHICH endpoints the helper
 * calls and HOW it reports failures, not about Keycloak itself, so no
 * venue is needed. The real transport is restored after every test.
 */

// The fake transport: a table of [method, pathRegex] → {status, data}
// (or {throws}), plus a call log the endpoint assertions read.
let routes;
let calls;

function fakeRequest(method, path) {
  calls.push(`${method} ${path}`);
  for (const [m, pattern, answer] of routes) {
    if (m === method && pattern.test(path)) {
      if (answer.throws) return Promise.reject(answer.throws);
      return Promise.resolve({ status: answer.status, data: answer.data });
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
const ADMIN_USER = {
  username: ADMIN_FIXTURE.username,
  email: ADMIN_FIXTURE.email,
  password: ADMIN_FIXTURE.password
};

const REALM = 'genie';
const ROLE_PATH = (name) => new RegExp(`/auth/admin/realms/${REALM}/roles/${name}$`);
const REALM_PATH = new RegExp(`/auth/admin/realms/${REALM}$`);
const ROLE_MAPPINGS_PATH = new RegExp(`/auth/admin/realms/${REALM}/users/user-1/role-mappings/realm$`);
const USERS_PATH = new RegExp(`/auth/admin/realms/${REALM}/users$`);
const USERNAME_LOOKUP = new RegExp(
  `/auth/admin/realms/${REALM}/users\\?username=${ADMIN_FIXTURE.username}&exact=true$`
);
const EMAIL_LOOKUP = new RegExp(
  `/auth/admin/realms/${REALM}/users\\?email=${encodeURIComponent(ADMIN_FIXTURE.email)}&exact=true$`
);
const RESET_PASSWORD_PATH = new RegExp(`/auth/admin/realms/${REALM}/users/user-1/reset-password$`);

test.beforeEach(() => {
  routes = [];
  calls = [];
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
    routes = [
      ['GET', ROLE_PATH('ghost'), { status: 404, data: null }],
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

  test('a 404 on a realm that does not exist fails loudly instead of skipping the removal', async () => {
    routes = [
      ['GET', ROLE_PATH('admin'), { status: 404, data: null }],
      ['GET', REALM_PATH, { status: 404, data: null }]
    ];

    await expect(removeRealmRoles('tok', REALM, 'user-1', ['admin'])).rejects.toThrow(/The realm genie does not exist/);
    expect(calls).not.toContain(`DELETE /auth/admin/realms/${REALM}/users/user-1/role-mappings/realm`);
  });
});

test.describe('convergeUser diagnoses a 409 whose username lookup misses', () => {
  const POST_USERS_409 = ['POST', USERS_PATH, { status: 409, data: null }];
  const USERNAME_LOOKUP_MISS = ['GET', USERNAME_LOOKUP, { status: 200, data: [] }];
  const EMAIL_PROBE = (data) => ['GET', EMAIL_LOOKUP, { status: 200, data }];

  test('an account owning the fixture email is named as an email conflict', async () => {
    routes = [
      POST_USERS_409,
      USERNAME_LOOKUP_MISS,
      EMAIL_PROBE([{ username: 'someone-else', email: ADMIN_FIXTURE.email }])
    ];

    await expect(convergeUser('tok', REALM, ADMIN_USER)).rejects.toThrow(
      new RegExp(`${ADMIN_FIXTURE.email}: an email conflict`)
    );
  });

  test('an empty email probe names the account as deleted mid-provisioning', async () => {
    routes = [POST_USERS_409, USERNAME_LOOKUP_MISS, EMAIL_PROBE([])];

    let caught;
    try {
      await convergeUser('tok', REALM, ADMIN_USER);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/was deleted mid-provisioning/);
    // The account can be recreated by the next attempt, so the retry
    // budget must be allowed to save the provisioning.
    expect(caught.transient).toBe(true);
  });

  test('a failed email probe fails loudly instead of guessing', async () => {
    routes = [POST_USERS_409, USERNAME_LOOKUP_MISS, ['GET', EMAIL_LOOKUP, { status: 403, data: null }]];

    await expect(convergeUser('tok', REALM, ADMIN_USER)).rejects.toThrow(
      new RegExp(`email-ownership probe for ${ADMIN_FIXTURE.email.replace('.', '\\.')} could not run \\(HTTP 403\\)`)
    );
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
    expect(caught.message).toMatch(/Cannot reach the Keycloak admin API for the email-ownership probe/);
  });
});

test.describe('convergeUser diagnoses a password reset on a vanished account', () => {
  test('a 404 reset names the account as deleted between lookup and reset', async () => {
    routes = [
      ['POST', USERS_PATH, { status: 409, data: null }],
      [
        'GET',
        USERNAME_LOOKUP,
        { status: 200, data: [{ id: 'user-1', username: ADMIN_FIXTURE.username, enabled: true, emailVerified: true }] }
      ],
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
    expect(caught.transient).toBe(true);
  });
});
