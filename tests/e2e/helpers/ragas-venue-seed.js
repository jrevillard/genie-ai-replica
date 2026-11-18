// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #1890 — the RAGAS e2e venue seed: the three RAGAS specs seed their OWN
// repo + RAGAS data instead of asserting against whatever venue repo
// happened to carry a finished run ('El Salvador' hardcoded — #1890).
//
// What the seed provisions, in order:
//   1. a stale-artifact purge (repos named `ragas-venue-seed` on the seed
//      domain + the seed suite docs — the #1596 name-AND-domain rule);
//   2. a repo via the OKF API (through the gateway, the browser's own
//      boundary) with one tiny concept;
//   3. the suite + done-run docs, written INTO okf_head_test_runs through
//      the TEST-ONLY back door: docker cp + docker exec of
//      data/okf/smoke-test/seed-ragas-venue-docs.js (the same procedure as
//      every run-smoke*.js harness — an in-container write by a runner that
//      already controls the venue; never a production API, never CI);
//   4. the lifecycle to publish (the Studio card's Testing Lab button is
//      rendered ONLY on a publish-state card — StudioDashboard.vue) and a
//      poll until the publish drain stops (a draining card hides it).
//
// The API token is the spec's own tools-admin user minted through the UI
// (getSessionTokenViaUI — the cleanup paths' replacement for ROPC, which
// the realm refuses by design). tools-admin is the OKF super-role
// (middleware/auth.js), so it authorizes every repo mutation the seed and
// the purge need.
//
// TRANSPORT REQUIREMENT: the back door needs a docker daemon that can exec
// into the venue's okf-server container. A venue without one (k8s-only)
// skips the three specs WITH A REASON (#1742 protocol) in the fixture
// hooks' probe — before any fixture exists — rather than failing on
// infrastructure it does not have. A transport that dies MID-seed fails
// the spec loudly: the afterAll purge still runs and says what survived.
//
// registerRagasVenueFixtures is the ONE wiring of the spec protocol (the
// skipUnlessVenue convention, #1773: stated once, not pasted per spec).

const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileP = promisify(execFile);
const { getSessionTokenViaUI, request, getAdminToken, SESSION_MINT_TIMEOUT_MS } = require('./auth');
const { createUser, deleteUser } = require('./keycloak-admin');
const seedDocs = require('../../../data/okf/smoke-test/ragas-venue-seed-docs');

const SEED_DIR = path.resolve(__dirname, '../../../data/okf/smoke-test');
const TEMPLATE_FILE = path.join(SEED_DIR, 'ragas-venue-seed-docs.js');
const WRITER_FILE = path.join(SEED_DIR, 'seed-ragas-venue-docs.js');
// The host↔writer path contract, stated once (cp target + every exec argv).
const TEMPLATE_IN_CONTAINER = '/app/ragas-venue-seed-docs.js';
const WRITER_IN_CONTAINER = '/app/seed-ragas-venue-docs.js';

const REALM = process.env.KEYCLOAK_REALM || 'genie';
// The publish-drain poll: a publish starts the async RAG drain, and the
// card's Testing Lab button hides while `rag_ingestion.status ===
// 'draining'`. A one-concept repo drains in seconds; two minutes bounds a
// wedged worker loudly.
const DRAIN_TIMEOUT_MS = 120000;
const DRAIN_POLL_MS = 3000;

// The one no-container sentence — the probe's skip reason and the direct
// caller's failure say the SAME thing about the SAME condition.
const NO_CONTAINER_REASON =
  'venue seed: no okf-server container reachable via docker (the #1890 back door needs docker exec into the venue’s okf-server; set OKF_E2E_OKF_CONTAINER to name it)';

function log(step, msg) {
  console.log(`[ragas-venue-seed] ${step}: ${msg}`);
}

async function docker(args, opts = {}) {
  const { stdout } = await execFileP('docker', args, { timeout: 60000, ...opts });
  return stdout.trim();
}

/** The venue's okf-server container, or null. OKF_E2E_OKF_CONTAINER names it explicitly. */
async function findOkfContainer() {
  const explicit = process.env.OKF_E2E_OKF_CONTAINER;
  if (explicit) return explicit;
  const names = (await docker(['ps', '--format', '{{.Names}}'])).split('\n').filter((n) => n.includes('okf-server'));
  return names[0] || null;
}

async function okfApi(method, urlPath, token, body) {
  // The shared venue transport (helpers/auth request()): per-request TLS
  // bypass for the self-signed edge — never a process-global kill switch.
  const res = await request(method, urlPath, {
    headers: { Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body })
  });
  return { status: res.status, body: res.data };
}

