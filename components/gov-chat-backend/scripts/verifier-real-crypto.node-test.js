// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// Real-crypto tests for the shared OIDC verifier
// (components/shared/lib/keycloak-auth-service.js — the single copy the
// backend re-exports). Runs on Node's built-in test runner:
//
//   node --test scripts/verifier-real-crypto.node-test.js
//
// WHY NOT JEST: the jest suites must stub `jose` entirely (the jest runtime
// cannot require the ESM-only package), so a wrong-aud or alg-confusion token
// can never be exercised through jose's real verification path there — the
// exact gap the pre-consolidation jest suites carried (their jwtVerify stubs
// never exercised jose's real verification). Here the
// verifier loads for real; only the two HTTP legs (OIDC discovery + JWKS) are
// served by a stubbed global.fetch, and the keys/tokens are real RSA/RS256
// material built with the same jose package (the prescription:
// generateKeyPair + exportJWK, stubbed fetch, real wrong-aud token).
//
// The issuer cases use the public-API form: accept/reject on real-shaped
// tokens — never internal map-state assertions.

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { SignJWT, jwtVerify } = require('jose');

const KEYCLOAK_URL = 'http://keycloak:8080';
const DISCOVERY_ISSUER = `${KEYCLOAK_URL}/realms/genie`;
const JWKS_URI = `${DISCOVERY_ISSUER}/protocol/openid-connect/certs`;

// One RSA pair stands in for the realm's signing key, exported as JWK so the
// stubbed JWKS document is byte-real (jose imports the keys exactly as it
// would from a live Keycloak certs endpoint). A SECOND pair stands in for an
// additional ("partner") realm — different keys, so a cross-realm clobber of
// a map entry cannot accidentally still verify.
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'jwk' },
  privateKeyEncoding: { type: 'pkcs8', format: 'jwk' }
});
const { publicKey: partnerPublicKey, privateKey: partnerPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'jwk' },
  privateKeyEncoding: { type: 'pkcs8', format: 'jwk' }
});
const JWKS = {
  keys: [
    { ...publicKey, kid: 'test-key', alg: 'RS256', use: 'sig' },
    // A second key whose kid no token names: a token that names NO key id
    // then has two candidates, and jose raises JWKSMultipleMatchingKeys —
    // the token-side ambiguity the verifier must not report as an outage.
    { ...partnerPublicKey, kid: 'second-key', alg: 'RS256', use: 'sig' }
  ]
};
const PARTNER_JWKS_URI = `${KEYCLOAK_URL}/realms/partner/protocol/openid-connect/certs`;
const PARTNER_JWKS = { keys: [{ ...partnerPublicKey, kid: 'partner-key', alg: 'RS256', use: 'sig' }] };

