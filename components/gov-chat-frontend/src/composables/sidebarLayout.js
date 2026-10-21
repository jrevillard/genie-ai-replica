// src/composables/sidebarLayout.js
//
// The bound policy for both sidebars, plus the arithmetic that keeps
// the centre column above its usable floor no matter what the user
// drags or what a stored width says.
//
// This is a layout module, not a Vuex store: App.vue owns the left
// sidebar and ChatBotComponent owns the right, and the two live in
// different subtrees (the right sits inside the router-view, so it is
// not a child of App.vue). Rather than thread a shared reactive
// singleton through the router, each side reads its own width from
// localStorage and recomputes its bound from the *other* side's
// stored width. localStorage is the bus; there is exactly one writer
// per key, so a read is always current.

// --- The numbers -----------------------------------------------------
//
// Defaults are the widths the panels shipped with before the resize
// feature, so a first-run user sees exactly the layout they saw
// before, and a double-click (restore default) lands on it.
export const SIDEBAR_DEFAULTS = Object.freeze({ left: 450, right: 320 });

// Minimums, derived from each panel's own content rather than from a
// round number.
//
// left 300 px — MEASURED, not reasoned. The panel is
//   300 (sidebar) − 24 (handle) − 1 (border) = 275 px,
// and the weather widget inside it takes 16 px of padding and a 1 px
// border, leaving a 227 px content box. Rendered on the running build
// with the widget's populated markup, the three-day forecast row fits
// at 227 px and overflows below it: at a 259 px widget (a 280 px
// sidebar) the row ran 16 px past the content box, at 239 px
// (a 260 px sidebar) 36 px, at 199 px (a 240 px sidebar) 52 px. The
// overflow was invisible to a scrollWidth check — the widget does not
// scroll — and was found by comparing each child's bounding rect
// against the content box. 300 px is also two thirds of the shipped
// 450 px default, so it reads as a deliberate half-way mark rather
// than a measurement that happened to land there.
//
// The widget now reflows instead of overflowing (`flex-wrap` plus
// `min-width: 0` on the day), so 300 px is about the forecast keeping
// its three days on one row rather than about content being cut. The
// floor would be lower if the widget could reflow and stay readable.
//
// right 240 px — a READ-OFF-THE-CSS judgement, not a measurement. The
// panel's document cards show a title and a URL on their own lines
// plus a five-row detail list whose label and value share a flex row;
// the widest label ("Confidence:") plus a plausible value ("100.00%")
// needs about 150 px, which leaves room for the icon column and the
// card's 16 px padding at 240. It could not be measured: the fidelity
// environment has no related documents, so the panel renders empty.
// Stated as a judgement rather than dressed up as a measurement.
export const SIDEBAR_MIN_WIDTHS = Object.freeze({ left: 300, right: 240 });

// Hard caps: the width past which a panel looks disproportionate to
// its content. 600 px for the left is roughly the width the tree
// needs before its two text columns stop reflowing into a wider
// block with nothing to fill it; 480 for the right is the point at
// which a document card stops reading as a card and starts reading
// as a paragraph. Also guesses, read off the design intent rather
// than measured.
export const SIDEBAR_MAX_WIDTHS = Object.freeze({ left: 600, right: 480 });

// The centre's usable minimum. DERIVED, not chosen: the quick-help
// grid's `auto-fit minmax(--qh-card-min, 1fr)` with
// `--qh-card-min: 217px` and `--space-xl: 32px` needs
//   2 × 217 + 32 = 466 px
// to render two columns, and the responsive-layout spec derives the
// column count from exactly that arithmetic. 480 px is the next
// whole number above 466, so the centre keeps two columns at its
// own floor.
export const CENTRE_MIN_WIDTH = 480;

// The horizontal space inside the viewport that the centre column
// does not get. Not a gap token: it is what the two sidebars cannot
// have, so the clamp has to account for all of it or the floor is
// missed by however much is unaccounted for.
//
//   16 px — the two `--space-sm` (8 px) inter-panel gaps, from
//           App.vue's `.main-container` and ChatBotComponent's
//           `.app-container`;
//    8 px — `.content-area`'s own left padding, also `--space-sm`.
//
// The third term is the one an earlier revision left out, and it is
// why the measured centre came out 8 px under its floor at exactly
// the viewport where the clamp bound.
const CENTRE_CHROME_PX = 24;

