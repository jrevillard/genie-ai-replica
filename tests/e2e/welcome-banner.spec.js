// tests/e2e/welcome-banner.spec.js
//
// Welcome banner invariants for the translucent scrim.
//
// The heading, its subtitle and the brand wordmark sit inside the banner, on
// the artwork, on a scrim that is translucent rather than opaque. Eight
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
//      measure of the widest text inside it); inside the plateau, where the
//      mask is fully opaque, the artwork has to arrive a measured fraction
//      of the way an opaque veil would carry it, and no further. A
//      full-width band fails the first; an opaque or absent veil fails the
//      second.
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
//   7. the title holds ONE line, and the veil is the measure of the widest
//      text inside it. Both are properties of the locale rather than of the
//      theme, and the loop above runs in English — the one locale whose
//      title never wraps and whose subtitle is narrower than its title — so
//      this runs in its own sweep over the extremes: `fr`, `man`, `st`.
//
//   8. the app's own narrow-panel adaptation is the app's own: the panel is
//      a query container and the two tokens the query steps resolve the same
//      with the Living Intelligence layer switched OFF as with it on. The
//      other seven all run with the layer on — the only state the layer's
//      CSS applies to — so none of them can see whether the layer's presence
//      decides the app's layout. This reads the same page twice, once as
//      shipped and once with the layer off, and asserts the equality.
//
// Assertions 1 to 7 run at 1920 / 1440 / 1400 / 1280 / 1024 / 769 in light +
// dark. Assertion 8 runs in the narrow-panel window only — 1440 and 1400,
// the two viewports at which the adaptation applies at all — because outside
// it the query does not fire and there is nothing to compare.
//
// Pixel sampling uses page.screenshot()'s clip parameter, hands the bytes
// back into the page as a data URL, draws them to a <canvas> and reads
// getImageData — every step runs in the browser, no npm dependency, no
// Node-side decoder. The capture, the decode and the WCAG formulas live in
// `helpers/welcome.js`; what is left here is what each measurement reads and
// the name it gives its assertion.
//
// 3, 4 and 6 all measure the same render, so they share one boot per
// (viewport, theme) and keep their assertions separate and separately named.
// 1, 2 and 5 each carry their own session: a failure in one of them then
// still leaves the other two reporting, instead of all three going quiet
// behind the first red assertion. 7 and 8 each carry a sweep of their own,
// over different axes — the locale and the layer — and for the same reason.

const { test, expect } = require('@playwright/test');
const { openWelcomeScreen, readVisualLayerState, capturePixels, lum, WCAG_BIND } = require('./helpers/welcome');

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
 *
 * ONE table, two jobs — and the reason they cannot drift apart:
 *
 *   assertion 1 is the FLOOR. `token >= SCRIM_ALPHA[theme]`: the scrim may
 *   be raised above the value measured here and still pass.
 *   assertion 4 is the EXACT value. `|alpha - SCRIM_ALPHA[theme]| < 0.01`:
 *   the blend floors are a measurement of the compositing against this
 *   alpha, so a veil that turned opaque would otherwise be allowed to move
 *   its own floor down to 0 and pass. The rendered token is therefore held
 *   to the number, not to a bound on it.
 *
 * They carried the same two numbers under two names until a designer
 * raising the scrim could leave the exact-value assertion asserting a value
 * the layer no longer ships.
 */
const SCRIM_ALPHA = { light: 0.88, dark: 0.8 };

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

/*
 * The panel is not the viewport. Below the sidebars' in-flow breakpoint the
 * two fixed sidebars are off-canvas and the centre panel is the whole
 * viewport; from 1400 up they take 770px, so the panel is at its NARROWEST at
 * the breakpoint itself and widens from there. The artwork's crop over a narrow
 * panel puts the most adverse backdrop behind the text, so 1400 is where every
 * local measurement on this banner is at its worst — and it was missing from
 * this list, which sampled 1920 (the widest panel) and 1280 and below (the
 * sidebars off-canvas, so the panel is the viewport). Every width in the
 * narrow-panel window between those two was untested.
 *
 * Measured on the running build, the subtitle in dark, against the panel width:
 *
 *   viewport   panel   subtitle    (1360 is below the breakpoint, so the
 *   1360        1360    10.543:1   sidebars are off-canvas and the panel IS
 *   1400         630     6.333:1   the viewport — which is why the measurement
 *   1440         670     6.714:1   climbs steeply the moment they stop being so)
 *   1500         730     7.047:1
 *   1600         830     7.498:1
 *   1700         930     8.039:1
 *   1920        1150     8.910:1
 *
 * 1400 and 1440 are in the list for that reason: 1400 is where the case bites,
 * and 1440 is the common laptop width and the width a 1440p screen renders at.
 */
const VIEWPORTS = [
  { label: '1920', width: 1920 },
  { label: '1440', width: 1440 },
  { label: '1400', width: 1400 },
  { label: '1280', width: 1280 },
  { label: '1024', width: 1024 },
  { label: '769', width: 769 }
];

/*
 * The locales the veil's GEOMETRY is asserted in, chosen as the extremes
 * in each direction rather than as a sample. Every assertion above runs
 * in English, and English is the one locale that cannot fail either of
 * the two this file has to get right:
 *
 *   fr    the title that wraps first — 578.3 px, the third longest of the
 *         fourteen, and the one that wraps at the smallest panel
 *   man   the longest title shipped, 659.1 px, 268 px more than English
 *   st    the locale whose SUBTITLE is wider than its title (515.0 px
 *         against 390.4), so the veil is as wide as something other than
 *         the title
 *
 * `pt` carries the same property as `st` with a 18.9 px margin where
 * `st` has 124.6 px, so `st` carries it.
 */
const GEOMETRY_LOCALES = ['fr', 'man', 'st'];

