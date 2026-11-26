<template>
  <!-- #2195 — the Studio's operation-wait overlay (fence-clean build:
       mounted inside AdminDashboard; httpService untouched). Rendered off
       the operations' data path: state arrives as plain service snapshots
       through the subscription, never through the reactive arrays the
       operation itself is committing. -->
  <div v-if="operations.length" class="op-wait" role="status" aria-live="polite">
    <div class="op-wait__panel">
      <div class="op-wait__title">{{ translate('okf.opwait.title', 'Working…') }}</div>
      <div v-for="op in operations" :key="op.id" class="op-wait__row">
        <DsSpinner size="sm" />
        <span class="op-wait__label">{{ op.labelKey ? translate(op.labelKey, op.label) : op.label }}</span>
        <DsProgress v-if="op.total" class="op-wait__bar" :value="op.total ? op.done / op.total : 0" />
        <span v-if="op.total" class="op-wait__count">{{ op.done }}/{{ op.total }}</span>
        <DsButton v-if="op.cancellable" variant="secondary" small @click="onCancel(op)">
          {{ translate('okf.opwait.cancel', 'Cancel') }}
        </DsButton>
      </div>
      <div v-if="lastFailure" class="op-wait__failure">{{ lastFailure.message }}</div>
    </div>
  </div>
</template>

<script>
import DsButton from '../ds/Button.vue';
import DsProgress from '../ds/Progress.vue';
import DsSpinner from '../ds/Spinner.vue';
import opWait from '@/services/operationWaitService';

export default {
  name: 'OperationWaitOverlay',
  components: { DsButton, DsProgress, DsSpinner },
  data() {
    return {
      operations: [],
      lastFailure: null
    };
  },
  created() {
    // Plain-subscriber bridge: the service is Vue-free on purpose, so a
    // saturated main thread cannot wedge the overlay through the operation's
    // own reactivity. The snapshot is a fresh plain object every notify.
    this.unsubscribe = opWait.subscribe((snap) => {
      this.operations = snap.operations;
      this.lastFailure = snap.lastFailure;
    });
  },
  beforeUnmount() {
    if (this.unsubscribe) this.unsubscribe();
  },
  methods: {
    onCancel(op) {
      opWait.cancel(op.id);
    }
  }
};
</script>

<style scoped>
.op-wait {
  position: fixed;
  inset: 0;
  z-index: var(--ds-zindex-overlay, 4000);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-overlay-backdrop, rgba(15, 15, 20, 0.45));
}
.op-wait__panel {
  min-width: 260px;
  max-width: 420px;
  padding: var(--ds-space-4, 16px);
  background: var(--ds-surface, var(--surface, #fff));
  color: var(--ds-text, var(--text));
  border: 1px solid var(--ds-border, var(--border));
  border-radius: var(--ds-radius, 8px);
  box-shadow: var(--ds-shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.25));
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-2, 8px);
}
.op-wait__title {
  font-weight: 600;
  color: var(--ds-text, var(--text));
}
.op-wait__row {
  display: flex;
  align-items: center;
  gap: var(--ds-space-2, 8px);
}
.op-wait__label {
  flex: 1;
  color: var(--ds-text, var(--text));
}
.op-wait__bar {
  flex: 1;
}
.op-wait__count {
  color: var(--ds-muted, var(--muted));
  font-variant-numeric: tabular-nums;
}
.op-wait__failure {
  color: var(--ds-danger, var(--danger));
  font-size: 0.9em;
}
</style>