// Stub both HTTP legs the verifier performs: OIDC discovery (fetch with an
// AbortController signal) and the JWKS document (jose's createRemoteJWKSet
// fetches through global fetch too). Discovery docs are derived per realm
// from the requested URL, so additional-realm inits get their own issuer and
// JWKS — the shape a real multi-realm Keycloak serves.
const fetchCalls = [];
// Mid-life outage switch: the JWKS endpoint starts REFUSING requests after a
// successful init — the topology #1723 describes (the key set is cached, the
// auth service goes down, and the next key-set fetch must be classified as an
// outage rather than as a bad token).
let jwksDown = false;
global.fetch = async (url, opts) => {
  const u = String(url);
  fetchCalls.push(u);
  // Both stall topologies settle ONLY on the AbortController signal — the
  // discovery-timeout guard can fire only if fetch honors it.
  const abortOnlyPromise = () =>
    new Promise((resolve, reject) => {
      const signal = opts && opts.signal;
      if (signal) {
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
        );
      }
      // No timer: only the abort settles this promise.
    });
  // A slow-body host resolves the fetch (ok:true) then hangs in json() —
  // the response-body half of the abort window. Without the abort guard
  // covering the body read, init would hang past the budget here.
  if (u.includes('slow-body')) {
    return {
      ok: true,
      status: 200,
      json: abortOnlyPromise
    };
  }
  // A hanging host never answers at all — the fetch-phase half.
  if (u.includes('hang')) {
    return abortOnlyPromise();
  }
  // An unreachable host refuses every request (503) — the init-failure
  // topology names its host 'unreachable' to land here.
  if (u.includes('unreachable')) {
    return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) };
  }
  const realmMatch = /\/realms\/([^/?#]+)\/\.well-known/.exec(u);
  if (realmMatch) {
    const realmName = realmMatch[1];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        issuer: `${KEYCLOAK_URL}/realms/${realmName}`,
        jwks_uri: `${KEYCLOAK_URL}/realms/${realmName}/protocol/openid-connect/certs`
      })
    };
  }
  // The JWKS URIs share the discovery issuer prefix — the regex above is
  // still safe because it only matches /.well-known/ discovery paths.
  if (jwksDown && u.includes('/protocol/openid-connect/certs')) {
    return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) };
  }
  if (u === JWKS_URI) {
    return { ok: true, status: 200, json: async () => JWKS, headers: new Map([['cache-control', 'no-store']]) };
  }
  if (u === PARTNER_JWKS_URI) {
    return { ok: true, status: 200, json: async () => PARTNER_JWKS, headers: new Map([['cache-control', 'no-store']]) };
  }
  return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
};

// Fresh module instance per topology: the verifier caches discovery state and
// reads its env surface at module load.
function loadVerifier(env) {
  fetchCalls.length = 0; // per-topology recorder — no earlier test's traffic
  jwksDown = false; // per-topology outage switch
  delete require.cache[require.resolve('../../shared/lib/keycloak-auth-service.js')];
  for (const key of [
    'KEYCLOAK_URL',
    'KEYCLOAK_REALM',
    'KEYCLOAK_ADDITIONAL_REALMS',
    'KEYCLOAK_PUBLIC_URL',
    'KEYCLOAK_BROWSER_ISSUER',
    'KEYCLOAK_JWKS_URL',
    'KEYCLOAK_DISCOVERY_URL',
    'KEYCLOAK_EXPECTED_ISSUER',
    'KEYCLOAK_DISCOVERY_TIMEOUT_MS'
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, { KEYCLOAK_URL, KEYCLOAK_REALM: 'genie' }, env);
  // The script runs on Node's own runner (see the header): the SOURCE-tree
  // path is the only correct one here — this file never ships in an image,
  // and the jest moduleNameMapper that makes the `shared-lib` spelling work
  // does not apply to `node --test`.
  // eslint-disable-next-line local/no-runtime-unresolvable-shared-path
  return require('../../shared/lib/keycloak-auth-service.js');
}

function baseClaims(iss, extra = {}) {
  return {
    sub: 'user-1',
    iss,
    exp: Math.floor(Date.now() / 1000) + 300,
    realm_access: { roles: ['admin'] },
    ...extra
  };
}

const sign = async (claims, opts = {}) => {
  const key = opts.partner ? partnerPrivateKey : privateKey;
  const kid = opts.partner ? 'partner-key' : 'test-key';
  return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid }).sign(key);
};

test('azp tolerance: a valid token with a foreign azp verifies (no authorized-party check)', async () => {
  // Service accounts (dataprep-service, okf-service) carry an azp that
  // differs from any audience — the resource-server contract accepts any
  // valid token in the trusted realm regardless of azp. This test is the
  // executable guard for that tolerance: a hardening pass adding azp
  // validation fails here before service-account tokens start 401ing.
  const svc = loadVerifier();
  const token = await sign(baseClaims(DISCOVERY_ISSUER, { azp: 'some-other-client' }));
  const payload = await svc.verifyToken(token);
  assert.equal(payload.azp, 'some-other-client');
});

test('valid RS256 token verifies end-to-end (real signature path)', async () => {
  const svc = loadVerifier();
  const token = await sign(baseClaims(DISCOVERY_ISSUER));
  const payload = await svc.verifyToken(token);
  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.iss_sub, `${DISCOVERY_ISSUER}#user-1`);
});

