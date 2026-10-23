// Story 8-6 live comparison (local build). Dev-only harness, committed with
// the story like smoke-8-6.js.
//
// Re-runs an EXISTING RAGAS suite and compares the new run against the
// previous one on the same suite — the experiment the fixed failure
// attribution asks for. It does NOT generate a suite and it does NOT delete
// anything: the suite and its runs are the operator's.
//
//   node scripts/okf-routing-lab/ragas-compare.js <repo_id> [suite_key]
//
// What it prints: per-metric means (before vs after), the failing-row
// count, and the stage distribution of the failures — so the question
// "did raising the retrieval pool actually convert the vector-recall
// failures?" has a number attached.
//
// Same auth spine as smoke-8-6.js: throwaway Keycloak user + tools-admin
// role + temporary ROPC (reverted immediately + on exit). Secrets are never
// printed.
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const REPO_ID = process.argv[2];
const SUITE_OVERRIDE = process.argv[3];
// Third form: `--attach <run_key>` polls an ALREADY-RUNNING run instead of
// starting a new one — two concurrent runs share the model endpoint and both
// slow down (the guide's own rule), so a poll that outlived its process must
// re-attach, never re-start.
const ATTACH = process.argv[3] === '--attach' ? process.argv[4] : null;
const SUITE_FOR_ATTACH = process.argv[3] === '--attach' ? process.argv[5] : null;
const SMOKE_USER = 'okf-ragas-compare';
const SMOKE_PW = crypto.randomBytes(18).toString('base64url') + '#aA1!';

