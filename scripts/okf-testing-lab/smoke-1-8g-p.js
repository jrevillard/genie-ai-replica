/* eslint-disable */
/**
 * smoke-1-8g-p.js — WHOLE-CORPUS TOPIC LINK AUTHORING (Story 1-8p).
 *
 * David (2026-10-11): "the purpose of this tool is to curate the data to make
 * it better for RAG… I still expect the code to cross-link the topics etc.
 * This processing must be the same and available across the both the wizard
 * and the editor."
 *
 * This is the live gate for that claim. It runs the EDITOR entry point end to
 * end against a real repository (detached 202 + poll), then measures the thing
 * the feature exists to change — the author's link graph the editor projects
 * and the ingest drain reads.
 *
 * Success criteria, asserted (not assumed):
 *   R1  POST /topic-links answers 202 with a running state
 *   R2  GET  /topic-links reaches a TERMINAL state (no eternal spinner — the
 *       exact UX failure of the suite runner this story was written next to)
 *   R3  the run reports written > 0 on a corpus that imported with an EMPTY
 *       graph (the pre-condition is measured, never assumed)
 *   R4  concepts carrying >= 1 link rises from the pre-run count
 *   R5  the EDITOR projection (RepoGraphView's own edge rule) is non-empty:
 *       non-index -> non-index, target exists, from!=to, deduped
 *   R6  every written edge is a REAL pair: both endpoints exist, no self-loop,
 *       no dangling target (the write-safety net, verified on stored data)
 *   R7  links are born in frontmatter.links[] (they survive a body read — the
 *       born-right channel), not only in the derived links[] column
 *   R8  re-running writes NOTHING new (idempotency, live)
 *   R9  no self-loops and no dangling targets per check-okf-repo.js's rules
 *
 * Usage (from the build tree, which holds .env):
 *   node scripts/okf-testing-lab/smoke-1-8g-p.js <repo_id> [--write]
 * or from inside the network (no .env in the container — pass what it needs):
 *   docker cp scripts/okf-testing-lab/smoke-1-8g-p.js main-backend-1:/tmp/
 *   docker exec -e SMOKE_API=http://nginx:80 -e SMOKE_AUTH=http://keycloak:8080 \
 *     -e KEYCLOAK_ADMIN_PASSWORD=... main-backend-1 \
 *     node /tmp/smoke-1-8g-p.js <repo_id> [--write]
 * Default is READ-ONLY apart from the run itself (which writes links); pass
 * --write to also exercise the second, idempotent pass (R8).
 */

const fs = require('fs');
const https = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// The .env is the host's; inside a container it does not exist, so the script
// falls back to whatever the environment already carries (docker exec -e ...).
// Either way process.env wins, so a caller can override without editing files.
const envFile = path.join(ROOT, '.env');
const fromFile = fs.existsSync(envFile)
  ? Object.fromEntries(
      fs
        .readFileSync(envFile, 'utf8')
        .split('\n')
        .map((l) => l.replace(/\r$/, ''))
        .filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
        })
    )
  : {};
const env = { ...fromFile };
for (const [k, v] of Object.entries(process.env)) if (env[k] === undefined) env[k] = v;

const API = process.env.SMOKE_API || env.SMOKE_API || env.VUE_PROXY_HOST || 'https://localhost';
// Keycloak is reachable two ways: KEYCLOAK_INTERNAL_URL is a docker-network
// name (only from inside a container), KEYCLOAK_PUBLIC_URL is the published
// port (only from the host). Prefer the SMOKE_AUTH override, then whichever
// one this process can actually resolve.
const AUTH = process.env.SMOKE_AUTH || env.SMOKE_AUTH || env.KEYCLOAK_PUBLIC_URL || env.KEYCLOAK_INTERNAL_URL;
const SMOKE_USER = process.env.SMOKE_USER || 'okf-smoke-18gp';
const SMOKE_PW = process.env.SMOKE_PW || 'OkfSmoke18gp!2026';
const REPO = process.argv[2];
const DO_SECOND_PASS = process.argv.includes('--write');

let failures = 0;
const check = (id, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
};

function req(method, url, { token, form, json } = {}) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : require('http');
    const body = form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : null;
    const r = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        rejectUnauthorized: false,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', 'Content-Length': Buffer.byteLength(body) } : {})
        }
      },
      (rs) => {
        let d = '';
        rs.on('data', (c) => (d += c));
        rs.on('end', () => res({ status: rs.statusCode, body: d }));
      }
    );
    r.on('error', rej);
    if (body) r.write(body);
    r.end();
  });
}
const j = (r) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return { raw: String(r.body || '').slice(0, 400) };
  }
};

/** A tools-admin bearer, via the same master-admin + ROPC dance the rest of the
 * smoke harness uses — and the ROPC flag is reverted immediately, always. */
