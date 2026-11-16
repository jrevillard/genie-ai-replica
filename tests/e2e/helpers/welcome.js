// tests/e2e/helpers/welcome.js
//
// The welcome screen's recipes, written once.
//
// Four specs open a signed-in session on the welcome screen, three of
// them capture pixels and read them back, and two of them compute WCAG
// contrast ratios. Each of those was written out again in every file,
// and the copies had already drifted: two alpha tables carrying the
// same numbers under two names, and a visual-layer read whose "layer
// is off" branch returned bare from one copy and `{ hasOverlay: false }`
// from the other.
//
// One implementation of each recipe is here. The module measures and
// returns, except for the two settle gates above — those assert, and
// a spec names the assertion
// and writes the failure message, because a message that does not name
// the measurement it is about is worth nothing in a CI log.

const { expect } = require('@playwright/test');
// The login is read through the chatbot module object at CALL time — the
// codebase's substitution idiom (helpers/auth.js reads its transport the
// same way) — so the session's close verdict is unit-coverable OFFLINE:
// the same function answers at runtime, a unit spec swaps it (#1900).
const chatbot = require('./chatbot');
const { assertAdoptedLocale } = require('./locale');

// The welcome composer's own resting viewport. The height is a
// parameter rather than a constant because it is a real difference
// between the specs: the banner's pixel measurements want a 800 px
// window, the composer's geometry wants a 900 px one, and a spec that
// cannot measure its subject at the height its subject is designed for
// is measuring a different page.
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

// Hard bounds for the two settle gates below. A gate that expires is a
// failure, never a reason to sample a moving page.
const ENTRANCE_TIMEOUT_MS = 15000;
const COMPOSITING_TIMEOUT_MS = 15000;
// The composer is the welcome screen's own element — it mounts when the
// configuration's buttons are known.
const COMPOSER_READY_TIMEOUT_MS = 15000;

/**
 * Wait for the welcome composer to be mounted.
 *
 * The composer is the welcome screen's own element (`welcome-composer`,
 * inside the welcome panel — the chat view has its own `chat-composer`),
 * and it appears only once the configuration's buttons are known: it is
 * the signal that the config has been read and applied.
 *
 * One recipe, so the specs that wait for it wait on the same observable
 * with the same budget.
 *
 * @param {import('@playwright/test').Page} page
 */
async function waitForComposerReady(page) {
  await page.waitForSelector('[data-testid="welcome-composer"]', { timeout: COMPOSER_READY_TIMEOUT_MS });
}

/**
 * Is the welcome banner laid out, visible and settled?
 *
 * The page-side half of the entrance gate, written once so the gate and
 * its unit spec read the SAME condition (the visualLayerState precedent:
 * a page-side function that reaches Node as source).
 *
 * Three conditions, all of them observable:
 *
 *   - the banner is there (a banner that is not mounted is not settled);
 *   - it is VISIBLE: a non-empty box, and a visibility that is not
 *     hidden. A banner that is mounted but collapsed or hidden is not a
 *     page anybody can measure — the box reads come back zeroed and the
 *     pixel capture has no clip to take;
 *   - its entrance animation is over: gli-enter runs 650 ms of opacity
 *     and transform on .quick-help-banner, and a box read or a capture
 *     inside that window measures the animation rather than the page.
 *
 * @param {Document} doc
 * @returns {boolean}
 */
function bannerIsSettled(doc) {
  const banner = doc.querySelector('[data-testid="quick-help-banner"]');
  if (banner === null) return false;
  // Cheapest first: getAnimations() touches no style and no layout, the
  // box read flushes layout and the style read forces a recalc. The gate
  // polls on every animation frame, so the two expensive reads only run
  // once the entrance is over.
  if (!banner.getAnimations().every((a) => a.playState !== 'running')) return false;
  const rect = banner.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return doc.defaultView.getComputedStyle(banner).visibility !== 'hidden';
}

/*
 * Two gates, both real observables, split by who needs them:
 *
 * 1. waitForBannerEntrance — the banner's entrance. gli-enter runs
 *    650 ms of opacity and transform on .quick-help-banner, and a box
 *    read or a capture inside that window measures the animation
 *    rather than the page. The gate is the animation's own playState,
 *    so the wait ends when the page is done animating, at whatever
 *    speed the machine renders it. Every open session passes it.
 *
 *    The gate also owns the banner's VISIBILITY, not only its presence:
 *    a banner that is mounted but hidden (or collapsed to a zero-size
 *    box) is not a page anybody can measure — the box reads come back
 *    zeroed and the pixel capture has no clip to take. This is the
 *    observable the post-reload selector wait used to enforce, and the
 *    reason the reload path can leave the banner to THIS gate alone.
 *
 * 2. waitForCompositingSettled — compositing of the masked banner. A
 *    capture taken before the compositor has produced its final frame
 *    can read the scrim mid-gray instead of at its resolved alpha.
 *    Four consecutive captures of the banner's box 250 ms apart must
 *    agree byte for byte before the page counts as settled; a banner
 *    that never stops repainting never settles, and the timeout
 *    reports that instead of letting a spec sample a moving target.
 *    Only pixel readers pay for it: capturePixels runs it once per
 *    page, and waitForBannerSettled composes the two for callers that
 *    sample pixels without capturePixels.
 */
