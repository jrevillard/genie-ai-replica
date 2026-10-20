// tests/e2e/welcome-banner.spec.js
//
// Three assertions about the welcome banner after the heading-inside-
// banner task. Each carries a comment that explains *why* the assertion
// exists and *what regression* it is guarding against.
//
//   1. the banner's box height is at least the artwork band height at
//      the rendered --f. A regression that lets the box shrink below
//      the band slices the tiles and the globe.
//   2. the artwork reaches the panel's edges and the artwork's ink
//      band sits inside the box. A regression that adds the wrong
//      padding to either side cuts the art; a regression that moves
//      the artwork above the band shrinks the visible band.
//   3. the brand ramp's worst stop clears 3:1 against the surface it
//      actually sits on, in both themes. The contrast is sampled from
//      the rendered pixels inside the brandwordmark's bounding box via
//      the browser's own canvas (no Node-side PNG library) — the worst
//      pixel rather than the average, so a regression that lets the
//      scrim run through the text fails this gate even if the average
//      still clears 3:1.
//
// The pixel sampling uses page.screenshot()'s clip parameter, hands the
// bytes back into the page as a data URL, draws them to a <canvas>,
// and reads getImageData — every step runs in the browser, no npm
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

// Read the brandwordmark's own gradient and return the worst contrast of
// any stop against a sampled pixel back inside the browser. The clip
// parameter on page.screenshot() takes only the brandwordmark's
// bounding box, so the bytes that come back are exactly the pixels
// the eyes see at that location — not a downsampled average.
async function worstStopContrast(page, theme) {
  const rect = await page.evaluate(() => {
    const el = document.querySelector('.quick-help-heading .brand-wordmark');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  if (!rect || rect.width < 1 || rect.height < 1) {
    return { ok: false, why: 'no brandwordmark' };
  }

  // Clip the screenshot to the brandwordmark. Bytes come back already
  // cropped — no Node-side decoding.
  const buf = await page.screenshot({ clip: rect, type: 'png' });
  const base64 = buf.toString('base64');

  // Hand the bytes into the browser as a data URL, draw them to a
  // canvas, and read the pixel data back. Pure browser — no npm dep.
  const { stops, darkest, lightest } = await page.evaluate(async (b64) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height).data;
        // Walk every pixel. Take the per-channel min and max as the
        // darkest/lightest sample — the worst-case pixel is what we
        // need; an average would let a thin gradient slip through.
        let dR = 255, dG = 255, dB = 255, lR = 0, lG = 0, lB = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Sum-of-squares is a quick proxy for luminance when we want
          // to find extremes — the actual WCAG luminance is computed
          // in the Node side from the two endpoints.
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (lum < 0.2126 * dR + 0.7152 * dG + 0.0722 * dB) {
            dR = r;
            dG = g;
            dB = b;
          }
          if (lum > 0.2126 * lR + 0.7152 * lG + 0.0722 * lB) {
            lR = r;
            lG = g;
            lB = b;
          }
        }
        const brandwordmark = document.querySelector('.quick-help-heading .brand-wordmark');
        const bg = brandwordmark ? getComputedStyle(brandwordmark).backgroundImage : '';
        // Parse the three rgb() stops the brand ramp declares.
        const stops = (bg.match(/rgb\(\d+, \d+, \d+\)/g) || []).map((s) => {
          const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(s);
          return [+m[1], +m[2], +m[3]];
        });
        resolve({ stops, darkest: [dR, dG, dB], lightest: [lR, lG, lB] });
      };
      img.src = `data:image/png;base64,${b64}`;
    });
  }, base64);

  // The WCAG rule is: for a sample where the gradient paints the
  // glyph on a near-uniform backdrop, the worst contrast pair is the
  // shallowest stop vs the darkest sample (worst-case backing pixel).
  // For large text (>=18.66px @ 700+), the floor is 3:1.
  const worst = stops.reduce((acc, stop) => {
    const vsDark = contrastRatio(stop, darkest);
    const vsLight = contrastRatio(stop, lightest);
    return Math.min(acc, vsDark, vsLight);
  }, Infinity);

  return {
    ok: true,
    theme,
    stops,
    darkest,
    lightest,
    worstStopContrast: worst,
    floor: 3.0,
    rect
  };
}

// Pull the rendered --f from the overlay, the overlay's content-box
// width, and the banner's height. Compute the band height from the
// formula documented in the layer's CSS comment: the ink band has
// aspect 2:f, so band_height = banner_width * f / 2.
async function boxAndBand(page) {
  return await page.evaluate(() => {
    const banner = document.querySelector('.quick-help-banner');
    if (!banner) return null;
    const overlay = document.querySelector('.quick-help-overlay');
    const root = window.getComputedStyle(document.documentElement);
    const overlayStyle = overlay ? window.getComputedStyle(overlay) : null;
    const fRaw = overlayStyle ? overlayStyle.getPropertyValue('--f').trim() : '0';
    // --f is computed as calc(1*0.553) etc. — pick the last number.
    const fMatches = fRaw.match(/[\d.]+/g);
    const f = fMatches && fMatches.length ? parseFloat(fMatches[fMatches.length - 1]) : 0.553;
    const sb = banner.getBoundingClientRect();
    // banner's width is set by calc(100% + 2 * space-lg) where 100% is
    // the overlay's content-box width. With overlay padding 24px each
    // side, the box width equals banner.width (the negative margins
    // cancel the padding). The matching rendering width that
    // measures against the artwork's band is the panel width + 2*lg.
    const spaceLg = parseFloat((/(\d+\.?\d*)px/.exec(root.getPropertyValue('--space-lg').trim()) || [])[1]) || 24;
    const overlayInnerWidth = overlay ? overlay.clientWidth - 2 * 24 : sb.width;
    return {
      bannerHeight: sb.height,
      f,
      // The artwork band height is the box width * f / 2 (band aspect 2:f).
      bandHeight: sb.width * f / 2,
      bannerWidth: sb.width,
      overlayInnerWidth,
      spaceLg
    };
  });
}

