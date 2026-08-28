<!--
  DsDialog.vue — richer wrapper around DsModal with structured footer actions.
  Backed by DsModal for focus-trap, esc, teleport — adds:
    - explicit actions slot prop with typed variants
    - persistent (no backdrop-close)
    - loading overlay
-->
<template>
  <DsModal :visible="visible" :title="title" :size="size" :scrollable="true" @close="onBackdrop">
    <template v-if="$slots.header" #header>
      <slot name="header" />
    </template>

    <div class="ds-dialog__body">
      <slot />
    </div>

    <template v-if="$slots.footer || actions.length" #footer>
      <div class="ds-dialog__actions">
        <slot name="footer" :actions="actions">
          <DsButton
            v-for="a in actions"
            :key="a.key"
            :variant="a.variant || 'secondary'"
            :disabled="a.disabled"
            @click="$emit('action', a.key)"
            >{{ a.label }}</DsButton
          >
        </slot>
      </div>
    </template>

    <div v-if="loading" class="ds-dialog__loading" aria-hidden="true">
      <DsSpinner size="lg" />
    </div>
  </DsModal>
</template>

<script>
import DsModal from './Modal.vue';
import DsButton from './Button.vue';
import DsSpinner from './Spinner.vue';

const SIZES = ['sm', 'md', 'lg', 'xl'];

export default {
  name: 'DsDialog',
  components: { DsModal, DsButton, DsSpinner },
  props: {
    visible: { type: Boolean, default: false },
    title: { type: String, default: '' },
    size: { type: String, default: 'md', validator: (v) => SIZES.includes(v) },
    actions: {
      type: Array,
      default: () => []
    },
    closeOnBackdrop: { type: Boolean, default: true },
    persistent: { type: Boolean, default: false },
    loading: { type: Boolean, default: false }
  },
  emits: ['close', 'action'],
  methods: {
    onBackdrop() {
      if (this.persistent) return;
      if (!this.closeOnBackdrop) return;
      this.$emit('close');
    }
  }
};
</script>

<style scoped>
.ds-dialog__body {
  position: relative;
}
.ds-dialog__actions {
  display: flex;
  gap: var(--space-sm);
  justify-content: flex-end;
  flex-wrap: wrap;
}
.ds-dialog__loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--surface) 60%, transparent);
  border-radius: var(--radius-md);
  pointer-events: none;
}
</style>