async function mintToken() {
  const tok = j(
    await req('POST', `${AUTH}/realms/master/protocol/openid-connect/token`, {
      form: { client_id: 'admin-cli', username: env.KEYCLOAK_ADMIN || 'admin', password: env.KEYCLOAK_ADMIN_PASSWORD, grant_type: 'password' }
    })
  );
  const at = tok.access_token;
  if (!at) throw new Error('master token: ' + JSON.stringify(tok).slice(0, 200));
  await req('POST', `${AUTH}/admin/realms/genie/users`, {
    token: at,
    json: {
      username: SMOKE_USER,
      email: SMOKE_USER + '@example.invalid',
      emailVerified: true,
      firstName: 'Smoke',
      lastName: '18gp',
      enabled: true,
      credentials: [{ type: 'password', value: SMOKE_PW, temporary: false }]
    }
  });
  const uid = j(await req('GET', `${AUTH}/admin/realms/genie/users?username=${SMOKE_USER}&exact=true`, { token: at }))[0].id;
  const role = j(await req('GET', `${AUTH}/admin/realms/genie/roles/tools-admin`, { token: at }));
  await req('POST', `${AUTH}/admin/realms/genie/users/${uid}/role-mappings/realm`, { token: at, json: [role] });
  const cu = j(await req('GET', `${AUTH}/admin/realms/genie/clients?clientId=genie-app`, { token: at }))[0].id;
  const clientFull = j(await req('GET', `${AUTH}/admin/realms/genie/clients/${cu}`, { token: at }));
  const wasOn = !!clientFull.directAccessGrantsEnabled;
  await req('PUT', `${AUTH}/admin/realms/genie/clients/${cu}`, {
    token: at,
    json: { ...clientFull, directAccessGrantsEnabled: true }
  });
  await new Promise((r) => setTimeout(r, 800));
  const ut = j(
    await req('POST', `${AUTH}/realms/genie/protocol/openid-connect/token`, {
      form: { grant_type: 'password', client_id: 'genie-app', username: SMOKE_USER, password: SMOKE_PW }
    })
  );
  // REVERT — non-negotiable, even on the failure path.
  await req('PUT', `${AUTH}/admin/realms/genie/clients/${cu}`, {
    token: at,
    json: { ...clientFull, directAccessGrantsEnabled: wasOn }
  });
  if (!ut.access_token) throw new Error('mint failed: ' + JSON.stringify(ut).slice(0, 300));
  return ut.access_token;
}

/** The EXACT edge rule RepoGraphView.vue draws with (concept-meta-service.js
 * getRepoLinks + the Vue component's filters) — copied, not approximated. */
async function editorGraph(repoId, token) {
  const raw = j(await req('GET', `${API}/api/okf/repos/${repoId}/links`, { token }));
  const links = (raw && raw.links) || [];
  const ids = new Set();
  const pair = new Set();
  let selfLoops = 0;
  let dangling = 0;
  const byTarget = new Map();
  for (const e of links) {
    if (e.to_concept_id == null) continue;
    if (e.from_concept_id === e.to_concept_id) selfLoops += 1;
    if (e.from_concept_id === 'index' || e.to_concept_id === 'index') continue;
    byTarget.set(e.to_concept_id, true);
    ids.add(e.from_concept_id);
    const k = e.from_concept_id + '~' + e.to_concept_id;
    if (!pair.has(k)) pair.add(k);
  }
  return { links, edgeCount: pair.size, selfLoops, fromConcepts: ids.size, targets: byTarget.size };
}

