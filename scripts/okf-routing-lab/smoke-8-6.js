// Story 8-6 live smoke (local build). Dev-only harness, committed with the
// story like smoke-1-8d.js.
// Proves the RAGAS benchmarking surface end-to-end against the deployed
// stack (sidecar + okf-server + remote GPU judge):
//   POST /api/okf/repos/:id/ragas-testsuite            (202 + poll)
//   GET  /api/okf/repos/:id/ragas-testsuite/:k         (suite doc)
//   POST /api/okf/repos/:id/ragas-testsuite/:k/run     (202 + poll)
//   GET  /api/okf/repos/:id/ragas-testsuite/:k/export  (xlsx bytes)
//   POST /api/okf/repos/:id/ragas-testsuite/:k/explain (202 + poll)
//   DELETE /api/okf/repos/:id/ragas-testsuite/:k       (cleanup)
// Same auth spine as smoke-1-8d.js: throwaway Keycloak user + tools-admin
// role + temporary ROPC (reverted immediately + on exit). The generated
// suite and the throwaway user are deleted before exit — compensating
// writes only; user creation is idempotent (a 409 adopts the leftover).
// Secrets are never printed.
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const REPO_ID = process.argv[2] || 'f9e08ce2-ddb4-4654-b59e-a27fdabfcb70';
// The judge the smoke asks for.
//
// A smoke must not follow the ACTIVE model configuration: that is a user
// choice, and it can be pointing at an endpoint that is rate-limited or
// unreachable. Live 2026-10-25: the active config (GLM-5.3 Flash at
// api.z.ai) answered 7,395 calls with 429 and ZERO successes, so a smoke
// that left the judge unset sat in the generation for an hour producing
// nothing. '__env__' is the deployment's own default judge
// (RAGAS_JUDGE_MODEL) — the neutral choice for a harness.
const JUDGE_PICK = process.env.OKF_SMOKE_JUDGE || '__env__';
const SMOKE_USER = 'okf-smoke-86';
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

function req(method, url, { token, form, json, binary } = {}) {
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
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
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

let ADMIN_TOKEN = '';
let CLIENT_UUID = '';
let ROPC_ON = false;
let USER_ID = '';
let SUITE_KEY = '';

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

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
  if (r.status < 200 || r.status >= 300) throw new Error(`ROPC revert HTTP ${r.status}`);
  ROPC_ON = false;
}

