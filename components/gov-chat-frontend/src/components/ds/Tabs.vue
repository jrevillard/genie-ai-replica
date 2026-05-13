<template>
  <div :class="['ds-tabs', { 'ds-tabs--fill': fill }]">
    <div class="ds-tabs__nav">
      <button
        v-for="(tab, index) in tabs"
        :key="tab.value ?? index"
        :class="['ds-tabs__btn', { 'ds-tabs__btn--active': modelValue === (tab.value ?? index) }]"
        @click="select(tab.value ?? index)"
      >
        <slot name="tab" :tab="tab" :index="index" :active="modelValue === (tab.value ?? index)">
          {{ tab.label }}
        </slot>
      </button>
    </div>
    <div class="ds-tabs__content">
      <slot />
    </div>
  </div>
</template>

<script>
export default {
  name: 'DsTabs',
  props: {
    tabs: {
      type: Array,
      default: () => []
    },
    modelValue: {
      type: [String, Number],
      default: 0
    },
    fill: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue'],
  methods: {
    select(value) {
      this.$emit('update:modelValue', value);
    }
  }
};
</script>

<style scoped>
.ds-tabs--fill {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.ds-tabs--fill .ds-tabs__content {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ds-tabs__nav {
  display: flex;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.ds-tabs__btn {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: var(--space-sm) var(--space-md);
  margin-bottom: -1px;
  color: var(--muted);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition:
    color 0.2s,
    border-color 0.2s;
}

.ds-tabs__btn:hover {
  color: var(--fg);
}

.ds-tabs__btn--active {
  color: var(--ds-tabs-active-color, var(--fg));
  border-bottom-color: var(--ds-tabs-active-border-color, var(--accent));
  font-weight: 600;
}

.ds-tabs__content {
  flex: 1;
  overflow-y: auto;
}
</style>
