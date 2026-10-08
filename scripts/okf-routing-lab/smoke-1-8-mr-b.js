// Story 1-8 MR-B live smoke (local build). NOT committed — dev-only harness.
// Same auth spine as smoke-1-8-mr-a.js (throwaway tools-admin user + ROPC
// enable/revert/delete; secrets read in-process, never printed). Exercises:
//   POST /api/okf/repos/:id/routing-testsuite          (LLM generation)
//   POST /api/okf/repos/:id/routing-testsuite/:key/queries (curator add)
//   POST /api/okf/repos/:id/routing-testsuite/:key/run (run-all)
//   GET  /api/okf/repos/:id/routing-testsuite/runs     (analytics list)
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const REPO_ID = process.argv[2] || 'f043215b-cead-4af2-ad37-e675a8eec4b7';
const SMOKE_USER = 'okf-smoke-18b';
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

(async () => {
  const tok = j(
    await req('POST', `${AUTH_BASE}/realms/master/protocol/openid-connect/token`, {
      form: { client_id: 'admin-cli', username: env.KEYCLOAK_ADMIN || 'admin', password: ADMIN_PW, grant_type: 'password' }
    })
  );
  if (!tok.access_token) throw new Error('admin token failed');
  ADMIN_TOKEN = tok.access_token;
  const mk = await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users`, {
    token: ADMIN_TOKEN,
    json: {
      username: SMOKE_USER,
      email: 'okf-smoke-18b@example.invalid',
      emailVerified: true,
      firstName: 'Smoke',
      lastName: 'OneDashEightB',
      enabled: true,
      credentials: [{ type: 'password', value: SMOKE_PW, temporary: false }]
    }
  });
  if (mk.status !== 201) throw new Error(`user create ${mk.status}`);
  USER_ID = j(
    await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/users?username=${SMOKE_USER}&exact=true`, { token: ADMIN_TOKEN })
  )[0].id;
  const role = j(await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/roles/tools-admin`, { token: ADMIN_TOKEN }));
  await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users/${USER_ID}/role-mappings/realm`, {
    token: ADMIN_TOKEN,
    json: [role]
  });
  CLIENT_UUID = j(
    await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}`, { token: ADMIN_TOKEN })
  )[0].id;
  ROPC_WAS = false;
  await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
    token: ADMIN_TOKEN,
    json: { directAccessGrantsEnabled: true }
  });
  const ut = j(
    await req('POST', `${AUTH_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
      form: { grant_type: 'password', client_id: CLIENT_ID, username: SMOKE_USER, password: SMOKE_PW }
    })
  );
  await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
    token: ADMIN_TOKEN,
    json: { directAccessGrantsEnabled: false }
  });
  ROPC_WAS = false;
  if (!ut.access_token) throw new Error('user token failed');
  const T = ut.access_token;
  console.log('[1] auth chain: ok (ROPC reverted)');

  // [2] GENERATE
  const gen = await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite`, {
    token: T,
    json: { n_positive: 5, n_negative: 3 }
  });
  const suite = j(gen);
  console.log(`[2] generate: HTTP ${gen.status} key=${suite.suite_key || (suite.error && suite.error)}`);
  if (gen.status !== 201) throw new Error('generation failed');
  console.log(
    `    positives=${suite.payload.positive.length} llm_neg=${suite.payload.negative.filter((n) => n.source === 'llm').length} forbidden_neg=${suite.payload.negative.filter((n) => n.source === 'forbidden').length} keywords=${suite.payload.keywords.length} generator=${suite.payload.generator}`
  );
  console.log(`    sample+: ${JSON.stringify(suite.payload.positive[0])}`);
  console.log(`    sample-: ${JSON.stringify(suite.payload.negative.find((n) => n.source === 'llm') || suite.payload.negative[0])}`);

  // [3] CURATOR ADD
  const add = await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/${suite.suite_key}/queries`, {
    token: T,
    json: { queries: [{ query: 'maize futures commodity pricing outlook', kind: 'negative', reason: 'curator probe' }] }
  });
  const added = j(add);
  console.log(`[3] curator add: HTTP ${add.status} manual_count=${added.payload ? added.payload.negative.filter((n) => n.source === 'manual').length : 'n/a'}`);

  // [4] RUN (LLM embed per query — the remote TEI)
  console.log('[4] run: executing...');
  const run = await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/${suite.suite_key}/run`, {
    token: T,
    json: {}
  });
  const runDoc = j(run);
  console.log(`[4] run: HTTP ${run.status} key=${runDoc._key || runDoc.error}`);
  if (run.status === 200) {
    console.log('    summary:', JSON.stringify(runDoc.payload.summary, null, 2));
    for (const r of runDoc.payload.results.slice(0, 4)) {
      console.log(
        `    ${r.kind}/${r.source} "${r.query.slice(0, 48)}" → ${r.error ? 'ERR ' + r.error : 'win=' + r.under_test_wins_head + ' score=' + (r.head_score || 0).toFixed(3) + ' rank=' + r.head_rank}`
      );
    }
  }

  // [5] LIST
  const list = await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/runs?limit=5&kind=all`, { token: T });
  const runs = j(list);
  console.log(`[5] list: HTTP ${list.status} rows=${runs.runs ? runs.runs.length : 'n/a'}`);
  if (runs.runs) for (const r of runs.runs) console.log(`    ${r.kind} ${r._key} pass_rate=${r.summary ? r.summary.pass_rate : '—'}`);

  await cleanup();
  console.log('SMOKE COMPLETE');
})().catch(async (e) => {
  console.error('SMOKE FAILED:', e.message);
  await cleanup();
  process.exit(1);
});