test('tampered signature is rejected (TOKEN_INVALID)', async () => {
  const svc = loadVerifier();
  const token = await sign(baseClaims(DISCOVERY_ISSUER));
  const [h, p, sig] = token.split('.');
  const flipped = sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA');
  await assert.rejects(
    () => svc.verifyToken(`${h}.${p}.${flipped}`),
    (err) => err.code === 'TOKEN_INVALID'
  );
});

test('wrong-aud token with opts.audience is rejected as TOKEN_INVALID', async () => {
  const svc = loadVerifier();
  const token = await sign(baseClaims(DISCOVERY_ISSUER, { aud: 'other-client' }));
  await assert.rejects(
    () => svc.verifyToken(token, { audience: 'genie-app' }),
    (err) => err.code === 'TOKEN_INVALID' && /audience/i.test(err.message)
  );
});

test('matching-aud token with opts.audience verifies', async () => {
  const svc = loadVerifier();
  const token = await sign(baseClaims(DISCOVERY_ISSUER, { aud: 'genie-app' }));
  const payload = await svc.verifyToken(token, { audience: 'genie-app' });
  assert.equal(payload.aud, 'genie-app');
});

test('a STALE alg-confusion token reports TOKEN_EXPIRED (expiry outranks alg)', async () => {
  // Order is load-bearing: a token BOTH expired and alg-mismatched must
  // report TOKEN_EXPIRED (expiry outranks the algorithm mismatch) — this
  // test is the mutation gate for the exp-before-alg branch order.
  const svc = loadVerifier();
  const claims = baseClaims(DISCOVERY_ISSUER);
  claims.exp = Math.floor(Date.now() / 1000) - 10;
  const staleHsToken = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(Buffer.from('attacker-controlled-secret'));
  await assert.rejects(
    () => svc.verifyToken(staleHsToken),
    (err) => err.code === 'TOKEN_EXPIRED'
  );
});

test('HS256 alg-confusion token is rejected through the real path', async () => {
  const svc = loadVerifier();
  const hsToken = await new SignJWT(baseClaims(DISCOVERY_ISSUER))
    .setProtectedHeader({ alg: 'HS256' })
    .sign(Buffer.from('attacker-controlled-secret'));
  // The message names the dedicated alg-rejection branch (jose rejects the
  // header before any key resolution) — if the branch is ever deleted the
  // token still ends TOKEN_INVALID via the retry path, so the message is
  // the mutation-visible discriminator.
  await assert.rejects(
    () => svc.verifyToken(hsToken),
    (err) => err.code === 'TOKEN_INVALID' && /algorithm not allowed/.test(err.message)
  );
});

test('expired RS256 token maps to TOKEN_EXPIRED', async () => {
  const svc = loadVerifier();
  const claims = baseClaims(DISCOVERY_ISSUER);
  claims.exp = Math.floor(Date.now() / 1000) - 10;
  const token = await sign(claims);
  await assert.rejects(
    () => svc.verifyToken(token),
    (err) => err.code === 'TOKEN_EXPIRED'
  );
});

test('issuer outside the discovery map is rejected as Unknown issuer', async () => {
  const svc = loadVerifier();
  const token = await sign(baseClaims('http://evil.example/realms/genie'));
  await assert.rejects(
    () => svc.verifyToken(token),
    (err) => err.code === 'TOKEN_INVALID' && err.message === 'Unknown issuer'
  );
});

test('KEYCLOAK_PUBLIC_URL alias is accepted on a real token', async () => {
  const svc = loadVerifier({ KEYCLOAK_PUBLIC_URL: 'https://public.example/auth' });
  const publicIss = 'https://public.example/auth/realms/genie';
  const token = await sign(baseClaims(publicIss));
  const payload = await svc.verifyToken(token);
  assert.equal(payload.iss, publicIss);
});

