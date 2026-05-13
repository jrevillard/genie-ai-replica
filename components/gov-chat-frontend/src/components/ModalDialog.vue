<template>
  <DsModal :visible="true" :title="translatedTitle" size="sm" @close="$emit('close')">
    <template #header>
      <slot name="header">
        <h3>{{ translatedTitle }}</h3>
      </slot>
    </template>

    <slot name="body">
      <p>{{ translateIfKey(message) }}</p>
    </slot>

    <template #footer>
      <slot name="footer">
        <DsButton variant="secondary" @click="$emit('close')">
          {{ translateIfKey(cancelText) }}
        </DsButton>
        <DsButton variant="primary" @click="$emit('confirm')">
          {{ translateIfKey(confirmText) }}
        </DsButton>
      </slot>
    </template>
  </DsModal>
</template>

<script>
import DsButton from './ds/Button.vue';
import DsModal from './ds/Modal.vue';

export default {
  name: 'ModalDialog',
  components: { DsButton, DsModal },

  props: {
    title: {
      type: String,
      default: 'Dialog'
    },
    message: {
      type: String,
      default: ''
    },
    cancelText: {
      type: String,
      default: 'Cancel'
    },
    confirmText: {
      type: String,
      default: 'Confirm'
    },
    useTranslation: {
      type: Boolean,
      default: false
    }
  },
  emits: ['close', 'confirm'],
  computed: {
    translatedTitle() {
      return this.translateIfKey(this.title);
    }
  },

  methods: {
    translateIfKey(key) {
      if (this.useTranslation && key) {
        return this.$t(key);
      }
      return key;
    }
  }
};
</script>

<style scoped>
.form-group {
  margin-bottom: var(--space-md);
}

.form-group label {
  color: var(--fg);
  font-weight: 500;
  margin-bottom: var(--space-sm);
  display: block;
}

.warning-text {
  color: var(--danger);
}
</style>
