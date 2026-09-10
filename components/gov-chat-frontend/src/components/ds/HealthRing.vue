<!--
  DsHealthRing.vue — SVG single-ring primitive.
  Props:
    score: 0..100 — filled fraction
    state: 'ok' | 'warn' | 'fail' | 'muted'  (overrides thresholds; defaults from score)
    size: 'sm' | 'md' | 'lg'   pixel sizes 24, 48, 72
    thickness: pixel stroke thickness
    showLabel: render score text in center
    label: override label text (default "{score}%")
    ariaLabel: required for screen readers
  Honors prefers-reduced-motion.
-->
<template>
  <div class="ds-health-ring" :class="sizeClass" role="img" :aria-label="computedAriaLabel">
    <svg class="ds-health-ring__svg" :viewBox="viewBox" :width="pxSize" :height="pxSize" aria-hidden="true">
      <circle
        class="ds-health-ring__track"
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        :stroke-width="thickness"
      />
      <circle
        class="ds-health-ring__bar"
        :class="stateClass"
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        :stroke-width="thickness"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        stroke-linecap="round"
        :transform="`rotate(-90 ${center} ${center})`"
      />
    </svg>
    <span v-if="showLabel" class="ds-health-ring__label">{{ displayLabel }}</span>
  </div>
</template>

<script>
const SIZES = { sm: 24, md: 48, lg: 72 };
const STATE_FROM_SCORE = (s) => (s >= 90 ? 'ok' : s >= 70 ? 'warn' : 'fail');

export default {
  name: 'DsHealthRing',
  props: {
    score: { type: Number, default: 0 },
    state: { type: String, default: null, validator: (v) => v === null || ['ok', 'warn', 'fail', 'muted'].includes(v) },
    size: { type: String, default: 'md', validator: (v) => Object.keys(SIZES).includes(v) },
    thickness: { type: Number, default: 4 },
    showLabel: { type: Boolean, default: false },
    label: { type: String, default: '' },
    ariaLabel: { type: String, default: '' }
  },
  computed: {
    pxSize() {
      return SIZES[this.size] || SIZES.md;
    },
    center() {
      return this.pxSize / 2;
    },
    radius() {
      return this.center - this.thickness / 2;
    },
    circumference() {
      return 2 * Math.PI * this.radius;
    },
    dashOffset() {
      const clamped = Math.max(0, Math.min(this.score, 100));
      return this.circumference * (1 - clamped / 100);
    },
    stateClass() {
      return `ds-health-ring__bar--${this.resolvedState}`;
    },
    sizeClass() {
      return `ds-health-ring--${this.size}`;
    },
    viewBox() {
      return `0 0 ${this.pxSize} ${this.pxSize}`;
    },
    displayLabel() {
      return this.label || `${Math.round(this.score)}%`;
    },
    resolvedState() {
      if (this.state) return this.state;
      return STATE_FROM_SCORE(this.score);
    },
    computedAriaLabel() {
      if (this.ariaLabel) return this.ariaLabel;
      const s = this.resolvedState;
      const pct = Math.round(this.score);
      return `Health: ${pct} percent, ${s}`;
    }
  }
};
</script>

<style scoped>
.ds-health-ring {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  line-height: 1;
}
.ds-health-ring__svg {
  display: block;
}
.ds-health-ring__track {
  stroke: var(--border-light);
}
.ds-health-ring__bar {
  transition: stroke-dashoffset 0.4s ease;
}

.ds-health-ring__bar--ok {
  stroke: var(--success);
}
.ds-health-ring__bar--warn {
  stroke: var(--warning);
}
.ds-health-ring__bar--fail {
  stroke: var(--danger);
}
.ds-health-ring__bar--muted {
  stroke: var(--muted);
}

.ds-health-ring__label {
  position: absolute;
  font-size: var(--text-xs);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.ds-health-ring--sm .ds-health-ring__label {
  font-size: 8px;
}
.ds-health-ring--lg .ds-health-ring__label {
  font-size: var(--text-sm);
}

@media (prefers-reduced-motion: reduce) {
  .ds-health-ring__bar {
    transition: none;
  }
}
</style>