test('browser-issuer alias works WITHOUT the JWKS override (drift closed)', async () => {
  // The env value is the literal issuer (doc-repo semantics: pushed verbatim
  // into the accepted-issuer set), not a URL prefix to derive from.
  const browserIss = 'https://localhost/auth/realms/genie';
  const svc = loadVerifier({ KEYCLOAK_BROWSER_ISSUER: browserIss });
  const token = await sign(baseClaims(browserIss));
  const payload = await svc.verifyToken(token);
  assert.equal(payload.iss, browserIss);
});

test('PUBLIC_URL and BROWSER_ISSUER set TOGETHER: both issuers accepted (both-aliases class)', async () => {
  // The original sequential-overwrite bug: the two alias variables were one overwritten
  // string, so setting both rejected public-issuer tokens. The aliases are
  // independent map entries — a regression to sequential overwrite fails
  // this test on whichever issuer lost its entry.
  const publicIss = 'https://public.example/auth/realms/genie';
  const browserIss = 'https://localhost/auth/realms/genie';
  const svc = loadVerifier({
    KEYCLOAK_PUBLIC_URL: 'https://public.example/auth',
    KEYCLOAK_BROWSER_ISSUER: browserIss
  });
  assert.equal((await svc.verifyToken(await sign(baseClaims(publicIss)))).iss, publicIss);
  assert.equal((await svc.verifyToken(await sign(baseClaims(browserIss)))).iss, browserIss);
  assert.equal((await svc.verifyToken(await sign(baseClaims(DISCOVERY_ISSUER)))).iss, DISCOVERY_ISSUER);
});

test('KEYCLOAK_EXPECTED_ISSUER pin: only the pinned issuer is accepted', async () => {
  const pinned = 'https://genie.example.org/auth/realms/genie';
  const svc = loadVerifier({ KEYCLOAK_EXPECTED_ISSUER: pinned });
  const pinnedToken = await sign(baseClaims(pinned));
  const payload = await svc.verifyToken(pinnedToken);
  assert.equal(payload.iss, pinned);
  // The discovery issuer is NOT accepted under the pin.
  const discoveryToken = await sign(baseClaims(DISCOVERY_ISSUER));
  await assert.rejects(
    () => svc.verifyToken(discoveryToken),
    (err) => err.code === 'TOKEN_INVALID'
  );
});

test('pin + additional realms: partner realms are skipped, the pinned entry survives', async () => {
  // The pin is the ONLY accepted issuer and belongs to the primary realm:
  // a partner realm's init could only ever produce entries the pin discards
  // (the multi-realm clobber class the primary-realm gate prevents), so
  // initAllRealms skips the partner leg entirely — no discovery fetch, no
  // misleading "initialized" log.
  const pinned = DISCOVERY_ISSUER;
  const svc = loadVerifier({
    KEYCLOAK_EXPECTED_ISSUER: pinned,
    KEYCLOAK_ADDITIONAL_REALMS: '["partner"]'
  });
  const primaryToken = await sign(baseClaims(pinned));
  const payload = await svc.verifyToken(primaryToken);
  assert.equal(payload.iss, pinned);
  // The partner discovery leg must NOT have run.
  const partnerDiscoveryUrl = `${KEYCLOAK_URL}/realms/partner/.well-known/openid-configuration`;
  assert.ok(
    !fetchCalls.some((c) => c === partnerDiscoveryUrl),
    'partner realm discovery was fetched — the pin skip did not apply'
  );
  // A partner-realm token carries a different iss than the pin — rejected.
  const partnerIss = `${KEYCLOAK_URL}/realms/partner`;
  const partnerToken = await sign(baseClaims(partnerIss), { partner: true });
  await assert.rejects(
    () => svc.verifyToken(partnerToken),
    (err) => err.code === 'TOKEN_INVALID' && err.message === 'Unknown issuer'
  );
});

