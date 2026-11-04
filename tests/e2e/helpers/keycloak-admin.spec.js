const { test, expect } = require('@playwright/test');
const auth = require('./auth');
const { credentialsOf } = require('./e2e-fixtures');
const { assignRealmRoles, removeRealmRoles, convergeUser } = require('./keycloak-admin');

// The untouched transport, captured before any test swaps it.
const realRequest = auth.request;

/**
 * Unit spec for the Keycloak admin helper's role resolution and the
 * convergeUser failure diagnoses. The transport (auth.request) is faked
 * per test — the assertions here are about WHICH endpoints the helper
 * calls and HOW it reports failures, not about Keycloak itself, so no
 * venue is needed. The real transport is restored after every test.
 */

// The fake transport: a table of [method, pathRegex] → {status, data},
// plus a call log the endpoint assertions read.
let routes;
let calls;

function fakeRequest(method, path) {
  calls.push(`${method} ${path}`);
  for (const [m, pattern, answer] of routes) {
    if (m === method && pattern.test(path)) {
      return Promise.resolve({ status: answer.status, data: answer.data });
    }
  }
  return Promise.reject(new Error(`fake transport: no route for ${method} ${path}`));
}

const ADMIN_BEARER = { Authorization: 'Bearer tok' };
const REALM = 'genie';
const ROLE_PATH = (name) => new RegExp(`/auth/admin/realms/${REALM}/roles/${name}$`);
const REALM_PATH = new RegExp(`/auth/admin/realms/${REALM}$`);

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
      ['POST', new RegExp(`/auth/admin/realms/${REALM}/users/user-1/role-mappings/realm$`), { status: 204, data: null }]
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

    await expect(assignRealmRoles('tok', REALM, 'user-1', ['admin'])).rejects.toThrow(
      /Failed to get realm settings for genie: 404/
    );
    expect(calls).not.toContain(`POST /auth/admin/realms/${REALM}/users/user-1/role-mappings/realm`);
  });

  test('a 200 without a usable representation is a hard failure naming the role', async () => {
    routes = [['GET', ROLE_PATH('admin'), { status: 200, data: null }]];

    await expect(assignRealmRoles('tok', REALM, 'user-1', ['admin'])).rejects.toThrow(
      /answered HTTP 200 without a usable representation/
    );
  });

  test('a lookup transport failure is a hard failure naming the role', async () => {
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
      [
        'DELETE',
        new RegExp(`/auth/admin/realms/${REALM}/users/user-1/role-mappings/realm$`),
        { status: 204, data: null }
      ]
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

    await expect(removeRealmRoles('tok', REALM, 'user-1', ['admin'])).rejects.toThrow(
      /Failed to get realm settings for genie: 404/
    );
    expect(calls).not.toContain(`DELETE /auth/admin/realms/${REALM}/users/user-1/role-mappings/realm`);
  });
});

test.describe('convergeUser diagnoses a 409 whose username lookup misses', () => {
  const CONFLICTING_USER = {
    username: 'someone-else',
    email: 'testadmin@e2e.test',
    enabled: true,
    emailVerified: true
  };
  const POST_USERS_409 = ['POST', new RegExp(`/auth/admin/realms/${REALM}/users$`), { status: 409, data: null }];
  const USERNAME_LOOKUP_MISS = [
    'GET',
    new RegExp(`/auth/admin/realms/${REALM}/users\\?username=testadmin&exact=true$`),
    { status: 200, data: [] }
  ];
  const EMAIL_PROBE = (data) => [
    'GET',
    new RegExp(`/auth/admin/realms/${REALM}/users\\?email=testadmin%40e2e\\.test&exact=true$`),
    { status: 200, data }
  ];

  test('an account owning the fixture email is named as an email conflict', async () => {
    routes = [POST_USERS_409, USERNAME_LOOKUP_MISS, EMAIL_PROBE([CONFLICTING_USER])];

    await expect(
      convergeUser('tok', REALM, {
        username: 'testadmin',
        email: 'testadmin@e2e.test',
        password: credentialsOf('testadmin').password
      })
    ).rejects.toThrow(/someone-else owns testadmin@e2e\.test: an email conflict/);
  });

  test('an empty email probe names the account as deleted mid-provisioning', async () => {
    routes = [POST_USERS_409, USERNAME_LOOKUP_MISS, EMAIL_PROBE([])];

    await expect(
      convergeUser('tok', REALM, {
        username: 'testadmin',
        email: 'testadmin@e2e.test',
        password: credentialsOf('testadmin').password
      })
    ).rejects.toThrow(/was deleted mid-provisioning/);
  });

  test('a failed email probe fails loudly instead of guessing', async () => {
    routes = [POST_USERS_409, USERNAME_LOOKUP_MISS, ['GET', /email=/, { status: 403, data: null }]];

    await expect(
      convergeUser('tok', REALM, {
        username: 'testadmin',
        email: 'testadmin@e2e.test',
        password: credentialsOf('testadmin').password
      })
    ).rejects.toThrow(/email-ownership probe for testadmin@e2e\.test could not run \(HTTP 403\)/);
  });

  test('a transport failure of the probe is transient, so the retry budget can save the provisioning', async () => {
    // No email-probe route: the fake transport rejects, which is what a
    // wedged Keycloak does between two requests.
    routes = [POST_USERS_409, USERNAME_LOOKUP_MISS];

    let caught;
    try {
      await convergeUser('tok', REALM, {
        username: 'testadmin',
        email: 'testadmin@e2e.test',
        password: credentialsOf('testadmin').password
      });
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
      ['POST', new RegExp(`/auth/admin/realms/${REALM}/users$`), { status: 409, data: null }],
      [
        'GET',
        new RegExp(`/auth/admin/realms/${REALM}/users\\?username=testadmin&exact=true$`),
        { status: 200, data: [{ id: 'user-1', username: 'testadmin', enabled: true, emailVerified: true }] }
      ],
      ['PUT', new RegExp(`/auth/admin/realms/${REALM}/users/user-1/reset-password$`), { status: 404, data: null }]
    ];

    await expect(
      convergeUser('tok', REALM, {
        username: 'testadmin',
        email: 'testadmin@e2e.test',
        password: credentialsOf('testadmin').password
      })
    ).rejects.toThrow(/deleted between the lookup and the password reset/);
  });
});
