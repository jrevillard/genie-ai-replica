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

    await page.goto(new URL('/admin', BASE_URL).toString(), {
      waitUntil: 'domcontentloaded'
    });
    await page.waitForSelector('[data-test-id="admin-dashboard"]', { timeout: 30000 });
    // The route's loading spinner (DsSpinner fixed) covers the dashboard
    // until the initial loads settle. A capture under it photographs the
    // loading state, not the tab panel; gone is the condition.
    await page.waitForSelector('.ds-spinner-wrapper--fixed', { state: 'detached', timeout: 30000 });

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
    await page.goto(new URL('/admin', BASE_URL).toString(), {
      waitUntil: 'domcontentloaded'
    });
    await page.waitForSelector('[data-test-id="admin-dashboard"]', { timeout: 30000 });
    await page.waitForSelector('.ds-spinner-wrapper--fixed', { state: 'detached', timeout: 30000 });

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
