<template>
  <div
    ref="stripEl"
    role="separator"
    aria-orientation="vertical"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="value"
    :aria-label="ariaLabel"
    tabindex="0"
    class="sidebar-handle"
    :class="[
      `sidebar-handle--${side}`,
      { 'sidebar-handle--collapsed': collapsed, 'sidebar-handle--dragging': isDragging }
    ]"
    @pointerdown="onPointerDown"
    @keydown="onKeyDown"
    @dblclick="onDoubleClick"
    @click.capture="onSuppressClick"
  >
    <button
      type="button"
      class="sidebar-handle__button"
      :aria-label="collapsed ? expandLabel : collapseLabel"
      :aria-expanded="!collapsed"
      @click.stop="onCollapseClick"
    >
      <ChevronLeft v-if="chevronPointsLeft" :size="14" aria-hidden="true" />
      <ChevronRight v-else :size="14" aria-hidden="true" />
    </button>
  </div>
</template>

<script>
import { ChevronLeft, ChevronRight } from '@lucide/vue';

// The keypad step for ArrowLeft/ArrowRight; the Shift modifier takes it
// to the Page Up/Down-sized "fast" step. Both are snap-to-grid so the
// drag's numeric output is predictable from a keyboard gesture, which
// the spec needs to assert against.
const KEY_STEP_PX = 8;
const KEY_STEP_FAST_PX = 40;

// How far the pointer must travel before a press counts as a drag
// rather than a click.
//
// A click is, by definition, zero displacement: the press and the
// release happen at the same pixel. What separates a click from a
// drag is not intent but the hand — measured sub-pixel on a desk
// mouse and around 1-2 px of tremor on a trackpad, so 4 px is an
// order of magnitude clear of every accidental movement.
//
// It cannot swallow a slow deliberate drag, because the step it must
// beat is the one a user already controls from the keyboard: the
// arrow keys move 8 px. Anything past 4 px has therefore already
// resized the panel by the time the pointer lifts, and a drag the
// user abandons after 3 px has by definition not resized anything.
const DRAG_THRESHOLD_PX = 4;

