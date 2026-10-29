// tests/e2e/helpers/welcome.js
//
// The welcome screen's recipes, written once.
//
// Four specs open a signed-in session on the welcome screen, three of
// them capture pixels and read them back, and two of them compute WCAG
// contrast ratios. Each of those was written out again in every file,
// and the copies had already drifted: two settle constants (2500 ms
// and 3000 ms), two alpha tables carrying the same numbers under two
// names, and a visual-layer read whose "layer is off" branch returned
// bare from one copy and `{ hasOverlay: false }` from the other.
//
// One implementation of each recipe is here. Nothing in this module
// asserts — it measures and returns, and the spec names the assertion
// and writes the failure message, because a message that does not name
// the measurement it is about is worth nothing in a CI log.

const { loginViaUI } = require('./chatbot');

// The welcome composer's own resting viewport. The height is a
// parameter rather than a constant because it is a real difference
// between the specs: the banner's pixel measurements want a 800 px
// window, the composer's geometry wants a 900 px one, and a spec that
// cannot measure its subject at the height its subject is designed for
// is measuring a different page.
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

/*
 * The pause after the reload, before the page is sampled.
 *
 * The banner's entrance animation finishes at 650 ms, but Chromium's
 * mask compositing layer takes a few extra seconds to settle after the
 * animation completes — a screenshot taken earlier reports the scrim
 * mid-gray rather than at its resolved alpha. 3000 ms is past that
 * window and is the default here, so no spec becomes flakier than it
 * was. A caller that measures something the mask layer does not touch
 * (the composer's geometry, for one) may pass a shorter pause.
 */
const DEFAULT_SETTLE_MS = 3000;

/**
 * Open a signed-in session on the welcome screen.
 *
 * One recipe for the whole suite: the context, the browser login, the
 * sidebar hint, the navigation, and the reload that clears the splash
 * (it shows once per authenticated session) before the page is
 * sampled.
 *
 *   viewport  the context's window; defaults to 1440x900
 *   theme     the context's colorScheme ('light' | 'dark')
 *   locale    applied through the app's own boot path
 *             (localStorage.userLocale, read by main.js before mount)
 *   settle    ms to wait after the reload; defaults to DEFAULT_SETTLE_MS
 *   setupPage an async hook run on the page BEFORE the login — the
 *             place for route stubs: the first chat mount already
 *             sees them, instead of a stub installed after the app
 *             has already fetched the real thing
 *   reload    false skips the splash-clearing reload and its settle
 *             pause — for a spec that HOLDS a network answer, a
 *             `waitUntil: 'networkidle'` reload would never settle
 *
 * Returns { ctx, page } — the caller closes ctx when it is done.
 */
async function openWelcomeScreen(browser, { viewport, theme, locale, settle, setupPage, reload = true } = {}) {
  const ctx = await browser.newContext({
    viewport: viewport || DEFAULT_VIEWPORT,
    colorScheme: theme || 'light',
    ignoreHTTPSErrors: true
  });
  const page = await ctx.newPage();
  if (setupPage) {
    await setupPage(page);
  }
  await loginViaUI(page);
  if (locale) {
    await page.evaluate((l) => localStorage.setItem('userLocale', l), locale);
  }
  await page.evaluate(() => localStorage.setItem('sidebarOpen', 'true'));
  // The splash is a full-screen overlay (z-index 30000, opaque
  // background) and it shows on the first authenticated load of a
  // session — the login above already triggered it. It has to be gone
  // before a single pixel is sampled, or the sampler reads the splash
  // image instead of the scrim. A reload skips it (the session flag is
  // set) and leaves the page ready to sample.
  await page.waitForSelector('.quick-help-banner', { timeout: 15000 });
  if (reload) {
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('.quick-help-banner', { timeout: 15000 });
    await page.waitForTimeout(settle === undefined ? DEFAULT_SETTLE_MS : settle);
  } else if (settle !== undefined) {
    await page.waitForTimeout(settle);
  }
  return { ctx, page };
}

/**
 * Is the Living Intelligence layer on, and is the welcome panel there?
 *
 * The DOM half, over a `document` rather than a page: a spec that has to
 * read the panel in the SAME evaluate as its own measurement composes the
 * two instead of paying a second round trip over the bridge for a value
 * it has already crossed the bridge to fetch.
 *
 * A miss returns `hasOverlay: false` rather than a bare `undefined`, so a
 * caller that forgets the guard still holds a falsy object it can assert
 * on — and a copy that returns early instead of asserting fails loudly
 * when the layer moves off the ancestor chain, rather than quietly
 * stopping testing.
 */