/*
 * The layer-off sweep: the narrow-panel window, and the two titles at the two
 * ends of it. 1400 and 1440 are the only two viewports at which the app's
 * adaptation applies with both sidebars in flow (a container of 582 and 622
 * px, against the 675 px threshold); below 1400 the sidebars go off-canvas
 * and the panel is the viewport, so the query does not fire there. They are
 * taken from VIEWPORTS rather than restated, so a change to that list moves
 * them together.
 */
const LAYER_OFF_VIEWPORTS = VIEWPORTS.filter((vp) => vp.label === '1440' || vp.label === '1400');

/*
 * `fr`, `id` and `man` are the extremes of the shipped title range — the one
 * that wraps first, the one the narrow panel is next-tightest on, and the
 * longest of the fourteen — so the three are the whole range the adaptation
 * exists for, and all three are swept for the mechanism (the container, the
 * two tokens it steps, and the geometry those tokens drive), which is the
 * app's own in either state.
 *
 * `fr` and `id` are also swept for the one-line consequence. The heading's
 * typography is declared by the app, so both titles measure the same in
 * either state — 578.3 px (`fr`) and 605.6 px (`id`) at 24 px, 532.0 px and
 * 557.1 px once the narrow-panel scale has stepped the type to 22.08 px —
 * and with the layer off the panel's own box is 48 px narrower than with it
 * on (the banner's full bleed is the layer's), so the veil caps at 566 px at
 * 1400 and 606 px at 1440. `id` is the case the typography ownership buys:
 * it measures 583.6 px without it, 17.6 px over that cap at 1400, and
 * wraps there.
 *
 * `man` is NOT swept for the one-line consequence, and the reason is
 * measured rather than chosen. Its title is 659.1 px at 24 px — 606.3 px
 * once the scale has stepped the type — the longest of the fourteen
 * shipped, and the veil's cap is 566 px for it with the layer off. No scale
 * closes that: the scale exists to clear the veil's 32 px of padding, and
 * with the padding at 8 px the title is still 93 px over the cap. With the
 * layer on it does fit — the full bleed gives 48 px back, so the narrow
 * panel has 614 px at 1400 and 654 px at 1440 against its 606.3 px, the
 * tightest case in the shipped theme, and it holds — and that geometry is
 * the base theme's own, not the Living Intelligence layer's.
 */
