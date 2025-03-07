<template>
  <div class="modal-backdrop" @click="$emit('close')">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <slot name="header">
          <h3>{{ title }}</h3>
        </slot>
        <button class="close-button" @click="$emit('close')" aria-label="Close">×</button>
      </div>
      
      <div class="modal-body">
        <slot name="body">
          <p>{{ message }}</p>
        </slot>
      </div>
      
      <div class="modal-footer">
        <slot name="footer">
          <button @click="$emit('close')" class="cancel-btn">{{ cancelText }}</button>
          <button @click="$emit('confirm')" class="primary-btn">{{ confirmText }}</button>
        </slot>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ModalDialog',
  
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
    }
  },
  
  mounted() {
    document.body.classList.add('modal-open');
    
    // Allow ESC key to close the modal
    this.handleEscKey = (e) => {
      if (e.key === 'Escape') {
        this.$emit('close');
      }
    };
    document.addEventListener('keydown', this.handleEscKey);
  },
  
  beforeUnmount() {
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', this.handleEscKey);
  }
};
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1050;
}

.modal-content {
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
}

.modal-header h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.close-button {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
  line-height: 1;
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
}

.modal-footer {
  padding: 16px 20px;
  border-top: 1px solid #eee;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.cancel-btn, 
.primary-btn {
  padding: 8px 16px;
  border-radius: 4px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.cancel-btn {
  background: none;
  border: 1px solid #ddd;
  color: #666;
}

.cancel-btn:hover {
  background-color: #f5f5f5;
}

.primary-btn {
  background-color: #4e97d1;
  border: none;
  color: white;
}

.primary-btn:hover {
  background-color: #3a7cb5;
}

/* Global style to prevent body scrolling when modal is open */
:global(body.modal-open) {
  overflow: hidden;
}
</style>