function visualLayerState(doc) {
  const overlay = doc.querySelector('.quick-help-overlay');
  const html = doc.documentElement;
  const visualOn = html.getAttribute('data-visual') === 'on';
  // .genie-living-intelligence lives on .dashboard-content, an ancestor
  // of .quick-help-overlay (DashboardView wraps the ChatBotComponent).
  const gliOn = overlay ? overlay.closest('.genie-living-intelligence') !== null : false;
  return { hasOverlay: !!overlay, visualOn, gliOn };
}

async function readVisualLayerState(page) {
  return await page.evaluate(`(${visualLayerState.toString()})(document)`);
}

/**
 * Capture a rectangle of the page as pixels, with an optional style
 * injected for the capture only.
 *
 * The tag is removed in a `finally`, so a screenshot that throws part
 * way through a sequence cannot leave the next capture reading a page
 * that is still wearing the last variant's CSS.
 *
 * `clip` is in CSS pixels relative to the viewport. Callers intersect
 * it with the viewport themselves: a clip taken at a negative
 * coordinate is silently shifted to 0 by the browser, and the caller
 * is the one that knows which coordinates it will read the result
 * against.
 *
 * Returns { data, width, height } — the capture as a base64 PNG, plus
 * the dimensions the browser actually produced.
 *
 * The bytes cross into Node as a PNG rather than as raw RGBA on
 * purpose. The widest clip in this suite is the banner's own box at
 * 1920 — measured 1576 x 436 px, 2 746 968 RGBA bytes — and a veil
 * measurement takes three of them, so shipping raw bytes would spend
 * seconds per page state in the bridge and buy nothing: the maths
 * reads the RGBA inside the page, where the pixels already are.
 */
async function capturePixels(page, clip, css) {
  const tag = css ? await page.addStyleTag({ content: css }) : null;
  try {
    const buf = await page.screenshot({ clip, type: 'png' });
    return {
      data: buf.toString('base64'),
      // A PNG's IHDR chunk carries the image's own width and height in
      // bytes 16..24, so the capture reports the array the caller's
      // pixel walk will index rather than the rectangle it asked for.
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20)
    };
  } finally {
    if (tag) await tag.evaluate((n) => n.remove());
  }
}

/**
 * WCAG relative luminance of an sRGB triple (0..1).
 *
 * The coefficients and the transfer curve are WCAG's, copied from the
 * spec's own definition rather than re-derived.
 */
function lum(r, g, b) {
  const toLin = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

/**
 * WCAG contrast ratio between two [r, g, b] triples.
 */
function contrastRatio(p, q) {
  const la = lum(p[0], p[1], p[2]);
  const lb = lum(q[0], q[1], q[2]);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/*
 * The two functions above, as source, for the page side.
 *
 * A pixel walk cannot hand hundreds of thousands of samples back to
 * Node per capture, so the contrast maths runs inside
 * `page.evaluate` — and a browser cannot call a Node function. The
 * coefficients therefore exist once, here, and reach the page by
 * source:
 *
 *   page.evaluate(({ shots, wcag }) => {
 *     const { lum, contrastRatio } = new Function(wcag)();
 *     ...
 *   }, { shots, wcag: WCAG_BIND })
 *
 * `contrastRatio` closes over `lum`, so the pair is compiled
 * together. The suite runs with `bypassCSP`, which is what lets the
 * page compile a function from source at all.
 */
const WCAG_BIND = `const lum = ${lum.toString()};
const contrastRatio = ${contrastRatio.toString()};
return { lum, contrastRatio };`;

/*
 * `visualLayerState` as source, for a spec that reads the panel in the
 * same evaluate as its own measurement:
 *
 *   await page.evaluate(
 *     ({ layerSource }) => ({
 *       ...new Function(layerSource)()(document),
 *       overflowX: getComputedStyle(document.querySelector('.quick-help-overlay')).overflowX
 *     }),
 *     { layerSource: LAYER_STATE_BIND }
 *   )
 */
const LAYER_STATE_BIND = `return (${visualLayerState.toString()});`;

module.exports = {
  openWelcomeScreen,
  readVisualLayerState,
  capturePixels,
  lum,
  contrastRatio,
  WCAG_BIND,
  LAYER_STATE_BIND
};
