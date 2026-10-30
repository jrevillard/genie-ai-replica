#!/usr/bin/env node
/**
 * Captures the dashboard welcome screen and the DOM facts a screenshot
 * cannot prove.
 *
 * A PNG read back yields a URL, never a claim about how it looks. So every
 * capture ships with an audit: whether each decoration asset actually
 * resolves, the computed styles of the surfaces the layer touches, and the
 * resolved custom properties. If the audit and the picture disagree, the
 * audit wins.
 *
 * The assets are checked with fetch rather than an Image probe: the three
 * SVGs carry only a viewBox, so they have no intrinsic size and
 * naturalWidth reports 0 for a perfectly valid file.
 *
 * Usage:
 *   NODE_PATH=<repo>/node_modules BASE_URL=https://localhost node tests/e2e/capture-dashboard.js [--theme light|dark]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loginViaUI } = require('./helpers/chatbot');
const BASE_URL = process.env.BASE_URL || 'https://localhost';

const OUT_DIR = path.join(__dirname, '..', '..', 'artifacts', 'living-intelligence');
// Four viewports: 1775×886 is the reference and 1920×960 is what the user
// sees in production, so the welcome banner's full-bleed is proven at both;
// 1280×720 is the laptop the deployment is also looked at on, 768×1024 is
// the narrow layout where the layer's two media queries take over and the
// card grid drops to fewer columns, and 414×896 is the phone: below 480px
// the welcome grid is one column and the heading changes weight, which is
// what decides whether the brand ramp inside it counts as large text.
const VIEWPORTS = [
  { label: '1775', width: 1775, height: 886 },
  { label: '1920', width: 1920, height: 960 },
  { label: '1280', width: 1280, height: 720 },
  { label: '768', width: 768, height: 1024 },
  { label: '414', width: 414, height: 896 }
];
const THEMES = process.argv.includes('--theme')
  ? [process.argv[process.argv.indexOf('--theme') + 1]]
  : ['light', 'dark'];
// The welcome overlay widens when a sidebar collapses, and the hero and
// waves used to slice their art at the wider panel width. The capture
// matrix now records that state at the desktop size, so a regression
// surfaces as a captured difference rather than an unread screenshot.
const SIDEBAR_STATES = [
  { label: 'open', collapsed: false },
  { label: 'collapsed-left', collapsed: 'left' },
  { label: 'collapsed-both', collapsed: 'both' }
];

// The width at which the sidebars become an in-flow reservation and
// grow their edge handles. Below it they are pinned and cannot be
// collapsed. Mirrors SIDEBAR_INFLOW_MIN_WIDTH in
// src/composables/sidebarLayout.js.
const IN_FLOW_MIN_WIDTH = 1400;

const audit = () => {
  const rootStyle = getComputedStyle(document.documentElement);

  const readUrl = (property) => {
    const raw = rootStyle.getPropertyValue(property).trim();
    if (!raw) return null;
    return raw.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
  };

  const probeAsset = async (property) => {
    const url = readUrl(property);
    if (!url) return { url: null, ok: false, reason: 'not set' };
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const buffer = await response.arrayBuffer();
      return {
        url,
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get('content-type'),
        bytes: buffer.byteLength
      };
    } catch (error) {
      return { url, ok: false, reason: error.message };
    }
  };

  const surface = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      backgroundImage: style.backgroundImage,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      backdropFilter: style.backdropFilter,
      overflow: style.overflow
    };
  };

  return (async () => {
    const assets = {
      hero: await probeAsset('--visual-hero'),
      waves: await probeAsset('--visual-waves'),
      mesh: await probeAsset('--visual-mesh'),
      corner: await probeAsset('--visual-corner')
    };

    const cards = [...document.querySelectorAll('.quick-help-item')].map((el) => {
      const style = getComputedStyle(el);
      return {
        text: el.textContent.trim().slice(0, 40),
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        qhBg: style.getPropertyValue('--qh-bg').trim(),
        qhHover: style.getPropertyValue('--qh-hover').trim(),
        qhOutline: style.getPropertyValue('--qh-outline').trim()
      };
    });

    const overlay = document.querySelector('.quick-help-overlay');
    const overlayBefore = overlay ? getComputedStyle(overlay, '::before') : null;
    const overlayAfter = overlay ? getComputedStyle(overlay, '::after') : null;
    const sidebar = document.querySelector('.sidebar:not(.collapsed)');
    const sidebarBefore = sidebar ? getComputedStyle(sidebar, '::before') : null;
    const heading = document.querySelector('.quick-help-heading');
    const subtitle = document.querySelector('.quick-help-subtitle');
    const brandName = document.querySelector('.brand-name');

    // The navbar's controls do not all read --navbar-fg: several are pinned
    // to --accent-fg, which is a different token. Recording the computed ink
    // of one of each is what proves the bar stays readable when the band
    // changes value, rather than only proving the band did.
    const inkOf = (el) => (el ? getComputedStyle(el).color : null);
    const navBar = document.querySelector('.nav-bar');
    const navBarInk = navBar
      ? {
          bar: inkOf(navBar),
          brandName: inkOf(brandName),
          iconButton: inkOf(navBar.querySelector('.icon-btn')),
          languageSelect: inkOf(navBar.querySelector('.language-select-container'))
        }
      : null;

    // The wordmark appears twice — the navbar name and the brand inside the
    // welcome heading — and only for the GENIE.AI brand. Every occurrence is
    // recorded, so a regression at either call site shows up as a shorter list
    // rather than a silently absent entry.
    const wordmarks = [...document.querySelectorAll('.brand-wordmark')].map((el) => {
      const style = getComputedStyle(el);
      return {
        text: el.textContent.trim(),
        tag: el.tagName,
        parent: el.parentElement ? el.parentElement.tagName.toLowerCase() + '.' + el.parentElement.className : null,
        backgroundImage: style.backgroundImage,
        backgroundClip: style.backgroundClip,
        textFillColor: style.getPropertyValue('-webkit-text-fill-color'),
        color: style.color,
        fontSize: style.fontSize,
        // Weight is recorded with the size because the two together decide
        // whether the mark is WCAG large text: 24px at any weight, or
        // 18.66px at weight 700+. Below 480px the heading drops to 20px,
        // so this is the field that says whether the ramp still gets the
        // 3:1 allowance or has to clear 4.5:1.
        fontWeight: style.fontWeight,
        fontFamily: style.fontFamily
      };
    });

    return {
      dataVisual: document.documentElement.getAttribute('data-visual'),
      theme: document.documentElement.getAttribute('data-theme'),
      assets,
      resolved: {
        visualHero: readUrl('--visual-hero'),
        navbarBg: rootStyle.getPropertyValue('--navbar-bg').trim(),
        navbarFg: rootStyle.getPropertyValue('--navbar-fg').trim(),
        brandMarkFrom: rootStyle.getPropertyValue('--brand-mark-from').trim(),
        brandMarkMid: rootStyle.getPropertyValue('--brand-mark-mid').trim(),
        brandMarkTo: rootStyle.getPropertyValue('--brand-mark-to').trim(),
        brand: rootStyle.getPropertyValue('--brand').trim(),
        accent: rootStyle.getPropertyValue('--accent').trim()
      },
      overlay: surface('.quick-help-overlay'),
      overlayBefore: overlayBefore
        ? {
            width: overlayBefore.width,
            height: overlayBefore.height,
            backgroundImage: overlayBefore.backgroundImage,
            // Both spellings are recorded: Safari only honours the -webkit-
            // one, so a mask present in one and missing in the other is a
            // real, Firefox-only regression.
            maskImage: overlayBefore.maskImage,
            webkitMaskImage: overlayBefore.webkitMaskImage
          }
        : null,
      overlayAfter: overlayAfter
        ? {
            width: overlayAfter.width,
            height: overlayAfter.height,
            backgroundImage: overlayAfter.backgroundImage,
            opacity: overlayAfter.opacity,
            mixBlendMode: overlayAfter.mixBlendMode
          }
        : null,
      sidebarBefore: sidebarBefore
        ? {
            width: sidebarBefore.width,
            height: sidebarBefore.height,
            backgroundImage: sidebarBefore.backgroundImage,
            opacity: sidebarBefore.opacity
          }
        : null,
      navBar: surface('.nav-bar'),
      navBarInk,
      brandName: brandName
        ? {
            text: brandName.textContent.trim(),
            fontSize: getComputedStyle(brandName).fontSize,
            fontWeight: getComputedStyle(brandName).fontWeight
          }
        : null,
      wordmarks,
      wordmarkCount: wordmarks.length,
      // A locale that regressed to element tags would leak "<brandwordmark>"
      // into the heading's text, and a broken placeholder would leak
      // "{brandwordmark}". Both reach assistive technology as text, so the
      // audit records the leak explicitly rather than leaving it to the eye.
      heading: heading
        ? {
            tag: heading.tagName,
            text: heading.textContent.trim(),
            brandSlotCount: heading.querySelectorAll('.brand-wordmark').length,
            leakedMarkup: /[<>{}]/.test(heading.textContent)
          }
        : null,
      subtitle: subtitle ? { text: subtitle.textContent.trim(), fontSize: getComputedStyle(subtitle).fontSize } : null,
      cards,
      cardCount: cards.length
    };
  })();
};

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const results = {};

  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      for (const sidebar of SIDEBAR_STATES) {
        // Below the in-flow threshold the sidebars are pinned: there is
        // no edge handle and nothing to collapse, so the collapsed state
        // does not exist at this width. Capturing it would write a
        // misnamed copy of the open state. The threshold mirrors
        // SIDEBAR_INFLOW_MIN_WIDTH in src/composables/sidebarLayout.js.
        if (sidebar.collapsed && viewport.width < IN_FLOW_MIN_WIDTH) {
          console.log(
            `${theme}-${viewport.label}-${sidebar.label}: skipped ` +
              `(the sidebars are pinned below ${IN_FLOW_MIN_WIDTH}px)`
          );
          continue;
        }
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: theme,
          ignoreHTTPSErrors: true
        });
        const page = await context.newPage();

        await loginViaUI(page);
        await page.waitForSelector('.quick-help-overlay', { timeout: 30000 });
        // Wait for the splash overlay to fade out (5s display + 1s fade)
        await page.waitForSelector('.splash-screen', { state: 'detached', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500);

        // The collapsed-sidebars state widens the centre overlay; the
        // panel's response to a wider stage is what the layer's band
        // sizing has to survive. Capture the open state as the default
        // and the collapsed states only at the desktop sizes — narrow
        // widths already pin the sidebar.
        let openOverlayWidth = null;
        let collapsedOverlayWidth = null;
        if (sidebar.collapsed) {
          // Snapshot the open width before any clicks so we can compare
          // against it afterwards; a "collapsed" capture that did not
          // collapse the sidebar would otherwise be misnamed and write
          // the open state's geometry as evidence.
          openOverlayWidth = await page.evaluate(
            () => document.querySelector('.quick-help-overlay').getBoundingClientRect().width
          );

          // The collapse controls: each panel carries an edge handle
          // whose button toggles it — `.side-bar .sidebar-handle__button`
          // on the left, `.sidebar .sidebar-handle__button` on the
          // right. The navbar's hamburger is gone, and the handle's
          // aria-label is just "Collapse" / "Réduire" in the user's
          // locale — no "sidebar" word — so any aria-label pattern
          // that demands the word never matches. Use the class names,
          // the same ones the sidebar spec uses.
          const left = await page.$('.side-bar .sidebar-handle__button');
          const right = await page.$('.sidebar .sidebar-handle__button');
          const wantBoth = sidebar.collapsed === 'both';
          if (wantBoth && (!left || !right)) {
            throw new Error(
              `Capture wants ${sidebar.label} but the toggles are absent ` +
                `(left handle=${!!left}, right handle=${!!right}). ` +
                `Either the desktop layout has pinned the sidebar or the ` +
                `selectors are stale; refusing to write a misnamed capture.`
            );
          }
          if (!wantBoth && !left) {
            throw new Error(
              `Capture wants ${sidebar.label} but the left handle's button is absent; ` +
                `refusing to write a misnamed capture.`
            );
          }
          await left.click();
          await page.waitForTimeout(400);
          if (wantBoth) {
            await right.click();
            await page.waitForTimeout(400);
          }

          // Verify the panel actually widened. The art's box tracks the
          // overlay's width (the user explicitly rejected a centred box
          // with gutters), so a state labelled "collapsed" that did not
          // collapse the sidebar would still read the open width.
          collapsedOverlayWidth = await page.evaluate(
            () => document.querySelector('.quick-help-overlay').getBoundingClientRect().width
          );
          if (collapsedOverlayWidth <= openOverlayWidth + 1) {
            const leftState = await page.evaluate(
              () => document.querySelector('.sidebar:not(.collapsed)')?.classList.contains('sidebar') ?? null
            );
            throw new Error(
              `Capture ${theme}-${viewport.label}-${sidebar.label}: ` +
                `overlay did not widen (open=${openOverlayWidth}px, ` +
                `collapsed=${collapsedOverlayWidth}px). A "collapsed" ` +
                `capture whose geometry is the open state is evidence of ` +
                `nothing — aborting the run.`
            );
          }
        }

        const data = await page.evaluate(audit);
        data.viewport = { width: viewport.width, height: viewport.height };
        data.sidebar = sidebar.label;
        const file = path.join(OUT_DIR, `${theme}-${viewport.label}-${sidebar.label}.png`);
        await page.screenshot({ path: file, fullPage: false });
        fs.writeFileSync(
          path.join(OUT_DIR, `${theme}-${viewport.label}-${sidebar.label}.audit.json`),
          JSON.stringify(data, null, 2)
        );

        results[`${theme}-${viewport.label}-${sidebar.label}`] = {
          file,
          audit: path.join(OUT_DIR, `${theme}-${viewport.label}-${sidebar.label}.audit.json`)
        };
        console.log(`${theme}-${viewport.label}-${sidebar.label}: ${file}`);
        await context.close();
      }
    }
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})();
