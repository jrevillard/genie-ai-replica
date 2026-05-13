<template>
  <div :class="classes" :style="overlayStyle">
    <div class="ds-spinner" :class="sizeClass"></div>
    <slot />
  </div>
</template>

<script>
const SIZES = ['sm', 'md', 'lg'];

export default {
  name: 'DsSpinner',
  props: {
    size: {
      type: String,
      default: 'md',
      validator: (v) => SIZES.includes(v)
    },
    overlay: {
      type: Boolean,
      default: false
    },
    fixed: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    isOverlay() {
      return this.overlay || this.fixed;
    },
    classes() {
      return [
        'ds-spinner-wrapper',
        {
          'ds-spinner-wrapper--overlay': this.isOverlay && !this.fixed,
          'ds-spinner-wrapper--fixed': this.fixed
        }
      ];
    },
    sizeClass() {
      return `ds-spinner--${this.size}`;
    },
    overlayStyle() {
      if (!this.isOverlay) return {};
      return { '--ds-spinner-min-height': this.minHeight };
    },
    minHeight() {
      switch (this.size) {
        case 'sm':
          return '100px';
        case 'lg':
          return '400px';
        default:
          return '200px';
      }
    }
  }
};
</script>

<style scoped>
.ds-spinner-wrapper {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.ds-spinner-wrapper--overlay {
  position: absolute;
  inset: 0;
  background-color: var(--overlay-bg);
  min-height: var(--ds-spinner-min-height, 200px);
  z-index: 10;
}

.ds-spinner-wrapper--fixed {
  position: fixed;
  inset: 0;
  background-color: var(--overlay-bg);
  min-height: var(--ds-spinner-min-height, 200px);
  z-index: 1100;
}

.ds-spinner {
  border-radius: 50%;
  animation: ds-spin 1s linear infinite;
}

.ds-spinner--sm {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-light);
  border-top-color: var(--accent);
}

.ds-spinner--md {
  width: 40px;
  height: 40px;
  border: 4px solid var(--border-light);
  border-top-color: var(--accent);
}

.ds-spinner--lg {
  width: 56px;
  height: 56px;
  border: 5px solid var(--border-light);
  border-top-color: var(--accent);
}

@keyframes ds-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
