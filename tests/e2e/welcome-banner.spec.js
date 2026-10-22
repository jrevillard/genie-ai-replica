// tests/e2e/welcome-banner.spec.js
//
// Welcome banner invariants for the translucent scrim.
//
// The heading, its subtitle and the brand wordmark sit inside the banner, on
// the artwork, on a scrim that is translucent rather than opaque. Four
// assertions guard that:
//
//   1. the scrim's alpha is at or above the floor measured for its theme.
//      A CSS-level read of the resolved custom property, plus a check that
//      the used background colour actually carries that alpha — a declared
//      token the background ignores would otherwise pass.
//
//   2. the wordmark's rendered contrast against its LOCAL background is at
//      least 3:1. The wordmark is roughly 110 px of a ~1100 px band, so the
//      global worst pixel of the banner is not what sits behind the glyph:
//      this separates the ink from the background inside the wordmark's own
//      bounding box and pairs each ink pixel with the artwork pixel directly
//      behind it. The absence of this reading is what let a 1.75:1 defect
//      ship once.
//
//   3. the scrim's top edge is a ramp, not a step. Measured as the
//      contribution the scrim makes to the rendered backdrop, row by row:
//      with the scrim removed the same rows show the bare artwork, and the
//      difference between the two is the scrim's own profile. A hard edge
//      delivers the whole contribution in a row or two; the composed fade
//      spreads it over the whole ramp.
//
//   4. the veil paints only where the title is, and it blends with the
//      artwork under it rather than replacing it. Three captures of the
//      banner's box — as shipped, with the veil removed, and with an
//      opaque veil — are compared pixel by pixel. Every pixel the veil
//      changes has to lie inside its own box (and the box has to be the
//      title's measure); inside the plateau, where the mask is fully
//      opaque, the artwork has to arrive a measured fraction of the way an
//      opaque veil would carry it, and no further. A full-width band
//      fails the first; an opaque or absent veil fails the second.
//
//   5. the banner's box holds the artwork's ink band, and the banner stays
//      full-bleed with nothing overflowing the panel.
//
//   6. the subtitle's ink is legible against the artwork under it and still a
//      step below the heading. It is the only text on the banner that is
//      normal-sized, so it is held to the 4.5:1 of normal text, and it is the
//      element sitting lowest on the artwork — which is where the neutral grey
//      it used to carry measured 3.05:1 in the dark theme.
//
// All six run at 1920 / 1280 / 1024 / 769 in light + dark.
//
// Pixel sampling uses page.screenshot()'s clip parameter, hands the bytes
// back into the page as a data URL, draws them to a <canvas> and reads
// getImageData — every step runs in the browser, no npm dependency, no
// Node-side decoder.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/chatbot');

/*
 * The measured floors.
 *
 * Both numbers come from walking the scrim's alpha down in 0.02 steps on a
 * running build and reading the wordmark's worst RENDERED local contrast at
 * every stop, at every width below, in the theme named:
 *
 *   light  1.00 -> 3.97:1    0.92 -> 3.47:1    0.88 -> 3.23:1   <- floor
 *          0.86 -> 3.09:1    0.84 -> 2.96:1                      <- fails
 *   dark   1.00 -> 5.86:1    0.88 -> 4.68:1    0.80 -> 3.16:1   <- floor
 *          0.78 -> 2.99:1    0.74 -> 2.61:1                      <- fails
 *
 * A single alpha has to clear 3:1 at EVERY width, so the governing stop is
 * the worst width, not the average: light is set by 1920, dark by 1280 —
 * the width at which the heading sits closest to the banner's mask knee and
 * so has the least of the artwork dissolved out from under it. The binding
 * pixel in light is the artwork's saturated blue in its lower band.
 *
 * Placement cannot buy a more translucent scrim. The globe's ink runs dark
 * from about 20 % to 80 % of the band, so sliding the text down to the
 * band's lower third or up to its pale top edge measured no better than the
 * position it already holds.
 */
const SCRIM_ALPHA_FLOOR = { light: 0.88, dark: 0.8 };

// The wordmark is large text, so 3:1 is the floor it must clear.
const WORDMARK_CONTRAST_FLOOR = 3.0;

/*
 * The subtitle's floor is derived from its own rendered type, not asserted
 * against a constant: WCAG AA asks 4.5:1 of NORMAL text and 3:1 of large text
 * (>= 24px, or >= 18.66px at weight >= 700). --text-md resolves to 1rem x
 * --font-scale, so a deployment that overrides the scale moves the subtitle
 * across that line, and a hardcoded 4.5 would then assert the wrong rule
 * without saying so. The subtitle inherits weight 400, so at the shipped scale
 * it is 16px/400 — normal text, 4.5:1.
 */
const WCAG_AA = { normal: 4.5, large: 3.0 };

/*
 * How far the subtitle's ink has to sit from the heading's, as a fraction of
 * the brighter of the two relative luminances. The two requirements pull
 * against each other — legible against the scrim, and still a step below the
 * heading rather than a second heading — and the mix between --fg and --accent
 * is what trades them off. Measured luminances (WCAG relative, from the
 * resolved inks):
 *
 *                 heading   88% fg   75% fg   60% fg (shipped)   plain --fg
 *   light           0.0108   0.0178   0.0284          0.0451           0.0108
 *   dark            0.8598   0.7977   0.7383          0.6690           0.8598
 *   step, light       -      39.4%    61.9%           76.0%              0%
 *   step, dark        -       7.2%    14.1%           22.2%              0%
 *
 * The 88% mix is the one this rejects: in dark it lands 7.2% from the
 * heading's own luminance, inside the 10% band, which is the hierarchy
 * collapsing into a second heading. Plain --fg is 0% in both. The shipped
 * 60% mix is 76.0% clear in light and 22.2% clear in dark, so 10% sits between
 * the 88% mix and the shipped one with room on the governing side — dark, where
 * the heading is the brighter of the two and a drifting subtitle shows as a
 * shrinking step rather than a missing one.
 *
 * The denominator is the brighter luminance rather than the heading's own, so
 * a near-black ink in the light theme (0.011) cannot make a tiny absolute
 * difference read as a large relative one.
 */
