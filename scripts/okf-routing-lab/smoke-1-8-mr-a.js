// Story 1-8 MR-A live smoke (local build). NOT committed — dev-only harness.
// Runs from the build root (needs .env). Creates a throwaway Keycloak user
// with the tools-admin realm role, temporarily enables ROPC on genie-app
// (reverted immediately + in the exit trap), then exercises:
//   POST /api/okf/repos/:id/head/rebuild
//   POST /api/okf/repos/:id/routing-test
// Secrets are read in-process and never printed.
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const REPO_ID = process.argv[2] || 'f043215b-cead-4af2-ad37-e675a8eec4b7';
const SMOKE_USER = 'okf-smoke-18';
const SMOKE_PW = crypto.randomBytes(18).toString('base64url') + '#aA1!';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const ADMIN_USER = env.KEYCLOAK_ADMIN || 'admin';
const ADMIN_PW = env.KEYCLOAK_ADMIN_PASSWORD;
if (!ADMIN_PW) {
  console.error('FATAL: KEYCLOAK_ADMIN_PASSWORD missing from .env');
  process.exit(1);
}
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
        rejectUnauthorized: false, // local self-signed cert
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
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      }
    );
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

const j = (r) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return { raw: r.body.slice(0, 400) };
  }
};

let ADMIN_TOKEN = '';
let CLIENT_UUID = '';
let USER_ID = '';
let ROPC_WAS = null;

async function cleanup() {
  const errs = [];
  try {
    if (ADMIN_TOKEN && CLIENT_UUID && ROPC_WAS === false) {
      await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
        token: ADMIN_TOKEN,
        json: { directAccessGrantsEnabled: false }
      });
      console.log('[cleanup] ROPC reverted: ok');
    }
  } catch (e) {
    errs.push(`ROPC revert: ${e.message}`);
  }
  try {
    if (ADMIN_TOKEN && USER_ID) {
      await req('DELETE', `${AUTH_BASE}/admin/realms/${REALM}/users/${USER_ID}`, { token: ADMIN_TOKEN });
      console.log('[cleanup] smoke user deleted: ok');
    }
  } catch (e) {
    errs.push(`user delete: ${e.message}`);
  }
  if (errs.length) console.error('[cleanup] FAILURES:', errs.join('; '));
}

process.on('exit', () => {
  // best-effort synchronous nothing — real cleanup is awaited below
});

(async () => {
  // 1. master admin token
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
  if (!tok.access_token) throw new Error(`admin token failed: ${JSON.stringify(tok).slice(0, 200)}`);
  ADMIN_TOKEN = tok.access_token;
  console.log('[1] master admin token: ok');

  // 2. throwaway tools-admin user
  const mk = await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users`, {
    token: ADMIN_TOKEN,
    json: {
      username: SMOKE_USER,
      email: 'okf-smoke-18@example.invalid',
      emailVerified: true,
      firstName: 'Smoke',
      lastName: 'OneDashEight',
      enabled: true,
      credentials: [{ type: 'password', value: SMOKE_PW, temporary: false }]
    }
  });
  if (mk.status !== 201) throw new Error(`user create ${mk.status}: ${mk.body.slice(0, 200)}`);
  const users = j(
    await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/users?username=${SMOKE_USER}&exact=true`, {
      token: ADMIN_TOKEN
    })
  );
  USER_ID = users[0] && users[0].id;
  if (!USER_ID) throw new Error('smoke user id not found after create');
  const role = j(await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/roles/tools-admin`, { token: ADMIN_TOKEN }));
  if (!role.name) throw new Error(`tools-admin role missing: ${JSON.stringify(role).slice(0, 120)}`);
  const assign = await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users/${USER_ID}/role-mappings/realm`, {
    token: ADMIN_TOKEN,
    json: [role]
  });
  if (assign.status !== 204) throw new Error(`role assign ${assign.status}: ${assign.body.slice(0, 200)}`);
  console.log('[2] throwaway tools-admin user: ok');

  // 3. temporarily enable ROPC on genie-app
  const clients = j(
    await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}`, { token: ADMIN_TOKEN })
  );
  CLIENT_UUID = clients[0] && clients[0].id;
  if (!CLIENT_UUID) throw new Error(`${CLIENT_ID} client not found`);
  ROPC_WAS = !!clients[0].directAccessGrantsEnabled;
  if (!ROPC_WAS) {
    const en = await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
      token: ADMIN_TOKEN,
      json: { directAccessGrantsEnabled: true }
    });
    if (en.status !== 204) throw new Error(`ROPC enable ${en.status}`);
  }
  console.log(`[3] ROPC enabled (was already on: ${ROPC_WAS})`);

  // 4. user token via ROPC
  const ut = j(
    await req('POST', `${AUTH_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
      form: {
        grant_type: 'password',
        client_id: CLIENT_ID,
        username: SMOKE_USER,
        password: SMOKE_PW
      }
    })
  );
  if (!ut.access_token) throw new Error(`user token failed: ${JSON.stringify(ut).slice(0, 200)}`);

  // REVERT ROPC IMMEDIATELY (non-negotiable) unless it was already on
  if (!ROPC_WAS) {
    await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
      token: ADMIN_TOKEN,
      json: { directAccessGrantsEnabled: false }
    });
    ROPC_WAS = false; // marks "reverted" for the trap
    console.log('[4] ROPC reverted immediately after token mint: ok');
  }

  // 5. sanity: repo readable with this token
  const repo = await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}`, { token: ut.access_token });
  const repoDoc = j(repo);
  console.log(
    `[5] repo GET: ${repo.status} — name=${repoDoc.name} state=${repoDoc.lifecycle_state} has_head=${!!(repoDoc.head && repoDoc.head.vector)} graph=${repoDoc.ingested_graph_name || 'none'}`
  );
  if (repo.status !== 200) throw new Error('repo GET failed — aborting before mutations');

  // 6. HEAD REBUILD
  const rebuild = await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/head/rebuild`, { token: ut.access_token });
  console.log(`[6] head/rebuild: HTTP ${rebuild.status}`);
  console.log(JSON.stringify(j(rebuild), null, 2).slice(0, 1200));

  // 7. ROUTING TEST (positive query)
  const rt = await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-test`, {
    token: ut.access_token,
    json: { query: 'cancer screening guidelines', include_probes: false }
  });
  console.log(`[7] routing-test (positive): HTTP ${rt.status}`);
  console.log(JSON.stringify(j(rt), null, 2).slice(0, 3000));

  // 8. ROUTING TEST (negative query — should NOT favor this repo)
  const rt2 = await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-test`, {
    token: ut.access_token,
    json: { query: 'agricultural commodity market prices for maize', include_probes: false }
  });
  console.log(`[8] routing-test (negative): HTTP ${rt2.status}`);
  const neg = j(rt2);
  console.log(
    JSON.stringify(
      { head_winner: neg.verdict && neg.verdict.head_routing_winner, under_test_wins: neg.verdict && neg.verdict.under_test_wins_head, margin: neg.verdict && neg.verdict.margin },
      null,
      2
    )
  );

  await cleanup();
  console.log('SMOKE COMPLETE');
})().catch(async (e) => {
  console.error('SMOKE FAILED:', e.message);
  await cleanup();
  process.exit(1);
});
