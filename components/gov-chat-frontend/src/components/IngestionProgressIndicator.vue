<template>
  <div v-if="shouldShow" class="ingestion-progress-indicator">
    <!-- Overall progress bar -->
    <div class="progress-header">
      <span class="progress-label">
        <template v-if="isError">
          Failed at: <strong>{{ currentStageName }}</strong>
        </template>
        <template v-else-if="isCompleted">
          Ingestion Complete
        </template>
        <template v-else>
          Stage: <strong>{{ currentStageName }}</strong>
        </template>
      </span>
      <span class="progress-percent">{{ Math.round(overallPercent) }}%</span>
    </div>

    <div class="progress-track">
      <div
        class="progress-fill"
        :class="{ 'progress-fill--error': isError, 'progress-fill--complete': isCompleted }"
        :style="{ width: overallPercent + '%' }"
      ></div>
    </div>

    <!-- Elapsed time -->
    <div class="progress-meta">
      <span class="elapsed-time">Elapsed: {{ elapsedTime }}</span>
    </div>

    <!-- Stage pipeline icons -->
    <div class="stage-pipeline">
      <div
        v-for="(stage, index) in stageStates"
        :key="stage.name"
        class="stage-item"
        :class="'stage-item--' + stage.state"
      >
        <div class="stage-icon">
          <!-- Completed: checkmark -->
          <svg v-if="stage.state === 'completed'" class="icon icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <!-- Active: spinner -->
          <svg v-else-if="stage.state === 'active'" class="icon icon-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
            <path d="M12 2 A10 10 0 0 1 22 12"></path>
          </svg>
          <!-- Error: X icon -->
          <svg v-else-if="stage.state === 'error'" class="icon icon-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
          <!-- Pending: circle -->
          <svg v-else class="icon icon-pending" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="8"></circle>
          </svg>
        </div>
        <span class="stage-name">{{ stage.name }}</span>
        <!-- Connector line between stages -->
        <div v-if="index < stageStates.length - 1" class="stage-connector" :class="{ 'stage-connector--done': index < stagesCompletedCount }"></div>
      </div>
    </div>
  </div>
</template>

<script>
const STAGE_NAMES = ['Extraction', 'Chunking', 'Guardrail', 'Labeling', 'Graph'];

export default {
  name: 'IngestionProgressIndicator',
  props: {
    progress: {
      type: Object,
      default: null
    },
    fileStatus: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      now: Date.now(),
      elapsedTimer: null
    };
  },
  computed: {
    shouldShow() {
      // Hide if file status is not "Ingesting" and no terminal progress record exists
      const isIngesting = this.fileStatus?.toLowerCase() === 'ingesting';
      const hasTerminalRecord = this.progress && (this.progress.status === 'completed' || this.progress.status === 'error');
      return isIngesting || hasTerminalRecord;
    },
    isCompleted() {
      return this.progress && this.progress.status === 'completed';
    },
    isError() {
      return this.progress && this.progress.status === 'error';
    },
    stagesCompletedCount() {
      return this.progress ? (this.progress.stages_completed || 0) : 0;
    },
    currentStageName() {
      if (!this.progress) return '';
      if (this.progress.current_stage === 'Completed') return 'Completed';
      return this.progress.current_stage || '';
    },
    overallPercent() {
      if (!this.progress) return 0;
      const stagesCompleted = this.progress.stages_completed || 0;
      const stageProgressPercent = this.progress.stage_progress_percent || 0;
      const totalStages = this.progress.total_stages || 5;
      return ((stagesCompleted * 100) + stageProgressPercent) / totalStages;
    },
    elapsedTime() {
      if (!this.progress || !this.progress.started_at) return '00:00:00';

      // On completion, show total elapsed = finished_at - started_at
      if (this.isCompleted && this.progress.finished_at) {
        const start = new Date(this.progress.started_at).getTime();
        const end = new Date(this.progress.finished_at).getTime();
        return this.formatDuration(end - start);
      }

      // On error, also freeze at finished_at
      if (this.isError && this.progress.finished_at) {
        const start = new Date(this.progress.started_at).getTime();
        const end = new Date(this.progress.finished_at).getTime();
        return this.formatDuration(end - start);
      }

      // Live elapsed time
      const start = new Date(this.progress.started_at).getTime();
      const diff = this.now - start;
      return this.formatDuration(diff);
    },
    stageStates() {
      if (!this.progress) return STAGE_NAMES.map(name => ({ name, state: 'pending' }));

      const stagesCompleted = this.progress.stages_completed || 0;
      const status = this.progress.status || 'in_progress';

      return STAGE_NAMES.map((name, index) => {
        let state;
        if (index < stagesCompleted) {
          state = 'completed';
        } else if (index === stagesCompleted && status === 'in_progress') {
          state = 'active';
        } else if (index === stagesCompleted && status === 'error') {
          state = 'error';
        } else if (status === 'completed') {
          // All stages completed
          state = 'completed';
        } else {
          state = 'pending';
        }
        return { name, state };
      });
    }
  },
  mounted() {
    this.startElapsedTimer();
  },
  beforeUnmount() {
    this.stopElapsedTimer();
  },
  watch: {
    progress: {
      handler(newVal) {
        if (newVal && (newVal.status === 'completed' || newVal.status === 'error')) {
          this.stopElapsedTimer();
        } else if (newVal && newVal.status === 'in_progress') {
          this.startElapsedTimer();
        }
      },
      deep: true
    }
  },
  methods: {
    startElapsedTimer() {
      this.stopElapsedTimer();
      this.now = Date.now();
      this.elapsedTimer = setInterval(() => {
        this.now = Date.now();
      }, 1000);
    },
    stopElapsedTimer() {
      if (this.elapsedTimer) {
        clearInterval(this.elapsedTimer);
        this.elapsedTimer = null;
      }
    },
    formatDuration(ms) {
      if (ms < 0) ms = 0;
      const totalSeconds = Math.floor(ms / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return [
        String(hours).padStart(2, '0'),
        String(minutes).padStart(2, '0'),
        String(seconds).padStart(2, '0')
      ].join(':');
    }
  }
};
</script>

