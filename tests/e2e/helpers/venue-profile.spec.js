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
const REAL_GET_SESSION_TOKEN = auth.getSessionTokenViaUI;
const REAL_OPEN_VENUE_SESSION = auth.openVenueSession;
const PROFILE_PATH = require.resolve('./venue-profile');

/** A fresh, uncached copy of the helper. */
function freshProfile() {
  delete require.cache[PROFILE_PATH];
  return require('./venue-profile');
}

test.afterEach(() => {
  auth.request = REAL_REQUEST;
  auth.getAdminToken = REAL_GET_ADMIN_TOKEN;
  auth.getSessionTokenViaUI = REAL_GET_SESSION_TOKEN;
  auth.openVenueSession = REAL_OPEN_VENUE_SESSION;
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
    // A plain stub: it hands back exactly the answer it was given. The
    // real transport's response contract — JSON parsing, the raw escape
    // hatch, the non-JSON rejection — is owned by helpers/auth-request
    // .spec.js at the transport's own boundary (#1804); this fake does
    // not re-implement it. The probes under test already pass the right
    // shape (raw text for the runtime config, arrays/null for the admin
    // API), so a probe reading the wrong shape fails on its own reads.
    return Promise.resolve({ status: answer.status, data: answer.data, headers: {} });
  };
  return calls;
}

/**
 * The venue session the probes open: a realm token, and the locale the app
 * adopted in that session. The real session launches a browser and logs in —
 * the unit spec fakes it, and `adopted` overrides the locale the fake app
 * reports (the default is the locale the session was opened with).
 */
