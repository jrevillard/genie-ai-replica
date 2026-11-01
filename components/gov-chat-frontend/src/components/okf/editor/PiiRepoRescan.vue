<!--
  OkfPiiRepoRescan.vue — REPO-WIDE PII RE-SCAN, reachable from the EDITOR.

  WHY THIS EXISTS (2026-10-13, follow-up to the 141-concept PII incident):
  the repo-level re-scan lived on the Validate step ONLY. A curator working in
  the editor — the surface they are actually in — had no way to clear a
  concept whose scan errored, which is the ONE pii_state that blocks the
  hand-off and that no per-occurrence action can reach (an 'error' has no
  occurrences to subtract and is deliberately not waivable by acknowledgement).
  The remedy was reachable from one screen out of three. Same defect class as
  the incident: a state that blocks with no in-context way out.

  ONE CODE PATH, BY CONSTRUCTION. This dispatches `okf/startRepoPiiScan` and
  `okf/getRepoPiiScan` — the exact actions Validate.vue uses. No new endpoint,
  no second store action, no divergent copy of the polling loop's contract.

  HONEST TERMINAL STATES, copied from the Validate step: a 404 (this server
  build has no re-scan route), a 409 (the repository is draining/publishing)
  and a failed run each render a VISIBLE error naming what did not happen. A
  control that refreshes a display while changing nothing is the exact defect
  this file exists to prevent, so it never swallows one.
-->
<template>
  <div class="okf-pii-rescan">
    <DsButton
      v-if="!readOnly"
      variant="secondary"
      small
      :disabled="busy"
      :aria-busy="busy ? 'true' : 'false'"
      @click="onRescan"
    >
      <DsSpinner v-if="busy" size="sm" />
      {{ busy ? translate('okf.editor.piiRescan.working', 'Re-scanning every page…') : buttonLabel }}
    </DsButton>
    <p v-if="note" class="okf-pii-rescan__note" role="status">{{ note }}</p>
    <p v-if="error" class="okf-pii-rescan__error" role="alert">{{ error }}</p>
    <ul v-if="tally" class="okf-pii-rescan__tally">
      <li class="okf-pii-rescan__tally-row">
        <DsStatusTag :variant="tally.error ? 'error' : 'success'" small>
          {{
            translate('okf.editor.piiRescan.scanned', '{n} page(s) re-scanned').replace('{n}', String(tally.scanned))
          }}
        </DsStatusTag>
        <span class="okf-pii-rescan__parts">
          <span class="okf-pii-rescan__part"
            >{{ tally.clean }} {{ translate('okf.editor.piiRescan.clean', 'clear') }}</span
          >
          <span class="okf-pii-rescan__part"
            >{{ tally.hit }} {{ translate('okf.editor.piiRescan.hit', 'flagged') }}</span
          >
          <span class="okf-pii-rescan__part" :class="{ 'okf-pii-rescan__part--error': tally.error }">
            {{ tally.error }} {{ translate('okf.editor.piiRescan.error', 'scan error') }}
          </span>
          <span v-if="tally.missing" class="okf-pii-rescan__part okf-pii-rescan__part--error">
            {{ tally.missing }} {{ translate('okf.editor.piiRescan.vanished', 'vanished') }}
          </span>
        </span>
      </li>
      <!-- The error rows are named: a bare "1 scan error" does not tell the
           curator which page to open, and these are the concepts still
           refusing the hand-off. -->
      <li v-for="r in errorRows" :key="r.concept_id" class="okf-pii-rescan__tally-row">
        <DsStatusTag variant="error" small>{{
          translate('okf.editor.piiRescan.stillBlocking', 'Still blocking')
        }}</DsStatusTag>
        <code class="okf-pii-rescan__id">{{ r.concept_id }}</code>
        <span v-if="r.reason" class="okf-pii-rescan__detail">{{ r.reason }}</span>
      </li>
    </ul>
  </div>
</template>

<script>
import DsButton from '../../ds/Button.vue';
import DsSpinner from '../../ds/Spinner.vue';
import DsStatusTag from '../../ds/StatusTag.vue';
import translateMixin from '../../../mixins/translateMixin';

// The run is DETACHED server-side (one Presidio round-trip per concept), so
// the control polls. Same cadence as the Validate step's panel — fast enough
// that the bar moves, slow enough not to hammer the API.
const PII_RESCAN_POLL_MS = 3000;
// CEILING (round 18, #80488): a server run wedged at status 'running'
// (worker crash without reaping) used to re-arm the 3s timer forever and
// the button spun indefinitely — the exact dead-end class the surrounding
// poll hardening exists to remove. Same horizon class as the store's
// pollJob PII actions (15 min); past it the run STOPS being followed with
// a readable timeout. The server-side run itself is untouched.
const PII_RESCAN_MAX_MS = 15 * 60 * 1000;

