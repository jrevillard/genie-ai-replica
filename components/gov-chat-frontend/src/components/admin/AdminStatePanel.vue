<template>
  <DsStateDisplay :type="type" :message="message" :data-test-id="testId">
    <template v-if="retryTestId" #action>
      <DsButton variant="secondary" small :data-test-id="retryTestId" @click="$emit('retry')">
        {{ retryLabel }}
      </DsButton>
    </template>
  </DsStateDisplay>
</template>

<script>
import DsStateDisplay from '../ds/StateDisplay.vue';
import DsButton from '../ds/Button.vue';

/**
 * AdminStatePanel — the admin dashboard's repeated state leaf (issue-wave
 * T2): a DsStateDisplay plus, optionally, one secondary Retry button.
 *
 * Before this wrapper the error+retry shell was hand-rolled six times and
 * the "Measuring…" fallback three times across AdminDashboard.vue's tabs —
 * any retry-affordance change had to land six times, and the measuring
 * note carried its own ad-hoc CSS beside a DS primitive that already
 * renders the same state. The wrapper is the single copy of that shell.
 * It is admin-scoped on purpose: the panel composes the dashboard's
 * translate() output into DS primitives and adds nothing a DS primitive
 * should own.
 */
export default {
  name: 'AdminStatePanel',
  components: { DsStateDisplay, DsButton },
  props: {
    type: {
      type: String,
      required: true,
      validator: (v) => ['error', 'loading', 'empty'].includes(v)
    },
    message: {
      type: String,
      required: true
    },
    testId: {
      type: String,
      default: undefined
    },
    retryTestId: {
      type: String,
      default: undefined
    },
    retryLabel: {
      type: String,
      default: undefined
    }
  },
  emits: ['retry']
};
</script>
