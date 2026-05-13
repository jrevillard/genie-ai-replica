<template>
  <div class="ds-card" :class="classes">
    <div v-if="$slots.header" class="ds-card__header">
      <slot name="header" />
    </div>
    <div class="ds-card__body">
      <slot />
    </div>
  </div>
</template>

<script>
const VARIANTS = ['default', 'flat', 'elevated', 'outline'];
const PADDINGS = ['none', 'sm', 'md', 'lg'];
const RADII = ['sm', 'md', 'lg'];

export default {
  name: 'DsCard',
  props: {
    variant: {
      type: String,
      default: 'default',
      validator: (v) => VARIANTS.includes(v)
    },
    padding: {
      type: String,
      default: 'md',
      validator: (v) => PADDINGS.includes(v)
    },
    radius: {
      type: String,
      default: 'md',
      validator: (v) => RADII.includes(v)
    },
    hoverable: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    classes() {
      return [
        `ds-card--${this.variant}`,
        `ds-card--radius-${this.radius}`,
        `ds-card--pad-${this.padding}`,
        { 'ds-card--hoverable': this.hoverable }
      ];
    }
  }
};
</script>

<style scoped>
.ds-card {
  background: var(--surface);
  color: var(--fg);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

/* Variants */
.ds-card--default {
  box-shadow: var(--shadow-sm);
}

.ds-card--flat {
  border: 1px solid var(--ds-card-border-color, var(--border-light));
}

.ds-card--elevated {
  box-shadow: var(--shadow-md);
}

.ds-card--outline {
  border: 1px solid var(--border);
}

/* Radius */
.ds-card--radius-sm {
  border-radius: var(--radius-sm);
}
.ds-card--radius-md {
  border-radius: var(--radius-md);
}
.ds-card--radius-lg {
  border-radius: var(--radius-lg);
}

/* Padding */
.ds-card--pad-none .ds-card__body {
  padding: 0;
}
.ds-card--pad-sm .ds-card__body {
  padding: var(--space-sm);
}
.ds-card--pad-md .ds-card__body {
  padding: var(--space-md);
}
.ds-card--pad-lg .ds-card__body {
  padding: var(--space-lg);
}

/* Header */
.ds-card__header {
  padding: var(--space-md);
  border-bottom: 1px solid var(--border-light);
}

/* Hover */
.ds-card--hoverable {
  cursor: pointer;
}

.ds-card--hoverable:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
</style>
