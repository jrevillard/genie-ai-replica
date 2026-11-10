/**
 * chartColors - resolves DS design tokens into CONCRETE color strings for chart libraries.
 *
 * WHY THIS EXISTS (T1, admin-ux review §2): chart libraries cannot resolve CSS var()
 * references — ApexCharts applies config colors as SVG presentation attributes (SVG.js
 * .attr(), verified against the installed bundle: 137 attr sites, one .style.fill for
 * dataLabels), and var() is invalid inside presentation attributes per css-variables-1
 * (the value is dropped at parse). The old bridge shipped 'var(--fg)'-style strings and
 * a hardcoded stock palette; the strings silently failed everywhere they reached
 * attributes, and the palette ignored --brand and every deployment flavour.
 *
 * HOW: each token is resolved through a hidden probe element (set style.color, read the
 * computed value) — this works for ANY token definition, including theme-variables.css's
 * relative-OKLch chains derived from --brand. The categorical ramp is derived with
 * relative-OKLch / color-mix EXPRESSIONS the browser engine evaluates, so there is no
 * hand-written color math on the primary path. Where an expression is unsupported (the
 * probe's sentinel read-back catches invalid values), derivation falls back to a small
 * pure HSL rotation — deterministic and unit-testable. The pure path normalizes its
 * input FIRST (review F1): browsers serialize computed colors back as oklch(...) when
 * the token is defined in oklch, and an oklch string must convert — not echo — or
 * every fallback silently no-ops and the derived ramp comes up short.
 *
 * NOTE ON THE EXPORT SURFACE: deliberately wider than production needs — the
 * parse/fallback internals are exported test-facing so the pure path can be
 * pinned directly; production consumes the builders through useChartTheme.
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
function getProbe() {
  if (!probeEl || !probeEl.isConnected) {
    probeEl = document.createElement('span');
    probeEl.setAttribute('aria-hidden', 'true');
    probeEl.style.position = 'absolute';
    probeEl.style.visibility = 'hidden';
    probeEl.style.pointerEvents = 'none';
    probeEl.style.lineHeight = '0';
    document.body.appendChild(probeEl);
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
function domCompute(expression) {
  if (typeof document === 'undefined' || !document.body) return '';
  try {
    const el = getProbe();
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

/**
 * Parse the computed oklch() form — what getComputedStyle().color returns when
 * the token is DEFINED in oklch (theme-variables.css) on engines that serialize
 * computed colors in their specified color space. Accepts number-or-percentage
 * L/C, a 'deg' hue suffix, and an '/ alpha' tail. Returns [l, c, hDeg, a] or null.
 */