test('pin + DIRECT partner init: the singleton is not poisoned by a registering-nothing init', async () => {
  // init(url) called directly with a partner URL while the pin is set
  // registers no issuer entry — it must NOT flip the lazy-init singleton,
  // or every later verifyToken dies 'Unknown issuer' with the retry path
  // permanently disabled. The pinned token must still verify afterwards.
  const pinned = DISCOVERY_ISSUER;
  const svc = loadVerifier({ KEYCLOAK_EXPECTED_ISSUER: pinned });
  const partnerUrl = `${KEYCLOAK_URL}/realms/partner`;
  // A partner init can only ever register nothing under the pin: the direct
  // call throws (a loud misconfiguration that arms the retry cooldown)
  // instead of silently leaving the singleton un-flipped.
  await assert.rejects(() => svc.init(partnerUrl), /matches no registered issuer/);
  // And the healthy inverse: a repeat PRIMARY init on an
  // already-registered pin must not throw (the guard fires only for a
  // non-primary realm).
  await assert.doesNotReject(() => svc.init());
  const token = await sign(baseClaims(pinned));
  const payload = await svc.verifyToken(token);
  assert.equal(payload.iss, pinned);
});

test('additional realms without a pin: a partner-realm token verifies against its own realm keys', async () => {
  const svc = loadVerifier({ KEYCLOAK_ADDITIONAL_REALMS: '["partner"]' });
  const partnerIss = `${KEYCLOAK_URL}/realms/partner`;
  const token = await sign(baseClaims(partnerIss), { partner: true });
  const payload = await svc.verifyToken(token);
  assert.equal(payload.iss, partnerIss);
});

test('JWKS_URL override + additional realms: the partner realm is skipped and its token reports Unknown issuer', async () => {
  // #1701: the override pins ONE realm's certs URL — every realm's issuer
  // would map to those keys, so a partner token failed SIGNATURE
  // verification (misleadingly) for the life of the deployment. The
  // additional realms are now skipped, exactly as under the strict issuer
  // pin: the partner token fails with the clear 'Unknown issuer'.
  const svc = loadVerifier({
    KEYCLOAK_JWKS_URL: JWKS_URI,
    KEYCLOAK_ADDITIONAL_REALMS: '["partner"]'
  });
  const partnerDiscoveryUrl = `${KEYCLOAK_URL}/realms/partner/.well-known/openid-configuration`;
  const primaryToken = await sign(baseClaims(DISCOVERY_ISSUER));
  const payload = await svc.verifyToken(primaryToken);
  assert.equal(payload.iss, DISCOVERY_ISSUER);
  assert.ok(
    !fetchCalls.some((c) => c === partnerDiscoveryUrl),
    'partner realm discovery was fetched — the JWKS override did not skip the additional realms'
  );
  const partnerIss = `${KEYCLOAK_URL}/realms/partner`;
  const partnerToken = await sign(baseClaims(partnerIss), { partner: true });
  await assert.rejects(
    () => svc.verifyToken(partnerToken),
    (err) => err.code === 'TOKEN_INVALID' && err.message === 'Unknown issuer'
  );
});

test('KEYCLOAK_DISCOVERY_URL moves the discovery leg; the issuer surface is unchanged', async () => {
  // #1712: the verifier ALWAYS needs the discovery document — the JWKS
  // fetch-host override replaces only the certs leg. The discovery leg now
  // targets the override, and the accepted issuers still come from the
  // document that leg returned.
  const svc = loadVerifier({ KEYCLOAK_DISCOVERY_URL: 'http://internal-kc:8080' });
  const token = await sign(baseClaims(DISCOVERY_ISSUER));
  const payload = await svc.verifyToken(token);
  assert.equal(payload.iss, DISCOVERY_ISSUER);
  assert.ok(
    fetchCalls.includes('http://internal-kc:8080/realms/genie/.well-known/openid-configuration'),
    `the discovery leg did not target the override: ${JSON.stringify(fetchCalls)}`
  );
  assert.ok(
    !fetchCalls.includes(`${DISCOVERY_ISSUER}/.well-known/openid-configuration`),
    'the discovery leg still targeted KEYCLOAK_URL'
  );
});

