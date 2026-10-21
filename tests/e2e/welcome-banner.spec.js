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
//   4. the scrim does not fully occlude the artwork. Measured where it
//      bites: the scrim's ramp drives the artwork's ink toward the panel
//      surface, and an OPAQUE scrim drives it all the way — the icon
//      tiles stop dead along a straight line. This reads the darkest
//      pixel of each row inside the scrim's plateau as shipped, and again
//      under an opaque scrim, and requires the two to differ. A scrim that
//      annihilates the ink renders identically either way and fails.
//
//   5. the banner's box holds the artwork's ink band, and the banner stays
//      full-bleed with nothing overflowing the panel.
//
// All five run at 1920 / 1280 / 1024 / 769 in light + dark.
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

// The scrim's rise must span at least this many rows. A hard top edge
// delivers the whole contribution in one or two; the shipped ramp delivers
// it over ~46 px.
const MIN_RAMP_ROWS = 8;

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
      const tail = used.slice(slash + 1).replace(/[)\s]+$/, '').trim();
      usedAlpha = tail.endsWith('%') ? parseFloat(tail) / 100 : parseFloat(tail);
    } else {
      const m = used.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)/);
      if (m) usedAlpha = parseFloat(m[1]);
    }
    return { ok: token !== null, token, raw, used, usedAlpha };
  });
}

