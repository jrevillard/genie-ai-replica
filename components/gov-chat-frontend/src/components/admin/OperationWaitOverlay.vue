<template>
  <!-- #2195 — the Studio's operation-wait panel (fence-clean build:
       mounted inside AdminDashboard; httpService untouched). Rendered off
       the operations' data path: state arrives as plain service snapshots
       through the subscription, never through the reactive arrays the
       operation feeds.

       NON-BLOCKING by design (code review !1094 round 1): a fullscreen
       backdrop would re-lock the app — including on the dashboard's own
       background refreshes, which register as short ops. A corner panel
       carries the Law's affordance (visible, app-level, cancellable)
       without re-introducing the lock. -->
  <div v-if="operations.length || lastFailure" class="op-wait" role="status" aria-live="polite">
    <div class="op-wait__panel">
      <div class="op-wait__title">{{ translate('okf.opwait.title', 'Working…') }}</div>
      <div v-for="op in operations" :key="op.id" class="op-wait__row" :class="`op-wait__row--${op.state}`">
        <DsSpinner v-if="op.state === 'active'" size="sm" />
        <span class="op-wait__label">{{ op.labelKey ? translate(op.labelKey, op.label) : op.label }}</span>
        <DsProgress v-if="op.total" class="op-wait__bar" :max="op.total" :value="op.done" />
        <span v-if="op.total" class="op-wait__count">{{ op.done }}/{{ op.total }}</span>
        <!-- Cancel renders ONLY for an actively-running op that wired a real
             abort — never for a completing/failed row in its min-visible
             window (a cancel click there would fire the server cancel for a
             job that already ended). -->
        <DsButton v-if="op.cancellable && op.state === 'active'" variant="secondary" small @click="onCancel(op)">
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
import translateMixin from '../../mixins/translateMixin';
import opWait from '@/services/operationWaitService';

export default {
  name: 'OperationWaitOverlay',
  components: { DsButton, DsProgress, DsSpinner },
  // The mixin (not a test mock): this component MUST own its translate —
  // Vue 3 resolves template identifiers against the child's own instance.
  mixins: [translateMixin],
  data() {
    return {
      operations: [],
      lastFailure: null
    };
  },
  created() {
    // Plain-subscriber bridge: the service is Vue-free on purpose, so a
    // saturated main thread cannot wedge the panel through the operation's
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
  right: var(--space-lg, 24px);
  bottom: var(--space-lg, 24px);
  z-index: 1050; /* below AdminDashboard dialogs (1100+), above content */
  pointer-events: none; /* the panel re-enables — the page stays usable */
}
.op-wait__panel {
  min-width: 240px;
  max-width: 380px;
  padding: var(--space-md, 12px);
  pointer-events: auto;
  background: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm, 8px);
}
.op-wait__title {
  font-weight: 600;
  color: var(--fg);
}
.op-wait__row {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 8px);
}
.op-wait__row--completing,
.op-wait__row--failed {
  opacity: 0.65;
}
.op-wait__label {
  flex: 1;
  color: var(--fg);
}
.op-wait__bar {
  flex: 1;
}
.op-wait__count {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.op-wait__failure {
  color: var(--danger);
  font-size: 0.9em;
}
</style>
