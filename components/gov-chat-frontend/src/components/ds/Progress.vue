<!--
  DsProgress.vue — linear progress bar.
  Variants: accent | success | warning | danger. Indeterminate animation.
  Supports size xs|sm|md and optional inline label.
-->
<template>
  <div class="ds-progress" :class="classes" role="progressbar" :aria-valuenow="clampedValue" aria-valuemin="0" :aria-valuemax="max" :aria-label="ariaLabel">
    <div class="ds-progress__track">
      <div
        class="ds-progress__bar"
        :class="{ 'ds-progress__bar--indeterminate': indeterminate }"
        :style="barStyle"
      />
    </div>
    <span v-if="showLabel" class="ds-progress__label">{{ displayLabel }}</span>
  </div>
</template>

<script>
const VARIANTS = ['accent', 'success', 'warning', 'danger'];
const SIZES = ['xs', 'sm', 'md'];

export default {
  name: 'DsProgress',
  props: {
    value: { type: Number, required: true },
    max: { type: Number, default: 100 },
    variant: { type: String, default: 'accent', validator: (v) => VARIANTS.includes(v) },
    indeterminate: { type: Boolean, default: false },
    size: { type: String, default: 'sm', validator: (v) => SIZES.includes(v) },
    showLabel: { type: Boolean, default: false },
    label: { type: String, default: '' },
    ariaLabel: { type: String, default: 'Progress' }
  },
  computed: {
    clampedValue() {
      return Math.max(0, Math.min(this.value, this.max));
    },
    pct() {
      return Math.round((this.clampedValue / this.max) * 100);
    },
    displayLabel() {
      return this.label || `${this.pct}%`;
    },
    barStyle() {
      if (this.indeterminate) return {};
      return { width: `${this.pct}%` };
    },
    classes() {
      return {
        [`ds-progress--${this.variant}`]: true,
        [`ds-progress--${this.size}`]: true
      };
    }
  }
};
</script>

<style scoped>
.ds-progress {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-family: var(--font-body);
}

.ds-progress__track {
  flex: 1 1 auto;
  background: var(--border-light);
  border-radius: 100px;
  overflow: hidden;
  position: relative;
}

.ds-progress__bar {
  height: 100%;
  width: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.2s ease;
}

.ds-progress--success .ds-progress__bar { background: var(--success); }
.ds-progress--warning .ds-progress__bar { background: var(--warning); }
.ds-progress--danger  .ds-progress__bar { background: var(--danger); }

.ds-progress--xs .ds-progress__track { height: 2px; }
.ds-progress--sm .ds-progress__track { height: 6px; }
.ds-progress--md .ds-progress__track { height: 10px; }

.ds-progress__label {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.ds-progress__bar--indeterminate {
  width: 40% !important;
  animation: ds-progress-indeterminate 1.4s ease-in-out infinite;
}

@keyframes ds-progress-indeterminate {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}

@media (prefers-reduced-motion: reduce) {
  .ds-progress__bar--indeterminate { animation: none; width: 60%; }
}
</style>
