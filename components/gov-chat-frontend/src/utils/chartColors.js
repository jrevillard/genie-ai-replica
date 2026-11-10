/**
 * chartColors - resolves DS design tokens into CONCRETE color strings for chart libraries.
 *
 * WHY THIS EXISTS (T1, admin-ux review §2): chart libraries cannot resolve CSS var()
 * references. ECharts paints to canvas (fillStyle parses CSS colors, not references);
 * ApexCharts applies config colors as SVG presentation attributes, and var() is invalid
 * inside presentation attributes (css-variables-1 — the value is dropped at parse).
 * The old bridge shipped 'var(--fg)'-style strings and a hardcoded stock palette; the
 * strings silently failed everywhere they reached SVG attributes or canvas, and the
 * palette ignored --brand and every deployment flavour.
 *
 * HOW: each token is resolved through a hidden probe element (set style.color, read the
 * computed value) — this works for ANY token definition, including theme-variables.css's
 * relative-OKLch chains derived from --brand. The categorical ramp is derived with
 * relative-OKLch / color-mix EXPRESSIONS the browser engine evaluates, so there is no
 * hand-written color math on the primary path. Where an expression is unsupported (the
 * probe's sentinel read-back catches invalid values), derivation falls back to a small
 * pure HSL rotation — deterministic and unit-testable.
 */

const SENTINEL = 'rgb(1, 2, 3)';

/** The DS token set charts consume (resolved once per theme evaluation). */
const TOKEN_SET = [
  '--fg',
  '--surface',
  '--border',
  '--border-light',
  '--accent',
  '--accent-muted',
  '--muted',
  '--brand',
  '--success',
  '--warning',
  '--danger',
  '--info'
];

let probeEl = null;

/**
 * Lazily create the one hidden probe element used for all resolutions.
 * Appended to document.body so it inherits html[data-theme] custom properties.
 */
function getProbe(doc) {
  if (!probeEl || !probeEl.isConnected) {
    const d = doc || document;
    probeEl = d.createElement('span');
    probeEl.setAttribute('aria-hidden', 'true');
    probeEl.style.position = 'absolute';
    probeEl.style.visibility = 'hidden';
    probeEl.style.pointerEvents = 'none';
    probeEl.style.lineHeight = '0';
    d.body.appendChild(probeEl);
  }
  return probeEl;
}

/**
 * The default compute strategy: evaluate a CSS color expression in the live
 * document and return the computed value. A SENTINEL pre-write detects invalid
 * values: the browser drops an unparseable color to the inherited/initial value,
 * so a read that still equals the sentinel means the expression never applied.
 * Returns '' when the expression could not be resolved to a different color.
 */
function domCompute(expression, doc) {
  if (typeof document === 'undefined' || !document.body) return '';
  try {
    const el = getProbe(doc);
    el.style.color = SENTINEL;
    el.style.color = expression;
    const computed = window.getComputedStyle(el).color;
    if (!computed || computed === SENTINEL || computed === 'rgba(0, 0, 0, 0)') return '';
    return computed;
  } catch {
    return '';
  }
}

/** Resolve one DS token (e.g. '--accent') to its computed color. */
function resolveTokenColor(token, compute = domCompute) {
  if (!token || token.charAt(0) !== '-') return '';
  return compute(`var(${token})`);
}

/** Evaluate a full CSS color expression (relative OKLch, color-mix, ...). */
function resolveExpression(expression, compute = domCompute) {
  return compute(expression);
}

/* ── pure HSL fallback path (no DOM) ──────────────────────────────────── */

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** Parse 'rgb(r, g, b)' / 'rgba(r, g, b, a)' (the computed format) into [r,g,b,a]. */
function parseComputedRgb(str) {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s]+([\d.]+))?\s*\)$/i.exec(str || '');
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h, s, l) {
  const hn = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(channel(hn + 1 / 3) * 255), Math.round(channel(hn) * 255), Math.round(channel(hn - 1 / 3) * 255)];
}

/**
 * Rotate a computed rgb() string's hue by deltaDeg (pure fallback path).
 * Non-parseable input returns the input unchanged.
 */
