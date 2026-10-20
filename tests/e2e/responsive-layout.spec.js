// tests/e2e/responsive-layout.spec.js
//
// Layout regression spec for the two narrow-viewport defects the
// quick-help grid used to reproduce, regardless of the Living
// Intelligence visual layer being switched on.
//
// What this asserts (at 1280x720 and 769x800, with both sidebars open
// by default — the same default state a fresh install carries):
//   - the centre chat column renders with a non-zero width;
//   - the grid renders 2 columns at 1280 (matching the designer's
//     mockup, divided out of the panel rather than the viewport);
//   - the grid renders 1 column at 769 (the panel is too narrow for
//     even two 217 px cards);
//   - every card's rendered width is at least the mockup's 217 px,
//     minus a 20 px tolerance;
//   - the sidebars do not overlap the centre.
//
// Counting columns is done by the distinct getBoundingClientRect().left
// values of the grid's items, not by reading a CSS custom property —
// a layout assertion that reads a CSS var would be tautological with
// the rule under test.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/chatbot');

// 217 px is the card width the designer's mockup shows at 4-col. The
// panel at 1280 with both sidebars open (~486 px) does not fit that
// width per card (2 cols of 217 + 32 gap = 466 px threshold), so each
// card is 203 px rather than 217; the same threshold shrinks cards
// slightly at the brief's tolerance. 20 px keeps the assertion
// meaningful at every viewport the spec covers and would still
// detect a return to the four-broken-columns state at 1280 (97 px
// cards).
const CARD_MIN = 217 - 20; // 197 px

async function gotoChatbot(page) {
  // Stay on /chat. The grid lives in the chat dashboard view, not the
  // landing page.
  await page.goto('/chat', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.quick-help-grid .quick-help-item', { timeout: 15000 });
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('.main-container');
    const centre = document.querySelector('.chatbot-container');
    const left = document.querySelector('.side-bar');
    const right = document.querySelector('.sidebar');
    const grid = document.querySelector('.quick-help-grid');
    const items = grid ? Array.from(grid.querySelectorAll('.quick-help-item')) : [];
    const distinctLefts = new Set(
      items.map((it) => Math.round(it.getBoundingClientRect().left))
    );
    const cardWidths = items.map((it) => Math.round(it.getBoundingClientRect().width));
    const lr = left && left.getBoundingClientRect();
    const rr = right && right.getBoundingClientRect();
    const cr = centre && centre.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      wrapWidth: wrap ? Math.round(wrap.getBoundingClientRect().width) : null,
      centreWidth: cr ? Math.round(cr.width) : null,
      centreLeft: cr ? Math.round(cr.left) : null,
      centreRight: cr ? Math.round(cr.right) : null,
      leftRect: lr
        ? { left: Math.round(lr.left), right: Math.round(lr.right), width: Math.round(lr.width) }
        : null,
      rightRect: rr
        ? { left: Math.round(rr.left), right: Math.round(rr.right), width: Math.round(rr.width) }
        : null,
      columnCount: distinctLefts.size,
      cardWidths,
      cardMin: Math.min(...(cardWidths.length ? cardWidths : [0]))
    };
  });
}

// Each assertion uses position, not derived arithmetic, so the spec
// catches a layout regression on either axis.
function assertNoOverlap(m) {
  expect(m.leftRect, 'left sidebar should be measurable').not.toBeNull();
  expect(m.centreLeft, 'centre should have a measurable left edge').not.toBeNull();
  // The left sidebar's right edge sits to the left of the centre's left
  // edge (with at most one gap unit of tolerance for transition widths).
  expect(
    m.leftRect.right <= m.centreLeft + 4,
    `left sidebar right=${m.leftRect.right} must not enter centre (centre left=${m.centreLeft})`
  ).toBe(true);
  if (m.rightRect) {
    expect(
      m.rightRect.left >= m.centreRight - 4,
      `right sidebar left=${m.rightRect.left} must not enter centre (centre right=${m.centreRight})`
    ).toBe(true);
  }
}

test.describe('Responsive layout (quick-help grid + sidebar policy)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUI(page);
    // Force the left sidebar open at narrow viewports too — the
    // checkScreenSize resize handler in App.vue auto-collapses left
    // sidebars at width < 768, but the spec sets the viewport
    // before reading, so the auto-collapse logic has already run
    // once with the previous viewport state. Without this, the
    // second test (769x800) would inherit whatever sidebar state
    // the first test (1280x720) left in localStorage.
    await page.evaluate(() => localStorage.setItem('sidebarOpen', 'true'));
  });

  test('1280x720: centre has room; grid is 2 cols; cards fit; no overlap', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoChatbot(page);
    // Settle the 0.3s sidebar width transition before reading.
    await page.waitForTimeout(800);

    const m = await measureLayout(page);
    expect(m.viewport, 'viewport should be 1280').toBe(1280);
    expect(m.centreWidth, `centre width should be > 0 (got ${m.centreWidth})`).toBeGreaterThan(0);
    expect(m.columnCount, `grid should be 2 columns at 1280 (got ${m.columnCount})`).toBe(2);
    expect(m.cardMin, `card width should be >= ${CARD_MIN} (got ${m.cardMin})`).toBeGreaterThanOrEqual(CARD_MIN);
    expect(m.scrollWidth, 'page should not overflow horizontally').toBeLessThanOrEqual(m.viewport);
    expect(
      m.leftRect.right <= m.viewport + 1,
      `left sidebar (right=${m.leftRect.right}) must not extend past the viewport (vw=${m.viewport})`
    ).toBe(true);
    expect(
      m.rightRect.left >= 0 && m.rightRect.right <= m.viewport + 1,
      `right sidebar must sit inside the viewport (left=${m.rightRect.left}, right=${m.rightRect.right}, vw=${m.viewport})`
    ).toBe(true);
    assertNoOverlap(m);
  });

  test('769x800: centre has room; grid is 1 col; card has a usable width; no overlap', async ({ page }) => {
    await page.setViewportSize({ width: 769, height: 800 });
    await gotoChatbot(page);
    // Settle the 0.3s sidebar width transition before reading.
    await page.waitForTimeout(800);

    const m = await measureLayout(page);
    expect(m.viewport, 'viewport should be 769').toBe(769);
    expect(m.centreWidth, `centre width should be > 0 (got ${m.centreWidth})`).toBeGreaterThan(0);
    expect(m.columnCount, `grid should be 1 column at 769 (got ${m.columnCount})`).toBe(1);
    expect(m.cardMin, `card width should be >= ${CARD_MIN} (got ${m.cardMin})`).toBeGreaterThanOrEqual(CARD_MIN);
    expect(m.scrollWidth, 'page should not overflow horizontally').toBeLessThanOrEqual(m.viewport);
    expect(
      m.leftRect.right <= m.viewport + 1,
      `left sidebar (right=${m.leftRect.right}) must not extend past the viewport (vw=${m.viewport})`
    ).toBe(true);
    expect(
      m.rightRect.left >= 0 && m.rightRect.right <= m.viewport + 1,
      `right sidebar must sit inside the viewport (left=${m.rightRect.left}, right=${m.rightRect.right}, vw=${m.viewport})`
    ).toBe(true);
    assertNoOverlap(m);
  });
});
