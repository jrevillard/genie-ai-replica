<template>
  <DsStateDisplay :type="type" :message="message" :data-test-id="testId">
    <template v-if="retryable" #action>
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
 *
 * The Retry affordance is gated on `retryable`, NOT on the test handle:
 * a data-test-id is an inert attribute (E2E-TESTING.md) and must never be
 * load-bearing for behavior. The wrapper renders only `message` — the
 * DsStateDisplay default slot is intentionally not forwarded, so a caller
 * passing slot content gets a dev-time warning instead of a silently
 * empty panel.
 */
export default {
  name: 'AdminStatePanel',
  components: { DsStateDisplay, DsButton },
  props: {
    // Passed straight through to DsStateDisplay — the primitive owns the
    // type vocabulary and validates it; a second validator here would be a
    // second list to keep in sync.
    type: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    testId: {
      type: String,
      default: undefined
    },
    retryable: {
      type: Boolean,
      default: false
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
  emits: ['retry'],
  created() {
    if (this.retryable && !this.retryLabel && process.env.NODE_ENV !== 'production') {
      // An unlabeled button is a blank pill for sighted users and silence
      // for screen readers — make the missing label loud in dev.
      console.warn('[AdminStatePanel] retryable is set but retryLabel is missing — the button would render unlabeled.');
    }
    if (this.$slots.default && process.env.NODE_ENV !== 'production') {
      console.warn(
        '[AdminStatePanel] renders only `message` — default-slot content is discarded. Pass the text via the message prop.'
      );
    }
  }
};
</script>