// Inside the page: read the wordmark's box, then recover the ink colour at
// every core glyph pixel from three renders of that box.
//
//   A = as rendered        (gradient ink over its real backdrop)
//   B = backdrop alone     (wordmark hidden)
//   H = flat black ink     -> H = (1-c)*B, so c = 1 - H/B is exact
//
// Recovering the ink as I = (A - (1-c)*B)/c removes the anti-aliasing
// dilution that a raw "is this pixel dark?" threshold cannot: an edge pixel
// that is 90 % ink over the backdrop reads as a lightened ink and drags the
// measured contrast below what the text colour actually achieves. Each ink
// pixel is then paired with the backdrop pixel directly behind it, so the
// number reported is the contrast under the glyph and not the worst pixel
// anywhere in the band.
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
  const hB64 = await shot(
    '.brand-wordmark{-webkit-text-fill-color:#000 !important;background-image:none !important;color:#000 !important;}'
  );

  return await page.evaluate(
    async ({ aB64, bB64, hB64 }) => {
      const load = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [imA, imB, imH] = await Promise.all([load(aB64), load(bB64), load(hB64)]);
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
      const H = pixels(imH);

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

      // A pixel only counts as glyph if the black-ink render shows a real
      // share of ink over it. Below the backdrop's own darkest channel the
      // coverage estimate is noise, so those pixels are skipped.
      let core = 0;
      let worst = Infinity;
      let worstInk = null;
      let worstBg = null;
      for (let i = 0; i < A.length; i += 4) {
        const bR = B[i];
        const bG = B[i + 1];
        const bB = B[i + 2];
        const channels = [
          [bR, H[i]],
          [bG, H[i + 1]],
          [bB, H[i + 2]]
        ];
        channels.sort((u, v) => v[0] - u[0]);
        const [brightest, inked] = channels[0];
        if (brightest < 20) continue;
        const coverage = 1 - inked / brightest;
        if (coverage < 0.55) continue;
        core++;
        const ink = [
          Math.min(255, Math.max(0, (A[i] - (1 - coverage) * bR) / coverage)),
          Math.min(255, Math.max(0, (A[i + 1] - (1 - coverage) * bG) / coverage)),
          Math.min(255, Math.max(0, (A[i + 2] - (1 - coverage) * bB) / coverage))
        ];
        const r = ratio(ink, [bR, bG, bB]);
        if (r < worst) {
          worst = r;
          worstInk = ink.map((v) => Math.round(v));
          worstBg = [bR, bG, bB];
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
    { aB64, bB64, hB64 }
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

// Assertion 4: the scrim does not fully occlude the artwork.
//
// The scrim's ramp drives the artwork's ink toward the panel surface. An
// OPAQUE scrim drives it all the way, and the icon tiles — whose ink is at
// its strongest exactly where the scrim begins — stop dead along a straight
// line: measured, the darkest pixel of the band jumps from 0.07 to a pure
// 1.00 across the scrim's top edge, which is a slice, not a fade.
//
// This reads the darkest pixel of every row inside the scrim's plateau twice
// — once as shipped, once with the scrim forced opaque — and requires them to
// differ. A scrim that annihilates the ink renders identically under both and
// fails. A scrim that leaves the artwork readable is the whole point of the
// layer, so the check is that the artwork survives.
async function scrimDoesNotOcclude(page) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('.quick-help-banner');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  if (!box) return { ok: false, why: 'no banner box' };

  const HIDE_TEXT = '.quick-help-heading,.quick-help-subtitle{visibility:hidden !important;}';
  const shot = async (css) => {
    const tag = await page.addStyleTag({ content: HIDE_TEXT + css });
    const buf = await page.screenshot({ clip: box, type: 'png' });
    await tag.evaluate((n) => n.remove());
    return buf.toString('base64');
  };
  // The scrim's plateau is the lower part of its own box, past the ramp.
  const geo = await page.evaluate(() => {
    const c = document.querySelector('.quick-help-content').getBoundingClientRect();
    const surface = getComputedStyle(document.documentElement)
      .getPropertyValue('--surface')
      .trim();
    // Resolve the surface to an sRGB triplet the same way a paint would:
    // fill a 1x1 canvas with it and read the byte back.
    const cv = document.createElement('canvas');
    cv.width = 1;
    cv.height = 1;
    const g2 = cv.getContext('2d');
    g2.fillStyle = surface;
    g2.fillRect(0, 0, 1, 1);
    const p = g2.getImageData(0, 0, 1, 1).data;
    return { plateauFrom: +(c.y + c.height * 0.5).toFixed(1), panel: [p[0], p[1], p[2]] };
  });
  const shipped = await shot('');
  const opaque = await shot('.quick-help-content{background:var(--surface) !important;}');

  return await page.evaluate(
    async ({ shipped, opaque, geo }) => {
      const load = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [imS, imO] = await Promise.all([load(shipped), load(opaque)]);
      const lum = (r, g, b) => {
        const toLin = (v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
      };
      // How far the artwork departs from the panel, per row. Which
      // direction it departs depends on the theme — the ink is darker than
      // a light panel and lighter than a dark one — so the statistic is
      // the pixel FURTHEST from the panel's own luminance, which reads the
      // artwork in both.
      const panelLum = lum(geo.panel[0], geo.panel[1], geo.panel[2]);
      const departure = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const D = ctx.getImageData(0, 0, c.width, c.height).data;
        const W = img.width;
        const H = img.height;
        const out = [];
        for (let y = 0; y < H; y++) {
          let best = 0;
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const l = lum(D[i], D[i + 1], D[i + 2]);
            const d = Math.abs(l - panelLum);
            if (d > best) best = d;
          }
          out.push(best);
        }
        return out;
      };
      const S = departure(imS);
      const O = departure(imO);
      const from = Math.max(0, Math.floor(geo.plateauFrom));
      let maxGap = 0;
      let at = -1;
      for (let y = from; y < S.length; y++) {
        const gap = Math.abs(S[y] - O[y]);
        if (gap > maxGap) {
          maxGap = gap;
          at = y;
        }
      }
      return {
        ok: true,
        rows: S.length - from,
        maxGap: Number(maxGap.toFixed(4)),
        atRow: at,
        shippedDeparture: at >= 0 ? Number(S[at].toFixed(4)) : null,
        opaqueDeparture: at >= 0 ? Number(O[at].toFixed(4)) : null,
        panelLum: Number(panelLum.toFixed(4))
      };
    },
    { shipped, opaque, geo }
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

test.describe('Welcome banner invariants', () => {
  test('1. the scrim alpha is at or above its theme floor and is the alpha it paints with', async ({
    browser
  }) => {
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
          `${vp.label}/${theme} the token is ${a.raw} but the scrim paints ${a.used} — ` +
            `the background is not reading the alpha it declares`
        ).toBeCloseTo(a.token, 2);
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
        expect(c.core, `${vp.label}/${theme} no core wordmark pixels found`).toBeGreaterThan(0);
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

  test('4. the scrim leaves the artwork readable instead of occluding it', async ({ browser }) => {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await freshSignedIn(browser, vp, theme);
        const o = await scrimDoesNotOcclude(page);
        expect(o.ok, `${vp.label}/${theme} occlusion measured (${o.why || 'ok'})`).toBe(true);
        expect(
          o.maxGap,
          `${vp.label}/${theme} the scrim renders the icon tiles identically to an opaque ` +
            `scrim (darkest pixel ${o.shippedDarkest} either way) across ${o.rows} rows — ` +
            `the artwork is being annihilated at the scrim's edge, not faded`
        ).toBeGreaterThan(0);
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
        expect(
          Math.abs(m.leftBleed),
          `${vp.label}/${theme} left bleed ${m.leftBleed}px`
        ).toBeCloseTo(Math.abs(m.rightBleed), 1);
        expect(
          m.overflow,
          `${vp.label}/${theme} the panel overflows the viewport by ${m.overflow}px`
        ).toBeLessThanOrEqual(0);
        await ctx.close();
      }
    }
  });
});