const HIERARCHY_LUMINANCE_STEP = 0.1;

// The ink-coverage floor for calling a pixel "a glyph pixel". It only selects
// which backdrop pixels sit under the text — the ratio itself is computed
// between the resolved ink and that backdrop, so a low floor costs nothing but
// a slightly larger pixel count.
const INK_COVERAGE_FLOOR = 0.25;

// Below this the ink and its backdrop are one 8-bit step apart or less, and the
// per-channel coverage is quantisation rather than paint.
const MIN_INK_SPAN = 4;

// The scrim's rise must span at least this many rows. A hard top edge
// delivers the whole contribution in one or two; the shipped ramp delivers
// it over ~46 px.
const MIN_RAMP_ROWS = 8;

/*
 * The veil's alpha, per theme — the value the layer SHIPS, which is the
 * value the blend floors below are derived from.
 *
 * It is deliberately not read off the page. The blend ratios are a
 * measurement of the compositing against the veil's own declared alpha,
 * so a live read would let a veil that turned opaque move its own floor
 * down to 0 and pass. The rendered token is asserted against this constant
 * separately, in the same test.
 */
const SHIPPED_SCRIM_ALPHA = { light: 0.88, dark: 0.8 };

/*
 * How far the blend has to have travelled, as a fraction of what an opaque
 * veil would have done — 0.8 in each direction.
 *
 * Measured on the running build, across the four widths in both themes:
 *
 *   r1 / a        = 0.994 ... 1.005
 *   r2 / (1 - a)  = 0.982 ... 1.042
 *
 * so the floors sit a comfortable 1.2x below the render in both directions,
 * and each of the two defects they guard collapses one of them to nothing:
 *
 *   an opaque veil                  r2 = 0
 *   no veil at all                  r1 = 0
 *   a replacement rather than blend  r1 = 1, r2 = 0, and 4a's inside count is 0
 */
const BLEND_FRACTION = 0.8;

// A pixel one step outside the veil's box may still differ — its own edge
// is antialiased. Measured outside-count at this tolerance: 0 at every width
// in both themes.
const FOOTPRINT_EDGE_TOLERANCE = 1;

const VIEWPORTS = [
  { label: '1920', width: 1920 },
  { label: '1280', width: 1280 },
  { label: '1024', width: 1024 },
  { label: '769', width: 769 }
];

async function freshSignedIn(browser, vp, theme) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: 800 },
    colorScheme: theme,
    ignoreHTTPSErrors: true
  });
  const page = await ctx.newPage();
  await loginViaUI(page);
  await page.evaluate(() => localStorage.setItem('sidebarOpen', 'true'));
  // The splash is a full-screen overlay (z-index 30000, opaque
  // background) and it shows on the first authenticated load of a
  // session — the login above already triggered it. It has to be gone
  // before a single pixel is sampled, or the sampler reads the splash
  // image instead of the scrim. A reload skips it (the session flag is
  // set) and leaves the page ready to sample. Without the reload, every
  // one of the eight sessions in a test would sit through the splash's
  // 5 s + 1 s fade, and the test would run past its own timeout.
  await page.waitForSelector('.quick-help-banner', { timeout: 15000 });
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.quick-help-banner', { timeout: 15000 });
  // The banner's entrance animation finishes at 650 ms, but Chromium's
  // mask compositing layer takes a few extra seconds to settle after
  // the animation completes — a screenshot taken earlier reports the
  // scrim mid-gray rather than at its resolved alpha. 3000 ms is past
  // that settle window and gives a stable read.
  await page.waitForTimeout(3000);
  return { ctx, page };
}

// Which theme is actually rendering. ThemeManager writes data-theme on the
// root element and mirrors it as a dark-mode class, which is the same pair
// the layer's own selectors key on.
async function activeTheme(page) {
  return await page.evaluate(() => {
    const root = document.documentElement;
    const attr = root.getAttribute('data-theme');
    if (attr === 'dark' || root.classList.contains('dark-mode')) return 'dark';
    return 'light';
  });
}

// Assertion 1: the scrim's alpha, read off the resolved custom property and
// cross-checked against the colour the element actually paints with.
async function scrimAlpha(page) {
  return await page.evaluate(() => {
    const el = document.querySelector('.quick-help-content');
    if (!el) return { ok: false, why: 'no scrim element' };
    const cs = getComputedStyle(el);
    const raw = cs.getPropertyValue('--qh-banner-scrim-alpha').trim();
    const token = raw === '' ? null : parseFloat(raw);
    const used = cs.backgroundColor;

    // Pull the alpha back out of whatever syntax the browser used to
    // serialise the colour: rgba(r, g, b, a), color(srgb r g b / a) or the
    // percentage form of either.
    let usedAlpha = null;
    const slash = used.lastIndexOf('/');
    if (slash !== -1) {
      const tail = used
        .slice(slash + 1)
        .replace(/[)\s]+$/, '')
        .trim();
      usedAlpha = tail.endsWith('%') ? parseFloat(tail) / 100 : parseFloat(tail);
    } else {
      const m = used.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)/);
      if (m) usedAlpha = parseFloat(m[1]);
    }
    return { ok: token !== null, token, raw, used, usedAlpha };
  });
}

