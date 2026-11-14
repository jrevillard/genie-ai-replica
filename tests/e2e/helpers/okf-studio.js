/**
 * The OKF Studio specs' shared scaffold — the account the Studio works
 * with, the Studio route family for one repo, and the open-a-repo walk.
 *
 * WHY THIS EXISTS: three specs drive the Studio through the same path —
 * the deployment-admin login (the e2e fixture user carries no okf scope,
 * so the Studio renders empty lanes for it), the `/admin?tab=studio`
 * dashboard, and the repo card click. The contract lived inline in
 * concept-ceiling.spec.js first, then twice more with the wave's two new
 * specs; this module is its one home, and all three specs are its callers
 * (#1841 migrated the ceiling spec onto it).
 *
 * The specs own their FIXTURES (the repo/draft/import payloads and the
 * assertions); this module owns the transport-shaped scaffolding around
 * them.
 */
const { loginViaUI, BASE_URL } = require('./chatbot');

/**
 * The deployment's own admin account. The credentials come from the
 * environment (the local build's .env carries them); the defaults name
 * the deployment convention.
 * @returns {{username: string, password: string}}
 */
function okfAdminUser() {
  return {
    username: process.env.GENIE_ADMIN_USERNAME || 'genie-admin',
    password: process.env.GENIE_ADMIN_PASSWORD || ''
  };
}

/**
 * Stub the Studio's route family for ONE repo, before the page loads:
 *
 *   - `…/api/okf/repos?*`         the dashboard list — `{ items: [repo] }`
 *   - `…/api/okf/repos/<id>/draft` the draft read. A 200 wraps the body in
 *                                  the `{ repo_id, draft }` envelope the
 *                                  client unwraps; any other status fulfills
 *                                  `draftBody` verbatim (the error shape
 *                                  under test — the envelope is a
 *                                  success-shape detail).
 *   - `…/api/okf/repos/<id>/concepts` the concept tree the Input step
 *                                     refreshes — empty, or `conceptsBody`
 *                                     when given (the concept-ceiling spec's
 *                                     list needs a row to click).
 *   - `…/api/okf/repos/<id>/import` the import POST, only when `importBody`
 *                                   is given (the wizard split-note spec).
 *
 * Plain routes: they answer every match, and a stub that vanishes mid-test
 * is exactly the silent degrade the suite forbids.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} p
 * @param {string} p.repoId the stubbed repo's id
 * @param {object} p.repo the repository object the dashboard lists
 * @param {number} [p.draftStatus=200] the draft read's verdict
 * @param {object|null} [p.draftBody=null] the draft read's body
 * @param {Array} [p.conceptsBody=[]] the concepts list's rows (a spec that
 *   opens a concept needs at least one, carrying `concept_id`)
 * @param {object|null} [p.importBody=null] when given, the import POST's answer
 */
async function stubStudioRepoRoutes(page, { repoId, repo, draftStatus = 200, draftBody = null, conceptsBody = [], importBody = null }) {
  await page.route('**/api/okf/repos?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [repo], next_cursor: null })
    })
  );
  await page.route(`**/api/okf/repos/${repoId}/draft`, (route) =>
    route.fulfill({
      status: draftStatus,
      contentType: 'application/json',
      body: draftStatus === 200 ? JSON.stringify({ repo_id: repoId, draft: draftBody }) : JSON.stringify(draftBody)
    })
  );
  // The concepts fetch always carries a query string (the store pages it:
  // `?limit=200&offset=0`), and a Playwright glob must consume the WHOLE
  // URL — the pattern needs the `*` or the stub is dead and the real
  // okf-server answers instead (a 404 the frontend maps to an empty list:
  // a silently dead stub, exactly the degrade this suite forbids).
  await page.route(`**/api/okf/repos/${repoId}/concepts*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(conceptsBody)
    })
  );
  if (importBody !== null) {
    await page.route(`**/api/okf/repos/${repoId}/import`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(importBody)
      })
    );
  }
}

/**
 * Log in as the deployment admin and open the Studio at the stubbed repo's
 * card. The route stubs MUST be registered before this call.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} repoId the repo whose dashboard card to click
 */
async function openStudioRepo(page, repoId) {
  await loginViaUI(page, okfAdminUser());
  await page.goto(`${BASE_URL}/admin?tab=studio`, { waitUntil: 'networkidle', timeout: 30000 });

  const card = page.locator(`[data-test-id="okf-studio-repo-${repoId}"]`);
  await card.waitFor({ state: 'visible', timeout: 15000 });
  await card.click();
}

module.exports = { okfAdminUser, stubStudioRepoRoutes, openStudioRepo };