async function userToken() {
  const r = j(
    await req('POST', `${AUTH_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
      form: {
        grant_type: 'password',
        client_id: CLIENT_ID,
        username: SMOKE_USER,
        password: SMOKE_PW
      }
    })
  );
  // Keycloak's answer is the whole diagnosis (invalid_grant vs expired vs
  // client-not-allowed) — never swallow it (live 2026-10-23: a re-mint died
  // as a bare "no token" and the cause stayed invisible).
  if (!r.access_token) throw new Error(`no token for smoke user: ${JSON.stringify(r).slice(0, 300)}`);
  return r.access_token;
}

async function refreshAdminToken() {
  // Master tokens are short-lived and a full run (10-20 min polls) outlives
  // the one minted at start — cleanup re-mints before its admin calls. Keeps
  // the previous token when the mint fails softly.
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

async function main() {
  console.log(`smoke-8-6 against repo ${REPO_ID}`);
  // --- auth spine ---
  await refreshAdminToken();
  if (!ADMIN_TOKEN) throw new Error('no master token');
  const mk = await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users`, {
    token: ADMIN_TOKEN,
    json: {
      username: SMOKE_USER,
      email: `${SMOKE_USER}@example.invalid`,
      emailVerified: true,
      firstName: 'Smoke',
      lastName: '86',
      enabled: true,
      credentials: [{ type: 'password', value: SMOKE_PW, temporary: false }]
    }
  });
  USER_ID = await resolveUserId();
  if (mk.status === 201) {
    check('throwaway user created', true);
  } else if (mk.status === 409 && USER_ID) {
    // Leftover from an aborted round whose cleanup failed to delete it.
    // Adopt it: re-set the password via the dedicated credentials endpoint —
    // never PUT the whole user object (that overwrites the credentials).
    const rp = await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/users/${USER_ID}/reset-password`, {
      token: ADMIN_TOKEN,
      json: { type: 'password', value: SMOKE_PW, temporary: false }
    });
    check('leftover user adopted (password reset)', rp.status >= 200 && rp.status < 300, `HTTP ${rp.status}`);
  } else {
    check('throwaway user created', false, `HTTP ${mk.status}`);
  }
  if (!USER_ID) throw new Error('smoke user id unresolved');
  const role = j(await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/roles/tools-admin`, { token: ADMIN_TOKEN }));
  const ar = await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users/${USER_ID}/role-mappings/realm`, {
    token: ADMIN_TOKEN,
    json: [role]
  });
  check('tools-admin granted', ar.status >= 200 && ar.status < 300, `HTTP ${ar.status}`); // repeat grant is a no-op
  await ropcEnable();
  check('ROPC enabled (will revert)', ROPC_ON);
  let token = await userToken();
  // A full generation/run on a real corpus outlives the access token (live
  // 2026-10-23: the El Salvador generation poll died at ~5 min with
  // "Token has expired", the poll read the 401 body as no-status and fell
  // out, then cleanup deleted a HEALTHY generating suite). Re-mint on 401 —
  // the same fix ragas-compare carries.
  const call = async (method, url, opts = {}) => {
    const first = await req(method, url, { ...opts, token: opts.token || token });
    if (first.status !== 401) return first;
    token = await userToken();
    return req(method, url, { ...opts, token });
  };

  // --- 1. generate (202 + poll) ---
  console.log('generate: 2 questions, single repo…');
  const gen = j(
    await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite`, {
      token,
      json: { testset_size: 2, num_personas: 1, judge_config_key: JUDGE_PICK }
    })
  );
  check(
    'generate answers 202 + suite_key',
    gen.suite_key && gen.status === 'generating',
    JSON.stringify(gen).slice(0, 120)
  );
  SUITE_KEY = gen.suite_key;
  let suite = null;
  const genDeadline = Date.now() + 65 * 60 * 1000; // matches OKF_RAGAS_LONG_TIMEOUT_MS (60 min) + margin
  for (;;) {
    if (Date.now() > genDeadline) break;
    await sleep(4000);
    const doc = j(await call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${SUITE_KEY}`));
    if (doc.status === 'generating') continue;
    if (doc.status === 'failed') {
      console.log('  generation failed:', JSON.stringify(doc.error).slice(0, 300));
      break;
    }
    suite = doc;
    break;
  }
  check('suite generated', !!(suite && suite.kind === 'ragas_suite'));
  if (!suite) throw new Error('no suite — aborting remaining checks');
  check(
    'entries carry query + expected outputs',
    suite.payload.entries.length >= 1 &&
      suite.payload.entries.every((e) => e.query && typeof e.reference_answer === 'string')
  );

  // --- 2. run (202 + poll) ---
  console.log('run: retrieval + answer + judge…');
  const run = j(
    await call('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${SUITE_KEY}/run`, {
      json: { judge_config_key: JUDGE_PICK }
    })
  );
  check('run answers 202 + run_key', run.run_key && run.status === 'running', JSON.stringify(run).slice(0, 120));
  let runDoc = null;
  let lastProgress = null;
  const runDeadline = Date.now() + 65 * 60 * 1000; // matches OKF_RAGAS_LONG_TIMEOUT_MS (60 min) + margin
  for (;;) {
    if (Date.now() > runDeadline) break;
    await sleep(3000);
    const doc = j(
      await call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${SUITE_KEY}/runs/${run.run_key}`)
    );
    if (doc.status === 'running') {
      if (doc.progress && doc.progress !== lastProgress) {
        lastProgress = doc.progress;
        console.log(`  progress: ${doc.progress.phase} ${doc.progress.done}/${doc.progress.total}`);
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
  check('run completed', !!(runDoc && runDoc.status === 'done'));
  if (runDoc) {
    const r0 = runDoc.payload.results[0];
    check(
      'results carry contexts + answer + metrics',
      !!(r0 && Array.isArray(r0.contexts) && typeof r0.answer === 'string' && r0.metrics)
    );
    check(
      'default four metrics present',
      ['faithfulness', 'context_precision', 'context_recall', 'answer_relevancy'].every((m) => m in (r0.metrics || {}))
    );
    const numeric = Object.values(runDoc.payload.summary.metrics || {}).some((v) => typeof v === 'number');
    check('summary has numeric metric means', numeric, JSON.stringify(runDoc.payload.summary.metrics).slice(0, 200));
    check('fidelity recorded', !!runDoc.payload.fidelity.retrieval.algorithm);
    // The judge that ACTUALLY scored the run must be the one the smoke asked
    // for. Without this the smoke passes on a run the active config scored
    // while the harness believed it had asked for something else (the live
    // 2026-10-25 case: a z.ai judge that answered nothing at all).
    const judgePick = (runDoc.payload.fidelity.judge || {}).pick || {};
    check(
      'the run was scored by the judge the smoke asked for',
      judgePick.config_key === JUDGE_PICK,
      `asked ${JUDGE_PICK}, run picked ${JSON.stringify(judgePick.config_key)}`
    );

    // --- 3. explain (202 + poll) ---
    console.log('explain: attribution + advice…');
    const ex = j(
      await call('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${SUITE_KEY}/explain`, {
        json: { run_key: run.run_key }
      })
    );
    let explainDoc = null;
    const exDeadline = Date.now() + 6 * 60 * 1000;
    for (;;) {
      if (Date.now() > exDeadline) break;
      await sleep(2500);
      const doc = j(
        await call('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${SUITE_KEY}/explain/${run.run_key}`)
      );
      if (doc.status === 'running') continue;
      if (doc.status === 'failed') {
        console.log('  explain failed:', JSON.stringify(doc.error).slice(0, 300));
        break;
      }
      explainDoc = doc;
      break;
    }
    check('explain persisted', !!(explainDoc && explainDoc.kind === 'ragas_explain'));
    if (explainDoc) {
      check(
        'attribution rows computed (array)',
        Array.isArray(explainDoc.payload.attributions) && explainDoc.payload.advice
      );
    }

    // --- 4. suite export (his format bytes) ---
    const exp = await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${SUITE_KEY}/export`, { token });
    check(
      'suite export streams xlsx',
      exp.status === 200 && exp.body.length > 500 && exp.body.slice(0, 2).toString() === 'PK'
    );
    fs.writeFileSync('smoke-8-6-suite.xlsx', exp.body);
    console.log(
      `  exported ${exp.body.length} bytes -> smoke-8-6-suite.xlsx (feed to xlsx_to_gold.py for the compat check)`
    );

    // --- 5. results export ---
    const expr = await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${SUITE_KEY}/results-export`, {
      token,
      json: { suite_key: SUITE_KEY, run_keys: [run.run_key] }
    });
    check('results export streams xlsx', expr.status === 200 && expr.body.slice(0, 2).toString() === 'PK');
    fs.writeFileSync('smoke-8-6-results.xlsx', expr.body);
  }
}

