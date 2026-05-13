<template>
  <div class="ds-form-group">
    <label v-if="label || $slots.label" :for="formGroupId" class="ds-form-group__label">
      <slot name="label">{{ label }}</slot>
    </label>
    <slot />
  </div>
</template>

<script>
let idCounter = 0;

export default {
  name: 'DsFormGroup',
  provide() {
    return {
      formGroupId: this.formGroupId
    };
  },
  props: {
    label: {
      type: String,
      default: ''
    },
    inputId: {
      type: String,
      default: ''
    }
  },
  computed: {
    formGroupId() {
      return this.inputId || 'ds-fg-' + ++idCounter;
    }
  }
};
</script>

<style scoped>
.ds-form-group {
  margin-bottom: var(--space-md);
  display: flex;
  flex-direction: column;
}

.ds-form-group__label {
  display: block;
  margin-bottom: var(--space-xs);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--fg);
}
</style>
