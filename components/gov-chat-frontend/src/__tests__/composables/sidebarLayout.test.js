import {
  SIDEBAR_DEFAULTS,
  SIDEBAR_MIN_WIDTHS,
  SIDEBAR_MAX_WIDTHS,
  CENTRE_MIN_WIDTH,
  SIDEBAR_INFLOW_MIN_WIDTH,
  computeMaxFor,
  clampWidth
} from '@/composables/sidebarLayout';

// The horizontal space inside the viewport the centre does not get:
// two 8 px inter-panel gaps plus `.content-area`'s 8 px left padding.
// Mirrors CENTRE_CHROME_PX in the module.
const CHROME = 24;

describe('sidebarLayout — the clamp arithmetic', () => {
  describe('the centre floor', () => {
    // The one number in the module that is derived rather than chosen:
    // the grid's auto-fit needs `2 * 217 + 32 = 466 px` for two columns,
    // so 480 is the next whole number above that.
    it('is the whole number above the grid two-column footprint', () => {
      expect(CENTRE_MIN_WIDTH).toBe(480);
      expect(CENTRE_MIN_WIDTH).toBeGreaterThan(2 * 217 + 32);
    });
  });

  describe('computeMaxFor', () => {
    it('is the hard cap when the viewport has room to spare', () => {
      // 2400 - 480 - 320 - 24 = 1576, far above the 600 cap.
      expect(computeMaxFor('left', SIDEBAR_DEFAULTS.right, 2400)).toBe(SIDEBAR_MAX_WIDTHS.left);
      expect(computeMaxFor('right', SIDEBAR_DEFAULTS.left, 2400)).toBe(SIDEBAR_MAX_WIDTHS.right);
    });

    it('is the centre-derived bound once the viewport runs short', () => {
      // 1400 - 480 - 320 - 24 = 576, below the 600 hard cap.
      expect(computeMaxFor('left', SIDEBAR_DEFAULTS.right, 1400)).toBe(576);
      // 1400 - 480 - 450 - 16 = 454, below the 480 hard cap.
      expect(computeMaxFor('right', SIDEBAR_DEFAULTS.left, 1400)).toBe(446);
    });

    it('tightens as the opposite sidebar grows — the two clamps compose', () => {
      const narrow = computeMaxFor('left', 320, 1400);
      const wide = computeMaxFor('left', 480, 1400);
      expect(wide).toBeLessThan(narrow);
      expect(narrow - wide).toBe(160);
    });

    // A viewport too narrow to hold both minimums plus the centre floor
    // must still return a usable handle bound — the minimum, not a
    // number below it, or the handle's own clamp would invert.
    it('never returns less than the side minimum, however narrow the viewport', () => {
      for (const viewport of [1400, 1024, 769, 414, 320]) {
        for (const other of [240, 300, 320, 450, 600, 4000]) {
          expect(computeMaxFor('left', other, viewport)).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTHS.left);
          expect(computeMaxFor('right', other, viewport)).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTHS.right);
        }
      }
    });
  });

  describe('clampWidth', () => {
    it('passes a value inside the bounds through unchanged', () => {
      expect(clampWidth('left', 450, SIDEBAR_DEFAULTS.right, 1920)).toBe(450);
    });

    it('holds the floor from below', () => {
      expect(clampWidth('left', 40, SIDEBAR_DEFAULTS.right, 1920)).toBe(SIDEBAR_MIN_WIDTHS.left);
    });

    it('holds the cap from above', () => {
      expect(clampWidth('left', 5000, SIDEBAR_DEFAULTS.right, 1920)).toBe(SIDEBAR_MAX_WIDTHS.left);
    });

    // The case the brief calls out: a width stored at a wide viewport,
    // restored at the in-flow breakpoint, must not be applied blind.
    it('re-binds a width stored at a wide viewport onto the narrow one', () => {
      const storedAtWide = clampWidth('left', 600, SIDEBAR_DEFAULTS.right, 1920);
      expect(storedAtWide).toBe(600);

      const restoredAtNarrow = clampWidth('left', storedAtWide, SIDEBAR_DEFAULTS.right, 1400);
      expect(restoredAtNarrow).toBe(576);
    });

    it('re-binds a right width stored at 2400 when restored at 1400', () => {
      const storedAtWide = clampWidth('right', 480, SIDEBAR_DEFAULTS.left, 2400);
      expect(storedAtWide).toBe(480);
      expect(clampWidth('right', storedAtWide, SIDEBAR_DEFAULTS.left, 1400)).toBe(446);
    });
  });

  // The property the responsive spec encodes, expressed here on the
  // arithmetic: at every viewport at or above the in-flow threshold,
  // a left width at its maximum and a right width at its maximum still
  // leave the centre its floor. If this ever fails, a drag can empty
  // the content column.
  describe('the two maxima together', () => {
    for (const viewport of [2400, 1920, 1600, 1400]) {
      it(`leave the centre ${CENTRE_MIN_WIDTH} px at ${viewport}`, () => {
        // The side being dragged can reach max computed against the
        // OTHER side sitting at its own hard cap — the worst legal
        // composition.
        const rightAtCap = SIDEBAR_MAX_WIDTHS.right;
        const leftMax = computeMaxFor('left', rightAtCap, viewport);
        const leftAtCap = Math.min(leftMax, SIDEBAR_MAX_WIDTHS.left);
        const remaining = viewport - leftAtCap - rightAtCap - CHROME;
        expect(remaining).toBeGreaterThanOrEqual(CENTRE_MIN_WIDTH);
      });
    }
  });

  // The invariant the responsive ladder rests on, and the one a
  // user-controlled width can break: the centre's width is
  // `viewport - what the two panels actually reserve`, so it can only
  // ever rise as the viewport rises IF the reserved total never rises
  // faster than the viewport does.
  //
  // This is where the earlier clamp failed. Each side clamped against
  // the OTHER SIDE'S STORED width, so at 1400 px a stored pair of
  // 600/480 resolved to an in-force 424/304 (over-clamped, centre
  // 648) while at 1600 px the same stored pair resolved to 600/480
  // (released, centre 496). The centre shrank by 152 px as the window
  // grew by 200. Clamping against the in-force width instead makes the
  // pair sum to exactly the budget at every viewport, and the ladder
  // monotonic with it.
  describe('monotonicity of the centre across the in-flow band', () => {
    // One round of "each side clamps itself against the other's
    // current width" — the fixed point both components converge on.
    function settle(storedLeft, storedRight, viewport) {
      let left = clampWidth('left', storedLeft, storedRight, viewport);
      let right = clampWidth('right', storedRight, left, viewport);
      // The counterpart signal re-clamps the other side once; two
      // rounds is enough to reach the fixed point because the
      // constraint is a single monotone inequality.
      left = clampWidth('left', left, right, viewport);
      right = clampWidth('right', right, left, viewport);
      return { left, right, centre: viewport - left - right - CHROME };
    }

    const STORED = [
      { left: 600, right: 480, label: 'both at their caps' },
      { left: 600, right: 320, label: 'wide left, default right' },
      { left: 4000, right: 4000, label: 'stored far out of range' },
      { left: 300, right: 240, label: 'both at their minimum' }
    ];
    const LADDER = [1400, 1500, 1600, 1800, 1920, 2400];

    for (const s of STORED) {
      it(`never narrows the centre with ${s.label}`, () => {
        const centres = LADDER.map((vp) => settle(s.left, s.right, vp));
        for (let i = 1; i < LADDER.length; i++) {
          expect(centres[i].centre).toBeGreaterThanOrEqual(centres[i - 1].centre);
        }
      });

      it(`keeps the centre at or above its floor with ${s.label}`, () => {
        for (const vp of LADDER) {
          const { centre } = settle(s.left, s.right, vp);
          expect(centre).toBeGreaterThanOrEqual(CENTRE_MIN_WIDTH);
        }
      });
    }
  });

  it('keeps the in-flow threshold above every viewport the ladder names below it', () => {
    // 1399 is the widest off-canvas width; 1400 is the narrowest
    // in-flow one. They must not overlap or the two policies are
    // simultaneously true at one width.
    expect(SIDEBAR_INFLOW_MIN_WIDTH).toBe(1400);
    expect(SIDEBAR_INFLOW_MIN_WIDTH).toBeGreaterThan(1399);
  });

  it('ships with the widths the panels had before the resize feature', () => {
    // A first-run user sees the layout they saw before, and a
    // double-click lands on it.
    expect(SIDEBAR_DEFAULTS).toEqual({ left: 450, right: 320 });
  });
});
