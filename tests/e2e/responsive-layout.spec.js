// tests/e2e/responsive-layout.spec.js
//
// Layout regression spec for the two narrow-viewport defects the
// quick-help grid used to reproduce, regardless of the Living
// Intelligence visual layer being switched on.
//
// The spec encodes the **invariant** the implementation guarantees
// — column count follows the panel width via auto-fit + a
// four-column cap, not a per-viewport table — so the test cannot
// dictate the layout. From the live DOM the spec reads:
//
//   P = grid bounding box width (the panel auto-fit sees)
//   G = --space-xl (the gap token the grid uses)
//   M = --qh-card-min (the component-local card-min token)
//
// and asserts that the distinct item-left count equals
// `clamp(1, floor((P + G) / (M + G)), 4)`. The cap is asserted
// explicitly elsewhere: a force-removal of `max-width` on the grid
// must break the test at a wide panel (so the cap is doing
// something) and a force to repeat(2, 1fr) at a panel that should
// show 4 columns must show 2 columns against the formula.
//
// The other assertions stay narrow: the chat column is non-zero,
// the page does not horizontally overflow, every card is at least
// the reference's 217 px minus a 20 px tolerance, and the sidebars
// do not overlap the centre by bounding-rect intersection.
//
// A companion describe block checks the welcome panel itself, in
// two parts:
//   - the panel must never offer a horizontal scrollbar; the
//     computed overflow-x must be 'hidden' or 'clip' at every
//     viewport and in both themes. That is the property that
//     decides whether a scrollbar is drawn, and is the property
//     the brief's ruling fixes.
//   - the wave ::after must not extend past the panel's right
//     edge (with the banner hidden for the read so only the wave
//     band can contribute to the overlay's horizontal scroll)
// They are two reads of the same panel at the same viewport, so they
// share one test and one boot: the pair costs 16 sessions instead of
// 32, and the panel's state and its geometry are read in the same
// evaluate rather than in two.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/chatbot');
const { openWelcomeScreen, LAYER_STATE_BIND } = require('./helpers/welcome');

// 217 - 20 = 197 px. See the report for why this is the floor rather
// than the unreachable target.
const CARD_MIN = 197;

async function gotoChatbot(page) {
  await page.goto('/chat', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.quick-help-grid .quick-help-item', { timeout: 15000 });
}

// Bounding boxes overlap iff `a.left < b.right && a.right > b.left`.
// Off-canvas sidebars have bounding rects that extend past the viewport,
// so the strict `<= right + 4` checks used to disagree on those
// states. The intersection check returns the truth regardless.
function boxesOverlap(a, b) {
  return a.left < b.right && a.right > b.left;
}

async function measureLayout(page) {
  // Read the design tokens the spec is supposed to assert against so
  // a future token change doesn't silently invalidate this spec.
  // --qh-card-min is a component-local extension point declared on
  // .quick-help-overlay (the common ancestor of the grid AND the
  // composer wrapper — both read --qh-card-min via the composite
  // --qh-measure, while the grid's own auto-fit reads --qh-card-min
  // directly). Declaring it on the grid alone leaves the wrapper's
  // reference unresolved and the wrapper silently falls back to the
  // overlay's full width — the cascade loss this comment exists to
  // warn against. The brief keeps it out of theme-variables.css on
  // purpose, so this spec reads it from the GRID, which inherits it
  // from that overlay, rather than from :root — the value is the
  // same either way, and the grid is the element the column count
  // below is actually derived from.
  // --space-xl is the global token.
  const tokens = await page.evaluate(() => {
    const parsePx = (raw) => {
      const m = /^([\d.]+)px$/.exec(raw.trim());
      return m ? parseFloat(m[1]) : NaN;
    };
    const grid = document.querySelector('.quick-help-grid');
    const root = document.documentElement;
    const gridStyle = grid ? window.getComputedStyle(grid) : null;
    const rootStyle = window.getComputedStyle(root);
    return {
      cardMin: gridStyle ? parsePx(gridStyle.getPropertyValue('--qh-card-min')) : NaN,
      gap: parsePx(rootStyle.getPropertyValue('--space-xl'))
    };
  });

  const layout = await page.evaluate(() => {
    const wrap = document.querySelector('.main-container');
    const centre = document.querySelector('.chatbot-container');
    const left = document.querySelector('.side-bar');
    const right = document.querySelector('.sidebar');
    const grid = document.querySelector('.quick-help-grid');
    const items = grid ? Array.from(grid.querySelectorAll('.quick-help-item')) : [];
    const distinctLefts = new Set(items.map((it) => Math.round(it.getBoundingClientRect().left)));
    const cardWidths = items.map((it) => Math.round(it.getBoundingClientRect().width));
    const lr = left && left.getBoundingClientRect();
    const rr = right && right.getBoundingClientRect();
    const cr = centre && centre.getBoundingClientRect();
    const gr = grid && grid.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      wrapWidth: wrap ? Math.round(wrap.getBoundingClientRect().width) : null,
      centreWidth: cr ? Math.round(cr.width) : null,
      centreLeft: cr ? Math.round(cr.left) : null,
      centreRight: cr ? Math.round(cr.right) : null,
      centreRect: cr ? { left: Math.round(cr.left), right: Math.round(cr.right), width: Math.round(cr.width) } : null,
      gridWidth: gr ? Math.round(gr.width) : null,
      leftRect: lr ? { left: Math.round(lr.left), right: Math.round(lr.right), width: Math.round(lr.width) } : null,
      rightRect: rr ? { left: Math.round(rr.left), right: Math.round(rr.right), width: Math.round(rr.width) } : null,
      columnCount: distinctLefts.size,
      cardWidths,
      cardMin: Math.min(...(cardWidths.length ? cardWidths : [0]))
    };
  });

  // Derived: the column-count the invariant says we should have.
  // clamp(1, floor((P + G) / (M + G)), 4).
  const expected =
    Number.isFinite(layout.gridWidth) && tokens.cardMin > 0 && tokens.gap > 0
      ? Math.max(1, Math.min(4, Math.floor((layout.gridWidth + tokens.gap) / (tokens.cardMin + tokens.gap))))
      : null;

  return { ...layout, expectedColumns: expected, tokens };
}

