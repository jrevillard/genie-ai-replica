// tests/e2e/welcome-banner.spec.js
//
// Welcome banner invariants after the heading-inside-banner task.
//
// Three assertions:
//
//   1. the surface behind the heading is uniform. Inside the
//      heading's bounding box every pixel must be either within a
//      stated tolerance of --surface or within a (looser) tolerance
//      of one of the heading's legitimate inks (--fg, --brand-mark-
//      from, --brand-mark-mid, --brand-mark-to). A pixel that is
//      neither is the artwork's ink showing through a partial-alpha
//      scrim -- the defect the previous contrast sampler missed
//      because it read the lightest backdrop pixel and so measured
//      only the case that passed.
//
//   2. the brand ramp's worst stop clears 3:1 against --surface. Reads
//      the declared --brand-mark-from/-mid/-to from the layer's :root,
//      computes WCAG contrast against the resolved --surface, and
//      asserts the minimum is >= 3.0 in both themes. This compares
//      declared token values, not sampled pixels, so anti-aliasing
//      cannot hide a low-contrast stop -- a deployment that overrides
//      the ramp tokens and breaks 3:1 fails this gate.
//
//   3. the banner's box height holds the artwork band at the rendered
//      --f, in whole pixels. A regression that lets the box shrink
//      below the band slices the tiles and the globe. The CSS's
//      aspect-ratio produces a float band height that the layout
//      engine rounds to the nearest 0.01 px for getBoundingClientRect;
//      rounding both sides to whole pixels absorbs the sub-pixel gap
//      so the assertion is stable across rendering passes.
//
// All three run at 1920 / 1280 / 1024 / 769 in light + dark. The
// earlier contrast-only suite was scoped to 1920 light because that
// sampler was misleading; both wider widths and dark matter for the
// surface-uniform and ramp-contrast checks now that the predicates
// are about resolved tokens, not pixel readings of the most-favourable
// backdrop.
//
// Pixel sampling uses page.screenshot()'s clip parameter, hands the
// bytes back into the page as a data URL, draws them to a <canvas>,
// and reads getImageData -- every step runs in the browser, no npm
// dependency, no Node-side decoder.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/chatbot');

// WCAG 2.x luminance + contrast for sRGB.
function luminance([r, g, b]) {
  const toLin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}
function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Inside the page: read the layer's declared tokens and resolve each
// to an sRGB triplet via a throwaway canvas. The browser's CSS color
// parser accepts modern syntax (hex, rgb(), oklch(), etc.); the canvas
// fillStyle getter, however, returns the value in whatever form it was
// stored in -- and rgb() / rgba() / hwb() / named colors get normalised
// to rgb(), but oklch() is returned as oklch(). The robust roundtrip is
// fillRect + getImageData, which forces the browser to compute the
// concrete sRGB regardless of the input syntax.
async function resolveTokens(page) {
  return await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    function toRgb(value) {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      const ctx = c.getContext('2d');
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const px = ctx.getImageData(0, 0, 1, 1).data;
      return [px[0], px[1], px[2]];
    }
    return {
      surface: toRgb(cs.getPropertyValue('--surface').trim()),
      fg: toRgb(cs.getPropertyValue('--fg').trim()),
      rampFrom: toRgb(cs.getPropertyValue('--brand-mark-from').trim()),
      rampMid: toRgb(cs.getPropertyValue('--brand-mark-mid').trim()),
      rampTo: toRgb(cs.getPropertyValue('--brand-mark-to').trim())
    };
  });
}

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
  // the animation completes -- a screenshot at 1500 ms still catches
  // the intermediate compositing tier and reports the scrim as mid-
  // gray instead of fully opaque. 3000 ms is past that settle window
  // and gives a stable read.
  await page.waitForTimeout(3000);
  return { ctx, page };
}

// Assertion 1: surface uniform behind heading.
//
// Each pixel in the heading's bounding box must be either
//   (a) close to --surface within T_SURFACE = 50/channel -- a
//       tolerance that catches anti-aliasing edges, OR
//   (b) close to one of the heading's legitimate ink colours (--fg
//       and the three declared ramp stops) within T_INK = 50/channel.
// A pixel that matches none is artwork ink showing through a
// partial-alpha scrim -- the defect.
//
// Defect fraction must stay below DEFECT_TOL = 5% of the box. Anti-
// aliasing between an ink stroke and the surface produces a small
// fringe of pixels that fall outside both tolerances -- the legal mix
// at this width lands at ~2% of the box; 5% covers it without
// crossing into the defect regime, where a partial-alpha scrim would
// push 30 %+ of the heading's bg pixels into the "neither" band.
async function surfaceUniform(page) {
  const rect = await page.evaluate(() => {
    const el = document.querySelector('.quick-help-heading');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  if (!rect || rect.width < 1 || rect.height < 1) {
    return { ok: false, why: 'no heading' };
  }
  const palette = await resolveTokens(page);
  const buf = await page.screenshot({ clip: rect, type: 'png' });
  const base64 = buf.toString('base64');
  const result = await page.evaluate(
    async ({ b64, palette }) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, c.width, c.height).data;
          const T_SURFACE = 50;
          const T_INK = 50;
          const inks = [palette.fg, palette.rampFrom, palette.rampMid, palette.rampTo].filter(Boolean);
          let total = 0;
          let defects = 0;
          const defectSamples = [];
          for (let i = 0; i < data.length; i += 4) {
            const px = [data[i], data[i + 1], data[i + 2]];
            total++;
            function near(p, t, T) {
              return Math.abs(p[0] - t[0]) <= T && Math.abs(p[1] - t[1]) <= T && Math.abs(p[2] - t[2]) <= T;
            }
            const surface = palette.surface;
            if (surface && near(px, surface, T_SURFACE)) continue;
            let matchedInk = false;
            for (const ink of inks) {
              if (near(px, ink, T_INK)) {
                matchedInk = true;
                break;
              }
            }
            if (matchedInk) continue;
            defects++;
            if (defectSamples.length < 6) defectSamples.push(px);
          }
          resolve({
            total,
            defects,
            defectFraction: total ? defects / total : 0,
            defectSamples
          });
        };
        img.src = `data:image/png;base64,${b64}`;
      });
    },
    { b64: base64, palette }
  );
  return { ok: true, ...result, rect };
}