(async () => {
  try {
    await main();
  } catch (e) {
    failures += 1;
    console.error('SMOKE ERROR:', e.message);
  } finally {
    // --- compensating cleanup, ALWAYS (steps isolated: one failing step
    // must not skip the others; every HTTP status checked, never silent) ---
    try {
      await refreshAdminToken(); // round-2 lesson: cleanup can outlive the master token
    } catch (e) {
      console.error('cleanup (admin token refresh) failed:', e.message);
    }
    try {
      if (SUITE_KEY && ROPC_ON) {
        // the suite delete needs a user token, so it must run while ROPC is ON
        const t = await userToken();
        const del = await req('DELETE', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${SUITE_KEY}`, {
          token: t
        });
        check('suite deleted (cleanup)', del.status === 200 || del.status === 404, `HTTP ${del.status}`);
      }
    } catch (e) {
      console.error('cleanup (suite) failed:', e.message);
    }
    try {
      await ropcRevert();
      check('ROPC reverted', !ROPC_ON);
    } catch (e) {
      console.error('cleanup (ROPC revert) FAILED — VERIFY MANUALLY:', e.message);
      failures += 1;
    }
    try {
      if (ADMIN_TOKEN) {
        if (!USER_ID) USER_ID = await resolveUserId(); // resolve even if main() died before its own lookup
        if (USER_ID) {
          const du = await req('DELETE', `${AUTH_BASE}/admin/realms/${REALM}/users/${USER_ID}`, { token: ADMIN_TOKEN });
          check(
            'user deleted (cleanup)',
            (du.status >= 200 && du.status < 300) || du.status === 404,
            `HTTP ${du.status}`
          );
        }
      }
    } catch (e) {
      console.error('cleanup (user) failed:', e.message);
      failures += 1;
    }
  }
  console.log(failures === 0 ? 'SMOKE 8-6: ALL CHECKS PASSED' : `SMOKE 8-6: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})();
