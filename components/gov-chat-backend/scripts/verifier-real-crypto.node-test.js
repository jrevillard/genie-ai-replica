// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// Real-crypto tests for the shared OIDC verifier
// (components/shared/lib/keycloak-auth-service.js — the single copy the
// backend re-exports, DW-427). Runs on Node's built-in test runner:
//
//   node --test scripts/verifier-real-crypto.node-test.js
//
// WHY NOT JEST: the jest suites must stub `jose` entirely (the jest runtime
// cannot require the ESM-only package), so a wrong-aud or alg-confusion token
// can never be exercised through jose's real verification path there — the
// exact gap DW-434 recorded against the pre-consolidation suites. Here the
// verifier loads for real; only the two HTTP legs (OIDC discovery + JWKS) are
// served by a stubbed global.fetch, and the keys/tokens are real RSA/RS256
// material built with the same jose package (DW-434's prescription:
// generateKeyPair + exportJWK, stubbed fetch, real wrong-aud token).
//
// The issuer cases are DW-435's public-API form: accept/reject on real-shaped
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
// would from a live Keycloak certs endpoint).
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'jwk' },
  privateKeyEncoding: { type: 'pkcs8', format: 'jwk' }
});
const JWKS = { keys: [{ ...publicKey, kid: 'test-key', alg: 'RS256', use: 'sig' }] };

// Stub both HTTP legs the verifier performs: OIDC discovery (fetch with an
// AbortController signal) and the JWKS document (jose's createRemoteJWKSet
// fetches through global fetch too). The discovery issuer tracks whatever
// KC issuer topology the current test configures.
let discoveryIssuer = DISCOVERY_ISSUER;
global.fetch = async (url) => {
  // The JWKS URI shares the discovery prefix — match it FIRST.
  if (String(url) === JWKS_URI) {
    return { ok: true, status: 200, json: async () => JWKS, headers: new Map([['cache-control', 'no-store']]) };
  }
  if (String(url).startsWith(discoveryIssuer)) {
    return { ok: true, status: 200, json: async () => ({ issuer: discoveryIssuer, jwks_uri: JWKS_URI }) };
  }
  return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
};

// Fresh module instance per topology: the verifier caches discovery state and
// reads its env surface at module load.
function loadVerifier(env) {
  delete require.cache[require.resolve('../../shared/lib/keycloak-auth-service.js')];
  for (const key of [
    'KEYCLOAK_URL',
    'KEYCLOAK_REALM',
    'KEYCLOAK_ADDITIONAL_REALMS',
    'KEYCLOAK_PUBLIC_URL',
    'KEYCLOAK_BROWSER_ISSUER',
    'KEYCLOAK_JWKS_URL',
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

const sign = async (claims, header = { alg: 'RS256', kid: 'test-key' }) =>
  new SignJWT(claims).setProtectedHeader(header).sign(privateKey);

test('DW-434: valid RS256 token verifies end-to-end (real signature path)', async () => {
  const svc = loadVerifier();
  const token = await sign(baseClaims(DISCOVERY_ISSUER));
  const payload = await svc.verifyToken(token);
  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.iss_sub, `${DISCOVERY_ISSUER}#user-1`);
});

test('DW-434: tampered signature is rejected (TOKEN_INVALID)', async () => {
  const svc = loadVerifier();
  const token = await sign(baseClaims(DISCOVERY_ISSUER));
  const [h, p, sig] = token.split('.');
  const flipped = sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA');
  await assert.rejects(
    () => svc.verifyToken(`${h}.${p}.${flipped}`),
    (err) => err.code === 'TOKEN_INVALID'
  );
});

test('DW-434: wrong-aud token with opts.audience is rejected as TOKEN_INVALID', async () => {
  const svc = loadVerifier();
  const token = await sign(baseClaims(DISCOVERY_ISSUER, { aud: 'other-client' }));
  await assert.rejects(
    () => svc.verifyToken(token, { audience: 'genie-app' }),
    (err) => err.code === 'TOKEN_INVALID' && /audience/i.test(err.message)
  );
});

test('DW-434: matching-aud token with opts.audience verifies', async () => {
  const svc = loadVerifier();
  const token = await sign(baseClaims(DISCOVERY_ISSUER, { aud: 'genie-app' }));
  const payload = await svc.verifyToken(token, { audience: 'genie-app' });
  assert.equal(payload.aud, 'genie-app');
});

test('DW-434: HS256 alg-confusion token is rejected (RS256 pin)', async () => {
  const svc = loadVerifier();
  const hsToken = await new SignJWT(baseClaims(DISCOVERY_ISSUER))
    .setProtectedHeader({ alg: 'HS256' })
    .sign(Buffer.from('attacker-controlled-secret'));
  await assert.rejects(
    () => svc.verifyToken(hsToken),
    (err) => err.code === 'TOKEN_INVALID'
  );
});

test('DW-434: expired RS256 token maps to TOKEN_EXPIRED', async () => {
  const svc = loadVerifier();
  const claims = baseClaims(DISCOVERY_ISSUER);
  claims.exp = Math.floor(Date.now() / 1000) - 10;
  const token = await sign(claims);
  await assert.rejects(
    () => svc.verifyToken(token),
    (err) => err.code === 'TOKEN_EXPIRED'
  );
});

test('DW-435: issuer outside the discovery map is rejected as Unknown issuer', async () => {
  const svc = loadVerifier();
  const token = await sign(baseClaims('http://evil.example/realms/genie'));
  await assert.rejects(
    () => svc.verifyToken(token),
    (err) => err.code === 'TOKEN_INVALID' && err.message === 'Unknown issuer'
  );
});

test('DW-435: KEYCLOAK_PUBLIC_URL alias is accepted on a real token', async () => {
  discoveryIssuer = DISCOVERY_ISSUER;
  const svc = loadVerifier({ KEYCLOAK_PUBLIC_URL: 'https://public.example/auth' });
  const publicIss = 'https://public.example/auth/realms/genie';
  const token = await sign(baseClaims(publicIss));
  const payload = await svc.verifyToken(token);
  assert.equal(payload.iss, publicIss);
});

test('browser-issuer alias works WITHOUT the JWKS override (drift closed)', async () => {
  discoveryIssuer = DISCOVERY_ISSUER;
  // The env value is the literal issuer (doc-repo semantics: pushed verbatim
  // into the accepted-issuer set), not a URL prefix to derive from.
  const browserIss = 'https://localhost/auth/realms/genie';
  const svc = loadVerifier({ KEYCLOAK_BROWSER_ISSUER: browserIss });
  const token = await sign(baseClaims(browserIss));
  const payload = await svc.verifyToken(token);
  assert.equal(payload.iss, browserIss);
});

test('KEYCLOAK_EXPECTED_ISSUER pin: only the pinned issuer is accepted', async () => {
  discoveryIssuer = DISCOVERY_ISSUER;
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

test('checkUserStatusInKeycloak is present on the unified verifier', () => {
  const svc = loadVerifier();
  assert.equal(typeof svc.checkUserStatusInKeycloak, 'function');
});

// Sanity: the signing key verifies directly (guards against a silently broken
// fixture — a stubbed fetch that never serves the JWKS would fail every test
// above with TOKEN_INVALID, indistinguishable from a verifier bug).
test('fixture sanity: the stubbed JWKS verifies the fixture token via jose directly', async () => {
  const token = await sign(baseClaims(DISCOVERY_ISSUER));
  const { payload } = await jwtVerify(token, async () => publicKey, { issuer: DISCOVERY_ISSUER });
  assert.equal(payload.sub, 'user-1');
});