// Inside the page: read the wordmark's box, then recover the ink colour at
// every core glyph pixel from four renders of that box.
//
//   A = as rendered         (gradient ink over its real backdrop)
//   B = backdrop alone      (wordmark hidden)
//   Hk = flat black ink     -> Hk = (1-c)*B,  c = 1 - Hk/B
//   Hw = flat white ink     -> Hw = c*255 + (1-c)*B,  c = (Hw - B)/(255 - B)
//
// Recovering the ink as I = (A - (1-c)*B)/c removes the anti-aliasing
// dilution that a raw "is this pixel dark?" threshold cannot: an edge pixel
// that is 90 % ink over the backdrop reads as a lightened ink and drags the
// measured contrast below what the text colour actually achieves. Each ink
// pixel is then paired with the backdrop pixel directly behind it, so the
// number reported is the contrast under the glyph and not the worst pixel
// anywhere in the band.
//
// Both probes are needed because neither one is legible against every
// backdrop: black loses its range under a light panel, white loses its
// range under a dark one. Taking the ink as fully black would make this
// assertion unable to report a contrast at all on a dark backdrop, which is
// exactly the case it exists to catch.
async function wordmarkContrast(page) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('.quick-help-heading .brand-wordmark');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  if (!box) return { ok: false, why: 'no wordmark box' };

  const shot = async (css) => {
    const tag = css ? await page.addStyleTag({ content: css }) : null;
    const buf = await page.screenshot({ clip: box, type: 'png' });
    if (tag) await tag.evaluate((n) => n.remove());
    return buf.toString('base64');
  };

  const aB64 = await shot(null);
  const bB64 = await shot('.brand-wordmark{visibility:hidden !important;}');
  const hkB64 = await shot(
    '.brand-wordmark{-webkit-text-fill-color:#000 !important;background-image:none !important;color:#000 !important;}'
  );
  const hwB64 = await shot(
    '.brand-wordmark{-webkit-text-fill-color:#fff !important;background-image:none !important;color:#fff !important;}'
  );

  return await page.evaluate(
    async ({ aB64, bB64, hkB64, hwB64 }) => {
      const load = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [imA, imB, imK, imW] = await Promise.all([load(aB64), load(bB64), load(hkB64), load(hwB64)]);
      const pixels = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const A = pixels(imA);
      const B = pixels(imB);
      const K = pixels(imK);
      const W = pixels(imW);

      const lum = (r, g, b) => {
        const toLin = (v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
      };
      const ratio = (p, q) => {
        const la = lum(p[0], p[1], p[2]);
        const lb = lum(q[0], q[1], q[2]);
        const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
        return (hi + 0.05) / (lo + 0.05);
      };

      let core = 0;
      let worst = Infinity;
      let worstInk = null;
      let worstBg = null;
      for (let i = 0; i < A.length; i += 4) {
        const bg = [B[i], B[i + 1], B[i + 2]];
        let coverage = null;
        // Black probe, solved on the brightest backdrop channel.
        const bright = Math.max(bg[0], bg[1], bg[2]);
        if (bright >= 24) {
          const ch = [0, 1, 2].reduce((m, k) => (bg[k] > bg[m] ? k : m), 0);
          coverage = 1 - [K[i], K[i + 1], K[i + 2]][ch] / bg[ch];
        }
        // White probe, solved on the darkest backdrop channel. Covers the
        // backdrops the black probe cannot read.
        if (coverage === null) {
          const dark = Math.min(bg[0], bg[1], bg[2]);
          if (dark <= 231) {
            const ch = [0, 1, 2].reduce((m, k) => (bg[k] < bg[m] ? k : m), 0);
            coverage = ([W[i], W[i + 1], W[i + 2]][ch] - bg[ch]) / (255 - bg[ch]);
          }
        }
        if (coverage === null || coverage < 0.55) continue;
        core++;
        const ink = [
          Math.min(255, Math.max(0, (A[i] - (1 - coverage) * bg[0]) / coverage)),
          Math.min(255, Math.max(0, (A[i + 1] - (1 - coverage) * bg[1]) / coverage)),
          Math.min(255, Math.max(0, (A[i + 2] - (1 - coverage) * bg[2]) / coverage))
        ];
        const r = ratio(ink, bg);
        if (r < worst) {
          worst = r;
          worstInk = ink.map((v) => Math.round(v));
          worstBg = bg;
        }
      }
      return {
        ok: true,
        worst: Number.isFinite(worst) ? Number(worst.toFixed(3)) : null,
        ink: worstInk,
        bg: worstBg,
        core
      };
    },
    { aB64, bB64, hkB64, hwB64 }
  );
}

