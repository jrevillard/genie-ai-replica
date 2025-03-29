<!-- src/components/ConfirmDialog.vue -->
<template>
    <div v-if="visible" class="confirm-dialog-overlay">
      <div class="confirm-dialog" :data-theme="theme">
        <div class="confirm-dialog-header">
          <h3>{{ title }}</h3>
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
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }
  
  .confirm-dialog {
    background-color: var(--bg-modal, #ffffff);
    color: var(--text-primary, #333333);
    border-radius: 8px;
    width: 400px;
    max-width: 90%;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    overflow: hidden;
    animation: dialog-fade-in 0.2s ease-out;
  }
  
  .confirm-dialog-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color, #eaeaea);
  }
  
  .confirm-dialog-header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
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
    border-top: 1px solid var(--border-color, #eaeaea);
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
    background-color: var(--btn-secondary-bg, #e0e0e0);
    color: var(--btn-secondary-text, #333333);
  }
  
  .btn-confirm {
    background-color: var(--btn-primary-bg, #4E97D1);
    color: var(--btn-primary-text, #ffffff);
  }
  
  .btn-cancel:hover {
    background-color: var(--btn-secondary-hover-bg, #d0d0d0);
  }
  
  .btn-confirm:hover {
    background-color: var(--btn-primary-hover-bg, #3a7da0);
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
  
  /* Dark mode specific styles */
  .confirm-dialog[data-theme="dark"] {
    background-color: #2a2a2a;
    color: #f0f0f0;
  }
  
  .confirm-dialog[data-theme="dark"] .confirm-dialog-header {
    border-bottom-color: #3a3a3a;
  }
  
  .confirm-dialog[data-theme="dark"] .confirm-dialog-footer {
    border-top-color: #3a3a3a;
  }
  
  .confirm-dialog[data-theme="dark"] .btn-cancel {
    background-color: #3a3a3a;
    color: #e0e0e0;
  }
  
  .confirm-dialog[data-theme="dark"] .btn-cancel:hover {
    background-color: #4a4a4a;
  }
  </style>