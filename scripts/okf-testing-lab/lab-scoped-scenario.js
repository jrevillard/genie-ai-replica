// lab-scoped-scenario.js — build and verify the GROUP-SCOPED test scenario in
// the local build (the fixture the Testing Lab's scoped evaluation needs).
//
// WHAT IT BUILDS
//   two fences  — two SERVING repositories whose `acl.restricted` is TRUE, each
//                 held by its own Keycloak group
//   two groups  — okf-lab-scope-a, okf-lab-scope-b
//   four users  — one per scope combination, plus the scopeless control
//
// WHY THIS SHAPE
//   The Testing Lab's universe is the DEPLOYMENT's, not the caller's: it
//   scores every repository head that competes, whichever caller opened the
//   run. A scoped evaluation must be able to say "this repository is OUTSIDE
//   the evaluated set". That can only be tested against a deployment where
//   the fences DIFFER per principal — which is what this builds:
//
//     principal-a    group a          → traverses fence A, not fence B
//     principal-b    group b          → traverses fence B, not fence A
//     principal-ab   groups a AND b   → traverses BOTH (the union)
//     principal-none  no group        → traverses NEITHER (open mode + fence)
//
//   The union is the load-bearing case: a caller in two groups carries two
//   scope strings, and the Lab must be able to NAME that set.
//
// The global scope mode is left at its default (`open`) — the per-repo fence
// is what decides, and that is the posture the deployment runs in.
//
// RUN (from the build root — it reads .env)
//   node scripts/okf-testing-lab/lab-scoped-scenario.js             apply + verify
//   node scripts/okf-testing-lab/lab-scoped-scenario.js --verify    verify only
//   node scripts/okf-testing-lab/lab-scoped-scenario.js --teardown  remove it all
//
// The principals' passwords are random and land in `okf-scenario-credentials.json`
// (git-ignored, host-side, never printed and never committed).

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTH_BASE = 'https://localhost/auth';
const API_BASE = 'https://localhost';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const REALM = env.KEYCLOAK_REALM || 'genie';
const CLIENT_ID = env.KEYCLOAK_CLIENT_ID || 'genie-app';
const ADMIN_USER = env.KEYCLOAK_ADMIN || 'admin';
const ADMIN_PW = env.KEYCLOAK_ADMIN_PASSWORD;

// The two fences. A is the local build's SMOKE repository (a test artefact by
// construction); B is already fenced by an earlier grant, so the scenario adds
// no ACL change to it. Both are overridable so the fixture can be moved
// without editing this file.
const FENCE_A = process.env.LAB_FENCE_A || 'f5bedc82-c078-40c6-a3e8-5d1aa536f2c1';
const FENCE_B = process.env.LAB_FENCE_B || 'f9e08ce2-ddb4-4654-b59e-a27fdabfcb70';

const GROUPS = {
  a: process.env.LAB_GROUP_A || 'okf-lab-scope-a',
  b: process.env.LAB_GROUP_B || 'okf-lab-scope-b'
};

// The principals: which groups each one belongs to.
const PRINCIPALS = [
  { key: 'a', username: process.env.LAB_USER_A || 'okf-lab-principal-a', groups: ['a'] },
  { key: 'b', username: process.env.LAB_USER_B || 'okf-lab-principal-b', groups: ['b'] },
  { key: 'ab', username: process.env.LAB_USER_AB || 'okf-lab-principal-ab', groups: ['a', 'b'] },
  { key: 'none', username: process.env.LAB_USER_NONE || 'okf-lab-principal-none', groups: [] }
];

const CREDENTIALS_FILE = process.env.LAB_CREDENTIALS_FILE || 'okf-scenario-credentials.json';
const MODE = process.argv.includes('--teardown') ? 'teardown' : process.argv.includes('--verify') ? 'verify' : 'apply';

// ── http ─────────────────────────────────────────────────────────────────────
function req(method, url, { token, form, json, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = json ? JSON.stringify(json) : form ? new URLSearchParams(form).toString() : body || null;
    const r = https.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        rejectUnauthorized: false, // local self-signed cert
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload
            ? {
                'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(payload)
              }
            : {})
        }
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      }
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}
const j = (r) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
};

// ── keycloak admin ──────────────────────────────────────────────────────────
let ADMIN_TOKEN = '';
const kc = (pathname, opts = {}) =>
  req(opts.method || 'GET', `${AUTH_BASE}/admin/realms/${REALM}${pathname}`, {
    ...opts,
    token: opts.token || ADMIN_TOKEN
  });