// Assertion 3: the scrim's top edge is a ramp.
//
// The banner box is shot twice with the text hidden: once as it ships, once
// with the scrim removed so the same rows show the bare artwork. The
// difference between them, row by row, is the scrim's own contribution — the
// artwork's own structure cancels out. A hard top edge drives that
// contribution from nothing to its full value inside a row or two; the
// composed fade spreads the same change over the whole ramp.
async function scrimTopEdge(page) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('.quick-help-banner');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  if (!box) return { ok: false, why: 'no banner box' };

  const shot = async (css) => {
    const tag = await page.addStyleTag({ content: css });
    const buf = await page.screenshot({ clip: box, type: 'png' });
    await tag.evaluate((n) => n.remove());
    return buf.toString('base64');
  };
  const HIDE_TEXT = '.quick-help-heading,.quick-help-subtitle{visibility:hidden !important;}';
  const withScrim = await shot(HIDE_TEXT);
  const withoutScrim = await shot(`${HIDE_TEXT}.quick-help-content{visibility:hidden !important;}`);

  return await page.evaluate(
    async ({ withScrim, withoutScrim }) => {
      const load = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [imS, imN] = await Promise.all([load(withScrim), load(withoutScrim)]);
      const pixels = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const S = pixels(imS);
      const N = pixels(imN);
      const W = imS.width;
      const H = imS.height;
      const lum = (r, g, b) => {
        const toLin = (v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
      };
      // The full band width: the cut this guards against happens at the icon
      // tiles, which sit well outside the middle.
      const x0 = 0;
      const x1 = W;
      const rows = [];
      for (let y = 0; y < H; y++) {
        let s = 0;
        let n = 0;
        let b = 0;
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          s += lum(S[i], S[i + 1], S[i + 2]);
          b += lum(N[i], N[i + 1], N[i + 2]);
          n++;
        }
        rows.push(s / n - b / n);
      }
      const plateau = Math.max(...rows.map((r) => Math.abs(r)));
      if (!(plateau > 1e-4)) return { ok: false, why: 'scrim contributed nothing', plateau };
      const firstAbove = (frac) => rows.findIndex((r) => Math.abs(r) >= frac * plateau);
      const start = firstAbove(0.1);
      const full = firstAbove(0.9);
      return {
        ok: true,
        plateau: Number(plateau.toFixed(4)),
        start,
        full,
        rampRows: full - start,
        rows: rows.length
      };
    },
    { withScrim, withoutScrim }
  );
}

// Assertion 4: the veil's footprint is the title's box, and it blends.
//
// The veil wraps the title rather than spanning the banner, so the two
// things worth proving are WHERE it paints and WHAT it does to what is
// under it. Both come out of three captures of the same banner box: as it
// ships, with the veil removed, and with an opaque veil.
//
// (4a) The footprint. Shipped is compared with bare pixel by pixel: every
// pixel that differs has to lie inside the veil's own border box, allowing
// 1 px for the antialiased edge, and some of them have to — an empty
// footprint is a missing veil, not a contained one.
//
// What that check cannot see is its own reference frame. The box is read
// off the page, so a veil grown back into the old full-width band still
// paints inside its own box and would still report zero pixels outside it.
// A footprint is the title's only if the box is the title's measure, so
// that is asserted alongside it: the veil's width has to be the title's own
// measure plus the padding it carries on both sides. The title's measure is
// read as the union of its line boxes, not as the heading's box — the
// heading is a block child that fills the veil and grows with it, so read
// off the same render its width says nothing about where the title ends.
//
// (4b) The blend. Inside the plateau — the lower half of the box, and in
// from the horizontal padding, where the mask has reached full opacity and
// the compositing is a plain blend — the pixel with the largest
// |bare - opaque| is picked, in whichever single channel it is largest in,
// and that channel is read. The banner's own bottom fade multiplies the
// whole banner's alpha and cancels in both ratios.
//
//   r1 = |shipped - bare|   / |bare - opaque|
//   r2 = |shipped - opaque| / |bare - opaque|
//
// An opaque veil sends r2 to 0 and an absent veil sends r1 to 0; a veil
// that replaced the artwork instead of blending with it sends both to the
// ends of their range at once (r1 = 1, r2 = 0) and leaves 4a's inside
// count at 0.
//
// Every capture neutralises the banner's own drop-shadow. That shadow is
// computed from the banner's alpha, and the veil raises that alpha wherever
// it paints — so the veil lays a faint halo up to ~30 px OUTSIDE its box,
// decaying with the distance to it (measured up to 211/255 in a channel,
// over ~23 px). That halo is the banner's decoration rather than the veil's
// paint, and left in place no footprint check can pass.
async function veilFootprintAndBlend(page) {
  const geo = await page.evaluate(() => {
    const banner = document.querySelector('.quick-help-banner');
    const veil = document.querySelector('.quick-help-content');
    const heading = document.querySelector('.quick-help-heading');
    if (!banner || !veil || !heading) return null;
    const b = banner.getBoundingClientRect();
    const v = veil.getBoundingClientRect();
    const cs = getComputedStyle(veil);
    // The title's own measure, not the heading's box. The heading is a block
    // child, so its box simply fills whatever the veil is wide and grows with
    // it — read off the same render it says nothing about where the text
    // ends. A Range over the heading's contents reports the union of the
    // line boxes, which is the title itself and does not move when the veil
    // is stretched.
    const title = document.createRange();
    title.selectNodeContents(heading);
    // The clip is the banner's box intersected with the viewport. The banner
    // breaks out past the panel, so at the narrow widths its box starts at
    // x = -24 and a clip taken at b.x is silently shifted to 0 — which puts
    // every coordinate read against the image 24 px out, and reads the
    // veil's own left ramp as a halo outside it.
    const x = Math.max(0, b.left);
    const y = Math.max(0, b.top);
    const alpha = parseFloat(cs.getPropertyValue('--qh-banner-scrim-alpha'));
    return {
      clip: {
        x,
        y,
        width: Math.min(b.right, window.innerWidth) - x,
        height: Math.min(b.bottom, window.innerHeight) - y
      },
      veil: { x: v.left - x, y: v.top - y, width: v.width, height: v.height },
      titleWidth: title.getBoundingClientRect().width,
      padLeft: parseFloat(cs.paddingLeft),
      padRight: parseFloat(cs.paddingRight),
      alpha: Number.isFinite(alpha) ? alpha : null
    };
  });
  if (!geo) return { ok: false, why: 'no banner box' };

  const BASE_CSS =
    // The glyphs would otherwise pollute the pixel comparison.
    '.quick-help-heading,.quick-help-subtitle{visibility:hidden !important;}' +
    // The banner's drop-shadow is computed from its own alpha, which the
    // veil raises wherever it paints; without this it haloed ~23 px outside
    // the veil's box in every capture.
    '.quick-help-banner{filter:none !important;}';
  const VEIL_OFF =
    '.quick-help-content{background:transparent !important;mask-image:none !important;-webkit-mask-image:none !important;}';
  const VEIL_OPAQUE =
    '.quick-help-content{background:var(--surface) !important;mask-image:none !important;-webkit-mask-image:none !important;}';

  const shot = async (css) => {
    const tag = await page.addStyleTag({ content: BASE_CSS + css });
    const buf = await page.screenshot({ clip: geo.clip, type: 'png' });
    await tag.evaluate((n) => n.remove());
    return buf.toString('base64');
  };
  const shipped = await shot('');
  const bare = await shot(VEIL_OFF);
  const opaque = await shot(VEIL_OPAQUE);

  return await page.evaluate(
    async ({ shipped, bare, opaque, geo, tol }) => {
      const load = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [imS, imB, imO] = await Promise.all([load(shipped), load(bare), load(opaque)]);
      const pixels = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const S = pixels(imS);
      const B = pixels(imB);
      const O = pixels(imO);
      const W = imS.width;
      const H = imS.height;

      // (4a) The footprint.
      let inside = 0;
      let outside = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const d = Math.abs(S[i] - B[i]) + Math.abs(S[i + 1] - B[i + 1]) + Math.abs(S[i + 2] - B[i + 2]);
          if (d === 0) continue;
          const dx = x + 0.5 - geo.veil.x;
          const dy = y + 0.5 - geo.veil.y;
          const inBox = dx >= -tol && dx <= geo.veil.width + tol && dy >= -tol && dy <= geo.veil.height + tol;
          if (inBox) inside++;
          else outside++;
        }
      }

      // (4b) The blend, over the part of the box where the mask is fully
      // opaque: past the vertical ramp at the bottom, and in from the
      // horizontal ramp on both sides.
      const x0 = Math.ceil(geo.veil.x + geo.padLeft);
      const x1 = Math.floor(geo.veil.x + geo.veil.width - geo.padRight);
      const y0 = Math.ceil(geo.veil.y + geo.veil.height * 0.5);
      const y1 = Math.floor(geo.veil.y + geo.veil.height);
      if (x1 < x0 || y1 < y0) return { ok: false, why: 'the veil has no plateau to sample' };

      let pick = null;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = (y * W + x) * 4;
          for (let ch = 0; ch < 3; ch++) {
            const span = Math.abs(B[i + ch] - O[i + ch]);
            if (!pick || span > pick.span) pick = { x, y, ch, span };
          }
        }
      }
      if (!pick || pick.span === 0) return { ok: false, why: 'the plateau carries no artwork' };

      const i = (pick.y * W + pick.x) * 4;
      const ch = pick.ch;
      return {
        ok: true,
        inside,
        outside,
        span: pick.span,
        r1: Math.abs(S[i + ch] - B[i + ch]) / pick.span,
        r2: Math.abs(S[i + ch] - O[i + ch]) / pick.span,
        veil: geo.veil,
        titleWidth: geo.titleWidth + geo.padLeft + geo.padRight,
        paddingInline: geo.padLeft + geo.padRight,
        alpha: geo.alpha,
        sample: { x: pick.x, y: pick.y, ch, shipped: S[i + ch], bare: B[i + ch], opaque: O[i + ch] }
      };
    },
    { shipped, bare, opaque, geo, tol: FOOTPRINT_EDGE_TOLERANCE }
  );
}