export default {
  name: 'OkfPiiRepoRescan',
  components: { DsButton, DsSpinner, DsStatusTag },
  mixins: [translateMixin],
  props: {
    repoId: { type: String, required: true },
    // A serving (frozen) repository refuses the write with a 409; hide the
    // control rather than offering a button that can only fail.
    readOnly: { type: Boolean, default: false },
    // The concept currently open in the editor. The run is repo-scoped, but
    // the guard below captures it so a result can never be rendered against a
    // concept the curator has already navigated away from.
    conceptId: { type: String, default: '' }
  },
  emits: ['rescanned'],
  data() {
    return {
      busy: false,
      note: '',
      error: '',
      tally: null,
      // STALE-ANSWER GUARD. A tally describes THIS repository at THIS moment.
      // Bumped by: starting a run, the repo changing, the concept changing,
      // and unmount. A poll whose epoch moved while in flight is discarded —
      // same idiom as TestingLabDialog's suiteEpoch / queryEpoch.
      epoch: 0
    };
  },
  computed: {
    buttonLabel() {
      return this.translate('okf.editor.piiRescan.button', 'Re-scan all pages');
    },
    // Error rows from the last run — the concepts STILL refusing the hand-off
    // after it. Server-side pii_scan_error rides along so the curator sees WHY.
    errorRows() {
      const results = this.tally && Array.isArray(this.tally.results) ? this.tally.results : [];
      return results
        .filter((r) => r && (r.pii_state === 'error' || r.skipped))
        .map((r) => ({ concept_id: r.concept_id, reason: r.error || r.skipped || null }));
    }
  },
  watch: {
    // STALE-ANSWER GUARD: this changes the SUBJECT every in-flight poll is
    // about. Both keys bump the epoch AND stop the timer, so an abandoned run
    // cannot keep a hidden poll alive or write into the new repository's row.
    repoId() {
      this.reset('repo');
    },
    conceptId() {
      this.epoch += 1;
      this._stopPolling();
    }
  },
  beforeUnmount() {
    this.epoch += 1;
    this._stopPolling();
  },
  methods: {
    // The poll timer is a NON-REACTIVE instance handle (declared here rather
    // than in data(): vue/no-reserved-keys rejects `_`-prefixed data keys).
    // Nothing renders from it — it only has to be cancellable.
    _timer: null,
    reset() {
      this.epoch += 1;
      this._stopPolling();
      this.busy = false;
      this.note = '';
      this.error = '';
      this.tally = null;
    },
    _stopPolling() {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
    },
    async onRescan() {
      if (this.busy) return; // double-submit guard, not a silent drop
      const epoch = ++this.epoch;
      const repoId = this.repoId;
      const conceptId = this.conceptId;
      this.busy = true;
      this.note = '';
      this.error = '';
      this.tally = null;
      const res = await this.$store.dispatch('okf/startRepoPiiScan', { repoId });
      // STALE-ANSWER GUARD: the repo or the open concept changed while the
      // arm request was in flight.
      if (epoch !== this.epoch || repoId !== this.repoId || conceptId !== this.conceptId) return;
      if (!res || !res.ok) {
        this.busy = false;
        this.error = this.errorMessage(res);
        return;
      }
      const scanKey = res.result && res.result.scan_key;
      if (!scanKey) {
        // A 2xx with no run id is not a run we can follow — say so rather
        // than leaving a spinner on a button that will never finish.
        this.busy = false;
        this.error = this.translate(
          'okf.editor.piiRescan.noKey',
          'The server accepted the re-scan but returned no run id, so its progress cannot be followed. Nothing was reported.'
        );
        return;
      }
      this._deadline = Date.now() + PII_RESCAN_MAX_MS;
      this._poll(epoch, repoId, conceptId, scanKey);
    },
    async _poll(epoch, repoId, conceptId, scanKey) {
      const res = await this.$store.dispatch('okf/getRepoPiiScan', { repoId, scanKey });
      if (epoch !== this.epoch || repoId !== this.repoId || conceptId !== this.conceptId) return;
      if (!res || !res.ok) {
        this.busy = false;
        this.error = this.errorMessage(res);
        return;
      }
      const run = res.result || {};
      if (run.status === 'running') {
        // Horizon (#80488 — see PII_RESCAN_MAX_MS): stop following with a
        // readable timeout instead of spinning forever on a wedged run.
        if (this._deadline && Date.now() > this._deadline) {
          this.busy = false;
          this._timer = null;
          this.error = this.translate(
            'okf.editor.piiRescan.timeout',
            'The re-scan is still running after 15 minutes — it keeps going server-side. Nothing was lost; check back in a minute.'
          );
          return;
        }
        const p = run.progress || {};
        const done = Number(p.done || 0);
        const total = Number(p.total || 0);
        this.note = total
          ? this.translate('okf.editor.piiRescan.progress', 'Re-scanning… {done} of {total} pages')
              .replace('{done}', String(done))
              .replace('{total}', String(total))
          : this.translate('okf.editor.piiRescan.progressIdle', 'Re-scanning… reading the repository');
        this._timer = setTimeout(() => this._poll(epoch, repoId, conceptId, scanKey), PII_RESCAN_POLL_MS);
        return;
      }
      // Terminal from here: 'failed' is as final as 'done' (the server reaps
      // orphaned runs), so neither may leave the button spinning.
      this.busy = false;
      this._timer = null;
      if (run.status === 'failed') {
        const err = run.error || {};
        this.error =
          err.message ||
          this.translate(
            'okf.editor.piiRescan.failed',
            'Re-scan failed. Nothing was changed — the pages that failed their scan are still blocking publishing.'
          );
        // A failed run may still carry a partial tally — showing it is more
        // honest than hiding the concepts it did reach.
        if (run.tally) this.tally = this.normaliseTally(run.tally);
        return;
      }
      this.tally = this.normaliseTally(run);
      // Re-read the concept list: a concept that just came back clean must
      // leave the flagged set, and the publish banner reads from that list.
      await this.$store.dispatch('okf/fetchConcepts', repoId);
      if (epoch !== this.epoch || repoId !== this.repoId || conceptId !== this.conceptId) return;
      const t = this.tally;
      this.note =
        t.error || t.missing
          ? this.translate(
              'okf.editor.piiRescan.partial',
              'Re-scanned {n} page(s). {e} still failed — their scan verdict did not change, so publishing stays blocked for them.'
            )
              .replace('{n}', String(t.scanned))
              .replace('{e}', String(t.error + t.missing))
          : this.translate('okf.editor.piiRescan.done', 'Re-scanned {n} page(s).').replace('{n}', String(t.scanned));
      this.$emit('rescanned', { repoId, tally: this.tally });
    },
    // Every count coerced to a number — a missing counter renders 0, never
    // "undefined" and never NaN.
    normaliseTally(run) {
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      return {
        scanned: num(run.scanned),
        clean: num(run.clean),
        hit: num(run.hit),
        error: num(run.error),
        missing: num(run.missing),
        results: Array.isArray(run.results) ? run.results : []
      };
    },
    // Why the re-scan did not run. Never swallowed: a 404 here means this
    // server build has no re-scan route, which is exactly the silent no-op
    // the curator is being spared.
    errorMessage(res) {
      const status = res && res.status;
      const serverMessage = res && res.error;
      const code = res && res.code;
      const explain = (c) => (code && code !== c ? ` (${code})` : '');
      if (status === 404) {
        return (
          serverMessage ||
          this.translate(
            'okf.editor.piiRescan.missing',
            'Re-scan is not available on this server (404). Nothing was changed — the pages that failed their scan are still blocking publishing.'
          ) + explain('NOT_FOUND')
        );
      }
      if (status === 409) {
        return (
          serverMessage ||
          this.translate(
            'okf.editor.piiRescan.frozen',
            'Re-scan refused: the repository is being published (409). Nothing was changed.'
          ) + explain('REPO_DRAINING')
        );
      }
      return (
        serverMessage ||
        this.translate(
          'okf.editor.piiRescan.failed',
          'Re-scan failed. Nothing was changed — the pages that failed their scan are still blocking publishing.'
        )
      );
    }
  }
};
</script>

<style scoped>
.okf-pii-rescan {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
  width: 100%;
}
.okf-pii-rescan__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-pii-rescan__error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-sm);
  font-weight: 600;
}
.okf-pii-rescan__tally {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: 100%;
}
.okf-pii-rescan__tally-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
}
.okf-pii-rescan__parts {
  display: inline-flex;
  gap: var(--space-xs);
  flex-wrap: wrap;
}
.okf-pii-rescan__part {
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-pii-rescan__part--error {
  color: var(--danger);
  font-weight: 600;
}
.okf-pii-rescan__id {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--muted);
}
.okf-pii-rescan__detail {
  color: var(--muted);
  font-size: var(--text-xs);
}
</style>