async function waitForBannerEntrance(page) {
  await page.waitForFunction(`(${bannerIsSettled.toString()})(document)`, undefined, {
    timeout: ENTRANCE_TIMEOUT_MS
  });
}

async function waitForCompositingSettled(page) {
  const clip = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="quick-help-banner"]');
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(r.left, 0),
      y: Math.max(r.top, 0),
      width: Math.min(r.right, window.innerWidth) - Math.max(r.left, 0),
      height: Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)
    };
  });
  let prev = await page.screenshot({ clip, type: 'png' });
  let identicalStreak = 0;
  await expect
    .poll(
      async () => {
        const next = await page.screenshot({ clip, type: 'png' });
        identicalStreak = next.equals(prev) ? identicalStreak + 1 : 0;
        prev = next;
        return identicalStreak;
      },
      { timeout: COMPOSITING_TIMEOUT_MS, interval: 250 }
    )
    .toBeGreaterThanOrEqual(3);
}

async function waitForBannerSettled(page) {
  await waitForBannerEntrance(page);
  await waitForCompositingSettled(page);
}

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
 *             and ADOPTED — the session proves it landed before it is
 *             returned (see below); a locale without the reload that
 *             adopts it is refused
 *   setupPage an async hook run on the page BEFORE the login — the
 *             place for route stubs: the first chat mount already
 *             sees them, instead of a stub installed after the app
 *             has already fetched the real thing
 *   reload    false skips the splash-clearing reload — for a spec
 *             that HOLDS a network answer, a `waitUntil: 'networkidle'`
 *             reload would never settle. A seeded locale and a skipped
 *             reload contradict each other — the seed lands after the
 *             login and only the next boot reads it — so the pair is
 *             refused at the door rather than left to measure the
 *             fallback locale
 *
 * A seeded locale is PROVEN, not assumed: the app writes the locale it
 * adopted to <html lang> at boot, and the session asserts that attribute
 * before it returns. A deployment whose active-locale set drops the
 * seeded locale falls back to English, and a session that fell back
 * measures the fallback's page and passes vacuously.
 *
 * The banner's entrance animation is over before the screen is
 * returned (see waitForBannerEntrance) — box and geometry reads see
 * the resolved page. Pixel reads additionally see the compositor's
 * settled frame: capturePixels gates on it (waitForCompositingSettled)
 * on its first capture of a page.
 *
 * Returns { ctx, page } — INTERNAL: the only caller is withWelcomeSession,
 * which owns the close guarantee in its own control flow. This half is
 * not exported: a caller that reached for it would have to close the
 * context itself, which is exactly the shape the helper exists to make
 * unforgetable (#1888).
 * The open path holds the same guarantee for itself: a throw after the
 * context exists (a login that fails, a wait that expires) closes the
 * context before rethrowing, so a failed open cannot leak it.
 */
async function openWelcomeScreen(browser, { viewport, theme, locale, setupPage, reload = true } = {}) {
  if (locale && !reload) {
    // A seeded locale is only ADOPTED by a boot: the write below lands
    // after the login, and the app reads localStorage.userLocale before it
    // mounts — so the reload is the boot that adopts it. Without the
    // reload the session would run on the locale it booted with and every
    // measurement in it would read that locale instead of the seeded one.
    throw new Error(
      `a seeded locale (${locale}) needs the reload that adopts it — the seed lands after the ` +
        `login and only the next boot reads it, so reload: false leaves the session on the ` +
        `locale it booted with`
    );
  }
  const sessionViewport = viewport || DEFAULT_VIEWPORT;
  const sessionTheme = theme || 'light';
  const ctx = await browser.newContext({
    viewport: sessionViewport,
    colorScheme: sessionTheme,
    ignoreHTTPSErrors: true
  });
  try {
    const page = await ctx.newPage();
    if (setupPage) {
      await setupPage(page);
    }
    await chatbot.loginViaUI(page);
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
    await page.waitForSelector('[data-testid="quick-help-banner"]', { timeout: 15000 });
    if (reload) {
      await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    }
    // ONE gate owns the banner after the reload: the entrance gate polls
    // for the banner to EXIST as well as for its entrance animation to be
    // over, so a second selector wait here would spend the same
    // observable twice — and fail on it twice (#1899).
    await waitForBannerEntrance(page);
    if (locale) {
      // The seed is only ADOPTED when the app boots on it, and the
      // adoption is PROVEN here, not assumed: main.js falls back to
      // English when the seeded locale is not in the deployment's active
      // set (VUE_APP_AVAILABLE_LOCALES), and a session that fell back
      // measures the fallback's page and passes vacuously (#1874, #1891).
      // The app writes the adopted locale to <html lang> at boot, so that
      // attribute is the pin.
      await assertAdoptedLocale(
        page,
        `the welcome session (${locale}, ${sessionTheme}, ${sessionViewport.width}x${sessionViewport.height})`,
        locale
      );
    }
    return { ctx, page };
  } catch (e) {
    // Loud cleanup, same verdict rule as the body path in
    // withWelcomeSession — with the cause kept: the close's own failure,
    // if any, travels WITH the open error that caused the unwind, never
    // instead of it (a close that erased the login failure would leave
    // the runner diagnosing the teardown instead of the cause).
    await closeLoudly(ctx, e);
    throw e;
  }
}

/**
 * Close a welcome session's context, loud but never verdict-stealing: a
 * close that itself fails joins the GIVEN failure's message (which keeps
 * its type, stack and any verdict flags) instead of replacing it. One
 * spelling for both cleanup sites — the open path and the body path
 * report the same teardown-failure shape.
 * @param {import('@playwright/test').BrowserContext} ctx
 * @param {Error} failure - The error that caused the unwind; its message
 *   is adorned with the close failure, and it stays the caller's verdict
 */
async function closeLoudly(ctx, failure) {
  try {
    await ctx.close();
  } catch (closeFailure) {
    failure.message = `${failure.message} — additionally, closing the session's context failed: ${closeFailure.message}`;
  }
}

/**
 * Open a welcome session, run `fn`, and guarantee the close.
 *
 * The close guarantee lives here, not at the call site (#1888): the leak
 * the inline `try { ... } finally { await ctx.close(); }` shape guards
 * against — close skipped when an assert throws mid-body — is one
 * forgotten wrapper away every time a loop copies the shape by hand. The
 * helper makes the guarantee unforgetable: the session is closed in this
 * function's own control flow, whatever `fn` throws, and the cleanup
 * stays loud without stealing the verdict — a close that itself fails
 * joins the body error's message (which keeps its type, stack and verdict
 * flags), it never replaces the failure that caused the unwind.
 *
 *   await withWelcomeSession(browser, { theme: 'dark' }, async (page) => {
 *     // assertions against the settled welcome screen
 *   });
 *
 * `fn` receives the session's page and its resolution is passed through,
 * so a spec can return a measured value from the session — unless the
 * session's own close fails after `fn` succeeded, in which case that
 * teardown failure throws and the measurement is lost with it (loud, and
 * the verdict names the teardown, not a body failure). The context
 * itself stays private to the helper — the close is the helper's own
 * guarantee, and a caller that could reach ctx could fight the cleanup.
 * @param {import('@playwright/test').Browser} browser
 * @param {Parameters<openWelcomeScreen>[1]} opts - Forwarded to
 *   openWelcomeScreen verbatim
 * @param {(page: import('@playwright/test').Page) => Promise<*>} fn
 * @returns {Promise<*>} Whatever `fn` resolved to — when the close after
 *   a successful `fn` itself fails, that teardown error throws instead
 */
async function withWelcomeSession(browser, opts, fn) {
  const { ctx, page } = await openWelcomeScreen(browser, opts);
  let result;
  try {
    result = await fn(page);
  } catch (bodyError) {
    // The body failed — the close's own failure, if any, joins the BODY
    // error's message (which keeps its type, stack and verdict flags), it
    // never replaces the failure that caused the unwind.
    await closeLoudly(ctx, bodyError);
    throw bodyError;
  }
  // fn succeeded — a close failure here is a TEARDOWN failure and is
  // rethrown as itself: adorning it as a body failure would invent a
  // session-body verdict that never happened.
  await ctx.close();
  return result;
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
  const overlay = doc.querySelector('[data-testid="quick-help-overlay"]');
  const html = doc.documentElement;
  const visualOn = html.getAttribute('data-visual') === 'on';
  // The visual layer scopes itself to the dashboard wrapper, an ancestor
  // of the welcome overlay (DashboardView wraps the ChatBotComponent).
  // The wrapper declares the handle; the layer's scope class on it is
  // styling, not an addressable element.
  const gliOn = overlay ? overlay.closest('[data-test-id="dashboard-content"]') !== null : false;
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
// Pages whose compositing gate already ran (see waitForCompositingSettled).
const compositingSettledPages = new WeakSet();

async function capturePixels(page, clip, css) {
  // The first pixel capture of a page pays the compositing gate once:
  // the veil recipes capture three or four times over the same state,
  // and each of them must read the settled frame, but the frame does
  // not un-settle between captures.
  if (!compositingSettledPages.has(page)) {
    await waitForCompositingSettled(page);
    compositingSettledPages.add(page);
  }
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
 *       overflowX: getComputedStyle(document.querySelector('[data-testid="quick-help-overlay"]')).overflowX
 *     }),
 *     { layerSource: LAYER_STATE_BIND }
 *   )
 */
const LAYER_STATE_BIND = `return (${visualLayerState.toString()});`;

module.exports = {
  withWelcomeSession,
  waitForComposerReady,
  bannerIsSettled,
  DEFAULT_VIEWPORT,
  waitForBannerSettled,
  readVisualLayerState,
  capturePixels,
  lum,
  contrastRatio,
  WCAG_BIND,
  LAYER_STATE_BIND
};