/**
 * Every repository the caller can read, across ALL pages (the route caps a
 * page at 100 and hands back a cursor) — a stale seed repo hidden past page
 * 1 on a repo-heavy venue must still be found by the purge. The list
 * envelope is the route's fixed { items, next_cursor }.
 */
async function listRepos(token) {
  const all = [];
  let cursor = null;
  for (;;) {
    const r = await okfApi(
      'GET',
      `/api/okf/repos?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      token
    );
    if (r.status !== 200) throw new Error(`repos list → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    const items = (r.body && r.body.items) || [];
    all.push(...items);
    cursor = r.body && r.body.next_cursor;
    if (!cursor) return all;
  }
}

/**
 * The full purge ladder for ONE repo (shared by the stale purge and the
 * afterAll purge — one implementation, one acceptance set): suite cascade
 * → delete → 409 → retract → delete → (in-container unstamp → delete).
 * Accepts 200/202/204/404; anything else throws naming the repo. The suite
 * cascade runs FIRST because a repository delete does NOT cascade
 * okf_head_test_runs docs — the suite delete is what takes the runs
 * (cancelled re-scores included); if IT fails, the trailing verify-clean /
 * orphan sweep is what still catches the survivors.
 */
async function purgeRepoWithLadder(token, repoId, container) {
  const s = await okfApi('DELETE', `/api/okf/repos/${repoId}/ragas-testsuite/${seedDocs.SUITE_KEY}`, token);
  if (![200, 404].includes(s.status)) {
    log(
      'purge',
      `suite delete → ${s.status} ${JSON.stringify(s.body).slice(0, 200)} (continuing — verify-clean owns the survivors)`
    );
  }
  const deleteOnce = async () => {
    let del = await okfApi('DELETE', `/api/okf/repos/${repoId}`, token);
    if (del.status === 409) {
      await okfApi('POST', `/api/okf/repos/${repoId}/lifecycle`, token, { action: 'retract' });
      del = await okfApi('DELETE', `/api/okf/repos/${repoId}`, token);
    }
    return del.status;
  };
  let st = await deleteOnce();
  if (![200, 202, 204, 404].includes(st)) {
    if (!container)
      throw new Error(`venue purge: repo ${repoId} delete → ${st} and no container for the unstamp fallback`);
    await execInContainer(container, ['node', WRITER_IN_CONTAINER, 'unstamp', repoId]);
    st = await deleteOnce();
  }
  if (![200, 202, 204, 404].includes(st)) {
    throw new Error(`venue purge: repo ${repoId} delete → ${st} — the seed repo is LEFT BEHIND`);
  }
  return st;
}

/**
 * Remove every artifact a previous seed run could have left: the seed repo
 * (by name AND domain) and the seed suite docs (the suite-delete cascade
 * removes its runs too). 404s are fine — nothing to purge.
 */
async function purgeStale(token, container) {
  for (const repo of await listRepos(token)) {
    if (repo.name !== seedDocs.REPO_NAME || repo.domain !== seedDocs.DOMAIN) continue;
    const st = await purgeRepoWithLadder(token, repo.repo_id, container);
    log('purge', `stale seed repo ${repo.repo_id} removed (${st})`);
  }
  // Orphan sweep: docs from a run whose purge missed the suite cascade (a
  // crashed run, a pre-fix seed) have no repo to hang off — reachable by
  // suite_key alone.
  await sweepOrphanDocs(container);
}

/** Remove every okf_head_test_runs doc in the seed's suite scope, repo or
 * no repo (the writer's purge-docs). */
async function sweepOrphanDocs(container) {
  const out = await execInContainer(container, ['node', WRITER_IN_CONTAINER, 'purge-docs']);
  log('purge', out.trim());
}

async function execInContainer(container, args) {
  try {
    return await docker(['exec', container, ...args]);
  } catch (e) {
    // The writer's verdicts (verify-clean's leftover list, seed failures)
    // are on stderr/stdout — surface them, never just "Command failed".
    throw new Error(
      `in-container exec failed (${args.join(' ')}): ${e.message}\nstdout: ${e.stdout || ''}\nstderr: ${e.stderr || ''}`,
      { cause: e }
    );
  }
}

/**
 * Seed the venue for the three RAGAS specs. Any failure THROWS — a broken
 * seed on a capable venue is a loud failure, not a skip (the venue posture
 * check is the hooks' probe, which SKIPS before anything is created).
 *
 * @param {{username: string, password: string}} user - the spec's own
 *        tools-admin user (already created by the fixture hooks).
 * @param {string} [container] - the probed okf-server container (the
 *        fixture hooks thread theirs so the seed re-runs no docker ps).
 * @returns {Promise<{repoId: string}>}
 */
async function seedRagasVenue(user, container = null) {
  container = container || (await findOkfContainer());
  if (!container) throw new Error(NO_CONTAINER_REASON);
  log('container', container);

  // The writer + template go in FIRST (independent copies, overlapped) —
  // the stale-artifact purge's orphan sweep execs them (a container copy
  // from a previous run may predate the current subcommands).
  await Promise.all([
    docker(['cp', TEMPLATE_FILE, `${container}:${TEMPLATE_IN_CONTAINER}`]),
    docker(['cp', WRITER_FILE, `${container}:${WRITER_IN_CONTAINER}`])
  ]);

  const token = await getSessionTokenViaUI({ user });
  if (!token) throw new Error('venue seed: the UI session mint returned no token');

  await purgeStale(token, container);

  const created = await okfApi('POST', '/api/okf/repos', token, {
    name: seedDocs.REPO_NAME,
    domain: seedDocs.DOMAIN,
    acl: { required_scopes: [] },
    lifecycle_state: 'draft'
  });
  if (created.status !== 201 || !created.body.repo_id) {
    throw new Error(`venue seed: repo create → ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
  }
  const repoId = created.body.repo_id;
  log('repo', `created ${repoId}`);

  const imp = await okfApi('POST', `/api/okf/repos/${repoId}/import`, token, {
    concepts: [
      {
        path: 'index.md',
        frontmatter: {
          type: 'topic',
          title: 'Venue seed alpha',
          sources: [],
          links: []
        },
        body: '# Venue seed alpha\n\nThe venue seed fixture concept.'
      }
    ]
  });
  if (![200, 201, 202].includes(imp.status)) {
    throw new Error(`venue seed: import → ${imp.status} ${JSON.stringify(imp.body).slice(0, 200)}`);
  }
  log('import', `1 concept → ${imp.status}`);

  // The back door: exec the writer (copied in at the top of the seed). It
  // marks PII scanned (the submit gate) and writes both docs.
  const out = await execInContainer(container, ['node', WRITER_IN_CONTAINER, 'seed', repoId]);
  log('back-door', out.trim().split('\n').join(' | '));

  for (const action of ['submit', 'approve', 'publish']) {
    const r = await okfApi('POST', `/api/okf/repos/${repoId}/lifecycle`, token, { action });
    if (r.status !== 200)
      throw new Error(`venue seed: lifecycle ${action} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  log('lifecycle', 'publish');

  // The Testing Lab button hides while the publish drain runs — wait it out.
  const started = Date.now();
  for (;;) {
    const repo = (await listRepos(token)).find((x) => x.repo_id === repoId);
    if (!repo) throw new Error('venue seed: the seeded repo vanished from the list');
    const draining = repo.rag_ingestion && repo.rag_ingestion.status === 'draining';
    const importing = repo.conversion && !['done', 'failed'].includes(repo.conversion.status);
    if (!draining && !importing) break;
    if (Date.now() - started > DRAIN_TIMEOUT_MS) {
      throw new Error(
        `venue seed: the publish drain never settled within ${DRAIN_TIMEOUT_MS / 1000}s (rag_ingestion=${JSON.stringify(repo.rag_ingestion)})`
      );
    }
    await new Promise((r) => setTimeout(r, DRAIN_POLL_MS));
  }
  log('drain', 'settled');

  // The seed asserts its own readiness: the suite + run docs answer over
  // the API exactly as the panel will read them (listRuns' fixed envelope
  // is { runs }, and every row projects suite_key).
  const runs = await okfApi('GET', `/api/okf/repos/${repoId}/ragas-testsuite/runs?kind=all&limit=20`, token);
  const rows = (runs.body && runs.body.runs) || [];
  const hasSuite = rows.some((x) => x.kind === 'ragas_suite' && x.suite_key === seedDocs.SUITE_KEY);
  const hasDone = rows.some((x) => x.kind === 'ragas_run' && x.status === 'done' && x._key === seedDocs.RUN_KEY);
  if (!hasSuite || !hasDone) {
    throw new Error(
      `venue seed: readiness check failed — listRuns kind=all → ${runs.status} ${JSON.stringify(runs.body).slice(0, 300)}`
    );
  }
  log('ready', `repo ${repoId} carries suite ${seedDocs.SUITE_KEY} + done run ${seedDocs.RUN_KEY}`);

  return { repoId };
}

/**
 * The afterAll purge (the "clean it up" ruling): the suite-delete cascade
 * takes the synthetic docs (suite + runs, cancelled rows included), then
 * the repo leaves. Everything is 404-tolerant; a REAL failure throws so a
 * leftover can never pass silently — #1890 exists because rows used to
 * pile up unnoticed. The purge asserts its own completeness on EVERY exit
 * path: verify-clean runs even when no seed repo was found (the orphan
 * sweep's own verdict), and when docker is unreachable at purge time the
 * skipped check is NAMED in a warning, never silent.
 *
 * @param {{username: string, password: string}} user
 * @param {string} [container] - the probed container (threaded by the
 *        fixture hooks; re-discovered when omitted).
 */
async function purgeRagasVenue(user, container = null) {
  if (!container) {
    try {
      container = await findOkfContainer();
    } catch (e) {
      log(
        'purge',
        `WARNING: docker unreachable at purge time (${e.message}) — unstamp fallback AND verify-clean are SKIPPED; any leftover goes UNVERIFIED`
      );
    }
  }
  const token = await getSessionTokenViaUI({ user });
  if (!token) throw new Error('venue purge: the UI session mint returned no token');

  const repos = await listRepos(token);
  const ours = repos.filter((r) => r.name === seedDocs.REPO_NAME && r.domain === seedDocs.DOMAIN);
  if (!ours.length) {
    log('purge', 'no seed repo found — orphan doc sweep + verify-clean still run');
  }
  for (const repo of ours) {
    const st = await purgeRepoWithLadder(token, repo.repo_id, container);
    log('purge', `repo ${repo.repo_id} removed (${st})`);
  }

  if (container) {
    // Orphan docs (a crashed run's suite whose repo is long gone) have no
    // repo to hang off — sweep by suite_key, then demand a clean verdict.
    await sweepOrphanDocs(container);
    const verdict = await execInContainer(container, ['node', WRITER_IN_CONTAINER, 'verify-clean']);
    log('purge', verdict.trim());
  } else {
    log(
      'purge',
      'WARNING: verify-clean SKIPPED (docker unreachable) — the venue’s cleanliness is UNVERIFIED for this run'
    );
  }
}

/**
 * The spec fixture protocol, stated ONCE (the #1773 convention): the
 * beforeAll probes the back-door transport — a venue without an
 * okf-server container skips the whole group WITH A REASON before any
 * fixture exists (a skip halts the remaining hooks, so nothing leaks) —
 * then mints the spec's tools-admin user and seeds. The afterAll purges on
 * EVERY exit — a half-seeded repo from a mid-seed throw must never
 * outlive the spec either (#1890's whole class) — and deletes the Keycloak
 * user in FINALLY, so a purge failure still removes the user before
 * surfacing.
 *
 * @param {object} testApi - the Playwright `test` object the spec uses
 * @param {{username: string, email: string, password: string}} fixture -
 *        the spec's own tools-admin user description
 */
function registerRagasVenueFixtures(testApi, { username, email, password }) {
  const user = { username, password };
  let container = null;
  let adminToken = null;
  let userId = null;

  testApi.beforeAll(async () => {
    // Minting can exceed the 60s beforeAll hook default — see
    // SESSION_MINT_TIMEOUT_MS in helpers/auth.js.
    testApi.setTimeout(SESSION_MINT_TIMEOUT_MS);

    try {
      container = await findOkfContainer();
    } catch (e) {
      testApi.skip(true, `venue seed: docker itself is unreachable for the back door (${e.message})`);
      return;
    }
    if (!container) {
      testApi.skip(true, NO_CONTAINER_REASON);
      return;
    }

    adminToken = await getAdminToken();
    userId = await createUser(adminToken, REALM, {
      username,
      email,
      password,
      realmRoles: ['tools-admin']
    });

    await seedRagasVenue(user, container);
  });

  testApi.afterAll(async () => {
    try {
      if (container) await purgeRagasVenue(user, container);
    } finally {
      if (adminToken && userId) await deleteUser(adminToken, REALM, userId);
    }
  });
}

module.exports = {
  REPO_NAME: seedDocs.REPO_NAME,
  registerRagasVenueFixtures,
  seedRagasVenue,
  purgeRagasVenue
};
