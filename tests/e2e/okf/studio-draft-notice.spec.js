// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// E2E: the OKF Studio's SESSION-WIDE degraded-draft banner (#1531).
//
// WHY THIS SPEC EXISTS: the banner (`studio-draft-notice`) renders only from
// the Vuex `okf/draftsUnavailable` latch, which arms when the draft endpoint
// answers 404/501 WITHOUT the backend's REPO_NOT_FOUND code — i.e. the server
// does not serve drafts at all. The Jest suite covers the latch's store
// logic; no browser-level spec proved the RENDERED banner — its presence,
// its exact degraded copy, or that a repo-gone 404 (the REPO_NOT_FOUND body)
// does NOT trip it.
//
// The claims this spec proves, in a real browser:
//
//   1. a 404 without the REPO_NOT_FOUND code (the endpoint missing) arms the
//      latch and renders the banner with its exact copy;
//   2. a 404 WITH the REPO_NOT_FOUND code (the repo is gone — a definitive
//      answer, never a latch) does NOT render the banner.
//
// The payloads are INJECTED (page.route), the same measure-don't-look rule
// as the sibling ceiling spec: the latch state on screen can only have come
// from the intercepted draft answer, and the interception is what makes the
// endpoint-missing state reachable on a venue whose okf-server serves drafts
// just fine.
//
// Run against an OKF-enabled venue (see helpers/venue-profile.js): on a venue
// whose runtime config parks the pillar the spec skips ITSELF, with the
// venue's own profile as the reason (#1742).

const { test, expect } = require('@playwright/test');
const { loginViaUI, BASE_URL } = require('../helpers/chatbot');
const { okfEnabled, okfParkedReason, skipUnlessVenue } = require('../helpers/venue-profile');

/**
 * WHO LOGS IN — the deployment's own admin, the account the Studio actually
 * works with (the e2e fixture user carries no okf scope, so the Studio
 * renders empty lanes for it). Same account as the sibling ceiling spec.
 */
const ADMIN_USER = {
  username: process.env.GENIE_ADMIN_USERNAME || 'genie-admin',
  password: process.env.GENIE_ADMIN_PASSWORD || ''
};

const REPO_ID = 'e2e-draft-notice-repo';

/** The stubbed repository the dashboard lists — a draft-lane repo the
 *  curator can resume. */
const REPO = {
  repo_id: REPO_ID,
  name: 'E2E Draft Notice Repo',
  lifecycle_state: 'draft',
  concept_count: 0,
  version: 1
};

/** The banner's exact copy — the en locale's `okf.studio.draft.notReady`. The
 *  assertion is the TEXT, not the visibility: a banner that renders any other
 *  sentence is a different contract (the copy is what the curator reads). */
const NOT_READY_COPY =
  'Drafts cannot currently be stored on the server — they stay in this browser tab only and are lost if the tab is closed or reloaded. The page or the server may be out of sync.';

/**
 * Register the routes the Studio path fires, with the draft answer the test
 * is named after. The wrapper is the shared one — a route handler must not
 * hand-roll its own catch (tests/e2e/CLAUDE.md).
 */
async function openStudioWithDraftAnswer(page, draftStatus, draftBody) {
  // The dashboard's repository list — one repo, so the resume card exists.
  await page.route(
    `**/api/okf/repos?*`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [REPO], next_cursor: null })
      }),
    { times: 10 }
  );
  // The draft read — THE interception. Registered before the click: onResume
  // fires it while opening the repo, and that answer is what arms (or not)
  // the session latch.
  await page.route(
    `**/api/okf/repos/${REPO_ID}/draft`,
    (route) =>
      route.fulfill({
        status: draftStatus,
        contentType: 'application/json',
        body: JSON.stringify(draftBody)
      }),
    { times: 10 }
  );
  // The editor shell's concept list (fired on resume, after the draft read).
  await page.route(
    `**/api/okf/repos/${REPO_ID}/concepts`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      }),
    { times: 10 }
  );

  await loginViaUI(page, ADMIN_USER);
  await page.goto(`${BASE_URL}/admin?tab=studio`, { waitUntil: 'networkidle', timeout: 30000 });

  const card = page.locator(`[data-test-id="okf-studio-repo-${REPO_ID}"]`);
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click();
}

test.describe('OKF Studio degraded-draft banner', () => {
  test.beforeEach(
    skipUnlessVenue(
      test,
      () => okfEnabled(),
      () => okfParkedReason()
    )
  );

  test('renders the degraded-draft banner when the draft endpoint is not served', async ({ page }) => {
    // A 404 WITHOUT the backend's REPO_NOT_FOUND code: this server build
    // does not serve drafts. Any other code would be the repo-gone answer,
    // which is a definitive answer and must NOT arm the latch.
    await openStudioWithDraftAnswer(page, 404, { error: 'ROUTE_NOT_SERVED', message: 'no such endpoint' });

    // The banner, with its exact copy. The live-region wrapper exists
    // before the banner (so the announcement is not lost to the v-if
    // insert); the banner itself is the asserted element.
    await expect(page.locator('[data-test-id="studio-draft-notice"]')).toHaveText(NOT_READY_COPY, {
      timeout: 15000
    });
  });

  test('does not render the banner when the 404 names the repo gone', async ({ page }) => {
    // The REPO_NOT_FOUND code: the repo is gone (deleted / out of scope) —
    // a DEFINITIVE answer about this repo, never a statement about the
    // endpoint. The latch stays off; the session-wide banner stays silent.
    await openStudioWithDraftAnswer(page, 404, { error: 'REPO_NOT_FOUND', message: 'repo is gone' });

    await page.waitForLoadState('networkidle');

    // The banner is ABSENT — the half of the contract a permissive spec
    // loses: a notice that always appears is noise the curator learns to
    // ignore. Strictly zero, not "not visible right now".
    await expect(page.locator('[data-test-id="studio-draft-notice"]')).toHaveCount(0);
  });
});
