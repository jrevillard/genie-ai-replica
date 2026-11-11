<template>
  <DsStateDisplay :type="type" :message="message">
    <template v-if="retryable" #action>
      <DsButton variant="secondary" small :data-test-id="retryTestId" @click="$emit('retry')">
        {{ retryLabel || translate('admin.retry', 'Retry') }}
      </DsButton>
    </template>
  </DsStateDisplay>
</template>

<script>
import DsStateDisplay from '../ds/StateDisplay.vue';
import DsButton from '../ds/Button.vue';
import translateMixin from '../../mixins/translateMixin';

/**
 * AdminStatePanel — the admin dashboard's repeated state leaf (issue-wave
 * T2): a DsStateDisplay plus, optionally, one secondary Retry button.
 *
 * Before this wrapper the error+retry shell was hand-rolled six times and
 * the "Measuring…" fallback three times across AdminDashboard.vue's tabs —
 * any retry-affordance change had to land six times, and the measuring
 * note carried its own ad-hoc CSS beside a DS primitive that already
 * renders the same state. The wrapper is the single copy of that shell.
 * It is admin-scoped on purpose: it composes translate() output (the
 * dashboard-wide Retry label is the wrapper's default; a call site may
 * override it via retryLabel) and adds nothing a DS primitive should own.
 *
 * The Retry affordance is gated on `retryable`, NOT on the test handle:
 * a data-test-id is an inert attribute (E2E-TESTING.md) and must never be
 * load-bearing for behavior. Call sites pass their panel handle as a plain
 * `data-test-id` attribute — single-root fallthrough carries it to the
 * rendered .ds-state div. The wrapper renders only `message` — the
 * DsStateDisplay default slot is intentionally not forwarded, so a caller
 * passing slot content gets a dev-time warning instead of a silently
 * empty panel.
 */
export default {
  name: 'AdminStatePanel',
  components: { DsStateDisplay, DsButton },
  mixins: [translateMixin],
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
    retryable: {
      type: Boolean,
      default: false
    },
    // The retry button is NOT the root element — attr fallthrough cannot
    // reach it, so its handle rides this prop. The panel's own handle (if
    // any) is a plain data-test-id attribute on the wrapper.
    retryTestId: {
      type: String,
      default: undefined
    },
    // Override for the dashboard-wide Retry label (the hierarchy tab's
    // "Retry translations" is the current user).
    retryLabel: {
      type: String,
      default: undefined
    }
  },
  emits: ['retry'],
  created() {
    if (this.$slots.default && process.env.NODE_ENV !== 'production') {
      console.warn(
        '[AdminStatePanel] renders only `message` — default-slot content is discarded. Pass the text via the message prop.'
      );
    }
  }
};
</script>