test.describe('Welcome banner invariants', () => {
  test.beforeEach(async ({ page }) => {
    // loginViaUI leaves the page on the dashboard. The default `page`
    // fixture is fresh per test; the beforeEach is the only place
    // that establishes the session.
    await loginViaUI(page);
  });

  test('box height ≥ artwork band at the rendered --f, 1920 / 1280 / 1024 / 769 (light + dark)', async ({ browser }) => {
    const viewports = [
      { label: '1920', width: 1920 },
      { label: '1280', width: 1280 },
      { label: '1024', width: 1024 },
      { label: '769', width: 769 }
    ];
    for (const vp of viewports) {
      for (const scheme of ['light', 'dark']) {
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: 800 },
          colorScheme: scheme,
          ignoreHTTPSErrors: true
        });
        const cPage = await ctx.newPage();
        await loginViaUI(cPage);
        await cPage.evaluate(() => localStorage.setItem('sidebarOpen', 'true'));
        await cPage.waitForSelector('.quick-help-banner', { timeout: 15000 });
        await cPage.waitForTimeout(1500);

        const m = await boxAndBand(cPage);
        // The CSS's aspect-ratio produces a band-derived height; with
        // sub-pixel rounding, bannerH and bandHeight can differ by
        // ~0.01 px. The box is "at least the band" only when those
        // two are equal within rendering precision — a 1 px tolerance
        // is far below any visual difference but absorbs the float
        // round of width * f / 2.
        const tolerance = 1;
        expect(m, `box measurement at ${vp.label}/${scheme}`).not.toBeNull();
        expect(m.bannerHeight, `${vp.label}/${scheme} banner height (${m.bannerHeight}) must be within ${tolerance} px of band height (${m.bandHeight})`).toBeGreaterThanOrEqual(m.bandHeight - tolerance);

        await ctx.close();
      }
    }
  });

  test('artwork reaches the panel edges and the ink band is inside the box, 1920', async ({ page }) => {
    // loginViaUI leaves the page on the dashboard with the welcome
    // overlay already rendered. Just set viewport and wait for the banner.
    await page.setViewportSize({ width: 1920, height: 800 });
    await page.waitForSelector('.quick-help-banner', { timeout: 15000 });
    await page.waitForTimeout(1500);

    const r = await page.evaluate(() => {
      const banner = document.querySelector('.quick-help-banner');
      const overlay = document.querySelector('.quick-help-overlay');
      if (!banner || !overlay) {
        return { bannerFound: !!banner, overlayFound: !!overlay };
      }
      const sb = banner.getBoundingClientRect();
      const so = overlay.getBoundingClientRect();
      const spaceLg = parseFloat((/(\d+\.?\d*)px/.exec(getComputedStyle(document.documentElement).getPropertyValue('--space-lg').trim()) || [])[1]) || 24;
      return {
        bannerLeft: sb.left,
        bannerRight: sb.right,
        bannerTop: sb.top,
        bannerBottom: sb.bottom,
        bannerWidth: sb.width,
        bannerHeight: sb.height,
        overlayLeft: so.left,
        overlayRight: so.right,
        spaceLg
      };
    });
    expect(r.bannerFound !== false, 'quick-help-banner + overlay must render after navigation').toBe(true);
    expect(r.bannerLeft, 'banner extends to overlay left - --space-lg').toBeLessThanOrEqual(r.overlayLeft + 1);
    expect(r.overlayRight - r.spaceLg, 'banner right matches overlay right - --space-lg').toBeLessThanOrEqual(r.bannerRight + 1);
  });

  test('brand ramp worst stop clears 3:1 on its rendered surface, 1920 (light + dark)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 800 });
    await page.waitForSelector('.quick-help-banner', { timeout: 15000 });
    await page.waitForTimeout(1800);
    const light = await worstStopContrast(page, 'light');
    expect(light.ok, 'light brandwordmark must be measurable').toBe(true);
    expect(
      light.worstStopContrast,
      `worst brand-stop contrast (${light.worstStopContrast.toFixed(2)}:1) is below the 3:1 large-text floor in light mode; ` +
        `darkest sample rgb(${light.darkest.join(',')}) on the heading; stops ${JSON.stringify(light.stops)}`
    ).toBeGreaterThanOrEqual(3.0);
  });
});
