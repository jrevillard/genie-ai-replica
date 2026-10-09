// Story 1-8c live smoke (local build). NOT committed — dev-only harness.
// Runs from the build root (needs .env). Same auth spine as smoke-1-8-mr-a.js:
// throwaway Keycloak user + tools-admin role + temporary ROPC (reverted
// immediately + on exit). Exercises the 1-8c Lab surface end-to-end:
//   POST /api/okf/repos/:id/routing-explain        (claim-side advice)
//   POST /api/okf/repos/:id/routing-testsuite      (count controls + near-miss)
//   POST /api/okf/repos/:id/routing-testsuite/:k/run
//   POST /api/okf/repos/:id/routing-testsuite/:k/explain (batch advice)
// PASS criteria are asserted inline; secrets are never printed.
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const REPO_ID = process.argv[2] || 'f043215b-cead-4af2-ad37-e675a8eec4b7';
const HIV_QUERY =
  'Give me a definitive list of the causes and symptoms of all the various types of diseases like HIV and other viruses';
const SMOKE_USER = 'okf-smoke-18c';
const SMOKE_PW = crypto.randomBytes(18).toString('base64url') + '#aA1!';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
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
        rejectUnauthorized: false,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {})
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
    return { raw: r.body.slice(0, 300) };
  }
};

let ADMIN_TOKEN = '';
let USER_TOKEN = '';
let CLIENT_UUID = '';
let USER_ID = '';
let ROPC_WAS = null;
let SUITE_KEY = '';
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

async function cleanup() {
  const errs = [];
  try {
    if (ADMIN_TOKEN && CLIENT_UUID && ROPC_WAS === false) {
      await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
        token: ADMIN_TOKEN,
        json: { directAccessGrantsEnabled: false }
      });
      console.log('[cleanup] ROPC reverted');
    }
  } catch (e) {
    errs.push('ROPC revert: ' + e.message);
  }
  try {
    if (ADMIN_TOKEN && USER_ID) {
      await req('DELETE', `${AUTH_BASE}/admin/realms/${REALM}/users/${USER_ID}`, { token: ADMIN_TOKEN });
      console.log('[cleanup] smoke user deleted');
    }
  } catch (e) {
    errs.push('user delete: ' + e.message);
  }
  if (errs.length) console.error('[cleanup] FAILURES:', errs.join('; '));
}

