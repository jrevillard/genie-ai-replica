/**
 * chartColors.test.js — the token-resolution utility's pure and injected-compute paths.
 *
 * The DOM probe path itself (style.color round-trip through getComputedStyle) is
 * browser-verified live (the capture probe); here we pin everything deterministic:
 * the pure HSL fallback math, the ramp's structural contract, the sentinel
 * invalid-value fallback, and the expression plumbing.
 */
'use strict';

const {
  SENTINEL,
  buildBrandRamp,
  buildSatisfactionBands,
  buildSatisfactionScale,
  fade,
  hslLightness,
  hslRotate,
  mix,
  normalizeComputedColor,
  parseComputedRgb,
  shiftHue,
  shiftLightness
} = require('../../utils/chartColors');

describe('chartColors — pure HSL fallback math', () => {
  test('hslRotate pins: red +90° is yellow-green (HSL 90°), +120° is lime', () => {
    expect(hslRotate('rgb(255, 0, 0)', 90)).toBe('rgb(128, 255, 0)');
    expect(hslRotate('rgb(255, 0, 0)', 120)).toBe('rgb(0, 255, 0)');
  });

  test('hslRotate pins: red -120° is blue', () => {
    expect(hslRotate('rgb(255, 0, 0)', -120)).toBe('rgb(0, 0, 255)');
  });

  test('hslRotate wraps mod 360 and stays distinct', () => {
    const a = hslRotate('rgb(255, 0, 0)', 47);
    const b = hslRotate('rgb(255, 0, 0)', 47 * 9);
    expect(a).not.toBe(b);
    expect(a.startsWith('rgb(')).toBe(true);
  });

  test('hslLightness steps a mid-gray toward white and black', () => {
    const mid = hslLightness('rgb(120, 120, 120)', 0.2);
    const dark = hslLightness('rgb(120, 120, 120)', -0.2);
    const [r1] = mid.match(/\d+/g).map(Number);
    const [r2] = dark.match(/\d+/g).map(Number);
    expect(r1).toBeGreaterThan(120);
    expect(r2).toBeLessThan(120);
  });

  test('hslLightness clamps at the extremes (no invisible black/white)', () => {
    expect(hslLightness('rgb(255, 255, 255)', 0.5)).toBe('rgb(242, 242, 242)');
    expect(hslLightness('rgb(0, 0, 0)', -0.5)).toBe('rgb(13, 13, 13)');
  });

  test('unparseable input resolves to empty (the failure marker), never echoed back', () => {
    // Review F1: echoing the input was the silent no-op — an untransformable
    // color must surface as '' so callers (isFailure guards, ramp dedup) see
    // the failure instead of a color that never changed.
    expect(hslRotate('var(--fg)', 90)).toBe('');
    expect(hslLightness('garbage', 0.1)).toBe('');
    expect(hslLightness('', 0.1)).toBe('');
  });

  test('parseComputedRgb reads the computed formats', () => {
    expect(parseComputedRgb('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1]);
    expect(parseComputedRgb('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3, 0.5]);
    expect(parseComputedRgb('not a color')).toBeNull();
    expect(parseComputedRgb(undefined)).toBeNull();
  });
});

describe('chartColors — expression plumbing with injected compute', () => {
  test('mix builds an OKLch color-mix expression and returns the computed result', () => {
    const compute = jest.fn(() => 'rgb(10, 20, 30)');
    const out = mix('rgb(1, 2, 3)', 'rgb(9, 8, 7)', 30, compute);
    expect(compute).toHaveBeenCalledWith('color-mix(in oklch, rgb(1, 2, 3) 70%, rgb(9, 8, 7) 30%)');
    expect(out).toBe('rgb(10, 20, 30)');
  });

  test('shiftHue builds a relative-OKLch rotation', () => {
    const compute = jest.fn(() => 'rgb(10, 20, 30)');
    const out = shiftHue('rgb(1, 2, 3)', 140, compute);
    expect(compute).toHaveBeenCalledWith('oklch(from rgb(1, 2, 3) l c calc(mod(h + 140, 360)))');
    expect(out).toBe('rgb(10, 20, 30)');
  });

  test('shiftLightness builds a clamped relative-OKLch step', () => {
    const compute = jest.fn(() => 'rgb(40, 40, 40)');
    const out = shiftLightness('rgb(1, 2, 3)', 0.08, compute);
    expect(compute).toHaveBeenCalledWith('oklch(from rgb(1, 2, 3) calc(clamp(0.08, calc(l + 0.08), 0.94)) c h)');
    expect(out).toBe('rgb(40, 40, 40)');
  });

  test('an empty color short-circuits to empty without calling compute', () => {
    const compute = jest.fn();
    expect(shiftHue('', 90, compute)).toBe('');
    expect(mix('', 'rgb(0,0,0)', 10, compute)).toBe('');
    expect(compute).not.toHaveBeenCalled();
  });

  test('an unsupported expression falls back to the pure HSL path', () => {
    // compute resolves var() tokens but returns the SENTINEL for derived
    // expressions — the "browser without relative color syntax" shape.
    const compute = (expression) => {
      if (expression.startsWith('var(')) return 'rgb(200, 30, 40)';
      return SENTINEL;
    };
    const out = shiftHue('rgb(200, 30, 40)', 90, compute);
    // the pure fallback, not '' and not the sentinel
    expect(out).not.toBe('');
    expect(out).not.toBe(SENTINEL);
    expect(out.startsWith('rgb(')).toBe(true);
  });
});

describe('chartColors — buildBrandRamp contract', () => {
  const ACCENT = 'rgb(80, 60, 200)';
  const BRAND = 'rgb(70, 50, 190)';
  const STATUSES = {
    success: 'rgb(20, 160, 90)',
    warning: 'rgb(230, 170, 20)',
    danger: 'rgb(220, 60, 50)',
    info: 'rgb(40, 130, 220)'
  };

  test('a fully-working compute yields count distinct concrete colors, accent first', () => {
    let n = 0;
    const compute = (expression) => {
      if (expression.startsWith('var(')) return ACCENT;
      n += 1;
      return `rgb(${10 + n}, ${20 + n}, ${30 + n})`;
    };
    const ramp = buildBrandRamp({
      accent: ACCENT,
      brand: BRAND,
      statuses: STATUSES,
      fg: 'rgb(10,10,10)',
      count: 8,
      compute
    });
    expect(ramp).toHaveLength(8);
    expect(ramp[0]).toBe(ACCENT);
    expect(new Set(ramp).size).toBe(8);
    ramp.forEach((c) => expect(c.startsWith('rgb(')).toBe(true));
  });

  test('a compute that fails EVERY derived expression still yields a full distinct ramp', () => {
    // only var() resolves; every mix/rotation hits the sentinel → the pure
    // HSL fallback walk must fill the ramp from the accent alone.
    const compute = (expression) => {
      if (expression.startsWith('var(')) return ACCENT;
      return SENTINEL;
    };
    const ramp = buildBrandRamp({ accent: ACCENT, brand: BRAND, statuses: STATUSES, count: 8, compute });
    expect(ramp).toHaveLength(8);
    expect(ramp[0]).toBe(ACCENT);
    expect(new Set(ramp).size).toBe(8);
    ramp.forEach((c) => expect(parseComputedRgb(c)).not.toBeNull());
  });

  test('the ramp never contains empty strings even when statuses are missing', () => {
    const compute = (expression) => {
      if (expression.startsWith('var(')) return ACCENT;
      return SENTINEL;
    };
    const ramp = buildBrandRamp({ accent: ACCENT, count: 6, compute });
    expect(ramp).toHaveLength(6);
    ramp.forEach((c) => expect(c).not.toBe(''));
  });

  test('no accent and no brand yields an empty ramp (nothing to derive from)', () => {
    const compute = jest.fn();
    expect(buildBrandRamp({ compute })).toEqual([]);
    expect(compute).not.toHaveBeenCalled();
  });

  test('47° fallback rotations are distinct for a practical count', () => {
    const angles = Array.from({ length: 8 }, (_, i) => (47 * (i + 1)) % 360);
    expect(new Set(angles).size).toBe(8);
  });
});

describe('chartColors — buildSatisfactionScale contract', () => {
  const STATUSES = {
    success: 'rgb(20, 160, 90)',
    warning: 'rgb(230, 170, 20)',
    danger: 'rgb(220, 60, 50)'
  };

  test('the scale is danger → mix → warning → mix → success', () => {
    let n = 0;
    // NOTE: starts at 10 so the canned outputs can never collide with SENTINEL
    // ('rgb(1, 2, 3)') — the failure-detection would rightly reject them.
    const compute = (expression) => {
      if (expression.startsWith('var(')) return expression;
      n += 1;
      return `rgb(${n + 10}, ${n + 11}, ${n + 12})`;
    };
    const scale = buildSatisfactionScale(STATUSES, { compute });
    expect(scale).toHaveLength(5);
    expect(scale[0]).toBe(STATUSES.danger);
    expect(scale[2]).toBe(STATUSES.warning);
    expect(scale[4]).toBe(STATUSES.success);
    expect(new Set(scale).size).toBe(5);
  });

  test('dimmed mode steps every entry via the fallback when expressions are unsupported', () => {
    const compute = (expression) => {
      if (expression.startsWith('var(')) return expression;
      return SENTINEL;
    };
    const scale = buildSatisfactionScale(STATUSES, { dimmed: true, compute });
    expect(scale).toHaveLength(5);
    scale.forEach((c) => {
      expect(c).not.toBe('');
      expect(c).not.toBe(SENTINEL);
    });
    // dimmed danger must differ from the raw danger
    expect(scale[0]).not.toBe(STATUSES.danger);
  });

  test('missing status tokens yield an empty scale', () => {
    expect(buildSatisfactionScale({ danger: 'rgb(1,2,3)' })).toEqual([]);
  });
});

describe('chartColors — buildSatisfactionBands (the gauge projection, review F2/F4)', () => {
  const STATUSES = { success: 'rgb(20, 160, 90)', warning: 'rgb(230, 170, 20)', danger: 'rgb(220, 60, 50)' };
  const failing = () => SENTINEL; // mixes resolve through the pure lerp fallback

  test('projects the scale to [0, 2, 3, 4] — the pre-T1 surface semantics', () => {
    // poor=danger, average=warning, good=warning→success mix, excellent=success:
    // the hardcoded pre-T1 scales painted 70-80 flat warning-orange and 80-90
    // green, and this pick restores exactly that on both charts. (Round 1's
    // [0,1,2,4] misread the reference and repainted the good band orange.)
    const bands = buildSatisfactionBands(STATUSES, { compute: failing });
    expect(bands).toEqual([
      'rgb(220, 60, 50)', // poor — danger
      'rgb(230, 170, 20)', // average — warning
      'rgb(125, 165, 55)', // good — warning→success mix (the lerp fallback)
      'rgb(20, 160, 90)' // excellent — success
    ]);
  });

  test('a missing status token degrades each band to its nearest available token', () => {
    // F4: a band the scale cannot produce never hands ApexCharts an empty
    // color — it degrades to the nearest raw status token, and a fully
    // unresolvable set yields [] (ApexCharts' default palette).
    expect(buildSatisfactionBands({ danger: 'rgb(1, 2, 3)' }, { compute: failing })).toEqual([
      'rgb(1, 2, 3)', // poor → danger
      'rgb(1, 2, 3)', // average → warning missing → danger
      'rgb(1, 2, 3)' // good → warning/success missing → danger
    ]);
    expect(buildSatisfactionBands({}, { compute: failing })).toEqual([]);
  });
});

describe('chartColors — oklch normalization (review F1) and pure fallbacks (F5/F6)', () => {
  test('oklch pins: the achromatic axis converts exactly', () => {
    expect(normalizeComputedColor('oklch(1 0 0)')).toBe('rgb(255, 255, 255)');
    expect(normalizeComputedColor('oklch(0 0 0)')).toBe('rgb(0, 0, 0)');
    // L=0.5 gray → linear 0.125 → gamma 0.3886 → 99 per channel.
    expect(normalizeComputedColor('oklch(0.5 0 0)')).toBe('rgb(99, 99, 99)');
  });

  test('oklch pins: the sRGB primaries at their published OKLch values', () => {
    // #FF0000 = oklch(0.628 0.258 29.23); #0000FF = oklch(0.452 0.313 264.05).
    const red = normalizeComputedColor('oklch(0.628 0.258 29.23)').match(/\d+/g).map(Number);
    expect(red[0]).toBeGreaterThanOrEqual(250);
    expect(red[1]).toBeLessThanOrEqual(5);
    expect(red[2]).toBeLessThanOrEqual(5);
    const blue = normalizeComputedColor('oklch(0.452 0.313 264.05)').match(/\d+/g).map(Number);
    expect(blue[0]).toBeLessThanOrEqual(5);
    expect(blue[1]).toBeLessThanOrEqual(5);
    expect(blue[2]).toBeGreaterThanOrEqual(250);
  });

  test('rgb() input passes through unchanged; unparseable input fails to empty', () => {
    expect(normalizeComputedColor('rgb(10, 20, 30)')).toBe('rgb(10, 20, 30)');
    expect(normalizeComputedColor('lab(50% 20 30)')).toBe('');
    expect(normalizeComputedColor('var(--fg)')).toBe('');
    expect(normalizeComputedColor('')).toBe('');
  });

  test('hslRotate transforms an oklch input instead of echoing it', () => {
    const base = normalizeComputedColor('oklch(0.628 0.258 29.23)');
    const rotated = hslRotate('oklch(0.628 0.258 29.23)', 120);
    expect(rotated.startsWith('rgb(')).toBe(true);
    expect(rotated).not.toBe(base);
  });

  test('mix gains a pure lerp fallback for degraded engines', () => {
    const failing = () => SENTINEL;
    expect(mix('rgb(0, 0, 0)', 'rgb(255, 255, 255)', 50, failing)).toBe('rgb(128, 128, 128)');
    // the oklch side normalizes first: gray 99 halfway toward white 255
    expect(mix('oklch(0.5 0 0)', 'rgb(255, 255, 255)', 50, failing)).toBe('rgb(177, 177, 177)');
    // an input even the fallback cannot parse degrades to empty, never the sentinel
    expect(mix('lab(50% 20 30)', 'rgb(255, 255, 255)', 50, failing)).toBe('');
  });

  test('fade gains a pure alpha fallback for degraded engines', () => {
    const failing = () => SENTINEL;
    expect(fade('rgb(255, 0, 0)', 30, failing)).toBe('rgba(255, 0, 0, 0.30)');
    expect(fade('var(--accent)', 30, failing)).toBe('');
  });

  test('the ramp fills to count even when the base arrives as oklch and expressions fail', () => {
    // The F1 regression shape: pre-fix, hslRotate echoed the oklch base, every
    // fallback step deduped to nothing, and the ramp came back SHORT of count.
    const compute = (expression) => (expression.startsWith('var(') ? 'oklch(0.628 0.258 29.23)' : SENTINEL);
    const ramp = buildBrandRamp({ accent: 'oklch(0.628 0.258 29.23)', count: 8, compute });
    expect(ramp).toHaveLength(8);
    expect(new Set(ramp).size).toBe(8);
    ramp.forEach((c) => expect(parseComputedRgb(c)).not.toBeNull());
  });
});