const LAYER_OFF_LOCALES = ['fr', 'id', 'man'];
const ONE_LINE_WITH_LAYER_OFF = ['fr', 'id'];

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

  const a = await capturePixels(page, box, null);
  const b = await capturePixels(page, box, '.brand-wordmark{visibility:hidden !important;}');
  const hk = await capturePixels(
    page,
    box,
    '.brand-wordmark{-webkit-text-fill-color:#000 !important;background-image:none !important;color:#000 !important;}'
  );
  const hw = await capturePixels(
    page,
    box,
    '.brand-wordmark{-webkit-text-fill-color:#fff !important;background-image:none !important;color:#fff !important;}'
  );

  return await page.evaluate(
    async ({ a, b, hk, hw, wcag }) => {
      const { lum, contrastRatio } = new Function(wcag)();
      const load = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [imA, imB, imK, imW] = await Promise.all([load(a.data), load(b.data), load(hk.data), load(hw.data)]);
      // One canvas for the four renders: resized per image, because
      // getImageData already hands back a fresh array every call.
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const pixels = (img) => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const A = pixels(imA);
      const B = pixels(imB);
      const K = pixels(imK);
      const W = pixels(imW);

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
        const r = contrastRatio(ink, bg);
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
    { a, b, hk, hw, wcag: WCAG_BIND }
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

  const HIDE_TEXT = '.quick-help-heading,.quick-help-subtitle{visibility:hidden !important;}';
  const withScrim = await capturePixels(page, box, HIDE_TEXT);
  const withoutScrim = await capturePixels(page, box, `${HIDE_TEXT}.quick-help-content{visibility:hidden !important;}`);

  return await page.evaluate(
    async ({ withScrim, withoutScrim, wcag }) => {
      const { lum } = new Function(wcag)();
      const load = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [imS, imN] = await Promise.all([load(withScrim.data), load(withoutScrim.data)]);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const pixels = (img) => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const S = pixels(imS);
      const N = pixels(imN);
      const W = imS.width;
      const H = imS.height;
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
    { withScrim, withoutScrim, wcag: WCAG_BIND }
  );
}

// Assertion 4: the veil's footprint is the text's box, and it blends.
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
// A footprint is the text's only if the box is the text's measure, so
// that is asserted alongside it: the veil's width has to be the measure of
// the widest text inside it plus the padding it carries on both sides.
// The veil is fit-content, so the widest of the two decides — in Sesotho
// and Portuguese that is the subtitle, not the title. Each text's measure
// is read as the union of its own line boxes, not as its element box —
// the heading is a block child that fills the veil and grows with it, so
// read off the same render its width says nothing about where the title
// ends.
//
// (4c) The ramp against the padding. The veil's horizontal mask runs from
// transparent to opaque over `--qh-veil-ramp` — a length, because it has
// to land inside a padding, which is also a length. The layer computes it
// as min(24px, the app's padding), so the ramp cannot be wider than the
// padding it has to be spent in; this reading is what keeps that true of
// the mask the element actually computed rather than of a token. If the
// ramp were wider than the padding it would still be fading where the
// first glyph starts, and the title would sit on a part-transparent veil
// whatever the title's length.
//
// (4b) The blend. Inside the plateau — the lower half of the box, and in
// from the horizontal ramp on both sides, where the mask has reached full
// opacity and the compositing is a plain blend — the pixel with the largest
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
    // The subtitle's measure, for the same reason: the veil is fit-content,
    // so it is as wide as its WIDEST child, and in two shipped locales that
    // is the subtitle and not the title (Sesotho 515.0 against 390.4,
    // Portuguese 438.6 against 419.7).
    const subtitleEl = document.querySelector('.quick-help-subtitle');
    const subtitle = subtitleEl ? document.createRange() : null;
    if (subtitle) subtitle.selectNodeContents(subtitleEl);
    // The clip is the banner's box intersected with the viewport. The banner
    // breaks out past the panel, so at the narrow widths its box starts at
    // x = -24 and a clip taken at b.x is silently shifted to 0 — which puts
    // every coordinate read against the image 24 px out, and reads the
    // veil's own left ramp as a halo outside it.
    const x = Math.max(0, b.left);
    const y = Math.max(0, b.top);
    const alpha = parseFloat(cs.getPropertyValue('--qh-banner-scrim-alpha'));

    // The horizontal ramp, read out of the mask the browser resolved rather
    // than off the token. The mask serialises as a comma-separated list of
    // gradients — vertical, then horizontal — and only the horizontal one
    // declares a direction:
    //   linear-gradient(to right, rgba(0,0,0,0) 0px, rgb(0,0,0) 24px, …)
    // The ramp is the length on the first OPAQUE stop: the gradient opens at
    // zero, transparent, and reaches full opacity some run later.
    const mask = cs.maskImage || cs.webkitMaskImage || '';
    const gradients = mask.match(/linear-gradient\([^()]*(?:\([^()]*\)[^()]*)*\)/g) || [];
    const horizontal = gradients.find((g) => /\bto\s+(?:right|left)\b/.test(g));
    let ramp = null;
    if (horizontal) {
      const stops = horizontal
        .slice(horizontal.indexOf('(') + 1, horizontal.lastIndexOf(')'))
        .split(/,(?![^(]*\))/)
        .map((s) => s.trim())
        .filter((s) => !/^to\s/.test(s));
      const opaque = stops.find((s) => {
        const colour = /^rgba?\(([^)]*)\)/.exec(s);
        if (!colour) return false;
        const parts = colour[1].split(',').map((p) => parseFloat(p));
        return parts.length < 4 || parts[3] > 0;
      });
      const px = opaque && opaque.match(/(-?[\d.]+)px\s*$/);
      if (px) ramp = parseFloat(px[1]);
    }

    return {
      clip: {
        x,
        y,
        width: Math.min(b.right, window.innerWidth) - x,
        height: Math.min(b.bottom, window.innerHeight) - y
      },
      veil: { x: v.left - x, y: v.top - y, width: v.width, height: v.height },
      titleWidth: title.getBoundingClientRect().width,
      subtitleWidth: subtitle ? subtitle.getBoundingClientRect().width : 0,
      padLeft: parseFloat(cs.paddingLeft),
      padRight: parseFloat(cs.paddingRight),
      alpha: Number.isFinite(alpha) ? alpha : null,
      ramp,
      mask
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

  const shipped = await capturePixels(page, geo.clip, BASE_CSS);
  const bare = await capturePixels(page, geo.clip, BASE_CSS + VEIL_OFF);
  const opaque = await capturePixels(page, geo.clip, BASE_CSS + VEIL_OPAQUE);

  return await page.evaluate(
    async ({ shipped, bare, opaque, geo, tol }) => {
      const load = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [imS, imB, imO] = await Promise.all([load(shipped.data), load(bare.data), load(opaque.data)]);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const pixels = (img) => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const S = pixels(imS);
      const B = pixels(imB);
      const O = pixels(imO);
      const W = imS.width;
      const H = imS.height;

      // (4a) The footprint, over the clip's whole grid.
      let inside = 0;
      let outside = 0;
      // (4b) The blend, over the part of the box where the mask is fully
      // opaque: past the vertical ramp at the bottom, and in from the
      // horizontal ramp on both sides. The plateau is a sub-rectangle of the
      // loop above, so both are settled in the SAME pass — the blend's
      // candidate is simply the plateau pixel carrying the largest
      // |bare - opaque| span, in whichever single channel it is largest in.
      const x0 = Math.ceil(geo.veil.x + geo.padLeft);
      const x1 = Math.floor(geo.veil.x + geo.veil.width - geo.padRight);
      const y0 = Math.ceil(geo.veil.y + geo.veil.height * 0.5);
      const y1 = Math.floor(geo.veil.y + geo.veil.height);
      const plateau = !(x1 < x0 || y1 < y0);

      let pick = null;
      for (let y = 0; y < H; y++) {
        const inPlateau = plateau && y >= y0 && y <= y1;
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const d = Math.abs(S[i] - B[i]) + Math.abs(S[i + 1] - B[i + 1]) + Math.abs(S[i + 2] - B[i + 2]);
          if (d !== 0) {
            const dx = x + 0.5 - geo.veil.x;
            const dy = y + 0.5 - geo.veil.y;
            const inBox = dx >= -tol && dx <= geo.veil.width + tol && dy >= -tol && dy <= geo.veil.height + tol;
            if (inBox) inside++;
            else outside++;
          }
          if (!inPlateau || x < x0 || x > x1) continue;
          for (let ch = 0; ch < 3; ch++) {
            const span = Math.abs(B[i + ch] - O[i + ch]);
            if (!pick || span > pick.span) pick = { x, y, ch, span };
          }
        }
      }

      if (!plateau) return { ok: false, why: 'the veil has no plateau to sample' };
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
        titleWidth: geo.titleWidth,
        subtitleWidth: geo.subtitleWidth,
        paddingInline: geo.padLeft + geo.padRight,
        padLeft: geo.padLeft,
        ramp: geo.ramp,
        mask: geo.mask,
        alpha: geo.alpha,
        sample: { x: pick.x, y: pick.y, ch, shipped: S[i + ch], bare: B[i + ch], opaque: O[i + ch] }
      };
    },
    { shipped, bare, opaque, geo, tol: FOOTPRINT_EDGE_TOLERANCE }
  );
}

