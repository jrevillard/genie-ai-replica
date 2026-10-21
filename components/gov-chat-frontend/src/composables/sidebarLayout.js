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
// round number:
//
//   left 240 px — the services tree renders a category row of
//     icon + label, and its sub-items indent by 16 px with a
//     disclosure caret. At 240 px minus the panel's 8 px padding
//     either side, a sub-item has 208 px of text before it starts
//     truncating mid-word. Below that the tree stops being
//     navigable, which is the only thing the panel is for.
//
//   right 240 px — the document cards show a title and a URL on
//     their own lines, plus a 5-row detail list whose labels and
//     values sit on one flex row. The widest label ("Confidence:")
//     plus the widest plausible value ("100.00%") needs ~150 px;
//     240 leaves room for the icon column and the card's 16 px
//     padding on both sides with a margin.
//
//   Both are GUESSES in the sense that no measurement of the content
//   was taken at these widths — they are read off the CSS the panels
//   already ship. They are stated as such rather than dressed up as
//   measurements.
export const SIDEBAR_MIN_WIDTHS = Object.freeze({ left: 240, right: 240 });

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

// The gap the flex layout puts between a sidebar and the centre.
// `--space-sm` = 8 px, from App.vue's `.main-container { gap }` and
// ChatBotComponent's `.app-container { gap }`. Two of them sit
// between the two sidebars' inner edges.
const LAYOUT_GAP_PX = 8;

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
// `sidebarOpen` is the app's existing key for the left's collapsed
// state and is read verbatim, so an upgrade does not reset anyone's
// preference.
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

export function persistOpen(side, collapsed) {
  // The left's key predates the feature and stores "open", not
  // "collapsed" — it is kept in its own polarity so an existing
  // value still reads correctly.
  const key = side === 'left' ? KEY_OPEN_LEFT : KEY_OPEN_RIGHT;
  write(key, side === 'left' ? (collapsed ? 'false' : 'true') : collapsed ? 'true' : 'false');
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
// sidebar's current width is subtracted. Passing the other side's
// width is what makes the two clamps compose — each side alone
// cannot see the reservation the other has already made.
export function computeMaxFor(side, otherWidth, viewport) {
  const hardCap = SIDEBAR_MAX_WIDTHS[side];
  const centreFloor = viewport - CENTRE_MIN_WIDTH - otherWidth - LAYOUT_GAP_PX * 2;
  return Math.min(hardCap, Math.max(SIDEBAR_MIN_WIDTHS[side], centreFloor));
}

// Apply that maximum as a floor on the value. Called on drag, on
// restore-from-storage and on every viewport change — a width stored
// at 1920 px is meaningless at 1400 px, and applying it blindly is
// exactly the failure the spec must catch.
export function clampWidth(side, value, otherWidth, viewport) {
  const max = computeMaxFor(side, otherWidth, viewport);
  return Math.max(SIDEBAR_MIN_WIDTHS[side], Math.min(max, value));
}
