#!/usr/bin/env node
/**
 * Captures the Admin Dashboard through its Phase V look — every tab panel
 * and every click-open dialog, in both themes — with the DOM facts a
 * screenshot cannot prove (#1799).
 *
 * Sibling of capture-dashboard.js and governed by the same determinism
 * rules (tests/e2e/CLAUDE.md): wait on conditions, no fallback branches,
 * assert exactly. Every capture ships with an .audit.json; where the audit
 * and the picture disagree, the audit wins.
 *
 * What the audit pins per state:
 *   - html[data-visual] === 'on' and .admin-page carries the layer's gate
 *     class — the whole look is gated on both, so a capture that ran
 *     without them photographs a page this harness does not describe
 *   - the page title and the uptime tile carry a gradient background-image
 *     (computed, resolved — the layer's paint, not the source's promise)
 *   - each open dialog's container carries the gate class (the V4
 *     teleported-dialog contract)
 *   - the clicked tab is the ACTIVE tab (the DS primitive's own class) —
 *     a panel capture mislabelled by a click that did not take is evidence
 *     of nothing
 *   - the layer-off capture pins dataVisual === 'off' with the static gate
 *     class still present on .admin-page and NO gradient painting — the
 *     additive-layer contract's other half: the flag turns the paint off,
 *     never the markup
 *
 * The OperationResults dialog needs a finished operation — venue state this
 * script does not fabricate (it must not trigger a backup to make one). It
 * is deliberately absent; a "skip" here is a named gap, not a swallowed one.
 * FileDetails IS captured: the documents panel's first row opens it. The
 * layer-off variant rides the config transport (theme.visual disabled via
 * request interception — the same lever an operator's config edit pulls),
 * re-bootstrapping the app on the /admin reload.
 *
 * Usage:
 *   NODE_PATH=<repo>/node_modules BASE_URL=https://localhost node tests/e2e/capture-admin.js [--theme light|dark]
 *
 * BASE_URL names the venue, as it does for the whole suite: the address
 * itself comes from the ONE definition (helpers/base-url.js).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loginViaUI, TEST_ADMIN_USER } = require('./helpers/chatbot');
const { venueLaunchArgs } = require('./helpers/venue-launch-args');
// The venue's edge: ONE definition, the credential-free module — this
// script reads the edge and no credential, and a second copy of the
// address here would be a second definition of the venue.
const { BASE_URL } = require('./helpers/base-url');

const OUT_DIR = path.join(__dirname, '..', '..', 'artifacts', 'admin-look');
const VIEWPORT = { width: 1775, height: 886 }; // the reference viewport
const THEMES = process.argv.includes('--theme')
  ? [process.argv[process.argv.indexOf('--theme') + 1]]
  : ['light', 'dark'];

// The rack order is the tabs array's order (DsTabs keys by index — the tab
// objects carry `id`, not `value`). ds-tab-N is the DS primitive's own
// handle; ds-tabs__btn--active is its own active state.
const TABS = [
  'overview',
  'hierarchy',
  'documents',
  'studio',
  'database',
  'logs',
  'queryInspector',
  'security',
  'users',
  'models'
];

// The dashboard's readiness contract, stated ONCE: the route's loading
// spinner covers the dashboard until the initial loads settle. Every
// /admin (re)entry waits here — three copies of this sequence drifted
// once already.
async function gotoAdminReady(page) {
  await page.goto(new URL('/admin', BASE_URL).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-test-id="admin-dashboard"]', { timeout: 30000 });
  await page.waitForSelector('.ds-spinner-wrapper--fixed', { state: 'detached', timeout: 30000 });
}

const audit = (label) => {
  const root = document.documentElement;
  const page = document.querySelector('.admin-page');
  const title = document.querySelector('.page-title');
  const uptimeTile = document.querySelector('[data-test-id="stat-system-uptime"]');
  const titleStyle = title ? getComputedStyle(title) : null;
  const tileStyle = uptimeTile ? getComputedStyle(uptimeTile) : null;

  return {
    label,
    dataVisual: root.getAttribute('data-visual'),
    theme: root.getAttribute('data-theme') || root.getAttribute('data-bs-theme'),
    adminPageHasGate: !!page && page.classList.contains('genie-living-intelligence'),
    pageTitleGradient: !!titleStyle && /gradient/i.test(titleStyle.backgroundImage),
    uptimeTileGradient: !!tileStyle && /gradient/i.test(tileStyle.backgroundImage),
    uptimeTileClasses: uptimeTile ? uptimeTile.className : null
  };
};

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ args: venueLaunchArgs() });
  const results = {};

  for (const theme of THEMES) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      colorScheme: theme,
      ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    // The admin role fixture: the panels' data calls are admin-gated on the
    // backend, so the captures must be the panels WITH their data (or their
    // honest empty/error states), not a 403's flattened chrome.
    await loginViaUI(page, TEST_ADMIN_USER);
    await page.waitForSelector('[data-testid="quick-help-overlay"]', { timeout: 30000 });
    await page.waitForSelector('[data-test-id="splash-screen"]', { state: 'detached', timeout: 15000 });

    await gotoAdminReady(page);

    const pre = await page.evaluate(audit, 'pre');
    if (pre.dataVisual !== 'on') {
      throw new Error(
        `capture-admin: html[data-visual] is '${pre.dataVisual}', not 'on'. ` +
          `The Phase V look is gated on the layer being enabled; a capture ` +
          `without it photographs the undecorated route and proves nothing ` +
          `about the layer. Enable theme.visual for this venue.`
      );
    }
    if (!pre.adminPageHasGate) {
      throw new Error('capture-admin: .admin-page has lost the living-intelligence gate class.');
    }

    // -- the ten tab panels ------------------------------------------------
    // adminTabs maps value: t.id, so the DS primitive's handles are
    // ds-tab-<id>. The okfEnabled filter drops studio/models on a parked
    // deployment — clicking those two is gated on the venue's flag being
    // on, asserted from the rack itself, never assumed.
    for (const tab of TABS) {
      const tabSel = `[data-test-id="ds-tab-${tab}"]`;
      if (!(await page.locator(tabSel).count())) {
        throw new Error(
          `capture-admin ${theme}: no rack handle for tab '${tab}'. ` +
            `If this venue runs with OKF disabled, studio/models are ` +
            `filtered from the rack — gate those two captures on the flag, ` +
            `do not absorb the absence.`
        );
      }
      await page.click(tabSel);
      const activeSel = `[data-test-id="ds-tab-${tab}"].ds-tabs__btn--active`;
      await page.waitForSelector(activeSel, { timeout: 10000 });

      const data = await page.evaluate(audit, `${tab}`);
      data.activeTab = tab;
      if (!data.pageTitleGradient) {
        throw new Error(
          `capture-admin ${theme} ${tab}: .page-title has no gradient ` +
            `background-image — the brand ramp is not painting.`
        );
      }
      if (tab === 'overview' && !data.uptimeTileGradient) {
        throw new Error(
          `capture-admin ${theme} overview: the uptime tile has no ` +
            `gradient background-image — the V2 hue wash is not painting.`
        );
      }

      const name = `${theme}-tab-${tab}`;
      const file = path.join(OUT_DIR, `${name}.png`);
      // animations:'disabled' fast-forwards CSS transitions before the
      // frame is taken: the first live run captured the tab underline
      // MID-TRANSITION (visually still on the previous tab while the DOM
      // already carried the new one — the probe proved the app state was
      // correct, so the stale frame was the capture's, not the app's).
      await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
      fs.writeFileSync(path.join(OUT_DIR, `${name}.audit.json`), JSON.stringify(data, null, 2));
      results[name] = file;
      console.log(`${name}: ${file}`);
    }

    // -- the three click-open dialogs --------------------------------------
    const dialogs = [
      {
        tab: 'documents',
        openSel: '[data-test-id="documents-add-from-link"]',
        dialogSel: '[data-test-id="add-from-link-dialog"]',
        closeSel: '[data-test-id="add-from-link-dialog-close"]',
        name: 'add-from-link'
      },
      {
        tab: 'documents',
        openSel: '[data-test-id="documents-upload-files"]',
        dialogSel: '[data-test-id="upload-files-dialog"]',
        closeSel: '[data-test-id="upload-files-dialog-close"]',
        name: 'upload-files'
      },
      {
        // The data-dependent one: the first document row opens the
        // FileDetails dialog (row click = viewDocumentDetails). needsRows
        // names the venue state it depends on, checked loudly before the
        // click — a venue with no ingested files fails here with that
        // reason, not with a click timeout.
        tab: 'documents',
        needsRows: '[data-test-id="document-row"]',
        openSel: '[data-test-id="document-row"]', // page.click takes the first row
        dialogSel: '[data-test-id="file-details-dialog"]',
        closeSel: '[data-test-id="file-details-dialog-close"]',
        name: 'file-details'
      },
      {
        tab: 'logs',
        openSel: '[data-test-id="logs-search"]',
        dialogSel: '[data-test-id="log-search-dialog"]',
        closeSel: '[data-test-id="log-search-dialog-close"]',
        name: 'log-search'
      }
    ];

    for (const d of dialogs) {
      await page.click(`[data-test-id="ds-tab-${d.tab}"]`);
      await page.waitForSelector(`[data-test-id="ds-tab-${d.tab}"].ds-tabs__btn--active`, {
        timeout: 10000
      });
      if (d.needsRows) {
        const rows = await page.locator(d.needsRows).count();
        if (!rows) {
          throw new Error(
            `capture-admin ${theme} ${d.name}: no ${d.needsRows} in the ` +
              `documents panel — the venue has no ingested files. Seed one; ` +
              `this capture is a named venue dependency, not a skip.`
          );
        }
      }
      await page.click(d.openSel);
      await page.waitForSelector(d.dialogSel, { timeout: 10000 });

      const data = await page.evaluate(audit, d.name);
      // The V4 gate contract has two legitimate shapes: TELEPORTED dialogs
      // (add-from-link) carry the class on their own container — they render
      // at body level, outside every ancestor gate — while IN-PLACE dialogs
      // (upload-files, log-search) are reached through .admin-page's gate
      // and carry none of their own. Assert the layer REACHES the container
      // by either mechanism and record which one.
      data.dialogGate = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return 'missing';
        if (el.classList.contains('genie-living-intelligence')) return 'own';
        if (el.closest('.genie-living-intelligence')) return 'ancestor';
        return 'none';
      }, d.dialogSel);
      if (data.dialogGate === 'none') {
        throw new Error(
          `capture-admin ${theme} ${d.name}: the dialog container is not ` +
            `reached by the living-intelligence gate by either mechanism ` +
            `(no own class, no gated ancestor) — the V4 contract.`
        );
      }

      const name = `${theme}-dialog-${d.name}`;
      const file = path.join(OUT_DIR, `${name}.png`);
      await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
      fs.writeFileSync(path.join(OUT_DIR, `${name}.audit.json`), JSON.stringify(data, null, 2));
      results[name] = file;
      console.log(`${name}: ${file}`);

      // Deterministic close: the dialog's own close affordance (a declared
      // handle), not a viewport coordinate — a coordinate click lands on
      // whatever hit-tests there, which is nobody's contract.
      await page.click(d.closeSel);
      await page.waitForSelector(d.dialogSel, { state: 'detached', timeout: 10000 });
    }

    // -- the phase X interiors ---------------------------------------------
    // The interiors live on the STUDIO tab; the dialog loop left the logs
    // tab active, and the studio surfaces mount only when the tab is
    // active (v-if) — navigate first, wait the tab's own active state.
    await page.click('[data-test-id="ds-tab-studio"]');
    await page.waitForSelector('[data-test-id="ds-tab-studio"].ds-tabs__btn--active', {
      timeout: 10000
    });

    // The wizard: the studio view toggle's declared handles land on the
    // step shell — every step renders inside .okf-wizard__step, so one
    // capture covers the ten-step shell.
    await page.click('[data-test-id="studio-view-wizard"]');
    await page.waitForSelector('.okf-wizard__step', { timeout: 15000 });
    const wizardData = await page.evaluate(audit, 'wizard');
    if (!wizardData.pageTitleGradient) {
      throw new Error(
        `capture-admin ${theme} wizard: .page-title has no gradient ` +
          `background-image — the brand ramp is not painting.`
      );
    }
    const wizardName = `${theme}-interior-wizard`;
    const wizardFile = path.join(OUT_DIR, `${wizardName}.png`);
    await page.screenshot({ path: wizardFile, fullPage: false, animations: 'disabled' });
    fs.writeFileSync(path.join(OUT_DIR, `${wizardName}.audit.json`), JSON.stringify(wizardData, null, 2));
    results[wizardName] = wizardFile;
    console.log(`${wizardName}: ${wizardFile}`);

    // The editor + lab: need an OPENED repository — venue state, checked
    // loudly like the document rows. The dashboard repo cards carry
    // okf-studio-repo-<id> handles; the first opens the editor shell (an
    // async chunk — the wait is the shell's own class). The lab opens from
    // the editor's declared CTA; the DsModal close handle (the primitive's
    // own, added this phase) closes it, and the pane tree unmounts with the
    // dialog.
    // The editor + lab need an OPENED repository — FIXED, ISOLATED SEED
    // DATA: the harness seeds its own DRAFT repo (unique name per run) via
    // the same API the studio's create dialog uses, captures, and deletes
    // it in a finally (a failing capture still removes the seed; a failed
    // delete fails the run naming the leftover). The bearer rides the
    // page's own session (the oidc user in sessionStorage — the same store
    // the raw-fetch open paths read).
    const bearer = await page.evaluate(() => {
      const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'));
      return key ? JSON.parse(sessionStorage.getItem(key)).access_token : null;
    });
    if (!bearer) throw new Error('capture-admin: no oidc token in sessionStorage — the login did not persist a user.');
    const seedName = `capture-seed-${Date.now()}`;
    let repoId = null;
    try {
      repoId = await page.evaluate(
        async ({ bearer, body }) => {
          const res = await fetch('/api/okf/repos', {
            method: 'POST',
            headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (!res.ok) throw new Error(`seed create failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
          const j = await res.json();
          const id = j && (j.repo_id || (j.repo && j.repo.repo_id));
          if (!id) throw new Error(`seed create returned no repo_id (2xx body: ${JSON.stringify(j).slice(0, 200)})`);
          return id;
        },
        {
          bearer,
          body: {
            name: seedName,
            domain: 'general',
            acl: { required_scopes: ['okf:t:general:admin'] },
            lifecycle_state: 'draft'
          }
        }
      );
    } catch (err) {
      // The venue-skip pattern: a 403 FORBIDDEN_SCOPE is the venue's own
      // answer — the test fixture holds no okf scopes, and repo creation is
      // a management route (default-deny). The editor/lab captures SKIP
      // with that reason; every OTHER seed failure is a real failure and
      // still throws.
      if (!/FORBIDDEN_SCOPE/.test(err.message)) throw err;
      console.log(
        `${theme} interior-editor/lab: SKIPPED — the venue refuses repo ` +
          `creation to the test fixture (no okf scopes; management routes ` +
          `are default-deny). Grant the fixture okf scopes to enable ` +
          `these captures.`
      );
    }
    // The named skip above already recorded its reason; the editor/lab
    // block below runs only on a successful seed — the layer-off capture
    // after it always runs.
    const seededCard = `[data-test-id="okf-studio-repo-${repoId}"]`;

    if (repoId) {
      try {
        // The dashboard mounted BEFORE the seed existed — reload the route so
        // the lane list includes it, then navigate back in.
        await gotoAdminReady(page);
        await page.click('[data-test-id="ds-tab-studio"]');
        await page.waitForSelector('[data-test-id="ds-tab-studio"].ds-tabs__btn--active', { timeout: 10000 });
        await page.waitForSelector(seededCard, { timeout: 20000 });
        await page.click(seededCard);
        // onResume lands the repo on the WIZARD sub-tab (the intended
        // landing); the editor frame is the shell's other sub-tab — the
        // DsTabs primitive's own handles switch to it.
        await page.click('[data-test-id="ds-tab-editor"]');
        await page.waitForSelector('.okf-shell', { timeout: 20000 });
        // The X1 chrome asserted, not just photographed: the editor frame's
        // top-lit wash is a background-image gradient — the same computed
        // proof the page-title rule uses.
        const shellChrome = await page.evaluate(() => {
          const el = document.querySelector('.okf-shell');
          return el ? /gradient/i.test(getComputedStyle(el).backgroundImage) : false;
        });
        if (!shellChrome) {
          throw new Error(
            `capture-admin ${theme} editor: .okf-shell carries no gradient ` +
              `background-image — the X1 chrome is not painting.`
          );
        }
        const editorData = await page.evaluate(audit, 'editor');
        const editorName = `${theme}-interior-editor`;
        const editorFile = path.join(OUT_DIR, `${editorName}.png`);
        await page.screenshot({ path: editorFile, fullPage: false, animations: 'disabled' });
        fs.writeFileSync(path.join(OUT_DIR, `${editorName}.audit.json`), JSON.stringify(editorData, null, 2));
        results[editorName] = editorFile;
        console.log(`${editorName}: ${editorFile}`);

        await page.click('[data-test-id="repo-editor-lab-open"]');
        await page.waitForSelector('.okf-headtest__tabs', { timeout: 20000 });
        // The lab's pane chrome paints through the INSTANCE GATE (the
        // teleported backdrop carries the class) — asserted, or a silent
        // unpainted lab would photograph as green.
        const labChrome = await page.evaluate(() => {
          const el = document.querySelector('.okf-headtest__pane');
          return el ? /gradient/i.test(getComputedStyle(el).backgroundImage) : false;
        });
        if (!labChrome) {
          throw new Error(
            `capture-admin ${theme} lab: .okf-headtest__pane carries no ` +
              `gradient background-image — the instance gate is not ` +
              `reaching the teleported dialog.`
          );
        }
        const labData = await page.evaluate(audit, 'lab');
        const labName = `${theme}-interior-lab`;
        const labFile = path.join(OUT_DIR, `${labName}.png`);
        await page.screenshot({ path: labFile, fullPage: false, animations: 'disabled' });
        fs.writeFileSync(path.join(OUT_DIR, `${labName}.audit.json`), JSON.stringify(labData, null, 2));
        results[labName] = labFile;
        console.log(`${labName}: ${labFile}`);

        await page.click('[data-test-id="ds-modal-close"]');
        await page.waitForSelector('.okf-headtest__tabs', { state: 'detached', timeout: 10000 });
      } finally {
        await page.evaluate(
          async ({ bearer: b, id }) => {
            const res = await fetch(`/api/okf/repos/${encodeURIComponent(id)}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${b}` }
            });
            if (!res.ok && res.status !== 404) {
              throw new Error(
                `seed cleanup FAILED: HTTP ${res.status} for ${id} — the leftover repo must be removed by hand`
              );
            }
          },
          { bearer, id: repoId }
        );
      }
    }

    // -- the layer-off variant ---------------------------------------------
    // The additive-layer contract's other half: with theme.visual disabled,
    // the route paints NO decorations while its markup (the static gate
    // classes) stays intact. The lever is the config transport — a request
    // interception serves the runtime config with theme.visual flipped off,
    // the same document an operator's config edit would produce — and the
    // /admin reload re-runs the config loader, so the app bootstraps
    // honestly off, not disguised. The original is read once, in-page, the
    // same way the loader reads it; the handler replays the rewritten copy
    // (the interception's pass-through API differs across Playwright builds
    // — this form does not depend on it).
    const originalConfig = await page.evaluate(async () => {
      const response = await fetch('/config/genie-ai-config.json');
      if (!response.ok) throw new Error(`config fetch failed: HTTP ${response.status}`);
      return response.json();
    });
    const offConfig = JSON.parse(JSON.stringify(originalConfig));
    offConfig.theme = offConfig.theme || {};
    offConfig.theme.visual = { ...(offConfig.theme.visual || {}), enabled: false };
    await page.route('**/config/genie-ai-config.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(offConfig) })
    );
    await gotoAdminReady(page);

    const off = await page.evaluate(audit, 'layer-off-overview');
    if (off.dataVisual !== 'off') {
      throw new Error(
        `capture-admin ${theme} layer-off: html[data-visual] is ` +
          `'${off.dataVisual}', not 'off' — the /admin reload did not ` +
          `re-bootstrap the config, or the interception missed the fetch.`
      );
    }
    if (!off.adminPageHasGate) {
      throw new Error(
        `capture-admin ${theme} layer-off: .admin-page lost its gate ` +
          `class — the gate markup is static and must survive the flag ` +
          `(the paint is what turns off, never the markup).`
      );
    }
    if (off.pageTitleGradient || off.uptimeTileGradient) {
      throw new Error(
        `capture-admin ${theme} layer-off: a decoration still paints with ` +
          `the layer disabled (title gradient: ${off.pageTitleGradient}, ` +
          `uptime wash: ${off.uptimeTileGradient}) — the ` +
          `html[data-visual='on'] CSS gate is not containing the layer.`
      );
    }
    const offName = `${theme}-layer-off-overview`;
    const offFile = path.join(OUT_DIR, `${offName}.png`);
    await page.screenshot({ path: offFile, fullPage: false, animations: 'disabled' });
    fs.writeFileSync(path.join(OUT_DIR, `${offName}.audit.json`), JSON.stringify(off, null, 2));
    results[offName] = offFile;
    console.log(`${offName}: ${offFile}`);

    await context.close();
  }

  await browser.close();
  console.log(JSON.stringify({ captured: Object.keys(results).length, results }, null, 2));
})();