(async () => {
  console.log('== Story 1-8c live smoke against ' + API_BASE + ' ==');
  // 1. master admin token
  const mt = j(
    await req('POST', `${AUTH_BASE}/realms/master/protocol/openid-connect/token`, {
      form: { client_id: 'admin-cli', username: 'admin', password: ADMIN_PW, grant_type: 'password' }
    })
  );
  if (!mt.access_token) throw new Error('master token failed');
  ADMIN_TOKEN = mt.access_token;
  console.log('[1] master admin token ok');

  // 2. throwaway tools-admin user
  const mk = await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users`, {
    token: ADMIN_TOKEN,
    json: {
      username: SMOKE_USER,
      email: 'okf-smoke-18c@example.invalid',
      emailVerified: true,
      firstName: 'Smoke',
      lastName: 'OneEightC',
      enabled: true,
      credentials: [{ type: 'password', value: SMOKE_PW, temporary: false }]
    }
  });
  if (mk.status !== 201) throw new Error('user create ' + mk.status);
  const users = j(
    await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/users?username=${SMOKE_USER}&exact=true`, {
      token: ADMIN_TOKEN
    })
  );
  USER_ID = users[0] && users[0].id;
  if (!USER_ID) throw new Error('smoke user id missing');
  const role = j(await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/roles/tools-admin`, { token: ADMIN_TOKEN }));
  if (!role.name) throw new Error('tools-admin role missing');
  const assign = await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users/${USER_ID}/role-mappings/realm`, {
    token: ADMIN_TOKEN,
    json: [role]
  });
  if (assign.status !== 204) throw new Error('role assign ' + assign.status);
  console.log('[2] throwaway tools-admin user ok');

  // 3. ROPC dance (revert immediately)
  const clients = j(
    await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}`, { token: ADMIN_TOKEN })
  );
  CLIENT_UUID = clients[0] && clients[0].id;
  ROPC_WAS = !!(clients[0] && clients[0].directAccessGrantsEnabled);
  if (!ROPC_WAS) {
    const en = await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
      token: ADMIN_TOKEN,
      json: { directAccessGrantsEnabled: true }
    });
    if (en.status !== 204) throw new Error('ROPC enable failed');
  }
  const ut = j(
    await req('POST', `${AUTH_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
      form: { grant_type: 'password', client_id: CLIENT_ID, username: SMOKE_USER, password: SMOKE_PW }
    })
  );
  if (!ROPC_WAS) {
    await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
      token: ADMIN_TOKEN,
      json: { directAccessGrantsEnabled: false }
    });
    ROPC_WAS = false;
  }
  if (!ut.access_token) throw new Error('user token failed');
  USER_TOKEN = ut.access_token;
  console.log('[3] user token ok (ROPC reverted)');

  // 4. routing-explain on the HIV query — expect claim + LLM suggested tags
  const ex = j(
    await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-explain`, {
      token: USER_TOKEN,
      json: { query: HIV_QUERY }
    })
  );
  check(
    'explain: verdict present',
    !!ex.under_test && !!ex.verdict,
    ex.under_test ? `claimed=${ex.under_test.head_claimed} claim=${ex.under_test.head_claim}` : 'missing under_test'
  );
  check(
    'explain: HIV query CLAIMS (pre-fix state)',
    ex.under_test && ex.under_test.head_claimed === true,
    ex.under_test ? `score=${ex.under_test.head_score && ex.under_test.head_score.toFixed(3)}` : ''
  );
  check(
    'explain: suggestion shape + LLM tags',
    ex.suggestion && Array.isArray(ex.suggestion.tags),
    `tags=[${(ex.suggestion && ex.suggestion.tags || []).join(', ')}] source=${ex.suggestion && ex.suggestion.source}`
  );

  // 5. suite generation with count controls + near-miss class
  const gen = j(
    await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite`, {
      token: USER_TOKEN,
      json: { n_positive: 3, n_negative: 2, n_negative_random: 2, n_meta: 2, n_near_miss: 3 }
    })
  );
  SUITE_KEY = gen.suite_key;
  const negs = (gen.payload && gen.payload.negative) || [];
  const byCls = negs.reduce((m, q) => ((m[q.cls] = (m[q.cls] || 0) + 1), m), {});
  check('suite: generated', !!SUITE_KEY, `key=${SUITE_KEY}`);
  check('suite: count controls honored', byCls.meta === 2 && byCls['near-miss'] === 3 && byCls['off-domain'] === 2, JSON.stringify(byCls));

  // 6. run the suite
  const run = j(await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/${SUITE_KEY}/run`, { token: USER_TOKEN }));
  const runRows = (run.payload && run.payload.results) || [];
  check(
    'run: rows carry gate telemetry',
    runRows.every((q) => 'head_claimed' in q),
    `n=${runRows.length}`
  );

  // 7. batch explain — expect 200 with the consolidated shape
  const batch = j(
    await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/${SUITE_KEY}/explain`, { token: USER_TOKEN })
  );
  check('batch explain: 200 + shape', batch.suite_key === SUITE_KEY && Array.isArray(batch.suggested_tags), `failing=${batch.failing_count} tags=[${(batch.suggested_tags || []).join(', ')}] source=${batch.source}`);

  // 8. authz: explain without token -> 401
  const noauth = await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-explain`, { json: { query: 'x' } });
  check('explain: unauthenticated rejected', noauth.status === 401 || noauth.status === 403, `status=${noauth.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n== SMOKE ${failed.length ? 'FAILED' : 'PASSED'}: ${results.length - failed.length}/${results.length} checks ==`);
  process.exitCode = failed.length ? 1 : 0;
})()
  .catch((e) => {
    console.error('SMOKE ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(cleanup);
