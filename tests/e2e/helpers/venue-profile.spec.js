// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const auth = require('./auth');

/**
 * Unit spec for the venue-profile probe.
 *
 * The transport (auth.request) is faked per test — the assertions are about
 * HOW the probe reads the venue and what it concludes, not about the venue
 * itself, so no deployment is needed. The real transport is restored after
 * every test.
 *
 * The module is required FRESH in every test: its caches are per-process,
 * and a cache that survived a test would answer the next one from the
 * previous one's venue.
 */
const REAL_REQUEST = auth.request;
const REAL_GET_ADMIN_TOKEN = auth.getAdminToken;
const PROFILE_PATH = require.resolve('./venue-profile');

/** A fresh, uncached copy of the helper. */
function freshProfile() {
  delete require.cache[PROFILE_PATH];
  return require('./venue-profile');
}

test.afterEach(() => {
  auth.request = REAL_REQUEST;
  auth.getAdminToken = REAL_GET_ADMIN_TOKEN;
});

/** The fake transport: a queue of answers, one per call. */
function fakeTransport(answers) {
  const calls = [];
  // The realm probes authenticate with an admin token; the fake transport
  // answers the API calls, so the mint is faked with it.
  auth.getAdminToken = async () => 'fake-admin-token';
  auth.request = (method, path, options) => {
    calls.push({ method, path, options });
    const answer = answers.shift();
    if (!answer) return Promise.reject(new Error(`fake transport: no answer for ${method} ${path}`));
    if (answer.throws) return Promise.reject(answer.throws);
    // The real transport (helpers/auth.js) parses the body as JSON
    // unless the caller asks for it raw, and REJECTS a non-JSON body.
    // The fake does the same, so a probe that forgets `raw: true` fails
    // the way the venue would fail — instead of quietly reading a body
    // the real transport would have refused.
    if (!(options && options.raw) && typeof answer.data === 'string') {
      try {
        return Promise.resolve({ status: answer.status, data: JSON.parse(answer.data), headers: {} });
      } catch {
        const error = new Error(
          `${method} ${path} returned a non-JSON body (HTTP ${answer.status}): ${answer.data.slice(0, 200)}`
        );
        error.nonJsonBody = true;
        error.status = answer.status;
        return Promise.reject(error);
      }
    }
    return Promise.resolve({ status: answer.status, data: answer.data, headers: {} });
  };
  return calls;
}

