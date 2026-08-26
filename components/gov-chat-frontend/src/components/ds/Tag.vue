<!--
  DsTag.vue — small labelled chip with optional remove action.
  Variants: neutral | accent | success | warning | danger | info
  Sizes:   sm | md
  Emits remove when removable=true and × clicked.
-->
<template>
  <span class="ds-tag" :class="classes">
    <slot>{{ label }}</slot>
    <button
      v-if="removable"
      type="button"
      class="ds-tag__remove"
      :aria-label="$attrs['remove-label'] || 'Remove tag'"
      @click.stop="$emit('remove')"
    >&times;</button>
  </span>
</template>

<script>
const VARIANTS = ['neutral', 'accent', 'success', 'warning', 'danger', 'info'];
const SIZES = ['sm', 'md'];

export default {
  name: 'DsTag',
  props: {
    label: { type: String, default: '' },
    variant: { type: String, default: 'neutral', validator: (v) => VARIANTS.includes(v) },
    size: { type: String, default: 'sm', validator: (v) => SIZES.includes(v) },
    removable: { type: Boolean, default: false }
  },
  emits: ['remove'],
  computed: {
    classes() {
      return {
        [`ds-tag--${this.variant}`]: true,
        [`ds-tag--${this.size}`]: true
      };
    }
  }
};
</script>

<style scoped>
.ds-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg);
  font-size: var(--text-xs);
  line-height: 1.2;
  padding: 2px 8px;
  font-family: var(--font-body);
  white-space: nowrap;
}
.ds-tag--md { padding: 4px 10px; font-size: var(--text-sm); }

.ds-tag--accent  { background: var(--accent-muted);  color: var(--accent);  border-color: var(--accent); }
.ds-tag--success { background: var(--success-bg);    color: var(--success); border-color: var(--success); }
.ds-tag--warning { background: var(--warning-bg);    color: var(--warning); border-color: var(--warning); }
.ds-tag--danger  { background: var(--danger-bg);     color: var(--danger);  border-color: var(--danger); }
.ds-tag--info    { background: var(--info-bg);       color: var(--info);    border-color: var(--info); }

.ds-tag__remove {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0 2px;
  font-size: 0.85em;
  line-height: 1;
  border-radius: var(--radius-sm);
}
.ds-tag__remove:hover { background: color-mix(in srgb, currentColor 15%, transparent); }
</style>