const env = {};
const ENV_FILE = ['./.env', 'C:/Dev/builds/main/.env'].find((p) => fs.existsSync(p));
if (!ENV_FILE) {
  console.error('FATAL: no .env found (cwd or C:/Dev/builds/main)');
  process.exit(1);
}
for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
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
    return { raw: r.body.toString().slice(0, 300) };
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The compare user's ROPC token, in a holder, with one re-mint on 401. A
// full 100-question run outlives a typical access-token lifespan — the poll
// died silently at retrieval 36/100 on the first live use (2026-10-23) when
// the token expired and every later GET returned a 401 body with no status
// field, which the poll loop read as "not running, not failed" and fell out
// of. The run itself continues server-side; only the VIEW died.
let USER_TOKEN = '';
async function mintUserToken() {
  const tok = j(
    await req('POST', `${AUTH_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
      form: { grant_type: 'password', client_id: CLIENT_ID, username: SMOKE_USER, password: SMOKE_PW }
    })
  );
  if (!tok.access_token) throw new Error('could not (re)mint the compare user token');
  USER_TOKEN = tok.access_token;
  return USER_TOKEN;
}
async function call(method, url, opts = {}) {
  const first = await req(method, url, { ...opts, token: opts.token || USER_TOKEN });
  if (first.status !== 401) return first;
  await mintUserToken();
  return req(method, url, { ...opts, token: USER_TOKEN });
}

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
  if (!ROPC_ON) throw new Error(`ROPC enable HTTP ${r.status}`);
}
async function ropcRevert() {
  if (!ROPC_ON || !CLIENT_UUID || !ADMIN_TOKEN) return;
  const r = await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
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
async function resolveUserId() {
  const r = await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/users?username=${SMOKE_USER}&exact=true`, {
    token: ADMIN_TOKEN
  });
  const users = j(r);
  return Array.isArray(users) && users[0] && users[0].id;
}

function stageCounts(explainDoc) {
  const attributions = (explainDoc && explainDoc.payload && explainDoc.payload.attributions) || [];
  const counts = {};
  for (const a of attributions) {
    const s = a.stage || 'none';
    counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}
function metricMeans(runDoc) {
  return (runDoc && runDoc.payload && runDoc.payload.summary && runDoc.payload.summary.metrics) || {};
}
function fmtMetrics(m) {
  return Object.entries(m)
    .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(4) : v}`)
    .join('  ');
}
function fidelityLine(runDoc) {
  const r = (runDoc && runDoc.payload && runDoc.payload.fidelity && runDoc.payload.fidelity.retrieval) || {};
  return `candidate_k=${r.candidate_k} top_n=${r.top_n}`;
}

async function main() {
  if (!REPO_ID) {
    console.error('usage: node ragas-compare.js <repo_id> [suite_key]');
    process.exit(2);
  }
  console.log(`ragas-compare against repo ${REPO_ID}`);

  // --- auth spine ---
  await refreshAdminToken();
  if (!ADMIN_TOKEN) throw new Error('no master token');
  const mk = await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users`, {
    token: ADMIN_TOKEN,
    json: {
      username: SMOKE_USER,
      email: `${SMOKE_USER}@example.invalid`,
      emailVerified: true,
      firstName: 'Ragas',
      lastName: 'Compare',
      enabled: true,
      credentials: [{ type: 'password', value: SMOKE_PW, temporary: false }]
    }
  });
  USER_ID = await resolveUserId();
  if (!USER_ID) throw new Error(`smoke user id unresolved (create HTTP ${mk.status})`);
  if (mk.status === 409) {
    // Leftover from an aborted round — adopt it (never PUT the user object:
    // that overwrites the credentials).
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
  await mintUserToken();

  // --- find the suite + the baseline run ---
  const runsRes = j(await call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/runs`));
  const runs = (runsRes.runs || []).map((r) => ({ ...r, run_key: r.run_key || r._key }));
  console.log(`existing runs: ${runs.length}`);
  runs.forEach((r) => console.log(`  ${r.run_key}  suite=${r.suite_key}  status=${r.status}  ${r.created_at || ''}`));
  const suiteKey = SUITE_FOR_ATTACH || SUITE_OVERRIDE || (runs[0] && runs[0].suite_key);
  if (!suiteKey) throw new Error('no suite with runs — pass the suite key as the second argument');
  // The list projection exposes the doc _key as the run's id — normalise it
  // BEFORE the baseline lookup, or the newest done run is missed and the
  // comparison silently prints no baseline (caught live 2026-10-23).
  const baselineKey = runs.find((r) => r.suite_key === suiteKey && r.status === 'done')?.run_key;
  console.log(`suite=${suiteKey}  baseline run=${baselineKey || '(none)'}`);

  const suiteDoc = j(await call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${suiteKey}`));
  console.log(`suite status=${suiteDoc.status} entries=${(suiteDoc.payload.entries || []).length}`);

  // --- baseline numbers ---
  let baselineRun = null;
  let baselineExplain = null;
  if (baselineKey) {
    baselineRun = j(
      await call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${suiteKey}/runs/${baselineKey}`)
    );
    baselineExplain = j(
      await call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${suiteKey}/explain/${baselineKey}`)
    );
    console.log(`\n--- BASELINE (${baselineKey}) ---`);
    console.log(`  metrics: ${fmtMetrics(metricMeans(baselineRun))}`);
    console.log(`  fidelity: ${fidelityLine(baselineRun)}`);
    console.log(
      `  failures: ${(baselineExplain.payload && baselineExplain.payload.failing_count) || '?'}  ` +
        `stages: ${JSON.stringify(stageCounts(baselineExplain))}`
    );
  }

  // --- the new run (or re-attach to one already in flight) ---
  console.log('\n--- NEW RUN ---');
  let runKey = ATTACH;
  if (ATTACH) {
    console.log(`  re-attaching to run_key=${ATTACH} (no new run started)`);
  } else {
    const run = j(
      await call('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${suiteKey}/run`, { json: {} })
    );
    if (!run.run_key) throw new Error(`run did not start: ${JSON.stringify(run).slice(0, 200)}`);
    runKey = run.run_key;
    console.log(`  run_key=${runKey}`);
  }
  let runDoc = null;
  let lastProgress = null;
  const runDeadline = Date.now() + 120 * 60 * 1000;
  for (;;) {
    if (Date.now() > runDeadline) {
      console.log('  TIMED OUT waiting for the run');
      break;
    }
    await sleep(5000);
    const doc = j(await call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${suiteKey}/runs/${runKey}`));
    if (doc.status === 'running') {
      if (doc.progress && JSON.stringify(doc.progress) !== lastProgress) {
        lastProgress = JSON.stringify(doc.progress);
        console.log(`  progress: ${JSON.stringify(doc.progress).slice(0, 160)}`);
      }
      continue;
    }
    if (doc.status === 'failed') {
      console.log('  run failed:', JSON.stringify(doc.error).slice(0, 300));
      break;
    }
    runDoc = doc;
    break;
  }
  if (!runDoc) {
    console.log('no run doc — stopping here');
    return;
  }

  // --- explain the new run ---
  const ex = j(
    await call('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${suiteKey}/explain`, {
      json: { run_key: runKey }
    })
  );
  let explainDoc = null;
  const exDeadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    if (Date.now() > exDeadline) break;
    await sleep(4000);
    const doc = j(
      await call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${suiteKey}/explain/${runKey}`)
    );
    if (doc.status === 'running') continue;
    if (doc.status === 'failed') {
      console.log('  explain failed:', JSON.stringify(doc.error).slice(0, 300));
      break;
    }
    explainDoc = doc;
    break;
  }

  console.log(`\n--- AFTER (${runKey}) ---`);
  console.log(`  metrics: ${fmtMetrics(metricMeans(runDoc))}`);
  console.log(`  fidelity: ${fidelityLine(runDoc)}`);
  console.log(
    `  failures: ${(explainDoc && explainDoc.payload && explainDoc.payload.failing_count) || '?'}  ` +
      `stages: ${JSON.stringify(stageCounts(explainDoc))}`
  );
  if (explainDoc && explainDoc.payload && explainDoc.payload.advice) {
    console.log(`  advice.knob_changes: ${JSON.stringify(explainDoc.payload.advice.knob_changes || [])}`);
    console.log(`  advice.content_curation: ${JSON.stringify(explainDoc.payload.advice.content_curation || [])}`);
  }

  // --- the comparison itself ---
  if (baselineRun) {
    console.log('\n=== COMPARISON (same suite) ===');
    const before = metricMeans(baselineRun);
    const after = metricMeans(runDoc);
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const b = before[k];
      const a = after[k];
      const delta =
        typeof b === 'number' && typeof a === 'number' ? ` (${a - b >= 0 ? '+' : ''}${(a - b).toFixed(4)})` : '';
      console.log(`  ${k}: ${b} -> ${a}${delta}`);
    }
    const bs = stageCounts(baselineExplain);
    const as = stageCounts(explainDoc);
    console.log('  stages before:', JSON.stringify(bs));
    console.log('  stages after :', JSON.stringify(as));
  }
}

(async () => {
  try {
    await main();
  } catch (e) {
    console.error('COMPARE ERROR:', e.message);
  } finally {
    await ropcRevert();
    // The throwaway user is left in place (it holds no data); deleting it is
    // a compensating write that can fail silently and strand it.
    process.exit(0);
  }
})();