// Assertion 5: the banner's box, the ink band it has to hold, and the
// full-bleed geometry around it.
async function boxGeometry(page) {
  return await page.evaluate(() => {
    const banner = document.querySelector('.quick-help-banner');
    const overlay = document.querySelector('.quick-help-overlay');
    const grid = document.querySelector('.quick-help-grid');
    if (!banner || !overlay || !grid) return null;
    const ov = getComputedStyle(overlay);
    const fRaw = ov.getPropertyValue('--f').trim();
    const m = fRaw.match(/[\d.]+/g);
    const f = m && m.length ? parseFloat(m[m.length - 1]) : 0.553;
    const b = banner.getBoundingClientRect();
    const o = overlay.getBoundingClientRect();
    const g = grid.getBoundingClientRect();
    return {
      f,
      bannerH: Math.round(b.height),
      // The artwork's band: the box tracks the art, not the viewport.
      bandH: Math.round((b.width * f) / 2),
      bannerToGrid: Number((g.top - b.top).toFixed(2)),
      // Full bleed: the artwork has to reach the panel's visible edges.
      leftBleed: Number((b.left - o.left).toFixed(2)),
      rightBleed: Number((o.right - b.right).toFixed(2)),
      overflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });
}

// Assertion 6: the subtitle's ink — its contrast against its own backdrop,
// and its distance from the heading's.
//
// The subtitle is the one text on the banner that is neither large enough nor
// bold enough for the relaxed 3:1 floor, so it is held to the 4.5:1 of normal
// text, and it is the element that sits lowest on the artwork — the band
// where the globe's ink is darkest and the scrim's contribution is smallest.
// Those two facts are the whole defect: measured on the running build, the
// neutral --muted the subtitle used to carry reads 5.38:1 in light (fine) and
// 3.05:1 in dark (not fine). Brightening the backdrop is not the way out and
// the numbers say so: dropping the veil's alpha to 0.50 takes dark to 2.32:1
// and light to 3.98:1, because the veil's own darkening is what the dim ink
// was already sitting on.
//
// The measure is the local one, for the reason assertion 2 gives: the backdrop
// under a glyph is not the backdrop of the box's corner. Two captures of the
// subtitle's own box — as rendered, and with the subtitle hidden — give the
// ink and the backdrop it is painted on.
//
// The ink is not recovered from the pixels. It is a flat colour the element
// declares, so the page resolves it once (a 1x1 canvas filled with it and read
// back — the computed value here is an oklch(), and parsing its numbers out
// would be reading the wrong colour space) and then only the BACKDROP varies
// per pixel. Coverage decides which pixels are glyph pixels; the ratio is the
// WCAG one, between the resolved ink and the backdrop under it, so an
// antialiased edge contributes a backdrop sample rather than a washed-out ink.
//
// What each ink measures at 1920, where the banner is widest, and the floor it
// is held to (4.5:1 — 16px/400 is normal text):
//
// *                    ink               worst backdrop   ratio    floor
//   --muted   light    (90, 101, 109)    (239, 243, 254)   5.38:1     pass
//   --muted   dark     (115, 123, 136)   ( 44,  49,  61)   3.05:1     FAIL
//   mix 60%   light    (26,  62,  96)    (239, 243, 254)   9.95:1     pass
//   mix 60%   dark     (190, 216, 249)   ( 44,  49,  61)   8.91:1     pass
//
// The governing width is not 1920: 769 is worse in both themes (9.28:1 light,
// 7.24:1 dark) because the subtitle sits closest to the artwork there. Both
// clear the floor by a wide margin, so the floor is set at the AA value rather
// than at the worst width measured.
async function subtitleContrast(page) {
  const geo = await page.evaluate(() => {
    const el = document.querySelector('.quick-help-subtitle');
    const head = document.querySelector('.quick-help-heading');
    if (!el || !head) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const cs = getComputedStyle(el);
    const hcs = getComputedStyle(head);
    // The clip is the subtitle's box intersected with the viewport: a clip
    // taken at a negative left is silently shifted to 0, which would put every
    // coordinate read against the image out by that much.
    const x = Math.max(0, r.left);
    const y = Math.max(0, r.top);
    const right = Math.min(r.right, window.innerWidth);
    const bottom = Math.min(r.bottom, window.innerHeight);
    if (right - x < 2 || bottom - y < 2) return null;
    return {
      clip: { x, y, width: right - x, height: bottom - y },
      color: cs.color,
      headingColor: hcs.color,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: parseInt(cs.fontWeight, 10) || 400
    };
  });
  if (!geo) return { ok: false, why: 'no subtitle box' };

  const shot = async (css) => {
    const tag = css ? await page.addStyleTag({ content: css }) : null;
    const buf = await page.screenshot({ clip: geo.clip, type: 'png' });
    if (tag) await tag.evaluate((n) => n.remove());
    return buf.toString('base64');
  };

  const aB64 = await shot(null);
  const bB64 = await shot('.quick-help-subtitle{visibility:hidden !important;}');

  return await page.evaluate(
    async ({ aB64, bB64, geo, coverageFloor, minSpan }) => {
      const load = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [imA, imB] = await Promise.all([load(aB64), load(bB64)]);
      const pixels = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const A = pixels(imA);
      const B = pixels(imB);

      // A computed colour in this codebase is an oklch(), sometimes a
      // color-mix() of two of them, so the bytes are read the way a paint
      // arrives at them rather than by parsing the text. The magenta base is
      // both the opaque backdrop the colour is laid over and the parse check:
      // a colour the canvas cannot take leaves fillStyle on the base, and the
      // result is reported rather than passed off as the theme's ink.
      const resolve = (css) => {
        const c = document.createElement('canvas');
        c.width = 1;
        c.height = 1;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ff00ff';
        ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return {
          rgb: [d[0], d[1], d[2]],
          parsed: !(d[0] === 255 && d[1] === 0 && d[2] === 255)
        };
      };

      const lum = (r, g, b) => {
        const toLin = (v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
      };
      const ratio = (p, q) => {
        const la = lum(p[0], p[1], p[2]);
        const lb = lum(q[0], q[1], q[2]);
        const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
        return (hi + 0.05) / (lo + 0.05);
      };

      const ink = resolve(geo.color);
      const head = resolve(geo.headingColor);
      if (!ink.parsed) return { ok: false, why: `the subtitle's colour (${geo.color}) would not parse` };
      if (!head.parsed) return { ok: false, why: `the heading's colour (${geo.headingColor}) would not parse` };
      const T = ink.rgb;

      let count = 0;
      let worst = Infinity;
      let worstBg = null;
      for (let i = 0; i < A.length; i += 4) {
        const bg = [B[i], B[i + 1], B[i + 2]];
        // The channel the ink and the backdrop are furthest apart in carries
        // the most 8-bit steps, so its coverage is the least quantisation.
        let ch = 0;
        let span = 0;
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(T[k] - bg[k]);
          if (d > span) {
            span = d;
            ch = k;
          }
        }
        if (span < minSpan) continue;
        if (!((A[i + ch] - bg[ch]) / (T[ch] - bg[ch]) > coverageFloor)) continue;
        count++;
        const r = ratio(T, bg);
        if (r < worst) {
          worst = r;
          worstBg = bg;
        }
      }

      const lInk = lum(T[0], T[1], T[2]);
      const lHead = lum(head.rgb[0], head.rgb[1], head.rgb[2]);
      return {
        ok: true,
        declared: geo.color,
        ink: T,
        heading: head.rgb,
        worst: Number.isFinite(worst) ? Number(worst.toFixed(3)) : null,
        bg: worstBg,
        core: count,
        lumInk: Number(lInk.toFixed(4)),
        lumHeading: Number(lHead.toFixed(4)),
        step: Number((Math.abs(lInk - lHead) / Math.max(lInk, lHead)).toFixed(4)),
        fontSize: geo.fontSize,
        fontWeight: geo.fontWeight
      };
    },
    { aB64, bB64, geo, coverageFloor: INK_COVERAGE_FLOOR, minSpan: MIN_INK_SPAN }
  );
}

test.describe('Welcome banner invariants', () => {
  test('1. the scrim alpha is at or above its theme floor and is the alpha it paints with', async ({ browser }) => {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await freshSignedIn(browser, vp, theme);
        const floor = SCRIM_ALPHA_FLOOR[theme];
        const a = await scrimAlpha(page);
        expect(a.ok, `${vp.label}/${theme} scrim alpha readable`).toBe(true);
        expect(
          a.token,
          `${vp.label}/${theme} --qh-banner-scrim-alpha resolved to ${a.raw || '(empty)'}, ` +
            `which clears neither the ${floor} floor nor any parse`
        ).not.toBeNull();
        expect(
          a.token,
          `${vp.label}/${theme} scrim alpha ${a.token} is below the measured ${floor} floor`
        ).toBeGreaterThanOrEqual(floor);
        expect(
          a.usedAlpha,
          `${vp.label}/${theme} could not read an alpha back out of the scrim's own colour ` +
            `(${a.used}) — the background is not the translucent colour the token declares`
        ).not.toBeNull();
        expect(
          Math.abs(a.usedAlpha - a.token),
          `${vp.label}/${theme} the token is ${a.raw} but the scrim paints ${a.used} — ` +
            `the background is not reading the alpha it declares`
        ).toBeLessThan(0.01);
        await ctx.close();
      }
    }
  });

  test("2. the wordmark's worst RENDERED local contrast clears 3:1", async ({ browser }) => {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await freshSignedIn(browser, vp, theme);
        const c = await wordmarkContrast(page);
        expect(c.ok, `${vp.label}/${theme} wordmark measured (${c.why || 'ok'})`).toBe(true);
        expect(
          c.core,
          `${vp.label}/${theme} no glyph pixel reached the 0.55 ink-coverage floor — the scrim ` +
            `is masking the wordmark itself, not just the artwork behind it, so the mark has ` +
            `been dissolved rather than merely veiled`
        ).toBeGreaterThan(0);
        expect(
          c.worst,
          `${vp.label}/${theme} worst local wordmark contrast ${c.worst}:1 ` +
            `ink=${JSON.stringify(c.ink)} on backdrop=${JSON.stringify(c.bg)} ` +
            `over ${c.core} glyph pixels`
        ).toBeGreaterThanOrEqual(WORDMARK_CONTRAST_FLOOR);
        await ctx.close();
      }
    }
  });

  test('3. the scrims top edge is a ramp, not a hard cut', async ({ browser }) => {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await freshSignedIn(browser, vp, theme);
        const e = await scrimTopEdge(page);
        expect(e.ok, `${vp.label}/${theme} scrim edge measured (${e.why || 'ok'})`).toBe(true);
        expect(
          e.rampRows,
          `${vp.label}/${theme} the scrim goes from ${(e.plateau * 0.1).toFixed(4)} to ` +
            `${(e.plateau * 0.9).toFixed(4)} of its own contribution in ${e.rampRows} row(s) of ` +
            `${e.rows} — a hard top edge cuts a line through the artwork`
        ).toBeGreaterThanOrEqual(MIN_RAMP_ROWS);
        await ctx.close();
      }
    }
  });

  test('4. the veil wraps the title box and blends with the artwork instead of replacing it', async ({ browser }) => {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await freshSignedIn(browser, vp, theme);
        const a = SHIPPED_SCRIM_ALPHA[theme];
        const m = await veilFootprintAndBlend(page);
        expect(m.ok, `${vp.label}/${theme} veil measured (${m.why || 'ok'})`).toBe(true);
        const box =
          `${m.veil.width.toFixed(1)}x${m.veil.height.toFixed(1)} at ` +
          `${m.veil.x.toFixed(1)},${m.veil.y.toFixed(1)}`;
        const sample =
          `channel ${m.sample.ch} at (${m.sample.x}, ${m.sample.y}): ` +
          `shipped=${m.sample.shipped} bare=${m.sample.bare} opaque=${m.sample.opaque} ` +
          `over a span of ${m.span}`;

        // (4a) The footprint.
        expect(
          m.outside,
          `${vp.label}/${theme} ${m.outside} of the ${m.inside + m.outside} pixels the veil ` +
            `changes paint outside its box (${box}), within a ${FOOTPRINT_EDGE_TOLERANCE}px ` +
            `edge tolerance — the veil is a band across the banner again, or something beside ` +
            `it is painting`
        ).toBe(0);
        expect(
          m.inside,
          `${vp.label}/${theme} not one of the pixels inside the veil's box (${box}) differs ` +
            `from the bare render — the veil paints nothing`
        ).toBeGreaterThan(0);
        // The footprint only means "the title's box" if the box is the
        // title's measure. The check above reads the box off the page, so a
        // veil grown back into the full-width band would still satisfy it on
        // its own — and so would a reading of the heading's box, which is a
        // block that fills the veil and grows with it. The title's width here
        // is the union of its own line boxes.
        expect(
          Math.abs(m.veil.width - m.titleWidth),
          `${vp.label}/${theme} the veil's box is ${m.veil.width.toFixed(1)}px wide but the ` +
            `title's measure plus its ${m.paddingInline.toFixed(0)}px of padding is ` +
            `${m.titleWidth.toFixed(1)}px — the veil is wrapped around the banner, not the title`
        ).toBeLessThanOrEqual(1);

        // (4b) The blend.
        expect(
          m.r1,
          `${vp.label}/${theme} the veil carried the artwork only ${(m.r1 * 100).toFixed(1)}% of ` +
            `the way an opaque veil would, against a floor of ` +
            `${(BLEND_FRACTION * a * 100).toFixed(1)}% (0.8 x ${a}) — r1=${m.r1.toFixed(3)} ` +
            `r2=${m.r2.toFixed(3)}, ${sample}. The veil is not blending with the artwork: it is ` +
            `either absent (r1=0) or replacing it (r1=1)`
        ).toBeGreaterThanOrEqual(BLEND_FRACTION * a);
        expect(
          m.r2,
          `${vp.label}/${theme} the veil carried the artwork only ${(m.r2 * 100).toFixed(1)}% of ` +
            `the way to an opaque veil, against a floor of ` +
            `${(BLEND_FRACTION * (1 - a) * 100).toFixed(1)}% (0.8 x ${1 - a}) — ` +
            `r2=${m.r2.toFixed(3)} r1=${m.r1.toFixed(3)}, ${sample}. The veil paints opaque: ` +
            `the artwork under it does not survive`
        ).toBeGreaterThanOrEqual(BLEND_FRACTION * (1 - a));

        // The floors above are derived from the alpha the layer ships, so
        // the rendered alpha has to still be that alpha.
        expect(
          m.alpha,
          `${vp.label}/${theme} the veil paints at alpha ${m.alpha} but the blend floors were ` + `derived from ${a}`
        ).not.toBeNull();
        expect(
          Math.abs(m.alpha - a),
          `${vp.label}/${theme} the veil paints at alpha ${m.alpha} but ships at ${a}`
        ).toBeLessThan(0.01);
        await ctx.close();
      }
    }
  });

  test('5. the banner box holds the ink band and stays full-bleed', async ({ browser }) => {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await freshSignedIn(browser, vp, theme);
        const m = await boxGeometry(page);
        expect(m, `${vp.label}/${theme} banner measurement`).not.toBeNull();
        expect(
          m.bannerH,
          `${vp.label}/${theme} bannerH=${m.bannerH} must be >= bandH=${m.bandH} (f=${m.f})`
        ).toBeGreaterThanOrEqual(m.bandH);
        // Full bleed: the banner reaches past the overlay's padding box on
        // both sides by the same amount, so it never gains a gutter.
        expect(Math.abs(m.leftBleed), `${vp.label}/${theme} left bleed ${m.leftBleed}px`).toBeCloseTo(
          Math.abs(m.rightBleed),
          1
        );
        expect(
          m.overflow,
          `${vp.label}/${theme} the panel overflows the viewport by ${m.overflow}px`
        ).toBeLessThanOrEqual(0);
        await ctx.close();
      }
    }
  });

  test('6. the subtitle clears the AA floor for its own type and stays below the heading', async ({ browser }) => {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await freshSignedIn(browser, vp, theme);
        const s = await subtitleContrast(page);
        expect(s.ok, `${vp.label}/${theme} subtitle measured (${s.why || 'ok'})`).toBe(true);

        // The floor follows the rendered type rather than a constant: WCAG AA
        // asks 3:1 of large text and 4.5:1 of normal text, and the size token
        // is a scale a deployment can move across that line.
        const large = s.fontSize >= 24 || (s.fontSize >= 18.66 && s.fontWeight >= 700);
        const floor = large ? WCAG_AA.large : WCAG_AA.normal;
        const type = `${s.fontSize}px/${s.fontWeight}`;

        expect(
          s.core,
          `${vp.label}/${theme} not one pixel in the subtitle's box passed ` +
            `${INK_COVERAGE_FLOOR} ink coverage against ink=rgb(${s.ink}) — the subtitle is ` +
            `drawing nothing over its own backdrop`
        ).toBeGreaterThan(0);
        expect(
          s.worst,
          `${vp.label}/${theme} the subtitle's worst local contrast is ${s.worst}:1, against the ` +
            `WCAG AA floor of ${floor}:1 for ${type} (${large ? 'large' : 'normal'} text) — ` +
            `ink=rgb(${s.ink}) [${s.declared}] on its worst backdrop rgb(${s.bg}), over ${s.core} ` +
            `glyph pixels. The text is ${theme === 'dark' ? 'a dim ink on a dark scrim' : 'a neutral grey, not the brand tint the subtitle should be'}`
        ).toBeGreaterThanOrEqual(floor);

        // The hierarchy. A mix that leans far enough towards --fg to be safe
        // in one theme stops being a subtitle and becomes a second heading,
        // and that is the direction this check fails in: the heading is the
        // brighter of the two in dark, so a subtitle that drifted up to it
        // shows as a small step rather than no step.
        expect(
          s.step,
          `${vp.label}/${theme} the subtitle's ink rgb(${s.ink}) sits at relative luminance ` +
            `${s.lumInk} against the heading's rgb(${s.heading}) at ${s.lumHeading} — a ${(s.step * 100).toFixed(1)}% ` +
            `step, inside the ${HIERARCHY_LUMINANCE_STEP * 100}% band the two have to stay apart by. ` +
            `The subtitle reads as a second heading rather than as text under one`
        ).toBeGreaterThanOrEqual(HIERARCHY_LUMINANCE_STEP);
        await ctx.close();
      }
    }
  });
});
