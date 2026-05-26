<template>
  <component
    :is="tag"
    class="ds-btn"
    :class="[`ds-btn--${variant}`, { 'ds-btn--sm': small, 'ds-btn--disabled': disabled && tag !== 'button' }]"
    :disabled="tag === 'button' ? disabled : undefined"
    :aria-disabled="disabled && tag !== 'button' ? 'true' : undefined"
    v-bind="$attrs"
    @click="!disabled && $emit('click', $event)"
  >
    <slot />
  </component>
</template>

<script>
const VARIANTS = ['primary', 'secondary', 'ghost', 'danger'];

export default {
  name: 'DsButton',
  inheritAttrs: false,
  emits: ['click'],
  props: {
    tag: {
      type: String,
      default: 'button'
    },
    variant: {
      type: String,
      default: 'secondary',
      validator: (v) => VARIANTS.includes(v)
    },
    small: {
      type: Boolean,
      default: false
    },
    disabled: {
      type: Boolean,
      default: false
    }
  }
};
</script>

<style scoped>
.ds-btn {
  font-family: var(--font-body);
  font-size: 0.85rem;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  line-height: 1.4;
  appearance: none;
  background-image: none;
}

.ds-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ds-btn--primary {
  background: var(--accent);
  color: var(--accent-fg);
  border-color: var(--accent);
}

.ds-btn--primary:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

.ds-btn--secondary {
  background: var(--btn-secondary-bg);
  color: var(--btn-secondary-fg);
  border-color: var(--border);
}

.ds-btn--secondary:hover:not(:disabled) {
  background: var(--btn-secondary-hover);
  border-color: var(--accent);
  color: var(--accent);
}

.ds-btn--ghost {
  background: transparent;
  color: var(--ds-btn-ghost-color, var(--muted));
  border-color: transparent;
}

.ds-btn--ghost:hover:not(:disabled) {
  color: var(--ds-btn-ghost-hover-color, var(--fg));
  background: var(--bg);
}

.ds-btn--danger {
  background: var(--danger);
  color: var(--accent-fg);
  border-color: var(--danger);
}

.ds-btn--danger:hover:not(:disabled) {
  opacity: 0.9;
}

.ds-btn--sm {
  font-size: 0.75rem;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
}
</style>