function parseComputedOklch(str) {
  const m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+(-?[\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/i.exec(str || '');
  if (!m) return null;
  const num = (v) => Number(String(v).replace(/%$/, ''));
  const l = String(m[1]).endsWith('%') ? num(m[1]) / 100 : num(m[1]);
  // C percentages top out at the 0.4 chroma ceiling (css-color-4).
  const c = String(m[2]).endsWith('%') ? num(m[2]) / 250 : num(m[2]);
  const h = num(m[3]);
  const a = m[4] === undefined ? 1 : String(m[4]).endsWith('%') ? num(m[4]) / 100 : num(m[4]);
  return [l, c, h, a];
}

/**
 * Convert OKLch components to a concrete sRGB 'rgb(r, g, b)' string — the
 * standard OKLab → linear-sRGB transform (Ottosson 2020; what browsers
 * implement). Alpha is dropped on this path: chart series are opaque, and
 * fade() re-applies alpha itself.
 */
function oklchToRgbString([l, c, hDeg]) {
  const hr = (hDeg * Math.PI) / 180;
  const aAxis = c * Math.cos(hr);
  const bAxis = c * Math.sin(hr);
  const lPrime = l + 0.3963377774 * aAxis + 0.2158037573 * bAxis;
  const mPrime = l - 0.1055613458 * aAxis - 0.0638541728 * bAxis;
  const sPrime = l - 0.0894841775 * aAxis - 1.291485548 * bAxis;
  const lCube = lPrime * lPrime * lPrime;
  const mCube = mPrime * mPrime * mPrime;
  const sCube = sPrime * sPrime * sPrime;
  const linear = [
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube
  ];
  const gamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const [r, g, b] = linear.map((v) => Math.round(clamp(gamma(v), 0, 1) * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Normalize a computed color to the concrete rgb()/rgba() form the pure
 * fallback path operates on: rgb/rgba pass through, oklch converts to sRGB,
 * anything else returns '' — the failure marker callers guard with isFailure.
 */
function normalizeComputedColor(str) {
  if (!str) return '';
  if (parseComputedRgb(str)) return str;
  const oklch = parseComputedOklch(str);
  return oklch ? oklchToRgbString(oklch) : '';
}

/** Normalize then parse — [r, g, b, a] or null. */
function toRgbTuple(color) {
  const normalized = normalizeComputedColor(color);
  return normalized ? parseComputedRgb(normalized) : null;
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
 * Rotate a computed color's hue by deltaDeg (pure fallback path). The input is
 * normalized first (review F1): an oklch(...) computed value converts to sRGB
 * and is then rotated — it is NOT echoed back. Unparseable input returns ''
 * (the isFailure marker).
 */
function hslRotate(color, deltaDeg) {
  const rgb = toRgbTuple(color);
  if (!rgb) return '';
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const [r, g, b] = hslToRgb(h + deltaDeg, s, l);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Step lightness on a computed color in HSL space (pure fallback path). */
function hslLightness(color, delta) {
  const rgb = toRgbTuple(color);
  if (!rgb) return '';
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
  if (!isFailure(out)) return out;
  // Pure fallback (review F5): a linear-sRGB lerp — not perceptual, but the
  // degraded-engine path only needs plausible distinct steps, not precision.
  const ra = toRgbTuple(a);
  const rb = toRgbTuple(b);
  if (!ra || !rb) return '';
  const t = pct / 100;
  const channel = (i) => Math.round(ra[i] + (rb[i] - ra[i]) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
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
  if (!isFailure(out)) return out;
  // Pure fallback (review F5): apply the alpha directly.
  const rgb = toRgbTuple(color);
  if (!rgb) return '';
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(pct / 100).toFixed(2)})`;
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
  // Normalized first (review F1): every derivation and the 47° shortfall fill
  // below parse this base — an oklch() accent must convert, not echo.
  const base = normalizeComputedColor(accent || brand);
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
  const d = normalizeComputedColor(danger);
  const w = normalizeComputedColor(warning);
  const s = normalizeComputedColor(success);
  if (!d || !w || !s) return [];
  const steps = [d, mix(d, w, 50, compute), w, mix(w, s, 50, compute), s];
  // Degraded compute (color-mix unsupported): a mix that cannot resolve takes
  // its LEFT anchor so the scale stays total — the anchors at 0/2/4 are
  // guaranteed non-empty above, so a left anchor always exists for the only
  // indexes (1, 3) that can ever be empty.
  for (let i = 0; i < steps.length; i += 1) {
    if (!steps[i]) steps[i] = steps[i - 1];
  }
  if (!dimmed) return steps;
  return steps.map((c) => {
    if (isFailure(c)) return '';
    const dimmedOut = resolveExpression(`oklch(from ${c} calc(l * 0.45) c h)`, compute);
    return isFailure(dimmedOut) ? hslLightness(c, -0.2) : dimmedOut;
  });
}

/**
 * The gauge's four value bands (poor/low/medium/high): the satisfaction scale,
 * projected to the gauge's four ranges by picking [0, 1, 2, 4] — the
 * danger→warning mix INCLUDED (review F2: [0,2,3,4] painted 'low' pure
 * warning, one stop ahead of the scale the heatmap shows). A band the scale
 * could not produce degrades to its nearest raw status token (review F4); an
 * unresolvable set yields [] (ApexCharts' default palette) rather than empty
 * colors. The heatmap consumes buildSatisfactionScale directly — it renders
 * all five stops with its own pick semantics.
 */
function buildSatisfactionBands(statusColors = {}, { compute = domCompute } = {}) {
  const scale = buildSatisfactionScale(statusColors, { compute });
  const st = statusColors || {};
  return [
    scale[0] || st.danger || '',
    scale[1] || st.warning || st.danger || '',
    scale[2] || st.warning || '',
    scale[4] || st.success || ''
  ].filter(Boolean);
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
  parseComputedOklch,
  normalizeComputedColor,
  buildBrandRamp,
  buildSatisfactionScale,
  buildSatisfactionBands,
  resolveChartTokens
};
