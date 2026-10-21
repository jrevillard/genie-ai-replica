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
    clampedValue() {
      return Math.max(this.min, Math.min(this.max, this.value));
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
      const delta = e.clientX - this.dragOrigin;
      // For the right sidebar the panel sits to the left of the strip,
      // so a positive delta (drag toward the right) widens it. For the
      // left sidebar the panel sits to the right, so the same delta
      // narrows it. The sign flip keeps one drag function for both.
      const sign = this.side === 'right' ? 1 : -1;
      const next = this.dragStartWidth + sign * delta;
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
      // Keyboard arrows resize. The mapping is consistent with the
      // pointer behaviour: on the right side, ArrowRight widens (the
      // panel sits to the left, so moving the strip toward the right
      // moves its left edge — the panel's right edge — into more
      // space); on the left side, ArrowRight also widens (the panel
      // sits to the right, so moving the strip toward the right moves
      // its right edge — the panel's left edge — into more space).
      // A single direction always grows or shrinks regardless of side.
      const step = e.shiftKey ? KEY_STEP_FAST_PX : KEY_STEP_PX;
      let next = this.value;
      let handled = true;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          next = this.value + step;
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          next = this.value - step;
          break;
        case 'Home':
          next = this.max;
          break;
        case 'End':
          next = this.min;
          break;
        case 'Enter':
        case ' ':
          // The Enter/Space on the strip collapses — Enter/Space is
          // also the button's activation key, and the strip's keyboard
          // behaviour should mirror the button so a screen reader user
          // does not have to Tab past the strip to find the toggle.
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
 * Strip = a 24 px-wide strip on the panel's inner edge. Sits in the
 * flex flow between the panel and the centre so a drag mutates the
 * panel width via the parent's style binding rather than fighting
 * position: absolute layout. Half-overlaps the centre — the panel's
 * edge plus 12 px visible to the right of the panel boundary — so
 * the chevron sits centred on the actual seam, which is the gesture
 * the reference image carries.
 *
 * Tokens only. The strip is a thin surface, painted as a slightly
 * translucent surface with a hover accent, so it reads as a handle
 * rather than a panel boundary.
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
  z-index: 2;
  transition: background-color 0.15s ease;
}

.sidebar-handle:hover,
.sidebar-handle:focus-visible,
.sidebar-handle--dragging {
  background: color-mix(in oklch, var(--accent) 22%, var(--surface));
}

/* The chevron button. Visually identical on both sides per the brief
   ("visuellement identique"). Half the button's 28 px box straddles
   the strip's boundary, anchored on the centre side so the chevron
   reads as a fold/unfold gesture against the centre panel. */
.sidebar-handle__button {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 50%;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
  position: relative;
}

.sidebar-handle__button:hover,
.sidebar-handle__button:focus-visible {
  color: var(--accent);
  border-color: var(--accent);
  box-shadow: var(--shadow-md);
  outline: none;
}

.sidebar-handle--left .sidebar-handle__button {
  /* Anchor half on the strip and half into the centre. Negative left
     pulls the button off the strip's content box so the chevron sits
     centred on the seam itself, where the user expects to find the
     affordance. */
  margin-left: -16px;
}

.sidebar-handle--right .sidebar-handle__button {
  margin-right: -16px;
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-handle,
  .sidebar-handle__button {
    transition: none;
  }
}
</style>
