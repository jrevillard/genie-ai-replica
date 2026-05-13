<template>
  <DsModal :visible="visible" :title="title" size="sm" @close="cancel">
    <p>{{ message }}</p>

    <template #footer>
      <DsButton v-if="secondaryText" variant="secondary" @click="secondary">
        {{ secondaryText }}
      </DsButton>
      <DsButton variant="secondary" @click="cancel">{{ cancelText }}</DsButton>
      <DsButton :variant="danger ? 'danger' : 'primary'" @click="confirm">{{ confirmText }}</DsButton>
    </template>
  </DsModal>
</template>

<script>
import DsButton from './ds/Button.vue';
import DsModal from './ds/Modal.vue';

export default {
  name: 'ConfirmDialog',
  components: { DsButton, DsModal },
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    title: {
      type: String,
      default: 'Confirm'
    },
    message: {
      type: String,
      default: 'Are you sure?'
    },
    confirmText: {
      type: String,
      default: 'OK'
    },
    cancelText: {
      type: String,
      default: 'Cancel'
    },
    secondaryText: {
      type: String,
      default: ''
    },
    danger: {
      type: Boolean,
      default: false
    }
  },
  emits: ['confirm', 'cancel', 'secondary'],
  methods: {
    confirm() {
      this.$emit('confirm');
    },
    cancel() {
      this.$emit('cancel');
    },
    secondary() {
      this.$emit('secondary');
    }
  }
};
</script>
