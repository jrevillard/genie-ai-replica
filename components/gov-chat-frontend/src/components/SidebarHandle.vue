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
      // The inner button gets the click event; ignore the pointerdown
      // when the user is targeting the button so the two gestures
      // don't fight each other (a click on the button would otherwise
      // also open a drag and the chevron would never toggle).
      if (e.target !== this.$refs.stripEl) return;
      // Right-button on mouse, secondary button, etc. — leave those for
      // the browser's own context menu and never start a drag.
      if (e.button !== 0) return;
      this.isDragging = true;
      this.dragOrigin = e.clientX;
      this.dragStartWidth = this.value;
      this.dragPointerId = e.pointerId;
      // Pointer capture keeps the move events flowing even when the
      // pointer strays off the strip — without it the drag breaks the
      // first time the user crosses into the side panel and the page
      // hits a hover state on a child element.
      try {
        this.$refs.stripEl.setPointerCapture(e.pointerId);
      } catch {
        // Older browsers without pointer capture — fall back to the
        // window-level move handler below.
      }
      window.addEventListener('pointermove', this.onPointerMove);
      window.addEventListener('pointerup', this.onPointerUp);
      window.addEventListener('pointercancel', this.onPointerUp);
      this.$emit('drag-start');
      e.preventDefault();
    },
    onPointerMove(e) {
      if (!this.isDragging) return;
      const next = this.dragStartWidth + this.widthSign * (e.clientX - this.dragOrigin);
      const clamped = Math.max(this.min, Math.min(this.max, next));
      if (clamped !== this.value) this.$emit('input', clamped);
    },
    onPointerUp() {
      if (!this.isDragging) return;
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
      this.$emit('drag-end');
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

/* The chevron. 24 x 24 is the WCAG 2.5.8 minimum target size, and it
   fills the strip's width exactly, so the control a user aims at and
   the surface they aim at are the same object. Everything else in the
   strip's height is drag surface. */
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
  cursor: pointer;
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
  .sidebar-handle__button {
    transition: none;
  }
}
</style>