async function findUser(username) {
  const users = j(await kc(`/users?username=${encodeURIComponent(username)}&exact=true`)) || [];
  return users[0] || null;
}

async function ensureUser(username, password) {
  const existing = await findUser(username);
  if (existing) return existing;
  const created = await kc('/users', {
    method: 'POST',
    json: {
      username,
      email: `${username}@lab.invalid`,
      emailVerified: true,
      firstName: 'Lab',
      lastName: 'Principal',
      enabled: true,
      credentials: [{ type: 'password', value: password, temporary: false }]
    }
  });
  if (created.status !== 201) throw new Error(`user create ${created.status}: ${created.body.slice(0, 200)}`);
  const user = await findUser(username);
  if (!user) throw new Error(`user ${username} not found after create`);
  return user;
}

async function findGroup(name) {
  const groups = j(await kc(`/groups?search=${encodeURIComponent(name)}&max=100`)) || [];
  return groups.find((g) => g.name === name) || null;
}

async function ensureGroup(name) {
  const existing = await findGroup(name);
  if (existing) return existing;
  const created = await kc('/groups', { method: 'POST', json: { name } });
  if (created.status !== 201 && created.status !== 409) {
    throw new Error(`group create ${created.status}: ${created.body.slice(0, 200)}`);
  }
  const group = await findGroup(name);
  if (!group) throw new Error(`group ${name} not found after create`);
  return group;
}

async function userGroups(username) {
  const user = await findUser(username);
  if (!user) return [];
  return j(await kc(`/users/${user.id}/groups?max=200`)) || [];
}

async function setUserGroups(username, groupNames) {
  const user = await findUser(username);
  if (!user) throw new Error(`user ${username} not found`);
  const current = j(await kc(`/users/${user.id}/groups?max=200`)) || [];
  const wanted = new Set(groupNames);
  for (const g of current) {
    if (!wanted.has(g.name)) {
      await kc(`/users/${user.id}/groups/${g.id}`, { method: 'DELETE' });
    }
  }
  for (const name of groupNames) {
    const group = await findGroup(name);
    if (!group) throw new Error(`group ${name} not found`);
    if (!current.some((g) => g.id === group.id)) {
      await kc(`/users/${user.id}/groups/${group.id}`, { method: 'PUT', body: '[]' });
    }
  }
}

async function clientUuid() {
  const clients = j(await kc(`/clients?clientId=${encodeURIComponent(CLIENT_ID)}`)) || [];
  if (!clients.length) throw new Error(`client ${CLIENT_ID} not found`);
  return clients[0];
}

/** Direct access grants (ROPC) are off by default on the local build; the
 *  scripted token mint needs them. The prior state is ALWAYS restored. */
async function setRopc(enabled) {
  const c = await clientUuid();
  await kc(`/clients/${c.id}`, { method: 'PUT', json: { directAccessGrantsEnabled: enabled } });
  return c;
}