test('a kid-less token against a multi-key set is a bad token, not an outage', async () => {
  // jose raises JWKSMultipleMatchingKeys when the token names NO key id and
  // the key set holds several keys. That is a TOKEN-side ambiguity: it must
  // not be classified as an outage, or an unauthenticated caller could make
  // the service answer 503 at will.
  const svc = loadVerifier();
  const kidless = await new SignJWT(baseClaims(DISCOVERY_ISSUER))
    .setProtectedHeader({ alg: 'RS256' }) // alg, but NO key id
    .sign(privateKey);
  await assert.rejects(
    () => svc.verifyToken(kidless),
    (err) => err.code === 'TOKEN_INVALID'
  );
});

test('a mid-life JWKS fetch failure is an outage (AUTH_SERVICE_UNAVAILABLE), not a bad token', async () => {
  // #1723: once initialized, the verifier classified a JWKS fetch failure as
  // TOKEN_INVALID — a 401 that sends every user to the login page during an
  // infrastructure outage. The key-set leg is the verifier's own network
  // call: its failure is the AUTH SERVICE's, not the token's.
  const svc = loadVerifier();
  const token = await sign(baseClaims(DISCOVERY_ISSUER));
  assert.equal((await svc.verifyToken(token)).sub, 'user-1');

  jwksDown = true; // the auth service goes down

  // An unknown kid forces the next key-set fetch (the rotation path).
  const rotated = await sign(baseClaims(DISCOVERY_ISSUER), { partner: true });
  await assert.rejects(
    () => svc.verifyToken(rotated),
    (err) => err.code === 'AUTH_SERVICE_UNAVAILABLE'
  );
});

