<template>
  <div :class="['ds-state', `ds-state--${type}`]">
    <div v-if="$slots.icon || icon" class="ds-state__icon">
      <slot name="icon">
        <component :is="icon" v-if="icon" :size="iconSize" />
      </slot>
    </div>
    <p v-if="$slots.default || message" class="ds-state__message">
      <slot>{{ message }}</slot>
    </p>
    <div v-if="$slots.action" class="ds-state__action">
      <slot name="action" />
    </div>
  </div>
</template>

<script>
const TYPES = ['empty', 'loading', 'error'];

export default {
  name: 'DsStateDisplay',
  props: {
    type: {
      type: String,
      default: 'empty',
      validator: (v) => TYPES.includes(v)
    },
    message: {
      type: String,
      default: ''
    },
    icon: {
      type: Object,
      default: null
    },
    iconSize: {
      type: Number,
      default: 48
    }
  }
};
</script>

<style scoped>
.ds-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-2xl) var(--space-lg);
  text-align: center;
  width: 100%;
  color: var(--muted-soft);
}

.ds-state__icon {
  margin-bottom: var(--space-md);
  color: var(--muted);
  font-size: var(--text-3xl);
}

.ds-state--error .ds-state__icon {
  color: var(--danger);
}

.ds-state--loading .ds-state__icon {
  color: var(--accent);
}

.ds-state__message {
  font-size: var(--text-md);
  margin: 0;
}

.ds-state--error .ds-state__message {
  color: var(--danger);
}

.ds-state__action {
  margin-top: var(--space-md);
}
</style>