async function mintToken(username, password) {
  const res = await req('POST', `${AUTH_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
    form: { grant_type: 'password', client_id: CLIENT_ID, username, password }
  });
  const body = j(res);
  if (!body || !body.access_token) throw new Error(`token mint failed for ${username}: ${res.body.slice(0, 160)}`);
  return body.access_token;
}

// ── okf-server ──────────────────────────────────────────────────────────────
async function okf(method, url, token, json) {
  return req(method, `${API_BASE}/api/okf${url}`, { token, json });
}

// ── credentials ─────────────────────────────────────────────────────────────
function readCredentials() {
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function writeCredentials(creds) {
  fs.writeFileSync(CREDENTIALS_FILE, `${JSON.stringify(creds, null, 2)}\n`);
  console.log(`[creds] ${path.resolve(CREDENTIALS_FILE)} (git-ignored; never committed)`);
}

function randomPassword() {
  return `${crypto.randomBytes(18).toString('base64url')}#Lab2061!`;
}

// ── the run ─────────────────────────────────────────────────────────────────
async function main() {
  if (!ADMIN_PW) throw new Error('KEYCLOAK_ADMIN_PASSWORD missing from .env');

  const tok = j(
    await req('POST', `${AUTH_BASE}/realms/master/protocol/openid-connect/token`, {
      form: {
        client_id: 'admin-cli',
        username: ADMIN_USER,
        password: ADMIN_PW,
        grant_type: 'password'
      }
    })
  );
  if (!tok || !tok.access_token) throw new Error('master admin token failed');
  ADMIN_TOKEN = tok.access_token;
  console.log('[1] master admin token: ok');

  const client = await clientUuid();
  const ROPC_WAS = !!client.directAccessGrantsEnabled;
  if (!ROPC_WAS) await setRopc(true);
  console.log(`[2] ROPC enabled for the scripted mint (was ${ROPC_WAS})`);

  // A throwaway tools-admin caller for the okf-server admin endpoints.
  const helperUser = `okf-scenario-helper-${crypto.randomBytes(3).toString('hex')}`;
  const helperPw = randomPassword();
  let helperId = null;
  let ADMIN_API_TOKEN = '';

  try {
    await kc('/users', {
      method: 'POST',
      json: {
        username: helperUser,
        email: `${helperUser}@lab.invalid`,
        emailVerified: true,
        firstName: 'Lab',
        lastName: 'Helper',
        enabled: true,
        credentials: [{ type: 'password', value: helperPw, temporary: false }]
      }
    });
    helperId = (await findUser(helperUser)).id;
    const role = j(await kc('/roles/tools-admin'));
    if (!role || !role.id) throw new Error('the tools-admin realm role is missing');
    const assign = await kc(`/users/${helperId}/role-mappings/realm`, { method: 'POST', json: [role] });
    if (assign.status !== 204) throw new Error(`tools-admin assignment ${assign.status}`);
    ADMIN_API_TOKEN = await mintToken(helperUser, helperPw);
    console.log('[3] throwaway tools-admin caller: ok');

    const creds = readCredentials();

    if (MODE === 'teardown') {
      // revoke the group grants
      for (const [fence, groupKey] of [
        [FENCE_A, 'a'],
        [FENCE_B, 'b']
      ]) {
        const g = await findGroup(GROUPS[groupKey]);
        if (g) {
          const r = await okf('POST', `/repos/${fence}/access/revoke-group`, ADMIN_API_TOKEN, {
            group: GROUPS[groupKey]
          });
          console.log(`[teardown] revoke-group ${GROUPS[groupKey]}: HTTP ${r.status}`);
        }
      }
      // remove the principals
      for (const p of PRINCIPALS) {
        const u = await findUser(p.username);
        if (u) {
          await kc(`/users/${u.id}`, { method: 'DELETE' });
          console.log(`[teardown] user ${p.username} deleted`);
        }
      }
      // unfence A (B was fenced before this scenario)
      const un = await okf('PUT', `/repos/${FENCE_A}/access`, ADMIN_API_TOKEN, { restricted: false });
      console.log(`[teardown] fence A released: HTTP ${un.status}`);
      console.log('[teardown] done');
      return;
    }

    // ── apply ───────────────────────────────────────────────────────────────
    if (MODE === 'apply') {
      // The groups and their scope grants go through the PRODUCT's own
      // facility (POST /repos/:id/access/grant-group), which creates the
      // scope-shaped realm role and assigns it to the group.
      for (const [fence, groupKey] of [
        [FENCE_A, 'a'],
        [FENCE_B, 'b']
      ]) {
        const grant = await okf('POST', `/repos/${fence}/access/grant-group`, ADMIN_API_TOKEN, {
          group: GROUPS[groupKey],
          level: 'read'
        });
        if (grant.status !== 200) {
          throw new Error(`grant-group ${GROUPS[groupKey]} on ${fence}: ${grant.status} ${grant.body.slice(0, 200)}`);
        }
        console.log(`[4] grant-group ${GROUPS[groupKey]} → ${fence}: HTTP ${grant.status}`);
      }

      // Fence both. B is already fenced (an earlier grant); the toggle is
      // idempotent and keeps the scenario correct if that ever changes.
      for (const fence of [FENCE_A, FENCE_B]) {
        const r = await okf('PUT', `/repos/${fence}/access`, ADMIN_API_TOKEN, { restricted: true });
        if (r.status !== 200) throw new Error(`fence ${fence}: ${r.status} ${r.body.slice(0, 200)}`);
        console.log(`[5] fence ${fence}: HTTP ${r.status}`);
      }

      // The principals.
      for (const p of PRINCIPALS) {
        if (!creds[p.username]) {
          creds[p.username] = randomPassword();
        }
        await ensureUser(p.username, creds[p.username]);
        await setUserGroups(
          p.username,
          p.groups.map((k) => GROUPS[k])
        );
        console.log(`[6] principal ${p.username} → groups [${p.groups.map((k) => GROUPS[k]).join(', ')}]`);
      }
      writeCredentials(creds);
    }

    // ── verify ──────────────────────────────────────────────────────────────
    // The fence's GRAPH NAME is minted from the repository's name and version
    // (workingGraphName), so the check does not guess it: it derives each
    // fence as the SET DIFFERENCE between the principals that hold it and the
    // principal that holds none. What is asserted is the STRUCTURE — the union
    // — not a name.
    console.log('[7] the traversable graph set per principal (the fence decides):');
    const sets = {};
    const scopes = {};
    let failures = 0;
    for (const p of PRINCIPALS) {
      const pw = creds[p.username];
      if (!pw) {
        console.log(`    ${p.username}: NO CREDENTIAL — run without --verify to create it`);
        failures += 1;
        continue;
      }
      let token;
      try {
        token = await mintToken(p.username, pw);
      } catch (e) {
        console.log(`    ${p.username}: token mint failed — ${e.message}`);
        failures += 1;
        continue;
      }
      const graphs = await okf('GET', '/authz/graphs', token);
      const body = j(graphs) || {};
      sets[p.key] = new Set(body.graph_names || []);
      scopes[p.key] = body.scopes || body.okf_scopes || null;
      console.log(`    ${p.username.padEnd(24)} traversable=${String(sets[p.key].size).padStart(2)}`);
    }
    if (!sets.none || !sets.a || !sets.b || !sets.ab) {
      console.error('[8] a principal could not be measured — the scenario is not verifiable');
      process.exitCode = 1;
      return;
    }

    const diff = (x, y) => new Set([...x].filter((v) => !y.has(v)));
    const fenceA = diff(sets.a, sets.none);
    const fenceB = diff(sets.b, sets.none);
    const union = new Set([...sets.none, ...fenceA, ...fenceB]);

    const checks = [
      ['fence A is exactly one repository', fenceA.size === 1],
      ['fence B is exactly one repository', fenceB.size === 1],
      ['the two fences are disjoint', [...fenceA].every((v) => !fenceB.has(v))],
      [
        'the control traverses NEITHER fence',
        ![...fenceA].some((v) => sets.none.has(v)) && ![...fenceB].some((v) => sets.none.has(v))
      ],
      ['a group holder traverses its own fence', sets.a.has([...fenceA][0])],
      ['a group holder traverses NOT the other fence', !sets.a.has([...fenceB][0])],
      ['b group holder traverses its own fence', sets.b.has([...fenceB][0])],
      ['b group holder traverses NOT the other fence', !sets.b.has([...fenceA][0])],
      [
        'a member of BOTH groups traverses BOTH fences (the union)',
        sets.ab.has([...fenceA][0]) && sets.ab.has([...fenceB][0])
      ],
      ['the union is exactly none + A + B', sets.ab.size === union.size && [...union].every((v) => sets.ab.has(v))],
      ['the union is strictly larger than either group alone', sets.ab.size > sets.a.size && sets.ab.size > sets.b.size]
    ];

    console.log(`    fence A: ${[...fenceA].join(', ') || '(none)'}`);
    console.log(`    fence B: ${[...fenceB].join(', ') || '(none)'}`);
    console.log(`    sizes: none=${sets.none.size} a=${sets.a.size} b=${sets.b.size} ab=${sets.ab.size}`);
    for (const [label, ok] of checks) {
      if (!ok) failures += 1;
      console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    }
    if (failures) {
      console.error(`[8] ${failures} check(s) failed`);
      process.exitCode = 1;
    } else {
      console.log('[8] the fence decides per group, and a member of both groups traverses the union');
    }
  } finally {
    // The helper caller and the ROPC state never outlive the run.
    if (helperId) {
      try {
        await kc(`/users/${helperId}`, { method: 'DELETE' });
        console.log('[cleanup] throwaway helper deleted');
      } catch (e) {
        console.error('[cleanup] helper delete failed:', e.message);
      }
    }
    if (!ROPC_WAS) {
      try {
        await setRopc(false);
        console.log('[cleanup] ROPC reverted to off');
      } catch (e) {
        console.error('[cleanup] ROPC revert failed:', e.message);
      }
    }
  }
}

main().catch((e) => {
  console.error('SCENARIO FAILED:', e.message);
  process.exit(1);
});