test.describe('the OKF probe reads the venue like the frontend reads it', () => {
  // The frontend's rule, arm for arm — components/gov-chat-frontend/src/utils/okfFlag.js.
  // A probe that disagrees with the product turns a skip into a red spec.

  test("the string '1' enables the OKF surfaces", async () => {
    fakeTransport([{ status: 200, data: 'window.APP_CONFIG = {\n  okfEnabled: "1",\n};\n' }]);
    const profile = freshProfile();
    expect(await profile.okfEnabled()).toBe(true);
  });

  test("the string '0' parks them", async () => {
    fakeTransport([{ status: 200, data: 'window.APP_CONFIG = {\n  okfEnabled: "0",\n};\n' }]);
    const profile = freshProfile();
    expect(await profile.okfEnabled()).toBe(false);
  });

  test('any other value fails closed, exactly like the frontend', async () => {
    // 'true' is the near-miss the flag exists to reject: a typo must never
    // silently enable the Studio.
    fakeTransport([{ status: 200, data: 'window.APP_CONFIG = {\n  okfEnabled: "true",\n};\n' }]);
    const profile = freshProfile();
    expect(await profile.okfEnabled()).toBe(false);
  });

  test('a config without the knob fails closed too', async () => {
    fakeTransport([{ status: 200, data: 'window.APP_CONFIG = {\n  apiUrl: "/api",\n};\n' }]);
    const profile = freshProfile();
    expect(await profile.okfEnabled()).toBe(false);
  });

  test('no runtime config at all means the surfaces render (the dev-build arm)', async () => {
    fakeTransport([{ status: 404, data: null }]);
    const profile = freshProfile();
    expect(await profile.okfEnabled()).toBe(true);
  });

  test('a numeric 1 is a different writer and does not enable them', async () => {
    // Strict equality: the frontend does not coerce.
    fakeTransport([{ status: 200, data: 'window.APP_CONFIG = {\n  okfEnabled: 1,\n};\n' }]);
    const profile = freshProfile();
    expect(await profile.okfEnabled()).toBe(false);
  });

  test('a comment naming the knob before the assignment is not the assignment', async () => {
    // The probe reads the ASSIGNMENT: a config whose header comment shows
    // the enabled value must not enable the Studio.
    fakeTransport([
      {
        status: 200,
        data: '// okfEnabled: "1" turns the Studio on\nwindow.APP_CONFIG = {\n  okfEnabled: "0",\n};\n',
      },
    ]);
    const profile = freshProfile();
    expect(await profile.okfEnabled()).toBe(false);
  });

  test('a foreign key that merely contains the name is not the knob', async () => {
    fakeTransport([
      { status: 200, data: 'window.APP_CONFIG = {\n  notOkfEnabled: "1",\n  okfEnabled: "0",\n};\n' },
    ]);
    const profile = freshProfile();
    expect(await profile.okfEnabled()).toBe(false);
  });

  test('the skip reason names the value the venue carries', async () => {
    fakeTransport([{ status: 200, data: 'window.APP_CONFIG = {\n  okfEnabled: "0",\n};\n' }]);
    const profile = freshProfile();
    const reason = await profile.okfParkedReason();
    // The value is rendered precisely — a string carries its quotes, a
    // number does not.
    expect(reason).toContain('okfEnabled="0"');
    // The reason is the only record of why a spec did not run: it must say
    // that the surface was NOT exercised.
    expect(reason).toMatch(/NOT exercised/);
  });

  test('an unreadable venue fails loudly — it is not an absent surface', async () => {
    fakeTransport([{ status: 500, data: null }]);
    const profile = freshProfile();
    await expect(profile.okfEnabled()).rejects.toThrow(/venue profile is UNKNOWN/);
  });

  test('a failed probe is not cached: the next read sees the venue again', async () => {
    const calls = fakeTransport([
      { throws: new Error('connection reset') },
      { status: 200, data: 'window.APP_CONFIG = {\n  okfEnabled: "0",\n};\n' },
    ]);
    const profile = freshProfile();
    await expect(profile.okfEnabled()).rejects.toThrow(/connection reset/);
    // The second read must reach the transport again — a cached failure
    // would answer from the first one.
    expect(await profile.okfEnabled()).toBe(false);
    expect(calls.length).toBe(2);
  });

  test('a successful probe is cached: one read per process', async () => {
    const calls = fakeTransport([{ status: 200, data: 'window.APP_CONFIG = {\n  okfEnabled: "1",\n};\n' }]);
    const profile = freshProfile();
    expect(await profile.okfEnabled()).toBe(true);
    expect(await profile.okfEnabled()).toBe(true);
    expect(calls.length).toBe(1);
  });
});

test.describe('the realm probes read the admin API', () => {
  test('a realm that answers 404 does not exist', async () => {
    fakeTransport([{ status: 404, data: null }]);
    const profile = freshProfile();
    expect(await profile.realmExists('genie2')).toBe(false);
  });

  test('a realm that answers 200 exists', async () => {
    fakeTransport([{ status: 200, data: { realm: 'genie2' } }]);
    const profile = freshProfile();
    expect(await profile.realmExists('genie2')).toBe(true);
  });

  test('an admin API that refuses fails loudly — the profile is UNKNOWN', async () => {
    fakeTransport([{ status: 403, data: null }]);
    const profile = freshProfile();
    await expect(profile.realmExists('genie2')).rejects.toThrow(/venue profile is UNKNOWN/);
  });

  test('a realm with no identity provider answers false', async () => {
    fakeTransport([{ status: 200, data: [] }]);
    const profile = freshProfile();
    expect(await profile.hasIdentityProvider('genie')).toBe(false);
  });

  test('a realm with an identity provider answers true', async () => {
    fakeTransport([{ status: 200, data: [{ alias: 'external-idp' }] }]);
    const profile = freshProfile();
    expect(await profile.hasIdentityProvider('genie')).toBe(true);
  });

  test('the missing-realm reason names the prerequisite and the unexercised surface', () => {
    const profile = freshProfile();
    const reason = profile.missingRealmReason('genie2');
    expect(reason).toContain('genie2');
    expect(reason).toContain('Phase 0 step 0.6');
    expect(reason).toMatch(/NOT exercised/);
  });

  test('the missing-IdP reason names the prerequisite and the unexercised surface', () => {
    const profile = freshProfile();
    const reason = profile.missingIdentityProviderReason('genie');
    expect(reason).toContain('Phase D steps 1-5');
    expect(reason).toMatch(/NOT exercised/);
  });
});
