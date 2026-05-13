<template>
  <div
    ref="menu"
    class="context-menu"
    :style="{
      top: `${adjustedPosition.y}px`,
      left: `${adjustedPosition.x}px`
    }"
  >
    <slot></slot>
  </div>
</template>

<script>
export default {
  name: 'ContextMenu',

  props: {
    position: {
      type: Object,
      required: true,
      validator: (value) => {
        return typeof value.x === 'number' && typeof value.y === 'number';
      }
    }
  },
  emits: ['close'],

  data() {
    return {
      adjustedPosition: {
        x: this.position.x,
        y: this.position.y
      }
    };
  },

  mounted() {
    document.addEventListener('click', this.handleOutsideClick);

    // Adjust position if menu would go off-screen
    this.$nextTick(() => {
      if (!this.$refs.menu) return;

      const menu = this.$refs.menu;
      const rect = menu.getBoundingClientRect();

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Adjust horizontal position if needed
      if (rect.right > viewportWidth) {
        this.adjustedPosition.x = Math.max(0, this.position.x - rect.width);
      }

      // Adjust vertical position if needed
      if (rect.bottom > viewportHeight) {
        this.adjustedPosition.y = Math.max(0, this.position.y - rect.height);
      }
    });
  },

  beforeUnmount() {
    document.removeEventListener('click', this.handleOutsideClick);
  },

  methods: {
    handleOutsideClick(event) {
      // Check if click is outside of the menu
      if (this.$refs.menu && !this.$refs.menu.contains(event.target)) {
        this.$emit('close');
      }
    }
  }
};
</script>

<style scoped>
.context-menu {
  position: fixed;
  background-color: var(--surface);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  min-width: 180px;
  padding: var(--space-xs) 0;
  z-index: 1060;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
