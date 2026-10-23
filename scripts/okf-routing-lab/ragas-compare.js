// Story 8-6 live comparison (local build). Dev-only harness, committed with
// the story like smoke-8-6.js.
//
// Re-runs an EXISTING RAGAS suite and compares the new run against the
// previous one on the same suite — the experiment the fixed failure
// attribution asks for. It does NOT generate a suite and it does NOT delete
// anything: the suite and its runs are the operator's.
//
//   node scripts/okf-routing-lab/ragas-compare.js <repo_id> [suite_key]
//   node scripts/okf-routing-lab/ragas-compare.js <repo_id> --attach <run_key> [suite_key]
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
// Third form: `--attach <run_key> [suite_key]` polls an ALREADY-RUNNING run
// instead of starting a new one — two concurrent runs share the model
// endpoint and both slow down (the guide's own rule), so a poll that outlived
// its process must re-attach, never re-start. In attach mode argv[3] is the
// FLAG, so the two-arg suite override must not read it (it would resolve
// suiteKey to the literal '--attach').
const ATTACH_MODE = process.argv[3] === '--attach';
const ATTACH = ATTACH_MODE ? process.argv[4] || null : null;
const SUITE_FOR_ATTACH = ATTACH_MODE ? process.argv[5] || null : null;
const SUITE_OVERRIDE = ATTACH_MODE ? null : process.argv[3] || null;
// `--metrics m1,m2,...` starts the run with an explicit metric selection —
// a 10-metric run is a DIFFERENT measurement from a 4-metric one (the
// guide's own rule) and must be recorded as what it is.
const METRICS_FLAG = process.argv.includes('--metrics');
const METRICS = METRICS_FLAG
  ? process.argv[process.argv.indexOf('--metrics') + 1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : null;
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
        timeout: 30000,
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
        // Without this, a reset mid-response-body emits an unhandled 'error'
        // on the stream — an uncaughtException that kills the process before
        // the finally block can revert ROPC.
        res.on('error', reject);
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    r.on('error', reject);
    // No timeout means one silent socket wedges the poll past its deadline —
    // the deadline is only checked between iterations.
    r.on('timeout', () => r.destroy(new Error('no response within 30s')));
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
// Every API call goes through here: one re-mint on 401, then ANY non-2xx is
// THROWN. A 404/500/error body must never reach the poll loops — their status
// checks cannot tell an error body from a finished run (the 2026-10-23 silent
// death was exactly a no-status body being read as "not running, not failed").
async function call(method, url, opts = {}) {
  const describe = (r) => `${method} ${url} -> HTTP ${r.status}: ${r.body.toString().slice(0, 160)}`;
  const first = await req(method, url, { ...opts, token: opts.token || USER_TOKEN });
  if (first.status === 401) {
    await mintUserToken();
    const second = await req(method, url, { ...opts, token: USER_TOKEN });
    if (second.status >= 400) throw new Error(describe(second));
    return second;
  }
  if (first.status >= 400) throw new Error(describe(first));
  return first;
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
  // Cleanup can outlive the master token minted at start (a 2-hour poll does)
  // — re-mint first; on a soft mint failure the PUT below surfaces its status.
  try {
    await refreshAdminToken();
  } catch {
    // keep the previous master token
  }
  const r = await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
    token: ADMIN_TOKEN,
    json: { directAccessGrantsEnabled: false }
  });
  ROPC_ON = false;
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`ROPC revert HTTP ${r.status} — VERIFY MANUALLY: directAccessGrantsEnabled on ${CLIENT_ID}`);
  }
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
    console.error('       node ragas-compare.js <repo_id> --attach <run_key> [suite_key]');
    process.exit(2);
  }
  if (ATTACH_MODE && !ATTACH) {
    console.error(
      '--attach needs the run_key to re-attach to (starting a new run instead would be the bug it exists to prevent)'
    );
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
    const rp = await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/users/${USER_ID}/reset-password`, {
      token: ADMIN_TOKEN,
      json: { type: 'password', value: SMOKE_PW, temporary: false }
    });
    if (rp.status >= 400) throw new Error(`adopted-user password reset HTTP ${rp.status} — re-mint would fail`);
  }
  const role = j(await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/roles/tools-admin`, { token: ADMIN_TOKEN }));
  if (!role.id) throw new Error(`tools-admin role lookup failed: ${JSON.stringify(role).slice(0, 160)}`);
  const rm = await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users/${USER_ID}/role-mappings/realm`, {
    token: ADMIN_TOKEN,
    json: [role]
  });
  if (rm.status >= 400) throw new Error(`role mapping HTTP ${rm.status} — API calls would 403`);
  await ropcEnable();
  await mintUserToken();

  // --- find the suite + the baseline run ---
  // limit=100: the default projection is the 20 NEWEST runs repo-wide, so a
  // done baseline older than that window silently disappears and the compare
  // runs baseline-less.
  const runsRes = j(await call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/runs?limit=100`));
  const runs = (runsRes.runs || []).map((r) => ({ ...r, run_key: r.run_key || r._key }));
  console.log(`existing runs: ${runs.length}`);
  runs.forEach((r) => console.log(`  ${r.run_key}  suite=${r.suite_key}  status=${r.status}  ${r.created_at || ''}`));
  let attachRun = null;
  if (ATTACH_MODE) {
    attachRun = runs.find((r) => r.run_key === ATTACH) || null;
    if (!attachRun)
      throw new Error(`--attach: run ${ATTACH} is not among the ${runs.length} listed runs — wrong key, or purged`);
    console.log(`  attach target: suite=${attachRun.suite_key} status=${attachRun.status}`);
  }
  // The attached run's OWN suite wins over runs[0] — the newest list row can
  // belong to a different suite than the run being re-attached to.
  const suiteKey =
    SUITE_FOR_ATTACH || (attachRun && attachRun.suite_key) || SUITE_OVERRIDE || (runs[0] && runs[0].suite_key);
  if (!suiteKey) throw new Error('no suite with runs — pass the suite key as the second argument');
  // The list projection exposes the doc _key as the run's id — normalise it
  // BEFORE the baseline lookup, or the newest done run is missed and the
  // comparison silently prints no baseline (caught live 2026-10-23). The
  // attached run is excluded, or re-attaching to a finished run compares it
  // against itself (+0.0000 everywhere).
  const baselineKey = runs.find(
    (r) => r.suite_key === suiteKey && r.status === 'done' && r.run_key !== ATTACH
  )?.run_key;
  console.log(`suite=${suiteKey}  baseline run=${baselineKey || '(none)'}`);

  const suiteDoc = j(await call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${suiteKey}`));
  console.log(`suite status=${suiteDoc.status} entries=${(suiteDoc.payload.entries || []).length}`);

  // --- baseline numbers ---
  let baselineRun = null;
  let baselineExplain = null;
  if (baselineKey) {
    const [runRes, explainRes] = await Promise.all([
      call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${suiteKey}/runs/${baselineKey}`),
      // An older baseline may have no explain doc — degrade to '?', do not
      // abort the whole comparison.
      call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${suiteKey}/explain/${baselineKey}`).catch(
        (e) => {
          console.log(`  (no baseline explain: ${e.message.slice(0, 120)})`);
          return null;
        }
      )
    ]);
    baselineRun = j(runRes);
    baselineExplain = explainRes ? j(explainRes) : null;
    console.log(`\n--- BASELINE (${baselineKey}) ---`);
    console.log(`  metrics: ${fmtMetrics(metricMeans(baselineRun))}`);
    console.log(`  fidelity: ${fidelityLine(baselineRun)}`);
    console.log(
      `  failures: ${(baselineExplain.payload && baselineExplain.payload.failing_count) ?? '?'}  ` +
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
      await call('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${suiteKey}/run`, {
        json: METRICS ? { metrics: METRICS } : {}
      })
    );
    if (!run.run_key) throw new Error(`run did not start: ${JSON.stringify(run).slice(0, 200)}`);
    runKey = run.run_key;
    console.log(`  run_key=${runKey}`);
  }
  let runDoc = null;
  let lastProgress = null;
  let pollErrors = 0;
  const runDeadline = Date.now() + 120 * 60 * 1000;
  for (;;) {
    if (Date.now() > runDeadline) {
      console.log('  TIMED OUT waiting for the run');
      break;
    }
    await sleep(5000);
    let doc;
    try {
      doc = j(await call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${suiteKey}/runs/${runKey}`));
      pollErrors = 0;
    } catch (e) {
      // A blip must not kill a 2-hour poll — the run continues server-side.
      pollErrors += 1;
      console.log(`  poll error ${pollErrors}: ${e.message.slice(0, 120)}`);
      if (pollErrors >= 12) {
        console.log('  giving up: 12 consecutive poll errors');
        break;
      }
      continue;
    }
    if (doc.status === 'running') {
      const p = doc.progress ? JSON.stringify(doc.progress) : null;
      if (p && p !== lastProgress) {
        lastProgress = p;
        console.log(`  progress: ${p.slice(0, 160)}`);
      }
      continue;
    }
    if (doc.status === 'failed') {
      console.log('  run failed:', JSON.stringify(doc.error).slice(0, 300));
      EXIT_CODE = 1;
      break;
    }
    if (doc.status === 'done') {
      runDoc = doc;
      break;
    }
    // 2xx but no recognizable status — not a finished run; say so instead of
    // printing a fabricated AFTER report.
    console.log(`  unexpected run doc (status=${JSON.stringify(doc.status)}): ${JSON.stringify(doc).slice(0, 200)}`);
    break;
  }
  if (!runDoc) {
    console.log('no run doc — stopping here');
    return;
  }

  // --- explain the new run ---
  try {
    await call('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${suiteKey}/explain`, {
      json: { run_key: runKey }
    });
  } catch (e) {
    // EXPLAIN_IN_FLIGHT (409) or a lost race — the GET poll below decides.
    console.log(`  explain start: ${e.message.slice(0, 160)}`);
  }
  let explainDoc = null;
  pollErrors = 0;
  const exDeadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    if (Date.now() > exDeadline) break;
    await sleep(4000);
    let doc;
    try {
      doc = j(await call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${suiteKey}/explain/${runKey}`));
      pollErrors = 0;
    } catch (e) {
      pollErrors += 1;
      console.log(`  explain poll error ${pollErrors}: ${e.message.slice(0, 120)}`);
      if (pollErrors >= 12) {
        console.log('  giving up: 12 consecutive explain poll errors');
        break;
      }
      continue;
    }
    if (doc.status === 'running') continue;
    if (doc.status === 'failed') {
      console.log('  explain failed:', JSON.stringify(doc.error).slice(0, 300));
      break;
    }
    // A finished explain doc carries payload and NO status field — requiring
    // a status here would reject the happy path.
    if (doc.payload) {
      explainDoc = doc;
      break;
    }
    console.log(`  unexpected explain doc: ${JSON.stringify(doc).slice(0, 200)}`);
    break;
  }

  console.log(`\n--- AFTER (${runKey}) ---`);
  console.log(`  metrics: ${fmtMetrics(metricMeans(runDoc))}`);
  console.log(`  fidelity: ${fidelityLine(runDoc)}`);
  console.log(
    `  failures: ${(explainDoc && explainDoc.payload && explainDoc.payload.failing_count) ?? '?'}  ` +
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

let EXIT_CODE = 0;
async function revertOnce() {
  try {
    await ropcRevert();
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message);
    EXIT_CODE = 1;
  }
}
// Ctrl-C must still revert ROPC (SERVER-TESTING.md: non-negotiable) — a bare
// SIGINT/SIGTERM kills the process without running finally blocks.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    revertOnce().finally(() => process.exit(sig === 'SIGINT' ? 130 : 143));
  });
}
(async () => {
  try {
    await main();
  } catch (e) {
    console.error('COMPARE ERROR:', e.message);
    EXIT_CODE = 1;
  } finally {
    await revertOnce();
    // The throwaway user is left in place (it holds no data); deleting it is
    // a compensating write that can fail silently and strand it.
    // Flush piped stdout before the hard exit — process.exit can truncate
    // pending writes, and the comparison block is this run's payload.
    await new Promise((resolve) => process.stdout.write('', resolve));
    process.exit(EXIT_CODE);
  }
})();