// Assertion 7: the veil's geometry, read off layout boxes alone.
//
// No capture: every number here is a box, a computed style or a text
// measure, so this costs one evaluate over a session the pixel
// assertions would have paid for anyway.
//
// The title's measure is read TWICE, and the second reading is the one
// the fix is computed from. Once as rendered, where a title that has
// wrapped measures its LONGEST LINE — which is exactly the number that
// reports the wrap as fitting — and once with `white-space: nowrap` for
// a few milliseconds, which is what the title would measure on one line
// if the box allowed it. The inline style is restored before the value
// is returned, so nothing downstream reads a page wearing the probe.
//
// `lineTops` is the number of LINE boxes the title's contents occupy,
// which is the direct reading of "one line"; the box height against the
// computed line-height is the same claim from the other side, and the
// two are asserted together because they fail for different reasons —
// a fractional font-size moves the second without the first.
//
// Distinct line boxes, not the length of getClientRects(): that reports
// one rect per INLINE fragment, so a one-line title whose text runs into
// the wordmark span inside it counts three or four (measured: the French
// title at 1920 reports 4 rects on one 38.4 px line), and a span with its
// own size sits a few px off the line's own top. Rects are clustered by
// their midpoint at half a line box, which is the distance between two
// lines and well above any difference within one.
async function veilGeometry(page) {
  return await page.evaluate(() => {
    const veil = document.querySelector('.quick-help-content');
    const banner = document.querySelector('.quick-help-banner');
    const heading = document.querySelector('.quick-help-heading');
    const subtitleEl = document.querySelector('.quick-help-subtitle');
    if (!veil || !banner || !heading) return null;
    const cs = getComputedStyle(veil);
    const hs = getComputedStyle(heading);
    const measure = (el) => {
      if (!el) return 0;
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect().width;
    };
    const title = document.createRange();
    title.selectNodeContents(heading);

    const prevSpace = heading.style.whiteSpace;
    heading.style.whiteSpace = 'nowrap';
    const titleUnwrapped = title.getBoundingClientRect().width;
    heading.style.whiteSpace = prevSpace;

    const v = veil.getBoundingClientRect();
    const lineHeight = parseFloat(hs.lineHeight);
    // The line boxes the title's contents occupy: every client rect's
    // midpoint, clustered at half a line.
    const midpoints = Array.from(title.getClientRects())
      .map((r) => r.top + r.height / 2)
      .sort((a, b) => a - b);
    let lineTops = 0;
    let last = -Infinity;
    for (const m of midpoints) {
      if (m - last > lineHeight / 2) {
        lineTops++;
        last = m;
      }
    }
    return {
      veilWidth: v.width,
      // The space the veil has for text: the banner's own content box less
      // the padding the veil carries inside it. The banner is the veil's
      // containing block, and its clientWidth is a layout number — the
      // entrance animation's scale would move a bounding rect, not this.
      available: banner.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      headingHeight: heading.getBoundingClientRect().height,
      lineHeight,
      fontSize: parseFloat(hs.fontSize),
      lineTops,
      titleWidth: title.getBoundingClientRect().width,
      titleUnwrapped,
      subtitleWidth: measure(subtitleEl),
      padLeft: parseFloat(cs.paddingLeft),
      padRight: parseFloat(cs.paddingRight)
    };
  });
}

// Assertion 8's second read: the container the app's own query runs against,
// and the two tokens that query steps.
//
// The tokens say whether the query matched without the assertion having to
// infer it from the geometry it is checking: `--qh-veil-pad` is the landing
// ground for the veil's padding and `--qh-heading-scale` the multiplier on
// the heading's type size, and both are declared by the app.
//
// `containerType` is the property whose presence must not depend on the
// decorative layer. `fixedInOverlay` is the price of declaring it: a layout
// container becomes the containing block for fixed-position descendants, so
// anything fixed inside the panel would be captured by the containment and
// moved off the viewport. The count is the evidence that the panel's own
// contents are not.
async function panelOwnership(page) {
  return await page.evaluate(() => {
    const overlay = document.querySelector('.quick-help-overlay');
    const veil = document.querySelector('.quick-help-content');
    if (!overlay || !veil) return null;
    const os = getComputedStyle(overlay);
    const vs = getComputedStyle(veil);
    const hs = getComputedStyle(document.querySelector('.quick-help-heading'));
    return {
      containerType: os.containerType || os.webkitContainerType || '',
      veilPadToken: vs.getPropertyValue('--qh-veil-pad').trim(),
      headingScaleToken: vs.getPropertyValue('--qh-heading-scale').trim(),
      paddingLeft: parseFloat(vs.paddingLeft),
      paddingRight: parseFloat(vs.paddingRight),
      fontSize: parseFloat(hs.fontSize),
      fontFamily: hs.fontFamily,
      letterSpacing: hs.letterSpacing,
      fixedInOverlay: Array.from(overlay.querySelectorAll('*')).filter(
        (el) => getComputedStyle(el).position === 'fixed'
      ).length
    };
  });
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

  const a = await capturePixels(page, geo.clip, null);
  const b = await capturePixels(page, geo.clip, '.quick-help-subtitle{visibility:hidden !important;}');

  return await page.evaluate(
    async ({ a, b, geo, coverageFloor, minSpan, wcag }) => {
      const { lum, contrastRatio } = new Function(wcag)();
      const load = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [imA, imB] = await Promise.all([load(a.data), load(b.data)]);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const pixels = (img) => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
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
        const cctx = c.getContext('2d');
        cctx.fillStyle = '#ff00ff';
        cctx.fillRect(0, 0, 1, 1);
        cctx.fillStyle = css;
        cctx.fillRect(0, 0, 1, 1);
        const d = cctx.getImageData(0, 0, 1, 1).data;
        return {
          rgb: [d[0], d[1], d[2]],
          parsed: !(d[0] === 255 && d[1] === 0 && d[2] === 255)
        };
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
        const r = contrastRatio(T, bg);
        if (r < worst) {
          worst = r;
          worstBg = bg;
        }
      }

      return {
        ok: true,
        declared: geo.color,
        ink: T,
        heading: head.rgb,
        worst: Number.isFinite(worst) ? Number(worst.toFixed(3)) : null,
        bg: worstBg,
        core: count,
        fontSize: geo.fontSize,
        fontWeight: geo.fontWeight
      };
    },
    { a, b, geo, coverageFloor: INK_COVERAGE_FLOOR, minSpan: MIN_INK_SPAN, wcag: WCAG_BIND }
  );
}