export default {
  name: 'SidebarHandle',
  components: { ChevronLeft, ChevronRight },
  props: {
    // The side of the panel this handle sits on. Drives chevron
    // orientation and the cursor that points to a draggable edge.
    side: {
      type: String,
      default: 'right',
      validator: (v) => ['left', 'right'].includes(v)
    },
    // The current sidebar width in pixels, mirrored to aria-valuenow.
    value: {
      type: Number,
      required: true
    },
    // The hard minimum width below which the panel's own content can no
    // longer fit. The handle clamps to this floor on drag and on
    // viewport-restored storage.
    min: {
      type: Number,
      required: true
    },
    // The dynamic maximum width — bounded by the hard cap AND the rule
    // that the centre must keep its usable minimum, expressed as
    // viewport - MIN_CENTRE - otherSidebarWidth - 2 * gap. The parent
    // computes this on every drag and resize, so the handle itself
    // stays free of viewport math and only enforces its own bounds.
    max: {
      type: Number,
      required: true
    },
    // Whether the sidebar is currently collapsed. Drives chevron
    // orientation; collapsing reduces width to 0 below the strip's min.
    collapsed: {
      type: Boolean,
      default: false
    },
    // Aria label for the strip's role=separator. The button inside has
    // its own label describing collapse.
    ariaLabel: {
      type: String,
      default: 'Resize sidebar'
    },
    expandLabel: {
      type: String,
      default: 'Expand sidebar'
    },
    collapseLabel: {
      type: String,
      default: 'Collapse sidebar'
    }
  },
  emits: ['input', 'drag-start', 'drag-end', 'collapse', 'reset'],
  data() {
    return {
      isDragging: false,
      // True once this press has travelled far enough to count as a
      // drag. Carried past pointerup so the click the browser fires
      // afterwards can be recognised as the tail of a drag.
      dragMoved: false,
      dragOrigin: null,
      dragStartWidth: 0,
      dragPointerId: null
    };
  },
  computed: {
    chevronPointsLeft() {
      // The chevron points inward — toward the centre — so the gesture
      // reads as "fold this side out of the way". On the left side the
      // chevron points left when expanded (fold left) and right when
      // collapsed (unfold right). Symmetric on the right side.
      if (this.side === 'left') return !this.collapsed;
      return this.collapsed;
    },
    // How a horizontal movement of the strip maps onto the panel's
    // width. The strip is the panel's RIGHT edge on the left side and
    // its LEFT edge on the right, so moving it right grows one panel
    // and shrinks the other. Both the drag and the arrow keys route
    // through this, which is what keeps the two gestures from
    // disagreeing about which way is "wider".
    widthSign() {
      return this.side === 'left' ? 1 : -1;
    }
  },
  beforeUnmount() {
    // A drag in progress when the component unmounts must release its
    // global listeners, otherwise a pointerup after teardown keeps
    // mutating state for a component that is already gone.
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  },
  methods: {
    onPointerDown(e) {
      // A press ANYWHERE on the handle arms a drag — the strip or the
      // chevron. The earlier revision refused any press whose target was
      // the button, on the reasoning that a click there would otherwise
      // also open a drag. But the button is 24 px wide in a 24 px
      // strip: that guard made a press anywhere on the only visible
      // control a non-event, and the feature was unreachable for anyone
      // who aimed at the chevron. Measured on the running build:
      // dragging the strip above the button took the sidebar 450 -> 300,
      // dragging the button did nothing at all, and clicking the button
      // collapsed it. The thing you can see was the thing you could not
      // pull.
      //
      // Drag and click are separated by MOVEMENT, not by target: a
      // press arms the drag, a pointer that travels past
      // DRAG_THRESHOLD_PX makes it a drag and suppresses the click,
      // and a press released without that travel is a click the DOM
      // delivers to the button on its own.
      //
      // Right-button on mouse, secondary button, etc. — leave those for
      // the browser's own context menu and never start a drag.
      if (e.button !== 0) return;
      this.isDragging = false;
      this.dragMoved = false;
      this.dragOrigin = e.clientX;
      this.dragStartWidth = this.value;
      this.dragPointerId = e.pointerId;
      // Deliberately NOT capturing the pointer here. Capture retargets
      // every subsequent pointer event — including the `pointerup` —
      // to the capture target, and the browser then fires the `click`
      // on the nearest common ancestor of the down and up targets,
      // which is the strip rather than the button. The chevron
      // stopped collapsing entirely: it resized correctly on a drag,
      // because that path emits from `pointermove`, and did nothing
      // on a click, because the click never reached it.
      //
      // Capture is taken in `onPointerMove` the moment a drag is
      // confirmed, which is where it is actually needed — to keep a
      // live drag alive when the pointer crosses into the panel.
      window.addEventListener('pointermove', this.onPointerMove);
      window.addEventListener('pointerup', this.onPointerUp);
      window.addEventListener('pointercancel', this.onPointerUp);
    },
    onPointerMove(e) {
      if (this.dragPointerId == null) return;
      const delta = e.clientX - this.dragOrigin;
      if (!this.isDragging) {
        // Below the threshold this is still a click in progress, so no
        // resize and no drag state yet — otherwise a hand tremor
        // during a click would nudge the panel.
        if (Math.abs(delta) < DRAG_THRESHOLD_PX) return;
        this.isDragging = true;
        this.dragMoved = true;
        this.$emit('drag-start');
        // Past this point the gesture is a drag, so retargeting the
        // pointer no longer costs anything and keeps the drag alive
        // when it leaves the strip.
        try {
          this.$refs.stripEl.setPointerCapture(e.pointerId);
        } catch {
          // Older browsers without pointer capture — the window-level
          // move listener below already covers the common case.
        }
      }
      const next = this.dragStartWidth + this.widthSign * delta;
      const clamped = Math.max(this.min, Math.min(this.max, next));
      if (clamped !== this.value) this.$emit('input', clamped);
    },
    onSuppressClick(e) {
      // A drag that began on the chevron ends with the browser firing
      // a click on it, which would collapse the panel the user just
      // resized. Swallow that one click and clear the flag so the next
      // press behaves normally.
      if (!this.dragMoved) return;
      this.dragMoved = false;
      e.preventDefault();
      e.stopPropagation();
    },
    onPointerUp() {
      if (this.dragPointerId == null) return;
      const wasDragging = this.isDragging;
      this.isDragging = false;
      this.dragOrigin = null;
      if (this.dragPointerId != null && this.$refs.stripEl) {
        try {
          this.$refs.stripEl.releasePointerCapture(this.dragPointerId);
        } catch {
          // Pointer may already be released.
        }
      }
      this.dragPointerId = null;
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
      window.removeEventListener('pointercancel', this.onPointerUp);
      if (wasDragging) this.$emit('drag-end');
    },
    onKeyDown(e) {
      // Keyboard moves the strip, exactly as the pointer does: the
      // named direction is a movement in screen space, and the panel
      // follows. ArrowRight slides the strip right, which widens a
      // LEFT panel (the strip is its right edge) and narrows a RIGHT
      // panel (the strip is its left edge). `widthSign` carries that,
      // so the two gestures cannot disagree — an earlier revision had
      // ArrowRight widen on both sides while the drag narrowed the
      // right, and the e2e drag assertions caught the split.
      //
      // Only the horizontal arrows, matching aria-orientation=
      // "vertical": the strip is a vertical divider that moves
      // horizontally, so Up/Down would have no meaning here.
      const step = e.shiftKey ? KEY_STEP_FAST_PX : KEY_STEP_PX;
      let next = this.value;
      let handled = true;
      switch (e.key) {
        case 'ArrowRight':
          next = this.value + this.widthSign * step;
          break;
        case 'ArrowLeft':
          next = this.value - this.widthSign * step;
          break;
        case 'Home':
          // Range-widget convention: Home is the low end, End the high.
          next = this.min;
          break;
        case 'End':
          next = this.max;
          break;
        case 'Enter':
        case ' ':
          // The same keys the button inside activates. Mirroring the
          // chevron's activation on the strip means a screen reader
          // user does not have to Tab past the strip to find collapse.
          this.onCollapseClick();
          break;
        default:
          handled = false;
      }
      if (!handled) return;
      const clamped = Math.max(this.min, Math.min(this.max, next));
      if (clamped !== this.value) this.$emit('input', clamped);
      e.preventDefault();
      e.stopPropagation();
    },
    onCollapseClick() {
      this.$emit('collapse');
    },
    onDoubleClick() {
      this.$emit('reset');
    }
  }
};
</script>

