<template>
  <div class="chart-dialog-overlay" @click.self="close">
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

.chart-dialog-container {
  background: var(--bg-card);
  border-radius: 12px;
  width: 100%;
  max-width: 95vw;
  height: 85vh;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}

.chart-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}

.chart-dialog-header h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.25rem;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
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
  background: var(--bg-tertiary);
  border-radius: 4px;
}

.chart-dialog-body::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 4px;
}

.chart-dialog-body::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
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