function fakeVenueSession({ adopted, at } = {}) {
  const sessions = { count: 0 };
  auth.getSessionTokenViaUI = async () => 'fake-session-token';
  auth.openVenueSession = async ({ locale } = {}) => {
    sessions.count += 1;
    return {
      token: 'fake-session-token',
      adopted: adopted || locale || 'en',
      at: typeof at === 'function' ? at() : Date.now()
    };
  };
  return sessions;
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
        data: '// okfEnabled: "1" turns the Studio on\nwindow.APP_CONFIG = {\n  okfEnabled: "0",\n};\n'
      }
    ]);
    const profile = freshProfile();
    expect(await profile.okfEnabled()).toBe(false);
  });

  test('a foreign key that merely contains the name is not the knob', async () => {
    fakeTransport([{ status: 200, data: 'window.APP_CONFIG = {\n  notOkfEnabled: "1",\n  okfEnabled: "0",\n};\n' }]);
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
      { status: 200, data: 'window.APP_CONFIG = {\n  okfEnabled: "0",\n};\n' }
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

test.describe('the venue-skip wiring (#1773)', () => {
  // A fake of the Playwright `test` object: the registrars take it as an
  // argument exactly so this spec can observe the wiring — the assertions
  // are about WHAT the hooks decide, not about Playwright itself.
  const fakeTest = () => {
    const calls = [];
    return { calls, skip: (condition, description) => calls.push({ condition, description }) };
  };

  test('skipUnlessVenue skips with the reason when the probe fails', async () => {
    const testApi = fakeTest();
    const hook = freshProfile().skipUnlessVenue(
      testApi,
      async () => false,
      () => 'the surface is absent'
    );
    await hook();
    expect(testApi.calls).toEqual([{ condition: true, description: 'the surface is absent' }]);
  });

  test('skipUnlessVenue calls skip(false) when the probe holds', async () => {
    const testApi = fakeTest();
    const hook = freshProfile().skipUnlessVenue(
      testApi,
      async () => true,
      () => 'unused'
    );
    await hook();
    expect(testApi.calls).toEqual([{ condition: false, description: 'unused' }]);
  });

  test('skipUnlessVenue awaits an async reason', async () => {
    const testApi = fakeTest();
    await freshProfile().skipUnlessVenue(
      testApi,
      async () => false,
      async () => 'async reason'
    )();
    expect(testApi.calls.map((c) => c.description)).toEqual(['async reason']);
  });

  test('skipUnlessVenue passes the probe verdict through, not its inverse', async () => {
    const testApi = fakeTest();
    await freshProfile().skipUnlessVenue(
      testApi,
      async () => 'truthy-but-not-boolean',
      () => 'r'
    )();
    expect(testApi.calls[0].condition).toBe(false);
  });
});

test.describe('the hook-skip contract the guarded specs stand on (#1773)', () => {
  // The guarded beforeAlls register the registrar itself as their FIRST
  // hook: when it skips, Playwright must not run the hooks that follow —
  // that is what keeps a skipped spec from minting a user into the
  // venue's realm. This pins the Playwright behaviour the shape leans on
  // (verified by hand 2026-11-13; if Playwright ever runs them, the
  // mint-guard silently dies).
  let bodyRan = false;

  test.describe('a group whose first hook skips', () => {
    test.beforeAll(async () => {
      test.skip(true, 'the venue lacks the surface');
    });
    test.beforeAll(async () => {
      bodyRan = true;
    });
    test('never runs', () => {
      expect(1).toBe(2);
    });
  });

  test('the hook after the skipped hook did not run', () => {
    expect(bodyRan).toBe(false);
  });
});

test.describe('the locale whitelist probe reads the config the frontend reads', () => {
  test('an empty whitelist keeps every locale active', async () => {
    fakeTransport([{ status: 200, data: 'window.APP_CONFIG = {\n  availableLocales: "",\n};\n' }]);
    const profile = freshProfile();
    expect(await profile.localeActive('fr')).toBe(true);
  });

  test('a config without the knob keeps every locale active', async () => {
    fakeTransport([{ status: 200, data: 'window.APP_CONFIG = {\n  apiUrl: "/api",\n};\n' }]);
    const profile = freshProfile();
    expect(await profile.localeActive('fr')).toBe(true);
  });

  test('no runtime config at all keeps every locale active (the dev-build arm)', async () => {
    fakeTransport([{ status: 404, data: null }]);
    const profile = freshProfile();
    expect(await profile.localeActive('fr')).toBe(true);
  });

  test('a whitelist that excludes the locale excludes it — and matches case-insensitively', async () => {
    // The frontend's rule (whitelist.js): trim, lowercase, compare. The
    // probe applies the same rule, arm for arm.
    fakeTransport([{ status: 200, data: 'window.APP_CONFIG = {\n  availableLocales: "en,es",\n};\n' }]);
    const profile = freshProfile();
    expect(await profile.localeActive('fr')).toBe(false);
    expect(await profile.localeActive('es')).toBe(true);
  });

  test('a whitelist carrying the locale in another case still admits it', async () => {
    fakeTransport([{ status: 200, data: 'window.APP_CONFIG = {\n  availableLocales: "EN,FR",\n};\n' }]);
    const profile = freshProfile();
    expect(await profile.localeActive('fr')).toBe(true);
  });

  test("'en' stays active even when the whitelist does not name it", async () => {
    // The frontend's rule (whitelist.js): 'en' is ALWAYS retained so
    // vue-i18n's fallbackLocale can resolve. A probe that said otherwise
    // would skip the default locale on a venue that serves it perfectly
    // well.
    fakeTransport([{ status: 200, data: 'window.APP_CONFIG = {\n  availableLocales: "es,fr",\n};\n' }]);
    const profile = freshProfile();
    expect(await profile.localeActive('en')).toBe(true);
    expect(await profile.localeActive('fr')).toBe(true);
    expect(await profile.localeActive('de')).toBe(false);
  });

  test('the skip reason renders the whitelist exactly and names the NOT-exercised verdict', async () => {
    fakeTransport([{ status: 200, data: 'window.APP_CONFIG = {\n  availableLocales: "en,es",\n};\n' }]);
    const profile = freshProfile();
    const reason = await profile.missingLocaleReason('fr');
    expect(reason).toContain('availableLocales="en,es"');
    expect(reason).toContain("'fr'");
    expect(reason).toMatch(/NOT exercised/);
  });
});

test.describe('the translation probe reads the venue through its own endpoint', () => {
  // The probe opens a realm session through the browser login (the faked
  // one here): a master-admin token is the wrong issuer for the backend.
  function fakeSessionMint() {
    fakeVenueSession();
  }

  test('a venue that translates the probe answers true, with the en→fr body', async () => {
    fakeSessionMint();
    const calls = fakeTransport([{ status: 200, data: { translated_texts: ['Bonjour'] }, headers: {} }]);
    const profile = freshProfile();
    expect(await profile.translatesTo('fr')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toBe('/api/translate');
    expect(calls[0].options.body.target_lang).toBe('fr');
    expect(calls[0].options.body.source_lang).toBe('en');
    expect(calls[0].options.headers.Authorization).toBe('Bearer fake-session-token');
  });

  test('the typed UNSUPPORTED_LANGUAGE refusal is the venue saying the language is absent', async () => {
    fakeSessionMint();
    fakeTransport([
      { status: 400, data: { error: 'UNSUPPORTED_LANGUAGE', message: 'Unsupported target language' }, headers: {} }
    ]);
    const profile = freshProfile();
    expect(await profile.translatesTo('fr')).toBe(false);
  });

  test('a 200 that echoes the source is a bug in the chain — it REDS, and it is not retried', async () => {
    // The status alone does not prove the chain translated anything: a body
    // that carries the source text back is a chain that did not translate.
    // That is a defect in the chain (operator ruling on #1984): the probe
    // throws, and the verdict is neither cached nor a skip.
    fakeSessionMint();
    const calls = fakeTransport([{ status: 200, data: { translated_texts: ['Hello'] }, headers: {} }]);
    const profile = freshProfile();
    await expect(profile.translatesTo('fr')).rejects.toThrow(/WITHOUT translating/);
    // ONE call: the probe is never re-issued.
    expect(calls).toHaveLength(1);
  });

  test('a 200 with no translated text is the same failure', async () => {
    fakeSessionMint();
    const calls = fakeTransport([{ status: 200, data: { translated_texts: [] }, headers: {} }]);
    const profile = freshProfile();
    await expect(profile.translatesTo('fr')).rejects.toThrow(/WITHOUT translating/);
    expect(calls).toHaveLength(1);
  });

  test('any other 400 is an unreadable venue, not an absent one', async () => {
    fakeSessionMint();
    fakeTransport([{ status: 400, data: { error: 'VALIDATION_ERROR' }, headers: {} }]);
    const profile = freshProfile();
    await expect(profile.translatesTo('fr')).rejects.toThrow(/venue profile is UNKNOWN/);
  });

  test('a 5xx is an unreadable venue too — loud, and never cached', async () => {
    fakeSessionMint();
    fakeTransport([
      { status: 503, data: { error: 'unavailable' }, headers: {} },
      { status: 200, data: { translated_texts: ['Bonjour'] }, headers: {} }
    ]);
    const profile = freshProfile();
    await expect(profile.translatesTo('fr')).rejects.toThrow(/HTTP 503/);
    // The failed probe left nothing cached: the next call re-reads the
    // venue in its own name instead of inheriting the error.
    expect(await profile.translatesTo('fr')).toBe(true);
  });
});

test.describe('the French streaming premise combines the venue facts', () => {
  test('a venue without the locale never asks the translation endpoint', async () => {
    fakeVenueSession();
    const calls = fakeTransport([
      { status: 200, data: 'window.APP_CONFIG = {\n  availableLocales: "en,es",\n};\n' },
      { status: 200, data: { translated_texts: ['Bonjour'] }, headers: {} }
    ]);
    const profile = freshProfile();
    expect(await profile.frenchStreamingReady()).toBe(false);
    // Exactly ONE call happened — the config read. The translation probe
    // was not spent on a venue whose locale already failed the premise.
    expect(calls).toHaveLength(1);
  });

  test('an active locale with no translation chain is a false, and the reason names the chain', async () => {
    fakeVenueSession();
    fakeTransport([
      { status: 200, data: 'window.APP_CONFIG = {\n  availableLocales: "",\n};\n' },
      { status: 400, data: { error: 'UNSUPPORTED_LANGUAGE', message: 'Unsupported target language' }, headers: {} }
    ]);
    const profile = freshProfile();
    expect(await profile.frenchStreamingReady()).toBe(false);
    const reason = await profile.frenchStreamingMissingReason();
    expect(reason).toMatch(/translation chain/);
    expect(reason).toMatch(/NOT exercised/);
  });

  test('both facts present is a ready venue', async () => {
    fakeVenueSession();
    fakeTransport([
      { status: 200, data: 'window.APP_CONFIG = {\n  availableLocales: "",\n};\n' },
      { status: 200, data: { translated_texts: ['Bonjour'] }, headers: {} }
    ]);
    const profile = freshProfile();
    expect(await profile.frenchStreamingReady()).toBe(true);
  });

  test('a build that does not carry the locale file fails the premise, and the reason says so', async () => {
    // The whitelist names 'fr', the build ships no fr.js: the app boots on
    // 'en'. The premise is the venue's answer to "can this deployment serve
    // this locale?", and the app is the only one that can answer it.
    fakeVenueSession({ adopted: 'en' });
    const calls = fakeTransport([
      { status: 200, data: 'window.APP_CONFIG = {\n  availableLocales: "en,fr",\n};\n' },
      { status: 200, data: { translated_texts: ['Bonjour'] }, headers: {} }
    ]);
    const profile = freshProfile();
    expect(await profile.frenchStreamingReady()).toBe(false);
    // The translation endpoint was never asked: the locale already failed.
    expect(calls).toHaveLength(1);
    const reason = await profile.frenchStreamingMissingReason();
    expect(reason).toMatch(/does not adopt the locale 'fr'/);
    expect(reason).toMatch(/NOT exercised/);
  });
});

test.describe('the ingest-chain canary uploads, ingests, and cleans up', () => {
  function fakeSessionMint() {
    fakeVenueSession();
  }

  const uploaded = (fileId) => ({
    status: 201,
    data: { success: true, data: { file_id: fileId, file_name: 'ingest-probe-canary.md' } },
    headers: {}
  });
  const recordRead = (fileId, status) => ({
    status: 200,
    data: { success: true, data: { file_id: fileId, file_name: 'ingest-probe-canary.md', dataprep: { status } } },
    headers: {}
  });

  test('a canary that reaches Ingested is a ready venue — and leaves nothing behind', async () => {
    fakeSessionMint();
    const calls = fakeTransport([
      uploaded('c1'),
      { status: 200, data: { success: true }, headers: {} },
      recordRead('c1', 'Ingested'),
      recordRead('c1', 'Ingested'),
      { status: 200, data: { success: true }, headers: {} }
    ]);
    const profile = freshProfile();
    expect(await profile.ingestChainReady()).toBe(true);
    // The whole conversation, in order: upload, ingest, the wait's reads,
    // the cleanup's record read and delete.
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/files/upload',
      'POST /api/files/c1/ingest',
      'GET /api/files/c1',
      'GET /api/files/c1',
      'DELETE /api/files/c1'
    ]);
  });

  test('a canary that lands Ingestion Error is NOT a ready venue, and the reason says what happened', async () => {
    fakeSessionMint();
    fakeTransport([
      uploaded('c1'),
      { status: 200, data: { success: true }, headers: {} },
      recordRead('c1', 'Ingestion Error'),
      recordRead('c1', 'Ingestion Error'),
      { status: 200, data: { success: true }, headers: {} }
    ]);
    const profile = freshProfile();
    expect(await profile.ingestChainReady()).toBe(false);
    const reason = await profile.ingestChainMissingReason();
    expect(reason).toContain('Ingestion Error');
    expect(reason).toMatch(/NOT exercised/);
  });

  test('a venue that cannot accept the upload is UNREADABLE — loud, not a false verdict', async () => {
    fakeSessionMint();
    fakeTransport([
      { status: 500, data: { success: false, error: 'boom' }, headers: {} },
      // The cleanup's prefix sweep: nothing was committed under the name.
      { status: 200, data: { data: [] }, headers: {} }
    ]);
    const profile = freshProfile();
    await expect(profile.ingestChainReady()).rejects.toThrow(/could not read the venue/);
  });

  test('a canary that lands Ingested with Warnings is NOT a ready venue — the specs assert the exact status', async () => {
    // The degraded status is indexed, but it is not the 'Ingested' the
    // specs assert: a premise that admitted it would run the specs on a
    // venue they would red on. The reason names the status it landed.
    fakeSessionMint();
    fakeTransport([
      uploaded('c1'),
      { status: 200, data: { success: true }, headers: {} },
      recordRead('c1', 'Ingested with Warnings'),
      // The cleanup's record read, then its delete.
      {
        status: 200,
        data: { success: true, data: { file_id: 'c1', file_name: 'ingest-probe-canary.md' } },
        headers: {}
      },
      { status: 200, data: { success: true }, headers: {} }
    ]);
    const profile = freshProfile();
    expect(await profile.ingestChainReady()).toBe(false);
    const reason = await profile.ingestChainMissingReason();
    expect(reason).toContain('Ingested with Warnings');
  });

  test('a canary that lands Ingested with Warnings MID-WAIT ends the wait at once, named', async () => {
    // The degraded status can arrive on the wait's SECOND read: the wait
    // must end there — polling a status that will not change would burn
    // the whole budget to say the same thing.
    fakeSessionMint();
    fakeTransport([
      uploaded('c1'),
      { status: 200, data: { success: true }, headers: {} },
      recordRead('c1', 'Pending'),
      recordRead('c1', 'Ingested with Warnings'),
      // The cleanup's record read, then its delete.
      {
        status: 200,
        data: { success: true, data: { file_id: 'c1', file_name: 'ingest-probe-canary.md' } },
        headers: {}
      },
      { status: 200, data: { success: true }, headers: {} }
    ]);
    const profile = freshProfile();
    expect(await profile.ingestChainReady()).toBe(false);
    const reason = await profile.ingestChainMissingReason();
    expect(reason).toContain('Ingested with Warnings');
  });

  test('a canary that cannot be removed FAILS the probe — a leftover stays in the venue corpus', async () => {
    fakeSessionMint();
    fakeTransport([
      uploaded('c1'),
      { status: 200, data: { success: true }, headers: {} },
      recordRead('c1', 'Ingested'),
      // The cleanup's record read, then a delete the venue refuses.
      {
        status: 200,
        data: { success: true, data: { file_id: 'c1', file_name: 'ingest-probe-canary.md' } },
        headers: {}
      },
      { status: 500, data: { success: false, error: 'boom' }, headers: {} }
    ]);
    const profile = freshProfile();
    // The chain WAS ready — and the run cannot certify it while it leaves
    // a canary document behind in a corpus the next run's questions read.
    await expect(profile.ingestChainReady()).rejects.toThrow(/cleanup failed/);
  });
});

test.describe('the venue session is bounded by its own age', () => {
  test('a session past the bound is re-opened — a realm token lives 300 s', async () => {
    // The cached session is older than the bound: the probe must not hand
    // its expired token to the next call.
    const sessions = fakeVenueSession({ at: () => Date.now() - 200000 });
    const profile = freshProfile();
    expect(await profile.localeAdopted('fr')).toBe(true);
    expect(sessions.count).toBe(1);
    expect(await profile.localeAdopted('fr')).toBe(true);
    expect(sessions.count).toBe(2);
  });

  test('a session inside the bound is reused — one login, not one per probe', async () => {
    const sessions = fakeVenueSession();
    const profile = freshProfile();
    expect(await profile.localeAdopted('fr')).toBe(true);
    expect(await profile.localeAdopted('fr')).toBe(true);
    expect(sessions.count).toBe(1);
  });
});