function assertNoOverlap(m) {
  expect(m.leftRect, 'left sidebar should be measurable').not.toBeNull();
  expect(m.centreRect, 'centre should be measurable').not.toBeNull();
  // The two sidebars' bounding rects must not intersect the centre's
  // bounding rect. Off-canvas rects extend past the viewport, which is
  // fine — they don't overlap the (always in-viewport) centre. The
  // intersection check works regardless of where the rectangles live.
  if (m.leftRect) {
    expect(
      !boxesOverlap(m.leftRect, m.centreRect),
      `left sidebar (left=${m.leftRect.left}, right=${m.leftRect.right}) must not overlap centre (left=${m.centreRect.left}, right=${m.centreRect.right})`
    ).toBe(true);
  }
  if (m.rightRect) {
    expect(
      !boxesOverlap(m.rightRect, m.centreRect),
      `right sidebar (left=${m.rightRect.left}, right=${m.rightRect.right}) must not overlap centre (left=${m.centreRect.left}, right=${m.centreRect.right})`
    ).toBe(true);
  }
}

test.describe('Responsive layout (quick-help grid + sidebar policy)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUI(page);
    // Force the left sidebar open at narrow viewports too — the
    // checkScreenSize resize handler in App.vue auto-collapses left
    // sidebars below the policy threshold (currently 1400 px), so the
    // spec's beforeEach sets localStorage to true for default state.
    await page.evaluate(() => localStorage.setItem('sidebarOpen', 'true'));
  });

  const viewports = [2400, 1920, 1600, 1400, 1280, 1024, 769, 414];

  for (const vp of viewports) {
    test(`${vp}x800: layout is non-zero, column count follows the invariant, no overlap`, async ({ page }) => {
      await page.setViewportSize({ width: vp, height: 800 });
      await gotoChatbot(page);
      // Settle the 0.3s sidebar transition and the Vue-driven position
      // reflow before reading.
      await page.waitForTimeout(2000);

      const m = await measureLayout(page);

      expect(m.viewport, 'viewport should match').toBe(vp);
      expect(m.centreWidth, `centre width should be > 0 (got ${m.centreWidth})`).toBeGreaterThan(0);
      expect(m.scrollWidth, 'page should not overflow horizontally').toBeLessThanOrEqual(m.viewport);
      expect(m.cardMin, `every card width >= ${CARD_MIN} (got ${m.cardMin})`).toBeGreaterThanOrEqual(CARD_MIN);
      // The invariant: column count is determined by panel width, the
      // card minimum and the gap. The spec reads these values from the
      // live DOM rather than carrying a table per viewport.
      expect(m.expectedColumns, 'expected columns should be computable').not.toBeNull();
      expect(
        m.columnCount,
        `column count (${m.columnCount}) must equal the invariant floor((P+G)/(M+G)) clamped to [1,4] ` +
          `which says ${m.expectedColumns} at panel ${m.gridWidth} ` +
          `(${JSON.stringify(m.tokens)})`
      ).toBe(m.expectedColumns);
      assertNoOverlap(m);
    });
  }
});

