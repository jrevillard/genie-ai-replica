<template>
  <span class="ds-pill" :class="`ds-pill--${variant}`">
    <slot />
  </span>
</template>

<script>
const VARIANTS = ['accent', 'success', 'warning', 'danger', 'info'];

export default {
  name: 'DsPill',
  props: {
    variant: {
      type: String,
      default: 'accent',
      validator: (v) => VARIANTS.includes(v)
    }
  }
};
</script>

<style scoped>
.ds-pill {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 100px;
  letter-spacing: 0.02em;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  white-space: nowrap;
  line-height: 1.4;
}

.ds-pill--accent {
  background: var(--accent-muted);
  color: var(--accent);
}

.ds-pill--success {
  background: var(--success-bg);
  color: var(--success);
}

.ds-pill--warning {
  background: var(--warning-bg);
  color: var(--warning);
}

.ds-pill--danger {
  background: var(--danger-bg);
  color: var(--danger);
}

.ds-pill--info {
  background: var(--info-bg);
  color: var(--info);
}
</style>
