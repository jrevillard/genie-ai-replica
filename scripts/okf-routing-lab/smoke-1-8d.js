// Story 1-8d live smoke (local build). NOT committed — dev-only harness.
// SUPERSET of smoke-1-8c.js (checks 1-8 unchanged) + the 1-8d surface:
//   checks 9-12 prove the suggestion guardrail, frontmatter history +
//   revert, suite forbidden_snapshot staleness marking, and the
//   positive-failure advice shape:
//   POST /api/okf/repos/:id/routing-explain        (+ suggestion.rejected)
//   GET  /api/okf/repos/:id/frontmatter/history
//   POST /api/okf/repos/:id/frontmatter/revert     {saved_at}
//   POST /api/okf/repos/:id/routing-test           (per-tag guard math)
//   POST /api/okf/repos/:id/routing-testsuite      (+ forbidden_snapshot)
//   POST /api/okf/repos/:id/routing-testsuite/:k/run
//   POST /api/okf/repos/:id/routing-testsuite/:k/explain (+positive_failures)
//   POST /api/okf/repos/:id/routing-advisor           (comprehensive advisor)
// Same auth spine as smoke-1-8c.js: throwaway Keycloak user + tools-admin
// role + temporary ROPC (reverted immediately + on exit). COMPENSATING
// WRITES ONLY: the one throwaway forbidden tag the history/revert check
// adds is removed again through the revert endpoint itself before exit.
// Secrets are never printed.
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const REPO_ID = process.argv[2] || 'f043215b-cead-4af2-ad37-e675a8eec4b7';
const HIV_QUERY =
  'Give me a definitive list of the causes and symptoms of all the various types of diseases like HIV and other viruses';
