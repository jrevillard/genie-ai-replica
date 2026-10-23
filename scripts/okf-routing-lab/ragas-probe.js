// ragas-probe.js — READ-ONLY probe of the local build's RAGAS benchmarking
// state: repos, suites, runs and their metrics. Prints the response shapes
// it finds so the next step is planned from what actually exists.
//
// Auth spine copied from scripts/okf-routing-lab/smoke-8-6.js (throwaway
// Keycloak user + tools-admin + temporary ROPC, reverted on exit).
// Secrets are never printed. Nothing is created or deleted except the
// throwaway user (reused if a previous round left one).
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const SMOKE_USER = 'okf-ragas-cmp';
const SMOKE_PW = crypto.randomBytes(18).toString('base64url') + '#aA1!';

const env = {};
const ENV_FILE = ['./.env', 'C:/Dev/builds/main/.env'].find((p) => fs.existsSync(p));
if (!ENV_FILE) {
  console.error('FATAL: no .env found');
  process.exit(1);
}
for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const ADMIN_PW = env.KEYCLOAK_ADMIN_PASSWORD;
const AUTH_BASE = 'https://localhost/auth';
const API_BASE = 'https://localhost';
const REALM = env.KEYCLOAK_REALM || 'genie';
const CLIENT_ID = env.KEYCLOAK_CLIENT_ID || 'genie-app';

function req(method, url, { token, form, json } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = json ? JSON.stringify(json) : form ? new URLSearchParams(form).toString() : null;
    const r = https.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        rejectUnauthorized: false,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body
            ? {
                'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body)
              }
            : {})
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const j = (r) => {
  try {
    return JSON.parse(r.body.toString());
  } catch {
    return { raw: r.body.toString().slice(0, 400) };
  }
};

let ADMIN_TOKEN = '';
let CLIENT_UUID = '';
let ROPC_ON = false;
let USER_ID = '';

async function ropcEnable() {
  const clients = j(
    await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}`, { token: ADMIN_TOKEN })
  );
  CLIENT_UUID = clients[0] && clients[0].id;
  if (!CLIENT_UUID) throw new Error('client not found');
  const r = await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
    token: ADMIN_TOKEN,
    json: { directAccessGrantsEnabled: true }
  });
  ROPC_ON = r.status === 204;
}
async function ropcRevert() {
  if (!ROPC_ON || !CLIENT_UUID || !ADMIN_TOKEN) return;
  await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
    token: ADMIN_TOKEN,
    json: { directAccessGrantsEnabled: false }
  });
  ROPC_ON = false;
}
async function refreshAdminToken() {
  const at = j(
    await req('POST', `${AUTH_BASE}/realms/master/protocol/openid-connect/token`, {
      form: { client_id: 'admin-cli', username: 'admin', password: ADMIN_PW, grant_type: 'password' }
    })
  );
  if (at.access_token) ADMIN_TOKEN = at.access_token;
}

async function main() {
  await refreshAdminToken();
  if (!ADMIN_TOKEN) throw new Error('no master token');

  const mk = await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users`, {
    token: ADMIN_TOKEN,
    json: {
      username: SMOKE_USER,
      email: `${SMOKE_USER}@example.invalid`,
      emailVerified: true,
      firstName: 'Ragas',
      lastName: 'Cmp',
      enabled: true,
      credentials: [{ type: 'password', value: SMOKE_PW, temporary: false }]
    }
  });
  const users = j(
    await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/users?username=${SMOKE_USER}&exact=true`, {
      token: ADMIN_TOKEN
    })
  );
  USER_ID = Array.isArray(users) && users[0] && users[0].id;
  if (!USER_ID) throw new Error(`smoke user id unresolved (create HTTP ${mk.status})`);
  if (mk.status === 409) {
    await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/users/${USER_ID}/reset-password`, {
      token: ADMIN_TOKEN,
      json: { type: 'password', value: SMOKE_PW, temporary: false }
    });
  }
  const role = j(await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/roles/tools-admin`, { token: ADMIN_TOKEN }));
  await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users/${USER_ID}/role-mappings/realm`, {
    token: ADMIN_TOKEN,
    json: [role]
  });
  await ropcEnable();
  const tok = j(
    await req('POST', `${AUTH_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
      form: { grant_type: 'password', client_id: CLIENT_ID, username: SMOKE_USER, password: SMOKE_PW }
    })
  );
  if (!tok.access_token) throw new Error('no token');
  const token = tok.access_token;

  const reposRes = await req('GET', `${API_BASE}/api/okf/repos?limit=100`, { token });
  const reposBody = j(reposRes);
  const list = Array.isArray(reposBody) ? reposBody : reposBody.items || reposBody.repos || reposBody.data || [];
  console.log('=== REPOS ===');
  console.log(`  count=${list.length}  raw-keys=${Object.keys(reposBody).join(',')}`);
  list.forEach((r) => {
    console.log(
      `  repo_id=${r.repo_id}  name=${r.name || '?'}  graph=${r.graph_name || r.graph || '?'}  ` +
        `index_status=${r.index_status || r.status || '?'}`
    );
  });

  for (const r of list) {
    const id = r.repo_id;
    if (!id) continue;
    const runsRes = j(await req('GET', `${API_BASE}/api/okf/repos/${id}/ragas-testsuite/runs`, { token }));
    const runs = runsRes.runs || (Array.isArray(runsRes) ? runsRes : []);
    console.log(`\n=== REPO ${id} (${r.name || '?'}) — runs: ${runs.length} ===`);
    if (runs.length) console.log('  run keys: ' + Object.keys(runs[0]).join(','));
    for (const x of runs) {
      console.log(
        `  run_key=${x.run_key || x.id}  suite=${x.suite_key}  status=${x.status}  ` +
          `created=${x.created_at || '?'}  ${x.metrics ? 'metrics=' + JSON.stringify(x.metrics) : ''}`
      );
    }
    // Fetch each distinct suite doc.
    const keys = [...new Set(runs.map((x) => x.suite_key).filter(Boolean))];
    for (const k of keys) {
      const s = j(await req('GET', `${API_BASE}/api/okf/repos/${id}/ragas-testsuite/${k}`, { token }));
      console.log(
        `\n  --- suite ${k} --- status=${s.status} size=${s.testset_size || s.size || '?'} ` +
          `entries=${Array.isArray(s.entries) ? s.entries.length : s.rows ? s.rows.length : '?'}`
      );
      console.log('    suite keys: ' + Object.keys(s).join(','));
      if (s.generation) console.log('    generation: ' + JSON.stringify(s.generation).slice(0, 300));
    }
  }
}

main()
  .then(async () => {
    await ropcRevert();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('FATAL', e.message);
    await ropcRevert();
    process.exit(1);
  });