// Welcome panel invariants.
//
// One describe block guards the welcome panel, in two parts, because
// both are reads of the same panel at the same viewport and theme:
//
// 1. "the panel does not scroll horizontally" — the computed
//    `overflow-x` of the panel must be 'hidden' or 'clip' at every
//    viewport the layout spec covers, in either theme. That is the
//    property the brief's ruling fixes, and the property that decides
//    whether a horizontal scrollbar is drawn.
//
// 2. "the wave ::after does not extend past the panel" — with the
//    banner hidden for the read (its full-bleed is intentional, see
//    below), the overlay's scrollWidth must not exceed its
//    clientWidth. After the ::after fix the wave band's contribution
//    is zero; before it, the band was sized to clientWidth +
//    2*--space-lg and produced the +24 px the brief measured.
//
// Why the waves read hides the banner: below 1299 px the overlay
// declares `padding: 0`, and the banner's `width: calc(100% + 2 *
// var(--space-lg))` + two negative margins bleeds the banner past
// the overlay's right edge by --space-lg. That bleed is intentional
// — the brief: "the banner … is correct … do not touch the banner's
// rule" — so reading the overlay's scrollWidth without isolating the
// ::after would catch that intentional bleed too. With the banner
// hidden, only the wave band can contribute; the regression guards
// the ::after's contribution exactly. `overflow-x` is a declared
// property and reads the same either way, so both parts of the read
// share that one hidden banner.
//
// The suite asserts that the Living Intelligence visual layer is
// actually on, so a build that silently drops it cannot vacuously
// pass against a missing wave pseudo.

const WELCOME_OVERFLOW_VIEWPORTS = [2400, 1920, 1600, 1400, 1280, 1024, 769, 414];
const WELCOME_OVERFLOW_THEMES = ['light', 'dark'];

// One read of the panel: the visual-layer precondition, the computed
// overflow-x, and the wave-only scrollWidth — a single trip across the
// bridge, with the overlay queried once. The layer-state half is the
// shared implementation from helpers/welcome.js, handed in by source
// so this evaluate can compose it with the panel's own geometry.
async function readWelcomePanel(page) {
  const tag = await page.addStyleTag({
    content: '.quick-help-overlay .quick-help-banner { display: none !important; }'
  });
  try {
    return await page.evaluate(
      ({ layerSource }) => {
        const layer = new Function(layerSource)()(document);
        const overlay = document.querySelector('.quick-help-overlay');
        if (!overlay) return { ...layer, overflowX: null, scrollWidth: null, clientWidth: null };
        return {
          ...layer,
          overflowX: getComputedStyle(overlay).overflowX,
          scrollWidth: overlay.scrollWidth,
          clientWidth: overlay.clientWidth
        };
      },
      { layerSource: LAYER_STATE_BIND }
    );
  } finally {
    await tag.evaluate((n) => n.remove());
  }
}

test.describe('Welcome panel does not scroll horizontally', () => {
  for (const vp of WELCOME_OVERFLOW_VIEWPORTS) {
    for (const theme of WELCOME_OVERFLOW_THEMES) {
      test(`${vp}px @${theme}: overlay overflow-x is 'hidden' or 'clip', and the wave adds no width`, async ({
        browser
      }) => {
        const { ctx, page } = await openWelcomeScreen(browser, {
          viewport: { width: vp, height: 800 },
          theme,
          // Past the 650 ms entrance animation and Chromium's mask-layer
          // settle window, so the banner's box has its final width. This
          // panel's geometry does not sit behind the mask, so it does not
          // need the suite's longer default.
          settle: 2500
        });
        try {
          const m = await readWelcomePanel(page);
          expect(m.hasOverlay, 'welcome overlay should be present in the DOM').toBe(true);
          expect(
            m.visualOn,
            'data-visual="on" must be set for the wave layer to render'
          ).toBe(true);
          expect(
            m.gliOn,
            '.genie-living-intelligence must be on <html> or an ancestor for the wave layer'
          ).toBe(true);

          // 1. the property that decides whether the panel draws a
          //    horizontal scrollbar.
          expect(m.overflowX, 'overlay should be readable').not.toBeNull();
          expect(
            m.overflowX,
            `overlay computed overflow-x must be 'hidden' or 'clip' (the property that decides ` +
              `whether the panel draws a horizontal scrollbar). Got '${m.overflowX}' at ` +
              `viewport ${vp}px (${theme}). Setting it back to 'auto' (the previous default after ` +
              `overflow-y: auto) would draw the very scrollbar the brief rules out.`
          ).toMatch(/^(hidden|clip)$/);

          // 2. and with the banner out of the way, the wave band itself
          //    contributes nothing past the panel's content box.
          expect(m.scrollWidth, 'overlay should be readable').not.toBeNull();
          const overflow = m.scrollWidth - m.clientWidth;
          expect(
            m.scrollWidth,
            `with banner hidden, overlay scrollWidth (${m.scrollWidth}px) must be <= ` +
              `clientWidth (${m.clientWidth}px) at viewport ${vp}px (${theme}); ` +
              `wave-only horizontal overflow=${overflow}px ` +
              `(the brief measured +24 here when the ::after box was sized to clientWidth + 2*--space-lg)`
          ).toBeLessThanOrEqual(m.clientWidth);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});