function hslRotate(color, deltaDeg) {
  const rgb = parseComputedRgb(color);
  if (!rgb) return color;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const [r, g, b] = hslToRgb(h + deltaDeg, s, l);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Lighten/darken a computed rgb() string in HSL space (pure fallback path). */
function hslLightness(color, delta) {
  const rgb = parseComputedRgb(color);
  if (!rgb) return color;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const [r, g, b] = hslToRgb(h, s, clamp(l + delta, 0.05, 0.95));
  return `rgb(${r}, ${g}, ${b})`;
}

/** A compute result that could not be resolved: empty, or the sentinel value
 * an injected compute returns to signal "this expression is unsupported". */
function isFailure(value) {
  return !value || value === SENTINEL;
}

/* ── expression helpers (browser-evaluated primary path) ─────────────── */

/** Mix two colors perceptually (OKLch) — b's share is pct. */
function mix(a, b, pct, compute = domCompute) {
  if (!a || !b) return '';
  const out = resolveExpression(`color-mix(in oklch, ${a} ${100 - pct}%, ${b} ${pct}%)`, compute);
  return isFailure(out) ? '' : out;
}

/** Rotate hue via relative OKLch, falling back to pure HSL rotation. */
function shiftHue(color, deltaDeg, compute = domCompute) {
  if (!color) return '';
  const viaCss = resolveExpression(`oklch(from ${color} l c calc(mod(h + ${deltaDeg}, 360)))`, compute);
  return isFailure(viaCss) ? hslRotate(color, deltaDeg) : viaCss;
}

/** Step lightness via relative OKLch, falling back to pure HSL math. */
function shiftLightness(color, delta, compute = domCompute) {
  if (!color) return '';
  const viaCss = resolveExpression(`oklch(from ${color} calc(clamp(0.08, calc(l + ${delta}), 0.94)) c h)`, compute);
  return isFailure(viaCss) ? hslLightness(color, delta) : viaCss;
}

/** Fade toward transparency (tooltip/area fills). */
function fade(color, pct, compute = domCompute) {
  if (!color) return '';
  const out = resolveExpression(`color-mix(in srgb, ${color} ${pct}%, transparent)`, compute);
  return isFailure(out) ? '' : out;
}

/**
 * The brand-derived categorical ramp (David's T1 decision: series colors derive
 * from --brand + the four status tokens; status hues stay available for semantic
 * series). Shape: the accent itself, then brand-anchored infusions toward each
 * status hue, then two perceptual hue rotations, then a deep tone toward --fg.
 * Every entry is individually guarded: a derivation that cannot resolve is
 * replaced by a pure-HSL fallback step from the accent, so the ramp is ALWAYS
 * `count` distinct concrete colors and never contains ''.
 */
function buildBrandRamp({ accent, brand, statuses = {}, fg = '', count = 8, compute = domCompute } = {}) {
  const base = accent || brand;
  if (!base) return [];
  const st = statuses || {};
  const wanted = [
    base,
    st.info ? mix(base, st.info, 35, compute) : '',
    st.success ? mix(base, st.success, 30, compute) : '',
    st.warning ? mix(base, st.warning, 30, compute) : '',
    st.danger ? mix(base, st.danger, 25, compute) : '',
    shiftHue(base, 140, compute),
    shiftHue(base, -140, compute),
    fg ? mix(base, fg, 25, compute) : ''
  ];

  const ramp = [];
  const seen = new Set();
  const push = (c) => {
    if (isFailure(c) || seen.has(c)) return;
    seen.add(c);
    ramp.push(c);
  };
  wanted.forEach(push);

  // Fill any shortfall with pure-HSL rotations from the accent (always succeeds):
  // 47° steps stay distinct mod 360 for any practical count.
  let guard = 0;
  while (ramp.length < count && guard < count * 4) {
    push(hslRotate(base, 47 * (guard + 1)));
    guard += 1;
  }
  return ramp.slice(0, count);
}

/**
 * The satisfaction scale (poor → excellent) used by the gauge and the heatmap,
 * derived from the status tokens: danger → warning → success with perceptual
 * mix steps between. `dimmed` produces the heatmap's dark-mode variants by
 * stepping lightness down via relative OKLch (HSL fallback applies).
 */
function buildSatisfactionScale(statuses = {}, { dimmed = false, compute = domCompute } = {}) {
  const { danger = '', warning = '', success = '' } = statuses || {};
  if (!danger || !warning || !success) return [];
  const steps = [danger, mix(danger, warning, 50, compute), warning, mix(warning, success, 50, compute), success];
  // Degraded compute (color-mix unsupported): a mix that cannot resolve takes
  // its LEFT anchor so the scale stays total — the browser path resolves every
  // mix, this only fires on the fallback path.
  for (let i = 0; i < steps.length; i += 1) {
    if (!steps[i]) steps[i] = steps[i - 1] || steps[i + 1] || '';
  }
  if (!dimmed) return steps;
  return steps.map((c) => {
    if (isFailure(c)) return '';
    const dimmedOut = resolveExpression(`oklch(from ${c} calc(l * 0.45) c h)`, compute);
    return isFailure(dimmedOut) ? hslLightness(c, -0.2) : dimmedOut;
  });
}

/**
 * Resolve the full DS token set charts need. Returns concrete strings ('' for a
 * token the document cannot resolve — callers decide their own guard).
 */
function resolveChartTokens(compute = domCompute) {
  const out = {};
  TOKEN_SET.forEach((t) => {
    out[t] = resolveTokenColor(t, compute);
  });
  return out;
}

export {
  SENTINEL,
  TOKEN_SET,
  domCompute,
  resolveTokenColor,
  resolveExpression,
  mix,
  shiftHue,
  shiftLightness,
  fade,
  hslRotate,
  hslLightness,
  parseComputedRgb,
  buildBrandRamp,
  buildSatisfactionScale,
  resolveChartTokens
};