// The breakpoint at which both sidebars stop being off-canvas and
// become in-flow reservations. Shared with the CSS in both sidebar
// components and with App.vue's `showLeftHandle` / ChatBot's
// `showRightHandle`; if these four ever diverge, a resize can leave
// the app in a state its CSS does not describe.
export const SIDEBAR_INFLOW_MIN_WIDTH = 1400;

// --- Persistence -----------------------------------------------------
//
// One key per concern, reusing the mechanism the collapsed state
// already used (localStorage) rather than inventing a second store.
// `sidebarOpen` is the app's existing key for the left panel's open
// state and is read verbatim, so an upgrade does not reset anyone's
// preference. Both open keys store "open".
export const KEY_WIDTH_LEFT = 'sidebarWidthLeft';
export const KEY_WIDTH_RIGHT = 'sidebarWidthRight';
export const KEY_OPEN_LEFT = 'sidebarOpen';
export const KEY_OPEN_RIGHT = 'sidebarOpenRight';

export function readStoredWidth(side) {
  const key = side === 'left' ? KEY_WIDTH_LEFT : KEY_WIDTH_RIGHT;
  return readInt(key, SIDEBAR_DEFAULTS[side]);
}

export function readStoredOpen(side, fallback) {
  const key = side === 'left' ? KEY_OPEN_LEFT : KEY_OPEN_RIGHT;
  return readBool(key, fallback);
}

export function persistWidth(side, value) {
  write(side === 'left' ? KEY_WIDTH_LEFT : KEY_WIDTH_RIGHT, Math.round(value));
}

export function persistOpen(side, open) {
  // Both keys store "open", the polarity their names and their
  // reader use. Storing "collapsed" on the right instead made the
  // same key mean opposite things on the two sides: a stored `'true'`
  // was an open left panel and a collapsed right one, so a value
  // written by either side was misread by anything that read it back.
  const key = side === 'left' ? KEY_OPEN_LEFT : KEY_OPEN_RIGHT;
  write(key, open ? 'true' : 'false');
}

function readInt(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function readBool(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // localStorage can be disabled (private mode, quota exhausted).
    // The layout still works for this session; only the preference
    // is lost, which is the right trade.
  }
}

// --- The clamp -------------------------------------------------------
//
// The dynamic maximum for one side: the smaller of the hard cap and
// whatever leaves the centre its usable minimum once the *other*
// sidebar's width is subtracted. Passing the other side's width is
// what makes the two clamps compose — each side alone cannot see the
// reservation the other has already made.
//
// `otherWidth` must be the width that side is *currently in force*,
// not the one it has stored. Clamping against the stored value
// over-reserves whenever both sides hold a width that neither can
// currently use, and the over-reservation differs per viewport: at
// 1400 px the two clamps measured 424 and 304 against stored 600 and
// 480, at 1600 px they released to 600 and 480, and the centre went
// 648 -> 496 as the window *widened*. The ladder has to be monotonic
// in the viewport, and only clamping against the in-force width makes
// it so: the pair then sums to exactly the budget rather than to some
// per-viewport approximation of it.
export function computeMaxFor(side, otherWidth, viewport) {
  const hardCap = SIDEBAR_MAX_WIDTHS[side];
  const centreFloor = viewport - CENTRE_MIN_WIDTH - otherWidth - CENTRE_CHROME_PX;
  return Math.min(hardCap, Math.max(SIDEBAR_MIN_WIDTHS[side], centreFloor));
}

// Apply that maximum as a floor on the value. Called on drag, on
// restore-from-storage and on every viewport change — a width stored
// at 1920 px is meaningless at 1400 px, and applying it blindly is
// exactly the failure the spec must catch.
//
// This is a RENDERING bound, not a stored one. The caller keeps the
// stored value untouched when the clamp binds, so a user who sets a
// wide panel on a large monitor and later narrows the window gets it
// back when they widen the window again.
export function clampWidth(side, value, otherWidth, viewport) {
  const max = computeMaxFor(side, otherWidth, viewport);
  return Math.max(SIDEBAR_MIN_WIDTHS[side], Math.min(max, value));
}
