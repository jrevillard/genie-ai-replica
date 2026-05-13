<template>
  <component
    :is="isTextarea ? 'textarea' : 'input'"
    :id="inputId || formGroupId"
    :class="['ds-input', { 'ds-input--sm': size === 'sm', 'ds-input--lg': size === 'lg' }]"
    :type="isTextarea ? undefined : type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    :rows="isTextarea ? rows : undefined"
    v-bind="$attrs"
    @input="$emit('update:modelValue', $event.target.value)"
    @focus="$emit('focus', $event)"
    @blur="$emit('blur', $event)"
    @keyup.enter="$emit('enter', $event)"
  />
</template>

<script>
export default {
  name: 'DsInput',
  inject: {
    formGroupId: { default: null }
  },
  inheritAttrs: false,
  props: {
    modelValue: {
      type: [String, Number],
      default: ''
    },
    type: {
      type: String,
      default: 'text'
    },
    placeholder: {
      type: String,
      default: ''
    },
    disabled: {
      type: Boolean,
      default: false
    },
    readonly: {
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
    },
    rows: {
      type: Number,
      default: 4
    }
  },
  emits: ['update:modelValue', 'focus', 'blur', 'enter'],
  computed: {
    isTextarea() {
      return this.type === 'textarea';
    }
  },
  methods: {
    focus() {
      this.$el?.focus();
    }
  }
};
</script>

<style scoped>
.ds-input {
  font-family: var(--font-body);
  font-size: var(--text-base);
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--fg);
  outline: none;
  width: 100%;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.ds-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}

.ds-input::placeholder {
  color: var(--muted);
  opacity: 0.6;
}

.ds-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ds-input--sm {
  font-size: var(--text-sm);
  padding: 4px 8px;
}

.ds-input--lg {
  font-size: var(--text-md);
  padding: 12px 16px;
}

textarea.ds-input {
  resize: vertical;
  min-height: 80px;
}
</style>