<style scoped>
.ingestion-progress-indicator {
  background-color: var(--progress-bg, #f8f9fa);
  border: 1px solid var(--progress-border, #e2e8f0);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.progress-label {
  font-size: 14px;
  color: var(--progress-label-color, #4a5568);
}

.progress-label strong {
  color: var(--progress-label-strong, #2d3748);
}

.progress-percent {
  font-size: 14px;
  font-weight: 600;
  color: var(--progress-percent-color, #2d3748);
}

.progress-track {
  width: 100%;
  height: 8px;
  background-color: var(--progress-track-bg, #e2e8f0);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: var(--progress-fill-color, #4e97d1);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-fill--error {
  background-color: var(--progress-error-color, #e53e3e);
}

.progress-fill--complete {
  background-color: var(--progress-complete-color, #38a169);
}

.progress-meta {
  margin-top: 8px;
  margin-bottom: 16px;
}

.elapsed-time {
  font-size: 12px;
  color: var(--progress-meta-color, #718096);
  font-family: monospace;
}

/* Stage pipeline layout */
.stage-pipeline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  position: relative;
}

.stage-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  flex: 1;
}

.stage-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  margin-bottom: 6px;
}

.stage-item--completed .stage-icon {
  background-color: var(--stage-completed-bg, #c6f6d5);
  color: var(--stage-completed-color, #22543d);
}

.stage-item--active .stage-icon {
  background-color: var(--stage-active-bg, #bee3f8);
  color: var(--stage-active-color, #2a4365);
}

.stage-item--pending .stage-icon {
  background-color: var(--stage-pending-bg, #edf2f7);
  color: var(--stage-pending-color, #a0aec0);
}

.stage-item--error .stage-icon {
  background-color: var(--stage-error-bg, #fed7d7);
  color: var(--stage-error-color, #742a2a);
}

.icon {
  width: 16px;
  height: 16px;
}

.icon-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.stage-name {
  font-size: 11px;
  color: var(--stage-name-color, #4a5568);
  text-align: center;
  white-space: nowrap;
}

.stage-item--active .stage-name {
  font-weight: 600;
  color: var(--stage-active-name, #2a4365);
}

.stage-item--error .stage-name {
  font-weight: 600;
  color: var(--stage-error-name, #742a2a);
}

/* Connector lines between stages */
.stage-connector {
  position: absolute;
  top: 14px;
  left: calc(50% + 18px);
  width: calc(100% - 36px);
  height: 2px;
  background-color: var(--connector-pending, #e2e8f0);
}

.stage-connector--done {
  background-color: var(--connector-done, #38a169);
}
</style>
