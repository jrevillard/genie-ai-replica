// tests/e2e/resizable-sidebars.spec.js
//
// Behaviour of the edge handle both sidebars share: drag to resize,
// click the chevron to collapse, double-click to restore the default
// width — and the clamp that keeps the centre column usable no matter
// what the user does.
//
// Two things this file is built around:
//
//   1. The ladder. Before the widths were user-controlled the ladder
//      was monotonic by construction: widening the window could never
//      hand the centre less room. Once a width is a user choice that
//      stops being true, so the ladder is measured rung by rung rather
//      than assumed. It splits into two bands, and the split is the
//      finding — see the note above `sweepLadder`.
//
//   2. The clamp applies on RESTORE, not only on drag. A drag has live
//      viewport geometry to clamp against; a restore from storage does
//      not. The tests therefore write a deliberately over-wide stored
//      width and assert what the served layout did with it, rather
//      than asserting that a drag would have been clamped.
//
// No per-viewport table is carried here. The column-count expectation
// is derived from the live DOM the way responsive-layout.spec.js
// derives it — panel width, the gap token, --qh-card-min — so a token
// change cannot leave this spec asserting stale numbers.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/chatbot');

// The centre's usable minimum, from the quick-help grid's own
// arithmetic: two cards of 217 px plus one 32 px gap = 466 px, so 480
// px is the next whole number above it. Mirrors CENTRE_MIN_WIDTH in
// components/gov-chat-frontend/src/composables/sidebarLayout.js; the
// unit test on that module asserts the derivation, so a divergence
// between the two would have to be made deliberately.
//
// It is a floor on the CENTRE COLUMN, which only means something where
// the sidebars are in flow and actually reserving width. Below the
// breakpoint both step off-canvas and the centre is the whole viewport
// minus its own padding — at a 414 px viewport no layout can hand the
// centre 480 px, and asserting it would be asserting the impossible.
const CENTRE_MIN_WIDTH = 480;

// The width at which both sidebars become in-flow reservations. Below
// it they slide off-canvas and reserve nothing. Mirrors
// SIDEBAR_INFLOW_MIN_WIDTH in the layout module.
const IN_FLOW_MIN_WIDTH = 1400;

const LEFT = '.side-bar';
const RIGHT = '.sidebar';
const LEFT_HANDLE = '.side-bar .sidebar-handle';
const RIGHT_HANDLE = '.sidebar .sidebar-handle';

async function gotoChatbot(page) {
  await page.goto('/chat', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.quick-help-grid .quick-help-item', { timeout: 15000 });
}

// The same invariant responsive-layout.spec.js derives: column count
// follows the panel width, the card minimum and the gap, clamped to
// [1, 4]. Stated here rather than imported so this spec stands on its
// own — but derived, never tabulated.
function expectedColumns(gridWidth, cardMin, gap) {
  return Math.max(1, Math.min(4, Math.floor((gridWidth + gap) / (cardMin + gap))));
}

// Measure the three columns, the handles, and the grid facts the
// invariant reads.
async function measure(page) {
  return await page.evaluate(
    ({ leftSel, rightSel, leftHandleSel, rightHandleSel }) => {
      const q = (s) => document.querySelector(s);
      const rect = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) };
      };
      const grid = q('.quick-help-grid');
      const items = grid ? Array.from(grid.querySelectorAll('.quick-help-item')) : [];
      const gridStyle = grid ? getComputedStyle(grid) : null;
      const rootStyle = getComputedStyle(document.documentElement);
      const parsePx = (raw) => {
        const m = /^([\d.]+)px$/.exec(raw.trim());
        return m ? parseFloat(m[1]) : NaN;
      };
      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        left: rect(q(leftSel)),
        centre: rect(q('.chatbot-container')),
        right: rect(q(rightSel)),
        leftHandle: rect(q(leftHandleSel)),
        rightHandle: rect(q(rightHandleSel)),
        gridWidth: grid ? Math.round(grid.getBoundingClientRect().width) : null,
        columnCount: new Set(items.map((it) => Math.round(it.getBoundingClientRect().left))).size,
        cardMin: gridStyle ? parsePx(gridStyle.getPropertyValue('--qh-card-min')) : NaN,
        gap: parsePx(rootStyle.getPropertyValue('--space-xl'))
      };
    },
    { leftSel: LEFT, rightSel: RIGHT, leftHandleSel: LEFT_HANDLE, rightHandleSel: RIGHT_HANDLE }
  );
}

