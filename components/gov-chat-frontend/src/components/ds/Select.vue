<template>
  <select
    :id="inputId || formGroupId"
    :class="['ds-select', { 'ds-select--sm': size === 'sm', 'ds-select--lg': size === 'lg' }]"
    :value="modelValue"
    :disabled="disabled"
    v-bind="$attrs"
    @change="$emit('update:modelValue', $event.target.value)"
  >
    <option v-if="placeholder" value="" disabled>
      {{ placeholder }}
    </option>
    <slot />
  </select>
</template>

<script>
export default {
  name: 'DsSelect',
  inject: {
    formGroupId: { default: null }
  },
  inheritAttrs: false,
  props: {
    modelValue: {
      type: [String, Number],
      default: ''
    },
    placeholder: {
      type: String,
      default: ''
    },
    disabled: {
      type: Boolean,
      default: false
    },
    inputId: {
      type: String,
      default: ''
    },
    size: {
      type: String,
      default: 'md',
      validator: (v) => ['sm', 'md', 'lg'].includes(v)
    }
  },
  emits: ['update:modelValue']
};
</script>

<style scoped>
.ds-select {
  font-family: var(--font-body);
  font-size: var(--text-base);
  padding: 8px 12px;
  border: 1px solid var(--ds-select-border-color, var(--border));
  border-radius: var(--radius-md);
  background-color: var(--ds-select-bg, var(--surface));
  color: var(--ds-select-color, var(--fg));
  outline: none;
  width: 100%;
  transition: border-color 0.15s;
  box-sizing: border-box;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 28px;
  cursor: pointer;
}

.ds-select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}

.ds-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ds-select--sm {
  font-size: var(--text-sm);
  padding: 4px 8px;
}

.ds-select--lg {
  font-size: var(--text-md);
  padding: 12px 16px;
}
</style>
