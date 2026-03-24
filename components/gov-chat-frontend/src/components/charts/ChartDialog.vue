<template>
  <div class="chart-dialog-overlay" :class="{ 'dark-mode': isDarkMode }" @click.self="close">
    <div class="chart-dialog-container">
      <div class="chart-dialog-header">
        <h3>{{ title }}</h3>
        <button class="close-btn" @click="close" aria-label="Close">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="chart-dialog-body">
        <slot></slot>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "ChartDialog",
  props: {
    title: {
      type: String,
      required: true
    }
  },
  computed: {
    isDarkMode() {
      return document.documentElement.getAttribute("data-theme") === "dark";
    }
  },
  methods: {
    close() {
      this.$emit("close");
    },
    handleKeydown(event) {
      if (event.key === "Escape") {
        this.close();
      }
    }
  },
  mounted() {
    document.addEventListener("keydown", this.handleKeydown);
    document.body.style.overflow = "hidden";
  },
  beforeUnmount() {
    document.removeEventListener("keydown", this.handleKeydown);
    document.body.style.overflow = "";
  }
};
</script>

<style scoped>
.chart-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
  backdrop-filter: blur(4px);
}

.dark-mode.chart-dialog-overlay {
  background: rgba(0, 0, 0, 0.85);
}

.chart-dialog-container {
  background: var(--bg-card, #ffffff);
  border-radius: 12px;
  width: 100%;
  max-width: 95vw;
  height: 85vh;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.dark-mode .chart-dialog-container {
  background: var(--bg-card-dark, #1f2937);
}

.chart-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  flex-shrink: 0;
}

.dark-mode .chart-dialog-header {
  border-bottom-color: var(--border-color-dark, #374151);
}

.chart-dialog-header h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary, #111827);
}

.dark-mode .chart-dialog-header h3 {
  color: var(--text-primary-dark, #f9fafb);
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.25rem;
  color: var(--text-secondary, #6b7280);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background: var(--bg-hover, #f3f4f6);
  color: var(--text-primary, #111827);
}

.dark-mode .close-btn:hover {
  background: var(--bg-hover-dark, #374151);
  color: var(--text-primary-dark, #f9fafb);
}

.chart-dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.chart-dialog-body::-webkit-scrollbar {
  width: 8px;
}

.chart-dialog-body::-webkit-scrollbar-track {
  background: var(--bg-secondary, #f9fafb);
  border-radius: 4px;
}

.dark-mode .chart-dialog-body::-webkit-scrollbar-track {
  background: var(--bg-secondary-dark, #374151);
}

.chart-dialog-body::-webkit-scrollbar-thumb {
  background: var(--border-color, #d1d5db);
  border-radius: 4px;
}

.dark-mode .chart-dialog-body::-webkit-scrollbar-thumb {
  background: var(--border-color-dark, #4b5563);
}

.chart-dialog-body::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary, #6b7280);
}

@media (max-width: 768px) {
  .chart-dialog-overlay {
    padding: 8px;
  }

  .chart-dialog-container {
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    max-width: 100vw;
    border-radius: 0;
  }

  .chart-dialog-header {
    padding: 12px 16px;
  }

  .chart-dialog-header h3 {
    font-size: 1.1rem;
  }

  .chart-dialog-body {
    padding: 16px;
  }
}
</style>