// A real pointer drag. Playwright's mouse produces trusted events, and
// the handle reads `pointerdown`/`pointermove` off the strip — a
// synthetic dispatchEvent would not exercise the same path a user's
// finger takes.
//
// The grab point is a quarter of the way down the strip, NOT its
// centre: the centre is where the chevron button sits, and the handle
// deliberately refuses a drag that starts on the button (a click there
// must collapse, not resize). Aiming at the centre would test the
// click-through guard, not the drag.
async function dragHandle(page, selector, dx) {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} should have a bounding box`).not.toBeNull();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 4;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Several intermediate moves: a single jump exercises the endpoint
  // but not the streaming updates a real drag produces.
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(startX + (dx * i) / 5, startY);
  }
  await page.mouse.up();
  await page.waitForTimeout(500); // let the 0.3 s width transition settle
}

// Seed the stored widths, then reload so the RESTORE path is what runs
// — not a live drag that never touched storage.
async function seedAndReload(page, widths) {
  await page.evaluate((w) => {
    localStorage.setItem('sidebarWidthLeft', String(w.left));
    localStorage.setItem('sidebarWidthRight', String(w.right));
    localStorage.setItem('sidebarOpen', 'true');
    localStorage.removeItem('sidebarOpenRight');
  }, widths);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.quick-help-grid .quick-help-item', { timeout: 15000 });
  await page.waitForTimeout(1800);
}

test.describe('Resizable sidebars behind one handle', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await loginViaUI(page);
    // Both panels open at their stored defaults, so the measurements
    // start from a known state.
    await page.evaluate(() => {
      localStorage.removeItem('sidebarWidthLeft');
      localStorage.removeItem('sidebarWidthRight');
      localStorage.setItem('sidebarOpen', 'true');
      localStorage.removeItem('sidebarOpenRight');
    });
    await gotoChatbot(page);
    await page.waitForTimeout(2000);
  });

  test('both handles exist, sit flush on their panel edge, and are in the tab order', async ({ page }) => {
    const m = await measure(page);
    expect(m.leftHandle, 'left handle should be measurable').not.toBeNull();
    expect(m.rightHandle, 'right handle should be measurable').not.toBeNull();

    // The strip sits INSIDE its panel, flush against the seam with the
    // centre. An earlier revision pulled it across that seam and the
    // centre's content painted over it — the control was focusable and
    // carried the right ARIA, and neither the chevron click nor the
    // drag reached it. Playwright reported the centre "intercepting
    // pointer events" on the element it was trying to click. A control
    // the centre paints over is not a control.
    //
    // One pixel of slack: the panel's 1 px border sits outside the
    // strip's box.
    expect(
      m.leftHandle.right,
      `left handle (left=${m.leftHandle.left}, right=${m.leftHandle.right}) must end at the panel's edge ` +
        `(${m.left.right}) — past it, the centre's content paints over the control`
    ).toBeGreaterThanOrEqual(m.left.right - 1);
    expect(m.leftHandle.right).toBeLessThanOrEqual(m.left.right);
    expect(m.leftHandle.left).toBeGreaterThan(m.left.left);

    expect(
      m.rightHandle.left,
      `right handle (left=${m.rightHandle.left}, right=${m.rightHandle.right}) must start at the panel's edge ` +
        `(${m.right.left}) — past it, the centre's content paints over the control`
    ).toBeGreaterThanOrEqual(m.right.left - 1);
    expect(m.rightHandle.left).toBeLessThanOrEqual(m.right.left + 1);
    expect(m.rightHandle.right).toBeLessThanOrEqual(m.right.right + 1);

    // 24 px wide, per the brief's stated handle zone, and full height so
    // the drag target is not a 24 px dot the user has to hunt for.
    expect(m.leftHandle.width).toBe(24);
    expect(m.rightHandle.width).toBe(24);

    // Focusable, and the chevron inside it is a real button — two
    // focusable things, so a keyboard user reaches both gestures
    // without hunting.
    for (const sel of [LEFT_HANDLE, RIGHT_HANDLE]) {
      const strip = page.locator(sel);
      await expect(strip).toHaveAttribute('role', 'separator');
      await expect(strip).toHaveAttribute('tabindex', '0');
      await expect(strip).toHaveAttribute('aria-valuenow', /\d+/);
      await expect(page.locator(`${sel} .sidebar-handle__button`)).toHaveJSProperty('tagName', 'BUTTON');
    }

    // And it is actually hittable — an occluded control passes every
    // assertion above and is still unusable.
    for (const sel of [LEFT_HANDLE, RIGHT_HANDLE]) {
      const hit = await page.evaluate((s) => {
        const strip = document.querySelector(s);
        const r = strip.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 4);
        if (!el) return 'nothing';
        // `className` on an SVG element is an SVGAnimatedString, not a
        // string — read the attribute so the read is uniform for both
        // HTML and SVG nodes.
        return `${el.tagName} ${el.getAttribute('class') || ''}`;
      }, sel);
      expect(
        hit,
        `${sel} must be the topmost element on its own drag surface — something is painted over it`
      ).toContain('sidebar-handle');
    }

    // How much of the strip is actually grabbable. The chevron occupies
    // its centre and refuses a drag, so the usable surface is the strip
    // minus that square. A probe that grabbed the centre and saw
    // nothing happen was measuring the button, not a broken drag — but
    // the area still has to be large enough that finding it is not a
    // hunt, so the number is pinned rather than assumed.
    for (const sel of [LEFT_HANDLE, RIGHT_HANDLE]) {
      const m2 = await page.evaluate((s) => {
        const strip = document.querySelector(s);
        const r = strip.getBoundingClientRect();
        const button = strip.querySelector('.sidebar-handle__button').getBoundingClientRect();
        // Fraction of the strip's height that is neither the button nor
        // a re-click of it.
        const draggable = r.height - button.height;
        return { stripH: r.height, buttonH: button.height, draggable, fraction: draggable / r.height };
      }, sel);
      expect(
        m2.fraction,
        `${sel}: only ${Math.round(m2.fraction * 100)} % of the ${m2.stripH} px strip is grabbable — ` +
          `the ${m2.buttonH} px chevron at its centre takes the rest`
      ).toBeGreaterThan(0.9);
    }
  });

  test('the three controls name their own side', async ({ page }) => {
    // Two separators and two chevrons are four focusable controls in
    // the same view. If they share an accessible name, a screen-reader
    // user hears four identical things and cannot tell which panel any
    // of them acts on. Read from the live DOM in the page's own
    // locale — this is what a screen reader announces.
    const names = await page.evaluate(
      ({ leftSel, rightSel }) => {
        const read = (sel, sel2) => {
          const el = document.querySelector(`${sel} ${sel2}`);
          return el ? el.getAttribute('aria-label') : null;
        };
        return {
          leftStrip: read(leftSel, '.sidebar-handle'),
          leftButton: read(leftSel, '.sidebar-handle__button'),
          rightStrip: read(rightSel, '.sidebar-handle'),
          rightButton: read(rightSel, '.sidebar-handle__button'),
          lang: document.documentElement.lang || null
        };
      },
      { leftSel: LEFT, rightSel: RIGHT }
    );

    for (const [key, value] of Object.entries(names)) {
      if (key === 'lang') continue;
      expect(value, `${key} must carry an accessible name`).toBeTruthy();
    }
    // Every name is distinct — no two controls may share one.
    const all = [names.leftStrip, names.leftButton, names.rightStrip, names.rightButton];
    expect(new Set(all).size, `all four names must differ, got ${JSON.stringify(all)}`).toBe(4);
    // And they name the side, so the difference is meaningful rather
    // than incidental.
    expect(names.leftStrip).not.toBe(names.rightStrip);
    expect(names.leftButton).not.toBe(names.rightButton);
  });

  test('dragging the left handle resizes the left and the centre correspondingly', async ({ page }) => {
    const before = await measure(page);
    // The strip is the left panel's RIGHT edge, so +120 slides it right
    // and the panel grows by 120 — at the centre's expense.
    await dragHandle(page, LEFT_HANDLE, 120);
    const after = await measure(page);

    expect(after.left.width).toBeGreaterThan(before.left.width + 100);
    // The exchange is one-for-one and in opposite directions: every
    // pixel the left takes is a pixel the centre loses. Asserting the
    // signs rather than "both grew" is what caught a drag that moved
    // the panel the wrong way.
    const leftDelta = after.left.width - before.left.width;
    const centreDelta = after.centre.width - before.centre.width;
    expect(centreDelta).toBeLessThan(0);
    expect(Math.abs(leftDelta + centreDelta)).toBeLessThanOrEqual(2);
    // The right did not move.
    expect(after.right.width).toBe(before.right.width);
    expect(after.scrollWidth, 'no horizontal overflow after a left drag').toBeLessThanOrEqual(after.viewport);
  });

  test('dragging the right handle resizes the right and the centre correspondingly', async ({ page }) => {
    const before = await measure(page);
    // The right panel's strip is its LEFT edge, so -120 slides it left
    // and the panel grows by 120.
    await dragHandle(page, RIGHT_HANDLE, -120);
    const after = await measure(page);

    expect(after.right.width).toBeGreaterThan(before.right.width + 100);
    const rightDelta = after.right.width - before.right.width;
    const centreDelta = after.centre.width - before.centre.width;
    expect(centreDelta).toBeLessThan(0);
    expect(Math.abs(rightDelta + centreDelta)).toBeLessThanOrEqual(2);
    expect(after.left.width).toBe(before.left.width);
    expect(after.scrollWidth).toBeLessThanOrEqual(after.viewport);
  });

  test('the handle is keyboard-operable from both sides', async ({ page }) => {
    // The arrow keys move the strip in screen space and the panel
    // follows: ArrowRight widens a LEFT panel (the strip is its right
    // edge) and narrows a RIGHT panel (the strip is its left edge).
    // The same convention has to hold for the drag — asserting that one
    // direction widens on both sides is what let the two drift apart
    // once already.
    for (const [sel, panelKey, widenKey] of [
      [LEFT_HANDLE, 'left', 'ArrowRight'],
      [RIGHT_HANDLE, 'right', 'ArrowLeft']
    ]) {
      const before = (await measure(page))[panelKey].width;
      await page.locator(sel).focus();
      await page.keyboard.press(widenKey);
      await page.waitForTimeout(400);
      const widened = (await measure(page))[panelKey].width;
      expect(widened, `${sel}: ${widenKey} must widen the panel (was ${before})`).toBeGreaterThan(before);

      const narrowKey = widenKey === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
      await page.keyboard.press(narrowKey);
      await page.waitForTimeout(400);
      const narrowed = (await measure(page))[panelKey].width;
      expect(narrowed, `${sel}: ${narrowKey} must narrow it back to ${before}`).toBeLessThan(widened);
    }
  });

  test('the chevron collapses, and expanding returns the panel to its previous width', async ({ page }) => {
    for (const [handleSel, panelKey] of [
      [LEFT_HANDLE, 'left'],
      [RIGHT_HANDLE, 'right']
    ]) {
      const before = (await measure(page))[panelKey].width;

      await page.locator(`${handleSel} .sidebar-handle__button`).click();
      await page.waitForTimeout(600);
      const collapsed = await measure(page);
      expect(collapsed[panelKey].width, `${panelKey} should be collapsed`).toBeLessThan(before);

      await page.locator(`${handleSel} .sidebar-handle__button`).click();
      await page.waitForTimeout(600);
      const expanded = await measure(page);
      expect(
        expanded[panelKey].width,
        `${panelKey} must return to the width it had before collapsing (${before})`
      ).toBe(before);
      // Collapsing gives the centre room, so expanding takes it back.
      expect(
        expanded.centre.width,
        'the centre must give up the room it gained while the panel was collapsed'
      ).toBeLessThan(collapsed.centre.width);
    }
  });

  test('double-click restores that side default width', async ({ page }) => {
    for (const [handleSel, panelKey, expected] of [
      [LEFT_HANDLE, 'left', 450],
      [RIGHT_HANDLE, 'right', 320]
    ]) {
      // Move away from the default so the restore is observable.
      await dragHandle(page, handleSel, panelKey === 'left' ? 150 : -150);
      expect((await measure(page))[panelKey].width, `${panelKey} should have moved off its default`).not.toBe(expected);

      // Double-click the STRIP, off the button. `locator.dblclick()`
      // aims at the element's centre, which is where the chevron sits
      // — so it would exercise the button's click handler (collapse)
      // rather than the strip's restore gesture, and the two clicks
      // toggle the panel instead of restoring it.
      const box = await page.locator(handleSel).boundingBox();
      await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 4);
      await page.waitForTimeout(700);
      expect((await measure(page))[panelKey].width, `${panelKey} default should be ${expected}`).toBe(expected);
    }
  });

  test('a width restored from storage is clamped to the current viewport, not applied blind', async ({ page }) => {
    // A width that is legal at 2400 px and not affordable at 1400 px.
    await page.setViewportSize({ width: 2400, height: 900 });
    await page.waitForTimeout(800);
    await dragHandle(page, LEFT_HANDLE, 300);
    const wide = await measure(page);
    expect(wide.left.width, 'the wide-viewport drag should have widened the left').toBeGreaterThan(500);
    // The right was never dragged, so it has no stored width of its
    // own — read it with the same fallback the app uses, or the
    // baseline below is understated and "something had to give" cannot
    // be evaluated.
    const stored = await page.evaluate(
      ({ defaultRight }) => ({
        left: Number(localStorage.getItem('sidebarWidthLeft')),
        right: Number(localStorage.getItem('sidebarWidthRight')) || defaultRight
      }),
      { defaultRight: 320 }
    );
    expect(stored.left).toBe(wide.left.width);

    // Same stored value, narrower viewport. The clamp has to run on the
    // way IN — a drag has live geometry to clamp against, a restore
    // from storage does not.
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.quick-help-grid .quick-help-item', { timeout: 15000 });
    await page.waitForTimeout(2500);

    const m = await measure(page);
    // The invariant is a property of the PAIR, not of one side. Which
    // side yields is not fixed: at 1400 px a stored pair of 600/480
    // resolves to 600/296 — the left keeps its width and the right gives
    // way — because the two clamps settle by summing to exactly the
    // viewport's budget. Asserting the left in particular turned this
    // test red against correct behaviour.
    const reserved = m.left.width + m.right.width;
    expect(
      m.centre.width,
      `the centre must keep its ${CENTRE_MIN_WIDTH} px usable minimum (left=${m.left.width}, right=${m.right.width})`
    ).toBeGreaterThanOrEqual(CENTRE_MIN_WIDTH);
    expect(
      reserved,
      `the two panels reserved ${reserved} px at ${m.viewport}; the budget for them is ${m.viewport - CENTRE_MIN_WIDTH} px`
    ).toBeLessThanOrEqual(m.viewport - CENTRE_MIN_WIDTH);
    // Something had to give — the stored total does not fit at 1400 px.
    expect(
      reserved,
      `stored total was ${stored.left + stored.right} px; applying it blind would have left the centre at ` +
        `${m.viewport - (stored.left + stored.right)} px`
    ).toBeLessThan(stored.left + stored.right);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.viewport);

    // And the stored width is intact: the clamp is a rendering bound,
    // not a rewrite. Widening the viewport back gives the panel what
    // the user chose.
    await page.setViewportSize({ width: 2400, height: 900 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.quick-help-grid .quick-help-item', { timeout: 15000 });
    await page.waitForTimeout(2500);
    expect(
      (await measure(page)).left.width,
      `the stored ${stored.left} px must come back at 2400 px — the clamp must not have overwritten it`
    ).toBe(stored.left);
  });

  // The real risk. Widening the window must never hand the centre LESS
  // room. With the widths user-controlled that is no longer true by
  // construction, so it is measured rung by rung — including rungs
  // reached with a user-set width rather than the shipped default.
  //
  // The ladder splits into two bands, and the split is the finding.
  // Below IN_FLOW_MIN_WIDTH both panels are off-canvas and reserve
  // nothing, so the centre is the viewport less its padding. At and
  // above it they are in-flow reservations, so the centre is the
  // viewport less whatever the pair settled on. Monotonicity holds
  // WITHIN each band and cannot hold across the boundary: crossing
  // 1399 -> 1400 turns two panels that reserved 0 px into two that
  // reserve up to their combined maximum. That step predates this
  // feature — the shipped defaults already produce it — so it is
  // measured and bounded rather than asserted away. What IS asserted
  // across the step is the thing that must never break: the centre
  // keeps its usable minimum and the page never overflows.
  //
  // One test per composition rather than three sweeps inside one: a
  // sweep is a page reload per rung, so a single failure would
  // otherwise hide which composition caused it and eat the timeout.
  async function sweepLadder(page, label, seedWidths) {
    const LADDER = [414, 769, 1024, 1280, 1400, 1600, 1920];
    const centres = [];
    const rows = [];

    for (const vp of LADDER) {
      await page.setViewportSize({ width: vp, height: 900 });
      await page.waitForTimeout(1000);
      await seedAndReload(page, seedWidths);

      const m = await measure(page);
      rows.push(`  ${vp}: centre=${m.centre.width} left=${m.left.width} right=${m.right.width} cols=${m.columnCount}`);
      centres.push({ vp, width: m.centre.width, left: m.left.width, right: m.right.width });

      expect(m.scrollWidth, `${label} ${vp}: page must not overflow horizontally`).toBeLessThanOrEqual(m.viewport);
      if (vp >= IN_FLOW_MIN_WIDTH) {
        expect(
          m.centre.width,
          `${label} ${vp}: with both panels in flow the centre must keep its ${CENTRE_MIN_WIDTH} px usable ` +
            `minimum (left=${m.left.width}, right=${m.right.width})`
        ).toBeGreaterThanOrEqual(CENTRE_MIN_WIDTH);
      } else {
        // Off-canvas: the panels reserve nothing, so the centre is the
        // viewport less its padding. A stored width leaking into the
        // layout here is exactly what this catches — a panel that is
        // off-canvas but still reserving 600 px shows up as a centre
        // far narrower than the viewport.
        expect(
          m.centre.width,
          `${label} ${vp}: off-canvas panels must reserve nothing, so the centre takes the viewport`
        ).toBeGreaterThan(vp - 64);
      }
      expect(
        m.columnCount,
        `${label} ${vp}: column count must follow the invariant floor((P+G)/(M+G)) clamped to [1,4]`
      ).toBe(expectedColumns(m.gridWidth, m.cardMin, m.gap));
    }

    // Monotonicity within each band, in the widening direction — the
    // direction the invariant is stated in.
    const band = (from, to) => centres.filter((c) => c.vp >= from && c.vp <= to);
    for (const [name, rungs] of [
      ['off-canvas', band(0, IN_FLOW_MIN_WIDTH - 1)],
      ['in flow', band(IN_FLOW_MIN_WIDTH, Infinity)]
    ]) {
      for (let i = 1; i < rungs.length; i++) {
        expect(
          rungs[i].width,
          `${label}: in the ${name} band the centre narrowed from ${rungs[i - 1].width} px at ${rungs[i - 1].vp} ` +
            `to ${rungs[i].width} px at ${rungs[i].vp} (left=${rungs[i].left}, right=${rungs[i].right}). ` +
            `Widening the window must never take room from the content.`
        ).toBeGreaterThanOrEqual(rungs[i - 1].width);
      }
    }

    // Across the boundary: the centre is still the viewport less what
    // the panels actually reserve on the far side of the step.
    const lastOffCanvas = centres.filter((c) => c.vp < IN_FLOW_MIN_WIDTH).pop();
    const firstInFlow = centres.find((c) => c.vp >= IN_FLOW_MIN_WIDTH);
    if (lastOffCanvas && firstInFlow) {
      const reserved = firstInFlow.left + firstInFlow.right;
      expect(
        firstInFlow.width,
        `${label}: crossing into in-flow the centre must still be the viewport less what the panels reserve. ` +
          `Reserved ${reserved} px at ${firstInFlow.vp}; the centre came out ${firstInFlow.width} px.`
      ).toBeGreaterThanOrEqual(firstInFlow.vp - reserved - 32);
    }

    // Printed so a report has the measured ladder, and so a failure
    // shows the whole thing rather than just the rung that tripped.
    console.log(
      `\n[${label}] stored left=${seedWidths.left} right=${seedWidths.right}\n` +
        `  breakpoint step: centre ${lastOffCanvas.width} px at ${lastOffCanvas.vp} -> ` +
        `${firstInFlow.width} px at ${firstInFlow.vp} (reserved ${firstInFlow.left + firstInFlow.right} px)\n` +
        rows.join('\n')
    );
  }

  test('ladder monotonic at both hard caps', async ({ page }) => {
    test.setTimeout(300000);
    await sweepLadder(page, 'both hard caps', { left: 600, right: 480 });
  });

  test('ladder monotonic with a wide left and a default right', async ({ page }) => {
    test.setTimeout(300000);
    // Asymmetric, and the subtle case: neither width is illegal on its
    // own, and the composition is one a user reaches by dragging the
    // left wider and never touching the right.
    await sweepLadder(page, 'wide left, default right', { left: 600, right: 320 });
  });

  test('ladder monotonic with a stored width far above any legal maximum', async ({ page }) => {
    test.setTimeout(300000);
    // Deliberately out of range on every side. If the restore path
    // applied a stored value without clamping, this is the width that
    // empties the centre — and it is the rung that fails first.
    await sweepLadder(page, 'out-of-range stored widths', { left: 4000, right: 4000 });
  });
});