test.describe('Welcome banner invariants', () => {
  // The budget below is the default 60s per test, and one test is 12 sessions
  // (6 viewports x 2 themes), each a browser login plus the 3s the banner's
  // mask layer needs to settle before a pixel is sampled. At four viewports
  // that was eight sessions and fitted; at six it does not, and three of the
  // six tests were killed mid-loop by the harness with the viewport list's
  // last cell unmeasured. This raises the budget only — every floor,
  // threshold and expectation below is unchanged.
  // Tighter than the project default (60000 per playwright.config.js):
  // this describe sizes its own ceiling because its steps can legitimately
  // run long.
  test.describe.configure({ timeout: 180000 });

  test('1. the scrim alpha is at or above its theme floor and is the alpha it paints with', async ({ browser }) => {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await openWelcomeScreen(browser, {
          viewport: { width: vp.width, height: 800 },
          theme
        });
        const floor = SCRIM_ALPHA[theme];
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
        const { ctx, page } = await openWelcomeScreen(browser, {
          viewport: { width: vp.width, height: 800 },
          theme
        });
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

  // 3, 4 and 6 read the same render, so they share one session per
  // (viewport, theme). The assertions stay in their original order and keep
  // their own messages — a merged test is one boot, not one assertion.
  test('3-4-6. the scrim ramps, the veil wraps the title and blends, the subtitle clears the AA floor', async ({
    browser
  }) => {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await openWelcomeScreen(browser, {
          viewport: { width: vp.width, height: 800 },
          theme
        });
        const where = `${vp.label}/${theme}`;
        const a = SCRIM_ALPHA[theme];

        // ---- 3. the scrim's top edge is a ramp, not a hard cut.
        const e = await scrimTopEdge(page);
        expect(e.ok, `${where} scrim edge measured (${e.why || 'ok'})`).toBe(true);
        expect(
          e.rampRows,
          `${where} the scrim goes from ${(e.plateau * 0.1).toFixed(4)} to ` +
            `${(e.plateau * 0.9).toFixed(4)} of its own contribution in ${e.rampRows} row(s) of ` +
            `${e.rows} — a hard top edge cuts a line through the artwork`
        ).toBeGreaterThanOrEqual(MIN_RAMP_ROWS);

        // ---- 4. the veil wraps the title's box, blends, and its ramp fits
        // inside the padding it is spent in.
        const m = await veilFootprintAndBlend(page);
        expect(m.ok, `${where} veil measured (${m.why || 'ok'})`).toBe(true);
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
          `${where} ${m.outside} of the ${m.inside + m.outside} pixels the veil ` +
            `changes paint outside its box (${box}), within a ${FOOTPRINT_EDGE_TOLERANCE}px ` +
            `edge tolerance — the veil is a band across the banner again, or something beside ` +
            `it is painting`
        ).toBe(0);
        expect(
          m.inside,
          `${where} not one of the pixels inside the veil's box (${box}) differs ` +
            `from the bare render — the veil paints nothing`
        ).toBeGreaterThan(0);
        // The footprint only means "the text's box" if the box is the text's
        // measure. The check above reads the box off the page, so a veil grown
        // back into the full-width band would still satisfy it on its own —
        // and so would a reading of the heading's box, which is a block that
        // fills the veil and grows with it. Both widths here are the unions of
        // their own line boxes, and the veil is fit-content, so it is the
        // WIDEST of the two that sets its measure. Written against the title
        // alone the check fails by 124.6px in Sesotho and 18.9px in
        // Portuguese, where the subtitle is the wider child, while passing in
        // the English this loop runs — which is how it shipped.
        const textWidth = Math.max(m.titleWidth, m.subtitleWidth);
        expect(
          Math.abs(m.veil.width - (textWidth + m.paddingInline)),
          `${where} the veil's box is ${m.veil.width.toFixed(1)}px wide but its widest text ` +
            `(title ${m.titleWidth.toFixed(1)}px, subtitle ${m.subtitleWidth.toFixed(1)}px) plus ` +
            `its ${m.paddingInline.toFixed(0)}px of padding is ` +
            `${(textWidth + m.paddingInline).toFixed(1)}px — the veil is wrapped around the ` +
            `banner, not around the text`
        ).toBeLessThanOrEqual(1);

        // (4c) The horizontal ramp has to be spent inside the padding. The
        // mask is read off the element, so this cannot pass on a token the
        // mask-image ignores — and the padding is the app's own, so a change
        // to the banner's inner margin moves the number the ramp is measured
        // against.
        expect(
          m.ramp,
          `${where} the veil's horizontal mask ramp is ${m.ramp}px but the content's own ` +
            `padding-left is ${m.padLeft}px (mask: ${m.mask}) — the ramp has to be exhausted ` +
            `inside the padding, or it eats the title's glyphs whatever the title's length`
        ).toBeLessThanOrEqual(m.padLeft);

        // (4b) The blend.
        expect(
          m.r1,
          `${where} the veil carried the artwork only ${(m.r1 * 100).toFixed(1)}% of ` +
            `the way an opaque veil would, against a floor of ` +
            `${(BLEND_FRACTION * a * 100).toFixed(1)}% (0.8 x ${a}) — r1=${m.r1.toFixed(3)} ` +
            `r2=${m.r2.toFixed(3)}, ${sample}. The veil is not blending with the artwork: it is ` +
            `either absent (r1=0) or replacing it (r1=1)`
        ).toBeGreaterThanOrEqual(BLEND_FRACTION * a);
        expect(
          m.r2,
          `${where} the veil carried the artwork only ${(m.r2 * 100).toFixed(1)}% of ` +
            `the way to an opaque veil, against a floor of ` +
            `${(BLEND_FRACTION * (1 - a) * 100).toFixed(1)}% (0.8 x ${1 - a}) — ` +
            `r2=${m.r2.toFixed(3)} r1=${m.r1.toFixed(3)}, ${sample}. The veil paints opaque: ` +
            `the artwork under it does not survive`
        ).toBeGreaterThanOrEqual(BLEND_FRACTION * (1 - a));

        // The floors above are derived from the alpha the layer ships, so
        // the rendered alpha has to still be that alpha.
        expect(
          m.alpha,
          `${where} the veil paints at alpha ${m.alpha} but the blend floors were ` + `derived from ${a}`
        ).not.toBeNull();
        expect(Math.abs(m.alpha - a), `${where} the veil paints at alpha ${m.alpha} but ships at ${a}`).toBeLessThan(
          0.01
        );

        // ---- 6. the subtitle's ink.
        const s = await subtitleContrast(page);
        expect(s.ok, `${where} subtitle measured (${s.why || 'ok'})`).toBe(true);

        // The floor follows the rendered type rather than a constant: WCAG AA
        // asks 3:1 of large text and 4.5:1 of normal text, and the size token
        // is a scale a deployment can move across that line.
        const large = s.fontSize >= 24 || (s.fontSize >= 18.66 && s.fontWeight >= 700);
        const floor = large ? WCAG_AA.large : WCAG_AA.normal;
        const type = `${s.fontSize}px/${s.fontWeight}`;

        expect(
          s.core,
          `${where} not one pixel in the subtitle's box passed ` +
            `${INK_COVERAGE_FLOOR} ink coverage against ink=rgb(${s.ink}) — the subtitle is ` +
            `drawing nothing over its own backdrop`
        ).toBeGreaterThan(0);
        expect(
          s.worst,
          `${where} the subtitle's worst local contrast is ${s.worst}:1, against the ` +
            `WCAG AA floor of ${floor}:1 for ${type} (${large ? 'large' : 'normal'} text) — ` +
            `ink=rgb(${s.ink}) [${s.declared}] on its worst backdrop rgb(${s.bg}), over ${s.core} ` +
            `glyph pixels. The text is ${theme === 'dark' ? 'a dim ink on a dark scrim' : 'a neutral grey, not the brand tint the subtitle should be'}`
        ).toBeGreaterThanOrEqual(floor);

        // The hierarchy. A mix that leans far enough towards --fg to be safe
        // in one theme stops being a subtitle and becomes a second heading,
        // and that is the direction this check fails in: the heading is the
        // brighter of the two in dark, so a subtitle that drifted up to it
        // shows as a small step rather than no step. Both inks are flat
        // colours the page already resolved, so the step is computed here
        // rather than inside the pixel walk.
        const lumInk = lum(s.ink[0], s.ink[1], s.ink[2]);
        const lumHeading = lum(s.heading[0], s.heading[1], s.heading[2]);
        const step = Math.abs(lumInk - lumHeading) / Math.max(lumInk, lumHeading);
        expect(
          step,
          `${where} the subtitle's ink rgb(${s.ink}) sits at relative luminance ` +
            `${lumInk.toFixed(4)} against the heading's rgb(${s.heading}) at ${lumHeading.toFixed(4)} — a ${(step * 100).toFixed(1)}% ` +
            `step, inside the ${HIERARCHY_LUMINANCE_STEP * 100}% band the two have to stay apart by. ` +
            `The subtitle reads as a second heading rather than as text under one`
        ).toBeGreaterThanOrEqual(HIERARCHY_LUMINANCE_STEP);

        await ctx.close();
      }
    }
  });

  test('5. the banner box holds the ink band and stays full-bleed', async ({ browser }) => {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await openWelcomeScreen(browser, {
          viewport: { width: vp.width, height: 800 },
          theme
        });
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

  // The one invariant the six above cannot see, because every one of them
  // runs in English: the title's own length is a property of the locale,
  // not of the theme or the width, and the veil's box is
  // max(title, subtitle) + padding, which makes it a property of the
  // subtitle as much as the title. In the narrow-panel window — where
  // both sidebars are in flow and the panel is at its narrowest, 630 px
  // of it at a 1400 px viewport — the longest shipped title does not fit
  // inside 32 px of padding a side, and the veil stops hugging the title:
  // it becomes a band across the whole panel with the title wrapped
  // inside it. Measured before this file's fix, `man` wrapped at 1440 and
  // `fr`, `id` and `man` wrapped at 1400; `man` measures 659.1 px against
  // the 566 px a 630 px panel has to give.
  //
  // Its own test, and its own locale sweep, for three reasons: it is
  // layout rather than paint, so each of its 36 sessions is a login and
  // one evaluate where the pixel test pays seven captures; a failure in
  // it leaves the pixel assertions reporting instead of all six going
  // quiet behind the first red; and the sweep is the point — the same
  // measurement in English is a check on a locale whose title never
  // wraps.
  test('7. the title holds one line in the narrow panel, and the veil is its measure', async ({ browser }) => {
    // 36 sessions, each a login plus a reload, against the describe's
    // 180s budget. This raises the ceiling for this test only.
    test.setTimeout(900000);
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        for (const locale of GEOMETRY_LOCALES) {
          const { ctx, page } = await openWelcomeScreen(browser, {
            viewport: { width: vp.width, height: 800 },
            theme,
            locale,
            // The default pause is set for the mask layer's compositing
            // settle, which a box read does not wait on. What a box read
            // DOES have to outlast is the banner's 650 ms entrance, which
            // scales the box by 0.985 while it runs — so this is a
            // whole second over the animation and nothing else.
            settle: 1000
          });
          const where = `${vp.label}/${theme}/${locale}`;
          const m = await veilGeometry(page);
          expect(m, `${where} the veil's geometry read`).not.toBeNull();

          // (7a) One line. The title's contents occupy one line box, and
          // the heading's box is that line and no more.
          expect(
            m.lineTops,
            `${where} the title occupies ${m.lineTops} line boxes — it measures ` +
              `${m.titleUnwrapped.toFixed(1)}px unwrapped and the veil has ` +
              `${m.available.toFixed(1)}px (a ${m.veilWidth.toFixed(1)}px box less ` +
              `${m.padLeft.toFixed(0)}px of padding a side). It has wrapped, and the veil ` +
              `around it has become a band across the panel`
          ).toBe(1);
          expect(
            Math.abs(m.headingHeight - m.lineHeight),
            `${where} the heading's box is ${m.headingHeight.toFixed(1)}px tall against a ` +
              `${m.lineHeight.toFixed(2)}px line box (${m.fontSize.toFixed(2)}px type) — the ` +
              `title is not on one line`
          ).toBeLessThanOrEqual(1);

          // (7b) The title fits the space, measured unwrapped. Read as
          // rendered this cannot fail: a wrapped title measures its
          // longest line, which by construction fits the box it wrapped
          // into.
          expect(
            m.titleUnwrapped - m.available,
            `${where} the title measures ${m.titleUnwrapped.toFixed(1)}px unwrapped and the ` +
              `veil's content box is ${m.available.toFixed(1)}px — ` +
              `${(m.titleUnwrapped - m.available).toFixed(1)}px wider than it has`
          ).toBeLessThanOrEqual(1);

          // (7c) The veil is the widest text inside it plus the padding it
          // carries on both sides. The same claim assertion 4 makes, run
          // here in the locales where the title is not the widest child.
          const textWidth = Math.max(m.titleWidth, m.subtitleWidth);
          expect(
            Math.abs(m.veilWidth - (textWidth + m.padLeft + m.padRight)),
            `${where} the veil's box is ${m.veilWidth.toFixed(1)}px wide but its widest text ` +
              `(title ${m.titleWidth.toFixed(1)}px, subtitle ${m.subtitleWidth.toFixed(1)}px) ` +
              `plus its ${(m.padLeft + m.padRight).toFixed(0)}px of padding is ` +
              `${(textWidth + m.padLeft + m.padRight).toFixed(1)}px — the veil is wrapped ` +
              `around the banner, not around the text`
          ).toBeLessThanOrEqual(1);

          await ctx.close();
        }
      }
    }
  });

  // The one invariant the seven above cannot see, because every one of them
  // runs with the Living Intelligence layer on — the state the app ships in,
  // and the only one the layer's CSS applies to. The app's own rule is that it
  // lays out identically with the layer switched off, and while the container
  // the app's narrow-panel query runs against was declared by the layer, the
  // layer's presence decided whether that query ran at all: with the layer on
  // it matched and the title held one line, with it off there was no
  // container, the query never fired, and the title went to two lines.
  //
  // The claim is an EQUALITY between two readings of the SAME page — shipped,
  // then the layer switched off — rather than a table of expected numbers, so
  // it cannot drift from whatever the app declares, and a deployment that
  // overrides --space-xl or the scale is checked too. What the layer owns may
  // move between the two: its artwork, its entrance animation, and the
  // banner's full bleed. The heading's typography does NOT — it is the app's
  // own declaration, and 8e holds it to that.
  test("8. the narrow-panel adaptation is the app's own — with the Living Intelligence layer OFF the panel is still a query container and the tokens it steps are unchanged", async ({
    browser
  }) => {
    // 12 sessions a pass (2 viewports x 2 themes x 3 locales), each a login
    // plus a reload. The same shape as test 7's budget, scaled to the third
    // locale: test 7 spends 900s on 36.
    test.setTimeout(420000);
    for (const vp of LAYER_OFF_VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        for (const locale of LAYER_OFF_LOCALES) {
          const { ctx, page } = await openWelcomeScreen(browser, {
            viewport: { width: vp.width, height: 800 },
            theme,
            locale,
            settle: 1000
          });
          const where = `${vp.label}/${theme}/${locale}`;
          // The title's own state in one string, so every message below can
          // name what the difference costs instead of only what it is.
          const as = (g) =>
            `${g.lineTops} line box${g.lineTops === 1 ? '' : 'es'}, a ` +
            `${g.headingHeight.toFixed(1)}px box at ${g.fontSize.toFixed(2)}px type`;

          const shipped = await readVisualLayerState(page);
          expect(shipped.visualOn, `${where} the first reading is not with the layer on`).toBe(true);
          expect(
            shipped.gliOn,
            `${where} the panel is not inside .genie-living-intelligence, so the layer never applied to it`
          ).toBe(true);
          const on = await veilGeometry(page);
          const onOwn = await panelOwnership(page);
          expect(on, `${where} the veil's geometry read with the layer on`).not.toBeNull();
          expect(onOwn, `${where} the panel's ownership read with the layer on`).not.toBeNull();

          // The app's own switch. src/config-loader.js writes exactly this
          // attribute on exactly this node when the runtime config carries no
          // `theme.visual` or an `enabled: false`, so this is the shipped
          // "layer off" state and not a test-only one. There is no control in
          // the UI that produces it any other way.
          await page.evaluate(() => {
            document.documentElement.dataset.visual = 'off';
          });
          const switched = await readVisualLayerState(page);
          expect(switched.visualOn, `${where} the layer did not go off`).toBe(false);

          // No settle pause here: every value below is read through
          // getComputedStyle or getBoundingClientRect, which force the style
          // and layout flush the attribute write invalidated. A pause would
          // only widen the window the banner's 650ms entrance sits in.
          const off = await veilGeometry(page);
          const offOwn = await panelOwnership(page);
          expect(off, `${where} the veil's geometry read with the layer off`).not.toBeNull();
          expect(offOwn, `${where} the panel's ownership read with the layer off`).not.toBeNull();

          // (8a) The query fires with the layer off. The two tokens say it
          // fired; the title's own box says what not firing cost, so the
          // failure reads as the defect and not as a property mismatch.
          expect(
            offOwn.veilPadToken,
            `${where} with the layer OFF --qh-veil-pad resolves to ${offOwn.veilPadToken}, against ` +
              `${onOwn.veilPadToken} with it on: the panel is not a query container, so the app's own ` +
              `narrow-panel query never matched. The veil carries ${offOwn.paddingLeft}px of padding ` +
              `instead of ${onOwn.paddingLeft}px, and the title occupies ${as(off)} instead of ${as(on)}`
          ).toBe(onOwn.veilPadToken);
          expect(
            offOwn.headingScaleToken,
            `${where} with the layer OFF --qh-heading-scale resolves to ${offOwn.headingScaleToken}, against ` +
              `${onOwn.headingScaleToken} with it on, for the reason the message above gives: the title ` +
              `occupies ${as(off)} with the layer off and ${as(on)} with it on`
          ).toBe(onOwn.headingScaleToken);

          // (8b) The container itself, which is what 8a is a consequence of.
          // Asserted as the value the app declares rather than as an equality,
          // because the equality is already 8a's: this is the mechanism, and
          // a layout that reads right by some other route is not what is
          // being claimed.
          expect(
            offOwn.containerType,
            `${where} the panel's own computed container-type reads ` +
              `${offOwn.containerType || '(empty)'} with the layer off and ${onOwn.containerType} with it ` +
              `on — the container the app's narrow-panel query runs against is being declared by the ` +
              `decorative layer, so switching the layer off switches the app's layout off with it`
          ).toBe('inline-size');

          // (8c) The geometry those tokens drive is the same either way. The
          // values are read off the rendered element, not off the tokens, so
          // a token that is resolved but ignored fails here.
          expect(
            Math.abs(offOwn.paddingLeft - onOwn.paddingLeft),
            `${where} the veil's resolved padding is ${offOwn.paddingLeft}px a side with the layer off ` +
              `and ${onOwn.paddingLeft}px with it on`
          ).toBeLessThanOrEqual(0.01);
          expect(
            Math.abs(offOwn.fontSize - onOwn.fontSize),
            `${where} the heading's resolved type is ${offOwn.fontSize}px with the layer off and ` +
              `${onOwn.fontSize}px with it on`
          ).toBeLessThanOrEqual(0.01);

          // (8d) And the consequence, in the locale the app's own panel
          // reaches with the layer off — see ONE_LINE_WITH_LAYER_OFF.
          if (ONE_LINE_WITH_LAYER_OFF.includes(locale)) {
            expect(
              off.lineTops,
              `${where} with the layer OFF the title occupies ${as(off)} — it measures ` +
                `${off.titleUnwrapped.toFixed(1)}px unwrapped and the veil has ` +
                `${off.available.toFixed(1)}px (a ${off.veilWidth.toFixed(1)}px box less ` +
                `${off.padLeft.toFixed(0)}px of padding a side)`
            ).toBe(1);
            expect(
              Math.abs(off.headingHeight - off.lineHeight),
              `${where} with the layer OFF the heading's box is ${off.headingHeight.toFixed(1)}px ` +
                `against a ${off.lineHeight.toFixed(2)}px line box (${off.fontSize.toFixed(2)}px type)`
            ).toBeLessThanOrEqual(1);
          }

          // (8e) The heading's own typography, which the app declares rather
          // than inherits from the layer. Read after the consequence above so
          // a regression is reported as the title that changed width rather
          // than as the property that changed with it: the narrow-panel scale
          // is calibrated against this heading's measured width, so a title
          // that moves when the layer goes off is a title the scale was never
          // measured against, and the fit 8d checks is then a property of the
          // layer rather than of the app.
          expect(
            offOwn.fontFamily,
            `${where} the heading's font-family with the layer off is ${offOwn.fontFamily}, against ` +
              `${onOwn.fontFamily} with it on — the title measures ${on.titleUnwrapped.toFixed(1)}px ` +
              `with the layer on and ${off.titleUnwrapped.toFixed(1)}px with it off`
          ).toBe(onOwn.fontFamily);
          expect(
            offOwn.letterSpacing,
            `${where} the heading's tracking with the layer off is ${offOwn.letterSpacing}, against ` +
              `${onOwn.letterSpacing} with it on — 0.025em of it is 29.4 px off the French title and ` +
              `26.5 px off the Indonesian one at the narrow panel's 22.08 px type, and this title ` +
              `measures ${on.titleUnwrapped.toFixed(1)}px with the layer on against ` +
              `${off.titleUnwrapped.toFixed(1)}px with it off`
          ).toBe(onOwn.letterSpacing);

          // (8f) The price of declaring the container: a layout container is
          // the containing block for fixed-position descendants, so anything
          // fixed inside the panel would be captured by the containment.
          expect(
            offOwn.fixedInOverlay,
            `${where} the panel is a layout container, so it becomes the containing block for ` +
              `fixed-position descendants — ${offOwn.fixedInOverlay} are inside it and would be ` +
              `captured by the containment`
          ).toBe(0);

          await ctx.close();
        }
      }
    }
  });
});
