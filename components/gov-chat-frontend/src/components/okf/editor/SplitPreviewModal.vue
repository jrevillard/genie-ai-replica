<!--
  OkfSplitPreviewModal.vue — #1577 story 2: the split CONFIRM dialog.

  CAP-3's "legible before": the ONE server engine (the split-preview
  endpoint — the same preflight the POST runs, minus the write) proposes the
  seams; this dialog renders the per-part rows BEFORE any write and keeps
  confirm disabled until a plan is on screen. Typed refusals
  (WITHIN_CEILING / CONCEPT_TOO_LARGE / TOO_MANY_PARTS / PART_ID_CONFLICT)
  render the server's message verbatim; a transport failure renders an
  honest error line — in both states the dialog stays open and confirm
  stays disabled (never a half-informed confirm). A post-preview mutation
  race is answered by the write path's own refusals, rendered verbatim.

  The dialog renders TEXT only (no v-html — carry-in rule from the security
  baseline).
-->
<template>
  <DsDialog
    class="genie-living-intelligence"
    :visible="visible"
    :title="translate('okf.editor.split.title', 'Split concept')"
    size="md"
    :loading="loading"
    @close="onClose"
  >
    <div data-test-id="okf-split-preview">
      <template v-if="plan">
        <p class="okf-split__lead">{{ bodyLead }}</p>
        <p class="okf-split__ceiling">
          {{ ceilingLine }}
        </p>
        <p class="okf-split__parts-title">{{ translate('okf.editor.split.parts', 'Proposed parts') }}</p>
        <ul class="okf-split__parts">
          <li v-for="p in plan.parts" :key="p.concept_id" class="okf-split__part" data-test-id="okf-split-part-row">
            <span class="okf-split__part-name">
              {{ p.title || p.concept_id }}
              <code class="okf-split__part-id">{{ p.concept_id }}</code>
            </span>
            <span class="okf-split__part-path">{{ p.path }}</span>
            <span class="okf-split__part-chars">
              {{ translate('okf.editor.split.partChars', '{chars} characters').replace('{chars}', String(p.chars)) }}
            </span>
          </li>
        </ul>
      </template>

      <!-- A typed refusal (preview) or a write refusal (confirm): the
           server's message, verbatim. The dialog stays open either way. -->
      <p v-if="refusal" class="okf-split__refusal" data-test-id="okf-split-refusal">
        <strong>{{ translate('okf.editor.split.refused', 'The server refused the split:') }}</strong>
        {{ refusal }}
      </p>
      <!-- A transport-level preview failure: no plan ever landed, so confirm
           stays disabled and the error line says so. -->
      <p v-if="fetchError" class="okf-split__error" data-test-id="okf-split-error">{{ fetchError }}</p>
      <!-- The center pane holds a dirty draft (passive text only): the split
           works on the SAVED body, so confirming discards the draft — said
           BEFORE the confirm, not discovered after it. -->
      <p v-if="dirtyHint" class="okf-split__dirty" data-test-id="okf-split-dirty">
        {{ dirtyLine }}
      </p>
    </div>

    <template #footer>
      <DsButton variant="secondary" small data-test-id="okf-split-cancel" :disabled="running" @click="onClose">
        {{ translate('common.cancel', 'Cancel') }}
      </DsButton>
      <DsButton
        variant="primary"
        small
        data-test-id="okf-split-confirm"
        :disabled="!plan || running"
        @click="onConfirm"
      >
        {{
          running ? translate('okf.editor.split.working', 'Splitting…') : translate('okf.editor.split.confirm', 'Split')
        }}
      </DsButton>
    </template>
  </DsDialog>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsButton from '../../ds/Button.vue';
import DsDialog from '../../ds/Dialog.vue';
import repoOkfService from '../../../services/repoOkfService';

// WHY CONSTANTS: the i18n contract test (`okf-surface-i18n-contract.test.js`)
// extracts the referenced `okf.*` keys with a PER-LINE regex — a `translate(`
// call that Prettier has wrapped across lines is invisible to it. Hoisting
// the long fallbacks into constants keeps every key on ONE line, where the
// extractor sees it (the ceilingOverNote precedent in ConceptEditor.vue).
const BODY_LEAD_FALLBACK =
  'The server proposes how this concept divides along lossless seams. Nothing is written until you confirm.';
const CEILING_FALLBACK = 'Ceiling: {ceiling} characters';
const PREVIEW_FAILED_FALLBACK = 'Could not load the split preview — nothing has been proposed yet.';
const FAILED_FALLBACK = 'The split failed — nothing was changed.';
const DIRTY_FALLBACK =
  'You have unsaved edits in this concept — the split works on the SAVED body; confirming discards the draft.';

