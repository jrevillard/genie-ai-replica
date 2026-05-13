<template>
  <span class="ds-status-tag" :class="classes">
    <slot />
  </span>
</template>

<script>
const VARIANTS = ['success', 'error', 'warning', 'info', 'pending'];

export default {
  name: 'DsStatusTag',
  props: {
    variant: {
      type: String,
      default: 'info',
      validator: (v) => VARIANTS.includes(v)
    }
  },
  computed: {
    classes() {
      return `ds-status-tag--${this.variant}`;
    }
  }
};
</script>

<style scoped>
.ds-status-tag {
  display: inline-block;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-xl);
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: 1.2;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.ds-status-tag--success {
  background-color: var(--success-bg);
  color: var(--success);
}

.ds-status-tag--error {
  background-color: var(--danger-bg);
  color: var(--danger);
}

.ds-status-tag--warning {
  background-color: var(--warning-bg);
  color: var(--warning);
}

.ds-status-tag--info {
  background-color: var(--info-bg);
  color: var(--accent);
}

.ds-status-tag--pending {
  background-color: var(--warning-bg);
  color: var(--warning);
}
</style>
