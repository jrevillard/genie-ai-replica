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
} = require('./keycloak-admin');

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
      return Promise.resolve({ status: answer.status, data: answer.data, headers: answer.headers });
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
  password: ADMIN_FIXTURE.password,
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
      ['POST', ROLE_MAPPINGS_PATH, { status: 204, data: null }],
    ];

    await assignRealmRoles('tok', REALM, 'user-1', ['admin']);

    expect(calls).toEqual([
      `GET /auth/admin/realms/${REALM}/roles/admin`,
      `POST /auth/admin/realms/${REALM}/users/user-1/role-mappings/realm`,
    ]);
  });

  test('names a missing role and never posts the assignment', async () => {
    routes = [
      ['GET', ROLE_PATH('ghost'), { status: 404, data: null }],
      ['GET', REALM_PATH, { status: 200, data: { realm: REALM } }],
    ];

    await expect(assignRealmRoles('tok', REALM, 'user-1', ['ghost'])).rejects.toThrow(
      'Roles not found in realm genie: ghost'
    );
    expect(calls).toEqual([`GET /auth/admin/realms/${REALM}/roles/ghost`, `GET /auth/admin/realms/${REALM}`]);
  });

  test('a 404 on a realm that does not exist fails loudly instead of blaming the role', async () => {
    routes = [
      ['GET', ROLE_PATH('admin'), { status: 404, data: null }],
      ['GET', REALM_PATH, { status: 404, data: null }],
    ];

    await expect(assignRealmRoles('tok', REALM, 'user-1', ['admin'])).rejects.toThrow(/The realm genie does not exist/);
    expect(calls).not.toContain(`POST /auth/admin/realms/${REALM}/users/user-1/role-mappings/realm`);
  });

  test('a realm read that the admin API refuses is not reported as a missing realm', async () => {
    routes = [
      ['GET', ROLE_PATH('admin'), { status: 404, data: null }],
      ['GET', REALM_PATH, { status: 401, data: { error: 'HTTP 401 Unauthorized' } }],
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
      ['DELETE', ROLE_MAPPINGS_PATH, { status: 204, data: null }],
    ];

    const removed = await removeRealmRoles('tok', REALM, 'user-1', ['admin']);

    expect(removed).toEqual(['admin']);
    expect(calls).toEqual([
      `GET /auth/admin/realms/${REALM}/roles/admin`,
      `DELETE /auth/admin/realms/${REALM}/users/user-1/role-mappings/realm`,
    ]);
  });

  test('a role the realm does not carry is skipped without a DELETE', async () => {
    routes = [
      ['GET', ROLE_PATH('ghost'), { status: 404, data: null }],
      ['GET', REALM_PATH, { status: 200, data: { realm: REALM } }],
    ];

    const removed = await removeRealmRoles('tok', REALM, 'user-1', ['ghost']);

    expect(removed).toEqual([]);
    expect(calls).toEqual([`GET /auth/admin/realms/${REALM}/roles/ghost`, `GET /auth/admin/realms/${REALM}`]);
  });

  test('a realm that does not exist leaves nothing to remove', async () => {
    routes = [
      ['GET', ROLE_PATH('admin'), { status: 404, data: null }],
      ['GET', REALM_PATH, { status: 404, data: null }],
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
            { id: 'r2', name: 'default-roles-genie' },
          ],
        },
      ],
    ];

    const effective = await effectiveRealmRoles('tok', REALM, 'user-1');

    expect(effective).toEqual(['admin', 'default-roles-genie']);
    // The listing endpoint is paginated — the effective roles are the
    // MAPPINGS of the user, so the listing must not be consulted.
    expect(calls.some((call) => call.endsWith(`/auth/admin/realms/${REALM}/roles`))).toBe(false);
  });
});