export default {
  name: 'OkfSplitPreviewModal',
  components: { DsButton, DsDialog },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false },
    repoId: { type: String, default: null },
    // The concept the split will divide (part 1 keeps this id).
    conceptId: { type: String, default: null },
    // The center pane holds a dirty draft — the split works on the SAVED
    // body, so the dialog warns BEFORE the confirm (passive text).
    dirtyHint: { type: Boolean, default: false }
  },
  emits: ['close', 'done'],
  data() {
    return {
      // The landed plan ({concept_id, parts, ceiling, body_chars}) — the ONLY
      // state that can ever arm confirm.
      plan: null,
      // Preview refused (typed refusal) or the write refused after confirm:
      // the server's message, rendered verbatim.
      refusal: '',
      // The preview transport failed — no plan, nothing proposed.
      fetchError: '',
      loading: false,
      running: false
    };
  },
  computed: {
    bodyLead() {
      return this.translate('okf.editor.split.body', BODY_LEAD_FALLBACK);
    },
    ceilingLine() {
      return this.translate('okf.editor.split.ceiling', CEILING_FALLBACK).replace(
        '{ceiling}',
        String((this.plan && this.plan.ceiling) || '')
      );
    },
    // WHY A COMPUTED: module constants are invisible to template render
    // scope (the fmKinds precedent) — the fallback would arrive undefined
    // and the raw key would render.
    dirtyLine() {
      return this.translate('okf.editor.split.dirty', DIRTY_FALLBACK);
    }
  },
  watch: {
    visible: {
      // IMMEDIATE: the parent renders this dialog always-mounted with
      // `visible` derived from its state — a mount that opens straight
      // into true must load, not wait for a transition that never comes.
      immediate: true,
      handler(v) {
        if (v) this.load();
      }
    }
  },
  methods: {
    onClose() {
      if (this.running) return; // a confirm in flight cannot be dismissed away
      this.$emit('close');
    },
    reset() {
      this.plan = null;
      this.refusal = '';
      this.fetchError = '';
      this.loading = false;
      this.running = false;
    },
    async load() {
      this.reset();
      if (!this.repoId || !this.conceptId) return;
      // STALE-RESPONSE GUARD (the ConceptEditor _loadSeq precedent): this
      // dialog is always mounted, so open A → close → open B fires two
      // overlapping fetches — a slow OLD response must never overwrite the
      // NEW load's state (A's plan arming confirm while B's concept is the
      // one the POST would split breaks CAP-3 in a race). Only the load
      // whose token is still current may write state.
      this._loadSeq = (this._loadSeq || 0) + 1;
      const seq = this._loadSeq;
      this.loading = true;
      // NEVER throws — the service maps refusals AND transport failures to
      // {ok:false, code, message}.
      const out = await repoOkfService.splitPreview(this.repoId, this.conceptId);
      if (seq !== this._loadSeq) return; // superseded by a newer open
      this.loading = false;
      if (out && out.ok) {
        this.plan = out;
        return;
      }
      // A SERVER refusal (the service flags the origin — its `error` code and
      // its own words) is the dialog's content: render the message verbatim,
      // whatever the code — a new server refusal code needs no client-side
      // vocabulary update. Anything else (network down, empty answer) is an
      // honest failure line; both states leave confirm disabled.
      if (out && out.serverRefusal) {
        this.refusal = out.message || out.code;
      } else {
        this.fetchError = this.translate('okf.editor.split.previewFailed', PREVIEW_FAILED_FALLBACK);
      }
    },
    async onConfirm() {
      if (!this.plan || this.running) return;
      this.running = true;
      this.refusal = '';
      // The store action never throws: {ok, code?, message?, ...summary}.
      const result = await this.$store.dispatch('okf/splitConcept', {
        repoId: this.repoId,
        conceptId: this.conceptId
      });
      this.running = false;
      if (!result || !result.ok) {
        // The write refused (e.g. a -part-N row appeared between the preview
        // and the confirm). The stale plan must NOT stay armed after a
        // refusal — re-run the preview so the dialog shows the FRESH server
        // state: the new conflict rendered verbatim, or the plan gone. The
        // write's own message surfaces only when the fresh preview lands a
        // plan again (a transient refusal the curator may retry).
        const writeMessage = (result && result.message) || this.translate('okf.editor.split.failed', FAILED_FALLBACK);
        await this.load();
        if (this.plan && !this.refusal && !this.fetchError) this.refusal = writeMessage;
        return;
      }
      this.$emit('done', result);
      this.$emit('close');
    }
  }
};
</script>

<style scoped>
.okf-split__lead {
  margin: 0 0 var(--space-sm);
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-split__ceiling {
  margin: 0 0 var(--space-md);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--fg);
}
.okf-split__parts-title {
  margin: 0 0 var(--space-xs);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.okf-split__parts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-split__part {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-xs) var(--space-sm);
  background: var(--bg);
}
.okf-split__part-name {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--fg);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
}
.okf-split__part-id {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--muted);
}
.okf-split__part-path {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--muted);
  word-break: break-all;
}
.okf-split__part-chars {
  font-size: var(--text-xs);
  color: var(--fg);
  font-variant-numeric: tabular-nums;
}
.okf-split__refusal {
  margin: var(--space-md) 0 0;
  font-size: var(--text-sm);
  color: var(--danger);
  word-break: break-word;
}
.okf-split__error {
  margin: var(--space-md) 0 0;
  font-size: var(--text-sm);
  color: var(--danger);
}
.okf-split__dirty {
  margin: var(--space-md) 0 0;
  font-size: var(--text-xs);
  color: var(--warning);
}
</style>
