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
// Two viewports: 1775×886 is the reference, 1920×960 is what the user sees
// in production (the welcome banner's full-bleed needs to hold at both).
const VIEWPORTS = [
  { label: '1775', width: 1775, height: 886 },
  { label: '1920', width: 1920, height: 960 }
];
const THEMES = process.argv.includes('--theme')
  ? [process.argv[process.argv.indexOf('--theme') + 1]]
  : ['light', 'dark'];

const audit = () => {
  const readUrl = (property) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
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

    return {
      dataVisual: document.documentElement.getAttribute('data-visual'),
      theme: document.documentElement.getAttribute('data-theme'),
      assets,
      resolved: {
        visualHero: readUrl('--visual-hero'),
        brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      },
      overlay: surface('.quick-help-overlay'),
      overlayBefore: overlayBefore
        ? {
            width: overlayBefore.width,
            height: overlayBefore.height,
            backgroundImage: overlayBefore.backgroundImage
          }
        : null,
      navBar: surface('.nav-bar'),
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

      const data = await page.evaluate(audit);
      data.viewport = { width: viewport.width, height: viewport.height };
      const file = path.join(OUT_DIR, `${theme}-${viewport.label}.png`);
      await page.screenshot({ path: file, fullPage: false });
      fs.writeFileSync(path.join(OUT_DIR, `${theme}-${viewport.label}.audit.json`), JSON.stringify(data, null, 2));

      results[`${theme}-${viewport.label}`] = { file, audit: path.join(OUT_DIR, `${theme}-${viewport.label}.audit.json`) };
      console.log(`${theme}-${viewport.label}: ${file}`);
      await context.close();
    }
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})();
