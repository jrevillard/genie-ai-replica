// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6.1 smoke token minter (host-side). Creates/updates the two smoke users
// (scoped: okf:smoke:{repo}:read on the smoke repo; scopeless), re-applies
// genie-admin's wildcard attribute, then mints the three tokens run-smoke.js
// expects as env (OKF_SMOKE_TOKEN_SCOPED/SCOPELESS/ADMIN).
//
// ROPC discipline: directAccessGrants is enabled on genie-app ONLY for the
// mint window and REVERTED immediately after (asserted).
//
// Usage (from the repo root, local build running):
//   node data/okf/smoke-test/mint-tokens.mjs [output-path]
//   docker exec -e OKF_SMOKE_TOKEN_SCOPED=... -e OKF_SMOKE_TOKEN_SCOPELESS=... \
//     -e OKF_SMOKE_TOKEN_ADMIN=... <okf-container> node /app/run-smoke.js
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // local self-signed cert
import fs from 'node:fs';

const ENV_FILE = process.env.OKF_SMOKE_ENV_FILE || 'C:/Dev/builds/main/.env';
const REPO = process.env.OKF_SMOKE_REPO_ID || 'smoke-kenya-repo-0001';
const OUT = process.argv[2] || 'okf-smoke-tokens.json';
const ENV = Object.fromEntries(
  fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]])
);
const AUTH = `${ENV.KEYCLOAK_URL || 'https://localhost/auth'}`;
const out = {};

async function j(url, opts) {
  const r = await fetch(url, opts);
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${r.status} ${url} ${JSON.stringify(b).slice(0, 200)}`);
  return b;
}
const form = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });
const SCOPE_PASSWORD = 'Smoke-Test-1234!';

const master = await j(`${AUTH}/realms/master/protocol/openid-connect/token`, form({
  client_id: 'admin-cli', username: 'admin', password: ENV.KEYCLOAK_ADMIN_PASSWORD, grant_type: 'password'
}));
const H = { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' };

async function ensureUser(username, attrs) {
  const found = await j(`${AUTH}/admin/realms/genie/users?username=${username}`, { headers: H });
  if (found.length) return found[0];
  const body = {
    username, email: `${username}@smoke.local`, emailVerified: true, enabled: true,
    firstName: 'Smoke', lastName: 'Test',
    credentials: [{ type: 'password', value: SCOPE_PASSWORD, temporary: false }],
    ...(attrs ? { attributes: attrs } : {})
  };
  const r = await fetch(`${AUTH}/admin/realms/genie/users`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (!r.ok && r.status !== 409) throw new Error(`user create ${r.status} ${await r.text()}`);
  const again = await j(`${AUTH}/admin/realms/genie/users?username=${username}`, { headers: H });
  return again[0];
}
const scoped = await ensureUser('smoke-scoped', { okf_scopes: [`okf:smoke:${REPO}:read`] });
await ensureUser('smoke-scopeless', null);
// keep the scoped user's attribute current (idempotent full-attribute PUT)
await fetch(`${AUTH}/admin/realms/genie/users/${scoped.id}`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({ ...scoped, attributes: { ...(scoped.attributes || {}), okf_scopes: [`okf:smoke:${REPO}:read`] } })
});
// re-assert genie-admin wildcard (the entrypoint also does this post-policy)
const adminUser = (await j(`${AUTH}/admin/realms/genie/users?username=${encodeURIComponent(ENV.GENIE_ADMIN_USERNAME)}`, { headers: H }))[0];
await fetch(`${AUTH}/admin/realms/genie/users/${adminUser.id}`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({ ...adminUser, attributes: { ...(adminUser.attributes || {}), okf_scopes: ['okf:*:*:admin'] } })
});

// ROPC window → mint → revert (asserted)
const uuid = (await j(`${AUTH}/admin/realms/genie/clients?clientId=genie-app`, { headers: H }))[0].id;
await fetch(`${AUTH}/admin/realms/genie/clients/${uuid}`, { method: 'PUT', headers: H, body: JSON.stringify({ directAccessGrantsEnabled: true }) });
const mint = async (u, p) =>
  (await j(`${AUTH}/realms/genie/protocol/openid-connect/token`, form({ grant_type: 'password', client_id: 'genie-app', username: u, password: p }))).access_token;
out.scoped = await mint('smoke-scoped', SCOPE_PASSWORD);
out.scopeless = await mint('smoke-scopeless', SCOPE_PASSWORD);
out.admin = await mint(ENV.GENIE_ADMIN_USERNAME, ENV.GENIE_ADMIN_PASSWORD);
await fetch(`${AUTH}/admin/realms/genie/clients/${uuid}`, { method: 'PUT', headers: H, body: JSON.stringify({ directAccessGrantsEnabled: false }) });
const verify = await j(`${AUTH}/admin/realms/genie/clients/${uuid}`, { headers: H });
if (verify.directAccessGrantsEnabled !== false) throw new Error('ROPC NOT reverted — aborting');

for (const [k, t] of Object.entries(out)) {
  const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
  console.log(`${k}: okf_scopes=${JSON.stringify(p.okf_scopes)} aud=${JSON.stringify(p.aud)} tools-admin=${((p.realm_access || {}).roles || []).includes('tools-admin')}`);
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`ROPC reverted; tokens → ${OUT}`);
