<!-- src/components/ConfirmDialog.vue -->
<template>
  <div v-if="visible" class="confirm-dialog-overlay">
    <div 
      class="confirm-dialog" 
      :style="parentStyles"
      :data-theme="theme"
    >
      <div class="confirm-dialog-header">
        <h3 :data-themed="true">{{ title }}</h3>
      </div>
      <div class="confirm-dialog-body">
        <p>{{ message }}</p>
      </div>
      <div class="confirm-dialog-footer">
        <button class="btn-cancel" @click="cancel">{{ cancelText }}</button>
        <button class="btn-confirm" @click="confirm">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ConfirmDialog',
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
    theme: {
      type: String,
      default: 'light'
    },
    parentStyles: {
      type: Object,
      default: () => ({})
    }
  },
  methods: {
    confirm() {
      this.$emit('confirm');
    },
    cancel() {
      this.$emit('cancel');
    }
  }
}
</script>

<style scoped>
.confirm-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: var(--dialog-overlay-background, rgba(0, 0, 0, 0.5));
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10000;
}

.confirm-dialog {
  background-color: var(--dialog-background, #ffffff);
  color: var(--dialog-text-color, #333333);
  border-radius: 8px;
  width: 400px;
  max-width: 90%;
  box-shadow: var(--dialog-box-shadow, 0 4px 12px rgba(0, 0, 0, 0.15));
  overflow: hidden;
  animation: dialog-fade-in 0.2s ease-out;
}

.confirm-dialog-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--dialog-border-color, #eaeaea);
}

.confirm-dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--dialog-title-color, #333333);
}

.confirm-dialog-body {
  padding: 20px;
  font-size: 16px;
}

.confirm-dialog-footer {
  padding: 16px 20px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  border-top: 1px solid var(--dialog-border-color, #eaeaea);
}

.btn-cancel, .btn-confirm {
  padding: 8px 16px;
  border-radius: 4px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background-color 0.2s;
}

.btn-cancel {
  background-color: var(--dialog-secondary-button-bg, #cccccc);
  color: var(--dialog-secondary-button-text, #333333);
}

.btn-cancel:hover {
  background-color: var(--dialog-secondary-button-hover-bg, #bbbbbb);
}

.btn-confirm {
  background-color: var(--dialog-primary-button-bg, #4E97D1);
  color: var(--dialog-primary-button-text, #ffffff);
}

.btn-confirm:hover {
  background-color: var(--dialog-primary-button-hover-bg, #3a7da0);
}

@keyframes dialog-fade-in {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Base dark theme styles - these will apply ONLY when no parentStyles are provided */
.confirm-dialog[data-theme="dark"]:not([style*="--dialog-background"]) {
  background-color: #2a2a2a;
  color: #ffffff;
}

.confirm-dialog[data-theme="dark"]:not([style*="--dialog-border-color"]) .confirm-dialog-header,
.confirm-dialog[data-theme="dark"]:not([style*="--dialog-border-color"]) .confirm-dialog-footer {
  border-color: #444444;
}

.confirm-dialog[data-theme="dark"]:not([style*="--dialog-title-color"]) .confirm-dialog-header h3 {
  color: #ffffff;
}

.confirm-dialog[data-theme="dark"]:not([style*="--dialog-secondary-button-bg"]) .btn-cancel {
  background-color: #444444;
  color: #ffffff;
}

.confirm-dialog[data-theme="dark"]:not([style*="--dialog-secondary-button-hover-bg"]) .btn-cancel:hover {
  background-color: #555555;
}

/* Ensure data-themed="true" works regardless of other settings */
.confirm-dialog-header h3[data-themed="true"] {
  color: var(--dialog-title-color, #333333) !important;
}

.confirm-dialog[data-theme="dark"] .confirm-dialog-header h3[data-themed="true"] {
  color: var(--dialog-title-color-dark, #ffffff) !important;
}

</style>