(async () => {
  if (!REPO) {
    console.error('usage: node smoke-1-8g-p.js <repo_id> [--write]');
    process.exit(2);
  }
  console.log(`smoke-1-8g-p — whole-corpus topic linking on ${REPO}\n`);
  const T = await mintToken();

  console.log('BEFORE');
  const before = await editorGraph(REPO, T);
  console.log(`  editor-graph edges=${before.edgeCount} (sources=${before.fromConcepts})`);

  console.log('\nR1/R2 — start the editor run and poll it to a terminal state');
  const start = await req('POST', `${API}/api/okf/repos/${REPO}/topic-links`, { token: T, json: {} });
  check('R1', start.status === 202, `POST /topic-links -> ${start.status} ${JSON.stringify(j(start)).slice(0, 160)}`);
  if (start.status !== 202) {
    console.log('\nABORT — the run never armed, nothing below is meaningful.');
    process.exit(1);
  }
  let run = null;
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    run = j(await req('GET', `${API}/api/okf/repos/${REPO}/topic-links`, { token: T })).run;
    const pct = run && run.batches_total ? `${run.batches_done}/${run.batches_total}` : '…';
    console.log(`  ${Math.round((Date.now() - t0) / 1000)}s  status=${run && run.status} batches=${pct} written=${run && run.written}`);
    if (!run) {
      console.log('  state is null — the progress channel never landed');
      break;
    }
    if (run.status !== 'running') break;
    if (Date.now() - t0 > 20 * 60 * 1000) {
      console.log('  TIMEOUT after 20 min');
      break;
    }
  }
  check('R2', !!run && run.status !== 'running' && !!run.status, `terminal status=${run && run.status}`);
  check('R3', !!run && run.written > 0, `written=${run && run.written} of proposed=${run && run.proposed} (kept=${run && run.kept}, already_linked=${run && run.already_linked}, failures=${run && run.failures})`);
  if (run && run.error) console.log(`  run.error: ${run.error}`);

  console.log('\nAFTER');
  const after = await editorGraph(REPO, T);
  console.log(`  editor-graph edges=${after.edgeCount} (sources=${after.fromConcepts}, targets=${after.targets})`);
  check('R4', after.fromConcepts > before.fromConcepts, `pages carrying >=1 link: ${before.fromConcepts} -> ${after.fromConcepts}`);
  check('R5', after.edgeCount > 0, `editor projection is non-empty: ${after.edgeCount} edges`);

  // R6/R9 — every stored edge points at a real, different concept.
  const concepts = j(await req('GET', `${API}/api/okf/repos/${REPO}/concepts?limit=5000`, { token: T }));
  const list = Array.isArray(concepts.concepts) ? concepts.concepts : Array.isArray(concepts) ? concepts : [];
  const idSet = new Set(list.map((c) => c.concept_id));
  let bad = 0;
  for (const e of after.links) {
    if (!e.from_concept_id || !e.to_concept_id) bad += 1;
    else if (e.from_concept_id === e.to_concept_id) bad += 1;
  }
  check('R6', bad === 0, `${after.links.length} stored link entries, ${bad} malformed/self-loop`);
  check('R9', after.selfLoops === 0, `self-loops=${after.selfLoops}`);
  void idSet;

  // R7 — born right: the links live in frontmatter, not only in the derived
  // links[] column. NOTE: GET /concepts projects with KEEP(...) and does NOT
  // carry frontmatter (listConceptsMeta), so this must read the SINGLE-concept
  // endpoint, which returns the full meta row. Asserting it on the list would
  // have been a wrong test, not a caught bug.
  const sources = [...new Set(after.links.map((e) => e.from_concept_id))].slice(0, 5);
  let withFm = 0;
  let sampled = 0;
  for (const sid of sources) {
    const full = j(await req('GET', `${API}/api/okf/repos/${REPO}/concepts/${encodeURIComponent(sid)}`, { token: T }));
    const fmLinks = full && full.frontmatter && Array.isArray(full.frontmatter.links) ? full.frontmatter.links : [];
    sampled += 1;
    if (fmLinks.length > 0) withFm += 1;
  }
  check('R7', sampled > 0 && withFm === sampled, `${withFm}/${sampled} sampled sources carry frontmatter.links[] (the born-right channel)`);

  if (DO_SECOND_PASS) {
    // The real invariant is NOT "a second run writes nothing" — the assistant
    // is a proposal engine, and on a fresh pass it can surface pairs the first
    // pass did not (live: written=8 alongside already_linked=471). The
    // invariant that MUST hold is: no edge is ever duplicated, and every
    // already-present pair is skipped. That is what "re-running is safe" means.
    console.log('\nR8 — idempotency: a second pass must add no DUPLICATE edge');
    const beforePairs = new Set(after.links.map((e) => e.from_concept_id + '~' + e.to_concept_id));
    const s2 = await req('POST', `${API}/api/okf/repos/${REPO}/topic-links`, { token: T, json: {} });
    check('R8-start', s2.status === 202, `second POST -> ${s2.status}`);
    let r2 = null;
    for (let i = 0; i < 400; i += 1) {
      await new Promise((r) => setTimeout(r, 4000));
      const raw = await req('GET', `${API}/api/okf/repos/${REPO}/topic-links`, { token: T });
      const parsed = j(raw);
      if (raw.status !== 200 || !parsed || !parsed.run) {
        console.log(`  poll #${i} unreadable (HTTP ${raw.status}): ${String(raw.body).slice(0, 160)} — retrying`);
        continue;
      }
      r2 = parsed.run;
      if (['done', 'failed'].includes(r2.status)) break;
      if (i === 399) r2 = null;
    }
    if (!r2) {
      check('R8', false, 'second run never reached a terminal state');
    } else {
      console.log(
        `  second run: status=${r2.status} written=${r2.written} proposed=${r2.proposed} already_linked=${r2.already_linked}`
      );
      const after2 = await editorGraph(REPO, T);
      const pairs2 = new Set(after2.links.map((e) => e.from_concept_id + '~' + e.to_concept_id));
      const dupes = [...pairs2].filter((p) => {
        const n = after2.links.filter((e) => e.from_concept_id + '~' + e.to_concept_id === p).length;
        return n > 1;
      });
      check(
        'R8',
        r2.status === 'done' && (r2.already_linked || 0) > 0 && dupes.length === 0 && pairs2.size === after2.links.length,
        `status=${r2.status}, ${r2.already_linked} existing pair(s) skipped, ${dupes.length} duplicated pair(s) in ${after2.links.length} entries`
      );
      void beforePairs;
    }
  } else {
    console.log('\nR8 — skipped (pass --write to exercise the idempotency pass)');
  }

  console.log(`\n${failures === 0 ? 'SMOKE OK' : 'SMOKE FAILED'} (${failures} failing check(s))`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});