test.describe('convergeUser diagnoses a 409 whose username lookup misses', () => {
  const POST_USERS_409 = ['POST', USERS_PATH, { status: 409, data: null }];
  const USERNAME_LOOKUP_MISS = ['GET', USERNAME_LOOKUP, { status: 200, data: [] }];
  const EMAIL_PROBE = (data) => [['GET', EMAIL_LOOKUP, { status: 200, data }]];

  test('an account owning the fixture email is named as an email conflict', async () => {
    routes = [
      POST_USERS_409,
      USERNAME_LOOKUP_MISS,
      ...EMAIL_PROBE([{ username: 'someone-else', email: ADMIN_FIXTURE.email }]),
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
      ['GET', EMAIL_LOOKUP, { throws: new Error('connection reset by peer') }],
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
    expect(caught.message).toMatch(/User lookup for testadmin in realm genie failed: HTTP 500/);
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
    expect(caught.message).toMatch(/answered a non-array payload/);
    expect(calls.some((call) => call.includes('email='))).toBe(false);
  });
});

test.describe('convergeUser diagnoses a password reset on a vanished account', () => {
  test('a 404 reset names the account as deleted between lookup and reset', async () => {
    routes = [
      ['POST', USERS_PATH, { status: 409, data: null }],
      [
        'GET',
        USERNAME_LOOKUP,
        { status: 200, data: [{ id: 'user-1', username: ADMIN_FIXTURE.username, enabled: true, emailVerified: true }] },
      ],
      ['PUT', RESET_PASSWORD_PATH, { status: 404, data: null }],
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
  const POST_USERS_409 = ['POST', USERS_PATH, { status: 409, data: null }];
  const USERNAME_LOOKUP_MISS = ['GET', USERNAME_LOOKUP, { status: 200, data: [] }];

  test('an account owning the fixture email is named as an email conflict', async () => {
    routes = [
      POST_USERS_409,
      USERNAME_LOOKUP_MISS,
      ['GET', EMAIL_LOOKUP, { status: 200, data: [{ username: 'someone-else', email: ADMIN_FIXTURE.email }] }],
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

    await expect(createUser('tok', REALM, ADMIN_USER)).rejects.toThrow(
      new RegExp(`email-ownership probe for ${ADMIN_FIXTURE.email.replaceAll('.', '\\.')} could not run`)
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
    expect(caught.message).toMatch(/User lookup for testadmin in realm genie failed: HTTP 401/);
    expect(caught.message).not.toMatch(/email conflict|deleted mid-provisioning/);
    expect(calls.some((call) => call.includes('email='))).toBe(false);
  });

  test('a create that did NOT answer 409 is reported as-is, with no probe', async () => {
    // The diagnosis exists for the 409 shape only: a vanished account on a
    // 201 create has no conflict to explain, and probing would invent one.
    routes = [
      ['POST', USERS_PATH, { status: 201, data: null }],
      ['GET', USERNAME_LOOKUP, { status: 200, data: [] }],
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

test.describe('rotateRealmKeys reads the new key id from the Location header', () => {
  const COMPONENTS_PATH = new RegExp(`/auth/admin/realms/${REALM}/components`);
  const OLD_KEYS = [
    {
      id: 'old-key-1',
      name: 'rsa-generated',
      providerId: 'rsa-generated',
      providerType: 'org.keycloak.keys.KeyProvider',
      config: { priority: ['0'], enabled: ['true'], active: ['true'] },
    },
    {
      id: 'old-key-2',
      name: 'rsa-generated-rotated-1',
      providerId: 'rsa-generated',
      providerType: 'org.keycloak.keys.KeyProvider',
      config: { priority: ['100'], enabled: ['true'], active: ['false'] },
    },
  ];

  // The two reads every rotation performs before the create: the realm's
  // id and the existing key providers.
  const BASE_ROUTES = [
    ['GET', REALM_PATH, { status: 200, data: { id: 'realm-uuid' } }],
    ['GET', COMPONENTS_PATH, { status: 200, data: OLD_KEYS }],
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
          headers: { location: `/auth/admin/realms/${REALM}/components/new-key-id` },
        },
      ],
      ['PUT', /\/auth\/admin\/realms\/genie\/components\/old-key-[12]$/, { status: 204, data: null }],
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
    // No old key was demoted behind a creation whose id was never resolved.
    expect(calls.some((c) => c.startsWith('PUT '))).toBe(false);
  });

  test('a Location header carrying no id segment fails loudly instead of yielding garbage', async () => {
    // A proxy-rewritten or truncated header answers with the collection
    // URL only: reading its last segment would mint the id 'components'.
    routes = [
      ...BASE_ROUTES,
      ['POST', COMPONENTS_PATH, { status: 201, data: null, headers: { location: `/auth/admin/realms/${REALM}/components/` } }],
    ];

    let caught;
    try {
      await rotateRealmKeys('tok', REALM);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toMatch(/answered 201 without a usable Location header/);
    expect(calls.some((c) => c.startsWith('PUT '))).toBe(false);
  });
});