const SMOKE_USER = 'okf-smoke-18d';
const SMOKE_PW = crypto.randomBytes(18).toString('base64url') + '#aA1!';
// Check 9 threshold — mirrors OKF_GUARD_SELF_SUBJECT (default 0.55).
let GUARD_SELF_SUBJECT = 0.55;
// Check 10's compensating-write tag (forbidden list grows by one, then is
// reverted away through the new endpoint).
const THROWAWAY_TAG = 'smoke-18d-throwaway';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
if (env.OKF_GUARD_SELF_SUBJECT) {
  const v = parseFloat(env.OKF_GUARD_SELF_SUBJECT);
  if (Number.isFinite(v) && v > 0) GUARD_SELF_SUBJECT = v;
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
// Set-equality for tag arrays (order-free deep-equals).
const eqTags = (a, b) =>
  JSON.stringify([...(Array.isArray(a) ? a : [])].sort()) === JSON.stringify([...(Array.isArray(b) ? b : [])].sort());

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

// Story 1-8f2: generation is now 202 + poll — POST returns
// {suite_key, status:'generating'} and the doc lands later.
async function generateSuite(body) {
  const start = j(await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite`, { token: USER_TOKEN, json: body }));
  const key = start.suite_key;
  if (!key || start.status !== 'generating') return start;
  // 1-8f2 contract: an in-flight key answers 200 {suite_key, status:'generating'}
  // (never a 404 — the minted-key envelope is the poll's keep-waiting signal).
  const first = j(await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/${key}`, { token: USER_TOKEN }));
  if (!(first && first.suite_key === key && first.status === 'generating')) {
    console.log(`  [WARN] generating-key GET did not return the generating envelope: ${JSON.stringify(first).slice(0, 120)}`);
  }
  for (let i = 0; i < 60; i++) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 2500));
    // eslint-disable-next-line no-await-in-loop
    const got = j(await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/${key}`, { token: USER_TOKEN }));
    if (got.suite_key && got.status !== 'generating') return got;
  }
  return { suite_key: key, status: 'timeout' };
}

(async () => {
  console.log('== Story 1-8d live smoke against ' + API_BASE + ' ==');
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
      email: 'okf-smoke-18d@example.invalid',
      emailVerified: true,
      firstName: 'Smoke',
      lastName: 'OneEightD',
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

  // 5. suite generation with count controls + near-miss class (1-8f2: async)
  const gen = await generateSuite({ n_positive: 3, n_negative: 2, n_negative_random: 2, n_meta: 2, n_near_miss: 3 });
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

  // ---- 9. GUARDRAIL (1-8d) ----
  // The LLM's proposals are non-deterministic, so the guard is verified
  // structurally: rejected must be an array, accepted tags must never
  // appear in it, and — against the repo's own head vectors — no accepted
  // tag may sit at/above the self-subject threshold on any positive field.
  // The per-tag routing-test call returns the guard's own math (cosine of
  // the tag against the CURRENT head's per-field centroids), so the script
  // needs no direct TEI access.
  console.log('[9] guardrail');
  const repoDoc = j(await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}`, { token: USER_TOKEN }));
  const pf = repoDoc.head && repoDoc.head.per_field;
  check(
    'guardrail: repo head carries per-field vectors',
    !!pf && ['topic', 'entity', 'keyword', 'summary', 'scope'].some((f) => Array.isArray(pf[f])),
    pf ? `fields=${['topic', 'entity', 'keyword', 'summary', 'scope'].filter((f) => Array.isArray(pf[f])).join('/')}` : 'no head.per_field'
  );
  const sugg = ex.suggestion || {};
  const rej = Array.isArray(sugg.rejected) ? sugg.rejected : null;
  const accepted = Array.isArray(sugg.tags) ? sugg.tags : [];
  const rejTags = (rej || []).map((e) => e && e.tag);
  check(
    'guardrail: suggestion.rejected array, disjoint from tags',
    rej !== null && rej.every((e) => e && typeof e.tag === 'string' && typeof e.reason === 'string') && accepted.every((t) => !rejTags.includes(t)),
    rej === null
      ? 'rejected missing (not an array)'
      : `rejected=[${rej.map((e) => e.tag + ' (' + e.reason.slice(0, 40) + '...)').join('; ')}] accepted=[${accepted.join(', ')}]`
  );
  // Guard math: cosine(tag, each positive-field centroid) < threshold.
  // Vacuously true when nothing was accepted (an empty set has no violator).
  let guardMathOk = true;
  const guardDetails = [];
  for (const tag of accepted) {
    const rt = j(
      await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-test`, {
        token: USER_TOKEN,
        json: { query: tag, include_probes: false }
      })
    );
    const fields = rt.under_test && rt.under_test.per_field;
    if (!fields) {
      guardMathOk = false;
      guardDetails.push(`${tag}: no per_field`);
      continue;
    }
    const worst = ['topic', 'entity', 'keyword', 'summary', 'scope']
      .map((f) => ({ f, c: typeof fields[f] === 'number' ? fields[f] : -1 }))
      .reduce((a, x) => (x.c > a.c ? x : a), { f: '-', c: -1 });
    if (worst.c >= GUARD_SELF_SUBJECT) guardMathOk = false;
    guardDetails.push(`${tag}: max ${worst.f}=${worst.c.toFixed(3)}`);
  }
  check(
    `guardrail: accepted tags all below ${GUARD_SELF_SUBJECT} on every positive field`,
    guardMathOk,
    accepted.length ? guardDetails.join(', ') : 'no accepted tags — guard math vacuously holds'
  );

  // ---- 10. HISTORY + REVERT roundtrip (compensating writes only) ----
  // Deterministic self-contained flow: snapshot the CURRENT frontmatter as
  // the baseline save, add ONE throwaway forbidden tag, revert to it via
  // the new endpoint (restores exactly that snapshot — and removes the
  // throwaway through the revert path, not a second PATCH).
  console.log('[10] history + revert');
  const F0 = Array.isArray(repoDoc.frontmatter && repoDoc.frontmatter.forbidden)
    ? repoDoc.frontmatter.forbidden
    : [];
  // The UI's 6-field save shape (drops legacy _approved stamps — they 400).
  const fmShape = (forbidden) => {
    const src = repoDoc.frontmatter || {};
    const arr = (v) => (Array.isArray(v) ? v : []);
    return {
      topic: arr(src.topic),
      entity: arr(src.entity),
      scope: typeof src.scope === 'string' ? src.scope : '',
      forbidden,
      summary: typeof src.summary === 'string' ? src.summary : '',
      keyword: arr(src.keyword)
    };
  };
  const hist0 = j(await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/frontmatter/history`, { token: USER_TOKEN }));
  check(
    'history: GET 200 + entries array',
    Array.isArray(hist0.entries),
    `n=${(hist0.entries || []).length} latest=${hist0.entries && hist0.entries[0] && hist0.entries[0].saved_at}`
  );
  const pBase = await req('PATCH', `${API_BASE}/api/okf/repos/${REPO_ID}`, {
    token: USER_TOKEN,
    json: { frontmatter: fmShape(F0) }
  });
  check('history: baseline save PATCH 200', pBase.status === 200, `status=${pBase.status}`);
  const pTag = await req('PATCH', `${API_BASE}/api/okf/repos/${REPO_ID}`, {
    token: USER_TOKEN,
    json: { frontmatter: fmShape([...F0, THROWAWAY_TAG]) }
  });
  check('history: throwaway-tag save PATCH 200', pTag.status === 200, `status=${pTag.status}`);
  const hist1 = j(await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/frontmatter/history`, { token: USER_TOKEN }));
  const top1 = hist1.entries && hist1.entries[0];
  const below1 = hist1.entries && hist1.entries[1];
  check(
    'history: top entry is the throwaway save',
    !!top1 && Array.isArray(top1.shape && top1.shape.forbidden) && top1.shape.forbidden.includes(THROWAWAY_TAG) && typeof top1.saved_at === 'string',
    top1 ? `saved_at=${top1.saved_at} forbidden_count=${top1.forbidden_count} actor=${top1.actor}` : 'no entries'
  );
  check(
    'history: baseline snapshot directly below',
    !!below1 && eqTags(below1.shape && below1.shape.forbidden, F0),
    below1 ? `saved_at=${below1.saved_at}` : 'missing second entry'
  );
  // Revert to the TOP entry — the restored frontmatter must deep-equal
  // that entry's shape (the revert restores the snapshotted state).
  const rev1 = j(
    await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/frontmatter/revert`, {
      token: USER_TOKEN,
      json: { saved_at: top1 && top1.saved_at }
    })
  );
  check(
    'revert: 200 to the top entry',
    rev1.reverted_to === (top1 && top1.saved_at) && !!rev1.frontmatter,
    rev1.reverted_to ? `reverted_to=${rev1.reverted_to}` : `status/body: ${JSON.stringify(rev1).slice(0, 120)}`
  );
  const repoRev = j(await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}`, { token: USER_TOKEN }));
  check(
    'revert: frontmatter.forbidden deep-equals the reverted entry shape',
    JSON.stringify(repoRev.frontmatter && repoRev.frontmatter.forbidden) === JSON.stringify(top1 && top1.shape && top1.shape.forbidden),
    `forbidden=[${(repoRev.frontmatter && repoRev.frontmatter.forbidden || []).join(', ')}]`
  );
  // The revert goes back through update() — it is itself snapshotted.
  const hist2 = j(await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/frontmatter/history`, { token: USER_TOKEN }));
  const top2 = hist2.entries && hist2.entries[0];
  check(
    'revert: revert itself snapshotted (new top entry)',
    !!top2 && top2.saved_at !== (top1 && top1.saved_at) && eqTags(top2.shape && top2.shape.forbidden, top1 && top1.shape && top1.shape.forbidden),
    top2 ? `saved_at=${top2.saved_at}` : 'no entries'
  );
  // COMPENSATION via the revert endpoint: restore the pre-tag baseline.
  // If the endpoint path itself fails, fall back to a direct PATCH of the
  // baseline so the stack never stays mutated by a half-run smoke.
  const rev2 = await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/frontmatter/revert`, {
    token: USER_TOKEN,
    json: { saved_at: below1 && below1.saved_at }
  });
  let repoClean = j(await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}`, { token: USER_TOKEN }));
  let fmNow = repoClean.frontmatter && repoClean.frontmatter.forbidden;
  let via = 'revert endpoint';
  if (rev2.status !== 200 || !Array.isArray(fmNow) || fmNow.includes(THROWAWAY_TAG)) {
    const pFix = await req('PATCH', `${API_BASE}/api/okf/repos/${REPO_ID}`, {
      token: USER_TOKEN,
      json: { frontmatter: fmShape(F0) }
    });
    repoClean = j(await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}`, { token: USER_TOKEN }));
    fmNow = repoClean.frontmatter && repoClean.frontmatter.forbidden;
    via = `PATCH fallback (revert status=${rev2.status}, patch status=${pFix.status})`;
  }
  check(
    'revert: compensation — throwaway removed, baseline restored',
    Array.isArray(fmNow) && !fmNow.includes(THROWAWAY_TAG) && eqTags(fmNow, F0),
    `via=${via} forbidden=[${(fmNow || []).join(', ')}]`
  );

  // ---- 11. STALENESS: forbidden_snapshot on generation ----
  console.log('[11] staleness snapshot');
  const repoNow = j(await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}`, { token: USER_TOKEN }));
  const forbiddenNow = (repoNow.frontmatter && repoNow.frontmatter.forbidden) || [];
  const gen2 = await generateSuite({ n_positive: 2, n_negative: 2, n_negative_random: 2, n_meta: 2, n_near_miss: 2 });
  SUITE_KEY = gen2.suite_key || SUITE_KEY;
  check(
    'staleness: payload.forbidden_snapshot equals current forbidden',
    Array.isArray(gen2.payload && gen2.payload.forbidden_snapshot) && eqTags(gen2.payload.forbidden_snapshot, forbiddenNow),
    `snapshot=[${((gen2.payload && gen2.payload.forbidden_snapshot) || []).join(', ')}] current=[${forbiddenNow.join(', ')}]`
  );

  // ---- 12. POSITIVE-FAILURE advice shape ----
  console.log('[12] positive-failure shape');
  const run2 = j(await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/${SUITE_KEY}/run`, { token: USER_TOKEN }));
  const run2Rows = (run2.payload && run2.payload.results) || [];
  const batch2 = j(
    await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/${SUITE_KEY}/explain`, { token: USER_TOKEN })
  );
  const pfShape = batch2.positive_failures;
  const vetoSum = pfShape && pfShape.veto_counts
    ? Object.values(pfShape.veto_counts).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)
    : -1;
  check(
    'advice: positive_failures {count, veto_counts, margin_killed}',
    !!pfShape && typeof pfShape.count === 'number' && !!pfShape.veto_counts && typeof pfShape.veto_counts === 'object' && typeof pfShape.margin_killed === 'number',
    `count=${pfShape && pfShape.count} veto_counts=${JSON.stringify(pfShape && pfShape.veto_counts)} margin_killed=${pfShape && pfShape.margin_killed}`
  );
  check(
    'advice: count identity (count = vetoed + margin-killed)',
    !!pfShape && pfShape.count === vetoSum + pfShape.margin_killed,
    `count=${pfShape && pfShape.count} vs ${vetoSum}+${pfShape && pfShape.margin_killed} (run killed ${run2Rows.filter((q) => q.kind === 'positive' && q.head_claimed === false).length} positives)`
  );
  check(
    'advice: removal_suggestions array (possibly empty)',
    Array.isArray(batch2.removal_suggestions) && batch2.removal_suggestions.every((r) => r && typeof r.tag === 'string' && typeof r.killed === 'number'),
    `removals=[${(batch2.removal_suggestions || []).map((r) => r.tag + 'x' + r.killed).join(', ')}] note=${(batch2.note || '').slice(0, 60)}`
  );

  // ---- 13. COMPREHENSIVE ADVISOR (aggregates runs → simulates the gate) ----
  // Structural: the scorecards must be well-formed and CONSISTENT (the
  // totals describe the same deduped query set), and the zero-positive-harm
  // constraint must hold on the recommendation itself — the predicted
  // positive_claimed may never sit below the current one.
  console.log('[13] advisor');
  const adv = j(await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-advisor`, { token: USER_TOKEN, json: {} }));
  const cur = adv.current_scorecard;
  const rec = adv.recommended_scorecard;
  const scOk = (s) =>
    !!s && typeof s.positive_claimed === 'number' && typeof s.positive_total === 'number' && typeof s.negative_suppressed === 'number' && typeof s.negative_total === 'number';
  check(
    'advisor: 200 + scorecard/changes shape',
    scOk(cur) && scOk(rec) && !!adv.changes && Array.isArray(adv.changes.add) && Array.isArray(adv.changes.remove) && Array.isArray(adv.add_eval) && Array.isArray(adv.remove_eval),
    `add=[${(adv.changes && adv.changes.add || []).join(', ')}] remove=[${(adv.changes && adv.changes.remove || []).map((r) => (typeof r === 'string' ? r : r && r.tag)).join(', ')}] queries=${adv.queries_considered} runs=${adv.runs_considered}`
  );
  check(
    'advisor: scorecard totals agree between current and recommended',
    !!cur && !!rec && cur.positive_total === rec.positive_total && cur.negative_total === rec.negative_total && cur.positive_total > 0 && cur.negative_total > 0,
    `positives ${cur && cur.positive_total}/${rec && rec.positive_total} negatives ${cur && cur.negative_total}/${rec && rec.negative_total}`
  );
  check(
    'advisor: zero-positive-harm holds on the recommendation',
    !!cur && !!rec && rec.positive_claimed >= cur.positive_claimed,
    `claimed ${cur && cur.positive_claimed} -> ${rec && rec.positive_claimed} (suppressed ${cur && cur.negative_suppressed} -> ${rec && rec.negative_suppressed})`
  );

  // ---- 14. SUITE LOAD + ROW EDIT roundtrip (1-8f) ----
  // GET the latest saved suite (full rows), flip its first negative row to
  // positive, verify the server moved it, flip it back. Compensating
  // roundtrip: query + kind are identical at exit; the row's generator cls
  // is cleared by a flip (documented behavior — a relabeled row has no
  // generator class), which is the one content delta the roundtrip leaves.
  console.log('[14] suite load + row edit');
  const suitesList = j(
    await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/runs?kind=suite&limit=1`, { token: USER_TOKEN })
  );
  const latestSuite = suitesList.runs && suitesList.runs[0];
  check('suites: saved-suites listing returns suite docs', !!latestSuite && !!latestSuite._key, `key=${latestSuite && latestSuite._key}`);
  const loaded = j(await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/${latestSuite && latestSuite._key}`, { token: USER_TOKEN }));
  const firstNeg = (loaded.payload && loaded.payload.negative || [])[0];
  check(
    'suite load: full rows returned',
    !!loaded.suite_key && Array.isArray(loaded.payload && loaded.payload.negative) && !!firstNeg,
    `negatives=${(loaded.payload && loaded.payload.negative || []).length} positives=${(loaded.payload && loaded.payload.positive || []).length}`
  );
  const flipBody = {
    updates: [{ match: { query: firstNeg.query, kind: firstNeg.kind || 'negative' }, set: { kind: 'positive' } }]
  };
  const flipped = j(
    await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/${latestSuite._key}/rows`, { token: USER_TOKEN, json: flipBody })
  );
  const negAfter = (flipped.payload && flipped.payload.negative) || [];
  check(
    'suite edit: row flipped out of negatives',
    Array.isArray(flipped.payload && flipped.payload.negative) &&
      !negAfter.some((r) => r.query === firstNeg.query && (r.kind || 'negative') === 'negative'),
    `negatives now=${negAfter.length}`
  );
  const flipBack = j(
    await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/${latestSuite._key}/rows`, {
      token: USER_TOKEN,
      json: { updates: [{ match: { query: firstNeg.query, kind: 'positive' }, set: { kind: firstNeg.kind || 'negative' } }] }
    })
  );
  const negBack = (flipBack.payload && flipBack.payload.negative) || [];
  check(
    'suite edit: flip-back restores the row (compensating roundtrip)',
    negBack.some((r) => r.query === firstNeg.query && r.kind === (firstNeg.kind || 'negative')),
    `negatives=${negBack.length} (cls cleared by the flip — documented)`
  );
  const noauthEdit = await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/${latestSuite._key}/rows`, { json: flipBody });
  check('suite edit: unauthenticated rejected', noauthEdit.status === 401 || noauthEdit.status === 403, `status=${noauthEdit.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n== SMOKE ${failed.length ? 'FAILED' : 'PASSED'}: ${results.length - failed.length}/${results.length} checks ==`);
  process.exitCode = failed.length ? 1 : 0;
})()
  .catch((e) => {
    console.error('SMOKE ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(cleanup);