test('a junk-signature token does not re-fetch the JWKS (the cache-thrash vector)', async () => {
  // #1703: the force-refresh carve-out fired on EVERY junk-signature token,
  // zeroing the JWKS cache TTL — the key set was re-fetched from Keycloak on
  // effectively every request, and every legitimate interleaved token paid a
  // fresh fetch. A resolved kid with a bad signature can never become valid
  // through rotation, so it must not touch the cache.
  const svc = loadVerifier();
  const token = await sign(baseClaims(DISCOVERY_ISSUER));
  await svc.verifyToken(token); // warm: the key set is fetched once
  const jwksFetches = () => fetchCalls.filter((c) => c === JWKS_URI).length;
  const before = jwksFetches();
  assert.equal(before, 1);

  const [h, p, sig] = token.split('.');
  const flipped = `${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
  for (let i = 0; i < 5; i++) {
    await assert.rejects(
      () => svc.verifyToken(`${h}.${p}.${flipped}`),
      (err) => err.code === 'TOKEN_INVALID'
    );
  }
  // No re-fetch for the junk class...
  assert.equal(jwksFetches(), before);
  // ...and the legitimate token still verifies on the cached key set.
  assert.equal((await svc.verifyToken(token)).sub, 'user-1');
  assert.equal(jwksFetches(), before);
});

test('an unknown-kid token with no exp claim is fast-failed without a key-set refresh', async () => {
  // #1703 addendum: a missing exp can never pass jose's requiredClaims
  // ('iss','exp'), so it can never be a rotation case — it must not trigger a
  // key-set refresh either.
  const svc = loadVerifier();
  const token = await sign(baseClaims(DISCOVERY_ISSUER));
  await svc.verifyToken(token); // warm
  const jwksFetches = () => fetchCalls.filter((c) => c === JWKS_URI).length;
  const before = jwksFetches();

  const claims = baseClaims(DISCOVERY_ISSUER);
  delete claims.exp;
  const unknownKid = await sign(claims, { partner: true });
  await assert.rejects(
    () => svc.verifyToken(unknownKid),
    (err) => err.code === 'TOKEN_INVALID'
  );
  assert.equal(jwksFetches(), before);
});

test('an unknown-kid token (rotation candidate) refreshes the key set — the price of rotation recovery', async () => {
  // The rotation candidate KEEPS its refresh path (D3): an unknown kid may
  // be a rotated key, and a realm that reuses a kid with new key material has
  // no other recovery path than a refresh. The cost is one key-set fetch per
  // unknown-kid token — the residual amplification this wave accepts
  // deliberately (recorded in the MR body).
  const svc = loadVerifier();
  const warm = await sign(baseClaims(DISCOVERY_ISSUER));
  await svc.verifyToken(warm); // warm: one fetch
  const jwksFetches = () => fetchCalls.filter((c) => c === JWKS_URI).length;
  const before = jwksFetches();

  const token = await sign(baseClaims(DISCOVERY_ISSUER), { partner: true });
  await assert.rejects(
    () => svc.verifyToken(token),
    (err) => err.code === 'TOKEN_INVALID'
  );
  assert.ok(jwksFetches() > before, 'the rotation candidate did not refresh the key set');
});

test('non-bare-integer KEYCLOAK_DISCOVERY_TIMEOUT_MS falls back to the 5000ms default', async () => {
  // A bare-integer requirement with three real failure modes: parseInt('abc')
  // is NaN (a NaN setTimeout fires immediately), parseInt('10s') is 10 (an
  // instant-abort loop at 10 ms), and anything above 2^31-1 ms clamps to 1 ms
  // in Node's timers ('2147483648' — the same instant abort). The guard must
  // fall back to the default budget for all of them — the DURATION is the
  // discriminator, since the verifier wraps init failures and the budget is
  // not on the public error. A hanging discovery leg is the only way to make
  // the abort (not a stub refusal) settle the fetch.
  const token = await sign(baseClaims(DISCOVERY_ISSUER));
  for (const badValue of ['abc', '10s', '2147483648']) {
    const svc = loadVerifier({
      KEYCLOAK_DISCOVERY_TIMEOUT_MS: badValue,
      KEYCLOAK_URL: 'http://keycloak-hang:8080'
    });
    const startedAt = Date.now();
    await assert.rejects(
      () => svc.verifyToken(token),
      (err) => err.code === 'AUTH_SERVICE_UNAVAILABLE'
    );
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed >= 4900, `${badValue}: discovery aborted after ${elapsed}ms — the 5000ms fallback did not apply`);
  }
});

test('a stalled response BODY aborts within the discovery budget too', async () => {
  // A host that accepts the connection and stalls the response body: the
  // abort timer must stay armed across res.json(), not only across fetch().
  // With the body read outside the guarded try this test hangs instead of
  // failing — the CI job timeout is the backstop.
  const svc = loadVerifier({
    KEYCLOAK_DISCOVERY_TIMEOUT_MS: 'abc',
    KEYCLOAK_URL: 'http://keycloak-slow-body:8080'
  });
  const token = await sign(baseClaims(DISCOVERY_ISSUER));
  const startedAt = Date.now();
  await assert.rejects(
    () => svc.verifyToken(token),
    (err) => err.code === 'AUTH_SERVICE_UNAVAILABLE'
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 4900, `body read hung past the budget (aborted after ${elapsed}ms)`);
});

test('init failure surfaces as AUTH_SERVICE_UNAVAILABLE (doc-repo 503 contract)', async () => {
  // An unreachable discovery host: the stub refuses every request (503).
  const svc = loadVerifier({ KEYCLOAK_URL: 'http://keycloak-unreachable:8080' });
  const token = await sign(baseClaims(DISCOVERY_ISSUER));
  await assert.rejects(
    () => svc.verifyToken(token),
    (err) => err.code === 'AUTH_SERVICE_UNAVAILABLE'
  );
});

// Sanity: the signing key verifies directly (guards against a silently broken
// fixture — a stubbed fetch that never serves the JWKS would fail every test
// above with TOKEN_INVALID, indistinguishable from a verifier bug).
test('fixture sanity: the stubbed JWKS verifies the fixture token via jose directly', async () => {
  const token = await sign(baseClaims(DISCOVERY_ISSUER));
  const { payload } = await jwtVerify(token, async () => publicKey, { issuer: DISCOVERY_ISSUER });
  assert.equal(payload.sub, 'user-1');
});