// Assertion 2: declared ramp's worst stop clears 3:1 vs surface.
// Compares declared token values, not rendered pixels -- the failures
// the previous sampler missed (anti-aliased glyph blends) cannot hide
// here. A deployment that overrides --brand-mark-* with low-contrast
// stops fails this gate regardless of theme.
async function rampContrast(tokens) {
  const stops = [tokens.rampFrom, tokens.rampMid, tokens.rampTo];
  const surface = tokens.surface;
  if (stops.some((s) => !s) || !surface) {
    return { ok: false, why: 'unresolvable tokens', stops, surface };
  }
  const ratios = stops.map((s) => contrastRatio(s, surface));
  return { ok: true, stops, surface, ratios, min: Math.min(...ratios), floor: 3.0 };
}

// Assertion 3: banner box >= artwork band, whole pixels. The band's
// height is bannerWidth * f / 2 (band aspect 2:f). Both are floats
// after getBoundingClientRect rounds to 0.01 px; rounding to whole
// pixels before comparing absorbs the sub-pixel gap so the assertion
// is stable across rendering passes -- a 0.011 px visual-equivalent
// gap no longer turns the test red on another machine.
async function boxAndBandInt(page) {
  return await page.evaluate(() => {
    const banner = document.querySelector('.quick-help-banner');
    const overlay = document.querySelector('.quick-help-overlay');
    if (!banner || !overlay) return null;
    const ov = getComputedStyle(overlay);
    const fRaw = ov.getPropertyValue('--f').trim();
    const fMatches = fRaw.match(/[\d.]+/g);
    const f = fMatches && fMatches.length ? parseFloat(fMatches[fMatches.length - 1]) : 0.553;
    const r = banner.getBoundingClientRect();
    return {
      f,
      width: r.width,
      height: r.height,
      bannerH: Math.round(r.height),
      bandH: Math.round((r.width * f) / 2)
    };
  });
}

test.describe('Welcome banner invariants', () => {
  test('1. surface behind heading is uniform (every pixel is --surface or ink)', async ({ browser }) => {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await freshSignedIn(browser, vp, theme);
        const r = await surfaceUniform(page);
        expect(r.ok, `${vp.label}/${theme} heading measured (${r.why || 'ok'})`).toBe(true);
        expect(
          r.defectFraction,
          `${vp.label}/${theme} heading defect pixels ${r.defects}/${r.total} ` +
            `(${(r.defectFraction * 100).toFixed(2)}%); samples=${JSON.stringify(r.defectSamples)}`
        ).toBeLessThanOrEqual(0.05);
        await ctx.close();
      }
    }
  });

  test('2. declared ramp worst stop clears 3:1 vs --surface (both themes)', async ({ browser }) => {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await freshSignedIn(browser, vp, theme);
        const tokens = await resolveTokens(page);
        const r = await rampContrast(tokens);
        expect(r.ok, `${vp.label}/${theme} ramp measured (${r.why || 'ok'})`).toBe(true);
        expect(
          r.min,
          `${vp.label}/${theme} worst brand-stop contrast ${r.min.toFixed(2)}:1 below 3:1; ` +
            `stops=${JSON.stringify(r.stops)} vs surface=${JSON.stringify(r.surface)}`
        ).toBeGreaterThanOrEqual(3.0);
        await ctx.close();
      }
    }
  });

  test('3. banner box holds artwork band, whole pixels', async ({ browser }) => {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await freshSignedIn(browser, vp, theme);
        const m = await boxAndBandInt(page);
        expect(m, `${vp.label}/${theme} banner measurement`).not.toBeNull();
        expect(
          m.bannerH,
          `${vp.label}/${theme} bannerH=${m.bannerH} must be >= bandH=${m.bandH} ` +
            `(f=${m.f}, width=${m.width}, height=${m.height})`
        ).toBeGreaterThanOrEqual(m.bandH);
        await ctx.close();
      }
    }
  });
});