<style scoped>
/*
 * The strip is a 24 px-wide column on the panel's inner edge, inside
 * the panel's own box. It is a flex child rather than an overlay, so
 * a drag mutates the panel's width through the parent's style binding
 * instead of fighting absolute positioning.
 *
 * It sits INSIDE the panel rather than half-overlapping the centre,
 * which departs from the Material reference on purpose. An earlier
 * revision pulled the chevron across the panel boundary with a
 * negative margin, which put it underneath the centre's content — and
 * the centre's own z-index won. The handle was in the DOM, focusable,
 * and carried the right ARIA, and neither the chevron click nor the
 * drag reached it: Playwright reported the centre "intercepting
 * pointer events" on the element it was trying to click. A control
 * the centre paints over is not a control. Flush against the edge
 * costs nothing and cannot be occluded by the neighbour it shares a
 * boundary with.
 *
 * The panel's declared width therefore includes the strip: a panel
 * set to 450 px shows 426 px of content beside a 24 px handle.
 *
 * Tokens only. The strip is a thin translucent surface that takes an
 * accent on hover, focus and drag, so it reads as a grab target
 * rather than as a border.
 */
.sidebar-handle {
  flex: 0 0 24px;
  width: 24px;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background: color-mix(in oklch, var(--surface) 60%, transparent);
  cursor: col-resize;
  touch-action: none;
  outline: none;
  transition: background-color 0.15s ease;
}

.sidebar-handle:hover,
.sidebar-handle:focus-visible,
.sidebar-handle--dragging {
  background: color-mix(in oklch, var(--accent) 22%, var(--surface));
}

/*
 * The grip.
 *
 * A 24 px column whose only visible mark is a small chevron reads as
 * a collapse button, and the surface tint alone is not enough to say
 * "this drags" — which is the reading the user gave after the strip
 * was placed flush inside the panel. The grip is two short rules
 * above and below the chevron, the way a splitter is drawn: they say
 * "edge" rather than "button" at rest, and take the accent on hover,
 * focus or drag. Two of them rather than a solid bar, so the chevron
 * stays the thing you grab and the rules stay the thing that says
 * what grabbing does.
 *
 * A pseudo-element pair rather than two real nodes: nothing in the
 * accessibility tree, nothing for a test to trip over, and it costs
 * no markup in a component rendered twice on every page.
 */
.sidebar-handle::before,
.sidebar-handle::after {
  content: '';
  position: absolute;
  left: 50%;
  width: 2px;
  height: 28px;
  margin-left: -1px;
  border-radius: var(--radius-sm);
  background: var(--border);
  transition: background-color 0.15s ease;
  pointer-events: none;
}

/* Centred on the strip's own height, flanking the chevron's 24 px. */
.sidebar-handle::before {
  bottom: calc(50% + 20px);
}

.sidebar-handle::after {
  top: calc(50% + 20px);
}

.sidebar-handle:hover::before,
.sidebar-handle:hover::after,
.sidebar-handle:focus-visible::before,
.sidebar-handle:focus-visible::after,
.sidebar-handle--dragging::before,
.sidebar-handle--dragging::after {
  background: var(--accent);
}

/* The chevron. 24 x 24 is the WCAG 2.5.8 minimum target size, and it
   fills the strip's width exactly, so the control a user aims at and
   the surface they aim at are the same object. Everything else in the
   strip's height is drag surface. */
/* The chevron carries BOTH gestures — press-and-move resizes,
   press-and-release collapses — so its cursor says the surface
   resizes, not that it is a button. `cursor: pointer` here was a
   promise the control could not keep: it advertised a click and
   denied the drag, on the one element the user could actually see.
   `touch-action: none` likewise, so a touch drag reaches
   `pointermove` instead of being claimed by the browser as a
   scroll. */
.sidebar-handle__button {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: var(--surface);
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
  cursor: col-resize;
  touch-action: none;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.sidebar-handle__button:hover,
.sidebar-handle__button:focus-visible {
  color: var(--accent);
  border-color: var(--accent);
  box-shadow: var(--shadow-md);
  outline: none;
}

/* A focus ring on the strip itself, since the strip is the resize
   target and the button inside it is the collapse target — each needs
   to show which one has focus. */
.sidebar-handle:focus-visible {
  box-shadow: inset 0 0 0 2px var(--accent);
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-handle,
  .sidebar-handle::before,
  .sidebar-handle::after,
  .sidebar-handle__button {
    transition: none;
  }
}
</style>
