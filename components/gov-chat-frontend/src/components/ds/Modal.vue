<template>
  <Teleport to="body">
    <div v-if="visible" class="ds-modal-backdrop" @click.self="$emit('close')">
      <div ref="dialog" class="ds-modal" :class="classes" role="dialog" aria-modal="true">
        <div class="ds-modal__header">
          <slot name="header">
            <h2 v-if="title">{{ isTranslationKey ? $t(title) : title }}</h2>
          </slot>
          <DsButton variant="ghost" class="ds-modal__close" aria-label="Close" @click="$emit('close')">
            &times;
          </DsButton>
        </div>

        <div class="ds-modal__body" :class="{ 'ds-modal__body--scrollable': scrollable }">
          <slot />
        </div>

        <div v-if="$slots.footer" class="ds-modal__footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
import DsButton from './Button.vue';

const SIZES = ['sm', 'md', 'lg', 'xl'];

export default {
  name: 'DsModal',
  components: { DsButton },
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    title: {
      type: String,
      default: ''
    },
    size: {
      type: String,
      default: 'md',
      validator: (v) => SIZES.includes(v)
    },
    scrollable: {
      type: Boolean,
      default: true
    },
    isTranslationKey: {
      type: Boolean,
      default: false
    }
  },
  emits: ['close'],
  data() {
    return {
      isOpen: false,
      keydownHandler: null
    };
  },
  computed: {
    classes() {
      return `ds-modal--${this.size}`;
    }
  },
  watch: {
    visible(val) {
      if (val) {
        this.isOpen = true;
        this.onOpen();
      } else if (this.isOpen) {
        this.isOpen = false;
        this.onClose();
      }
    }
  },
  beforeUnmount() {
    if (this.isOpen) {
      this.isOpen = false;
      this.onClose();
    }
  },
  methods: {
    onOpen() {
      document.body.style.overflow = 'hidden';
      this.$nextTick(() => this.trapFocus());
      document.addEventListener('keydown', this.handleEsc);
    },
    onClose() {
      const dialog = this.$refs.dialog;
      if (dialog && this.keydownHandler) {
        dialog.removeEventListener('keydown', this.keydownHandler);
        this.keydownHandler = null;
      }
      document.body.style.overflow = '';
      document.removeEventListener('keydown', this.handleEsc);
    },
    handleEsc(e) {
      if (e.key === 'Escape') {
        this.$emit('close');
      }
    },
    trapFocus() {
      const dialog = this.$refs.dialog;
      if (!dialog) return;

      const focusable = dialog.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      first.focus();

      this.keydownHandler = (e) => {
        if (e.key !== 'Tab') return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      };
      dialog.addEventListener('keydown', this.keydownHandler);
    }
  }
};
</script>

<style scoped>
.ds-modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.ds-modal {
  position: relative;
  background: var(--surface);
  color: var(--fg);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  max-width: 90%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  animation: ds-modal-enter 0.2s ease-out;
}

@keyframes ds-modal-enter {
  from {
    opacity: 0;
    transform: translateY(-16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.ds-modal--sm {
  width: 400px;
}
.ds-modal--md {
  width: 600px;
}
.ds-modal--lg {
  width: 800px;
}
.ds-modal--xl {
  width: 1000px;
}

.ds-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border);
}

.ds-modal__header h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
}

.ds-modal__close {
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: var(--text-lg);
  line-height: 1;
}

.ds-modal__body {
  padding: var(--space-lg);
  flex: 1 1 auto;
}

.ds-modal__body--scrollable {
  overflow-y: auto;
  max-height: calc(90vh - 120px);
}

.ds-modal__footer {
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-md);
}

@media (max-width: 480px) {
  .ds-modal {
    width: 95% !important;
  }

  .ds-modal__header,
  .ds-modal__body,
  .ds-modal__footer {
    padding: var(--space-md);
  }
}
</style>
