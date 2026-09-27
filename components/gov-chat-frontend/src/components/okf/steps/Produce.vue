<!--
  OkfStepProduce.vue — Amendment A slice 4 (B2 for documents/crawl): runs the
  EXISTING conversion services into THIS repo (repo_id passthrough) and shows
  REAL progress. Manual/clone content skips production — the gate opens at
  once (nothing to generate).

  Idempotency (max-review F5 hardening): a kick whose POST FAILED is resumed
  as FAILED with a Retry — never as a phantom "running". A recorded
  conversion only counts for the inputs it converted (converted_ids): picking
  NEW sources re-kicks. Progress reads whichever counter pair the backend
  actually writes (documents: files_done/files_total; crawl: pages_done +
  bytes; max-review C2). Producer 409s (DUPLICATE_CONTENT,
  CONVERSION_IN_FLIGHT) surface with their actionable message (F10).
-->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.produce.title', 'Generate topics') }}</h3>
    <p class="okf-step__hint">
      {{ translate('okf.steps.produce.hint', 'We are reading your sources and proposing topics.') }}
    </p>

    <template v-if="needsProduction">
      <div class="okf-step__progress">
        <DsProgress
          :value="progressPct"
          :indeterminate="status === 'running' && progressPct === 0"
          :show-label="true"
          :label="progressLabel"
        />
      </div>
      <p v-if="status === 'running'" class="okf-step__note">
        {{
          translate(
            'okf.steps.produce.running',
            'Converting… you can watch progress here; nothing is committed until you review in Curate.'
          )
        }}
      </p>
      <p v-if="status === 'failed'" class="okf-step__error">{{ errorText }}</p>
      <p v-if="status === 'done'" class="okf-step__note">
        {{ translate('okf.steps.produce.done', 'Topics are ready — continue to review them in Curate.') }}
      </p>
      <div class="okf-step__actions">
        <DsButton variant="secondary" small :disabled="status === 'running'" @click="kick">
          {{
            status === 'failed'
              ? translate('okf.steps.produce.retry', 'Retry conversion')
              : translate('okf.steps.produce.restart', 'Run again')
          }}
        </DsButton>
      </div>
    </template>

    <template v-else>
      <p class="okf-step__note">
        {{
          translate(
            'okf.steps.produce.manualSkip',
            'Hand-written topics need no generation — continue to Curate to review them.'
          )
        }}
      </p>
    </template>
  </div>
</template>

<script>
import DsButton from '../../ds/Button.vue';
import DsProgress from '../../ds/Progress.vue';
import repoOkfService from '../../../services/repoOkfService';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepProduce',
  components: { DsButton, DsProgress },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['update', 'gate'],
  data() {
    return {
      status: 'idle', // idle | running | done | failed
      progressPct: 0,
      progressNote: '',
      errorText: '',
      pollTimer: null
    };
  },
  computed: {
    needsProduction() {
      return this.variant === 'documents' || this.variant === 'crawl';
    },
    variant() {
      return (this.draft && this.draft.source) || 'documents';
    },
    progressLabel() {
      if (this.status === 'done') return this.translate('okf.steps.produce.labelDone', 'Conversion complete');
      if (this.status === 'failed') return this.translate('okf.steps.produce.labelFailed', 'Conversion failed');
      return this.progressNote || this.translate('okf.steps.produce.progress', 'Producer running...');
    }
  },
  watch: {
    status(s) {
      // A2 gate: open when there is nothing left to wait for (or a retry is
      // possible) — never a dead end while running (Back stays available).
      this.$emit('gate', s !== 'running');
    }
  },
  async mounted() {
    this.$emit('gate', !this.needsProduction);
    if (!this.needsProduction) return;
    const input = (this.draft && this.draft.input) || {};
    const ids = input.document_ids || [];
    if (ids.length === 0) return; // nothing selected — Input will send the steward back
    const live = this.repoConversionStatus();
    if (input.conversion_kicked && live == null && !input.converted_ids) {
      // F5: a kick whose POST may never have landed. The STORE copy can be
      // stale — verify against the LIVE repo before declaring failure.
      let liveStatus = null;
      try {
        const fresh = await repoOkfService.get(this.draft.repo_id);
        liveStatus = fresh && fresh.conversion ? fresh.conversion.status : null;
      } catch {
        /* fall through to failed */
      }
      if (liveStatus === 'running') {
        this.status = 'running';
        this.poll();
        return;
      }
      if (liveStatus === 'done') {
        this.status = 'done';
        this.$emit('update', {
          input: { ...input, converted_ids: ids }
        });
        this.$emit('gate', true);
        return;
      }
      this.status = 'failed';
      this.errorText = this.translate('okf.steps.produce.neverStarted', 'The conversion did not start — retry.');
      this.$emit('gate', true);
      return;
    }
    const stale = input.converted_ids && JSON.stringify(input.converted_ids) !== JSON.stringify(ids);
    if (live === 'running' && !stale) {
      this.status = 'running';
      this.poll();
    } else if ((live === 'done' || live === 'failed') && !stale) {
      this.status = live;
      if (live === 'failed') {
        this.errorText = this.translate(
          'okf.steps.produce.failed',
          'The conversion failed — retry, or go back and pick different inputs.'
        );
      }
      this.$emit('gate', true);
    } else {
      // fresh draft, stale terminal state for NEW inputs, or no live state —
      // (re-)kick for the CURRENT selection.
      await this.kick();
    }
  },
  beforeUnmount() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  },
  methods: {
    repoConversionStatus() {
      const repo = this.draft && this.draft.repo_id ? this.$store.getters['okf/repoById'](this.draft.repo_id) : null;
      const conv = repo && repo.conversion;
      return conv ? conv.status || 'running' : null;
    },
    friendlyError(err) {
      const code = err && (err.code || (err.data && err.data.error));
      const msg = (err && (err.message || (err.data && err.data.message))) || '';
      if (code === 'DUPLICATE_CONTENT' || /already imported/i.test(msg)) {
        return this.translate(
          'okf.steps.produce.dupContent',
          'These sources are already imported into another OKF repository. Retract or delete that repository first, or pick different documents.'
        );
      }
      if (code === 'CONVERSION_IN_FLIGHT' || /in flight/i.test(msg)) {
        return this.translate(
          'okf.steps.produce.inFlight',
          'A conversion is already running for this repository — wait for it to finish.'
        );
      }
      return this.translate(
        'okf.steps.produce.failed',
        'The conversion failed — retry, or go back and pick different inputs.'
      );
    },
    async kick() {
      const repoId = this.draft && this.draft.repo_id;
      const input = (this.draft && this.draft.input) || {};
      const ids = input.document_ids || [];
      if (!repoId || ids.length === 0) {
        this.status = 'failed';
        this.errorText = this.translate('okf.steps.produce.noSources', 'No sources selected — go back to Input.');
        this.$emit('gate', true);
        return;
      }
      this.status = 'running';
      this.$emit('gate', false);
      this.$emit('update', {
        input: { ...input, document_ids: ids, conversion_kicked: true }
      });
      try {
        if (this.variant === 'documents') {
          await repoOkfService.importDocuments({
            file_ids: ids,
            repo_id: repoId,
            name: (this.draft && this.draft.name) || undefined,
            classification: (this.draft && this.draft.classification) || 'heuristics'
          });
        } else {
          await repoOkfService.convertFromCrawlInto({
            repo_id: repoId,
            file_id: ids[0],
            classification: (this.draft && this.draft.classification) || 'heuristics',
            split_mode: 'B'
          });
        }
        this.poll();
      } catch (err) {
        // F10: the producer's 409s carry the remedy — surface them instead
        // of looping a doomed Retry.
        this.status = 'failed';
        this.errorText = this.friendlyError(err);
        this.$emit('update', {
          input: { ...input, document_ids: ids, conversion_kicked: false }
        });
        this.$emit('gate', true);
      }
    },
    poll() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      const repoId = this.draft && this.draft.repo_id;
      if (!repoId) return;
      // First tick is IMMEDIATE (F5): a fresh kick must not sit at "running"
      // for 3s on stale store data, and a failed-first-fetch resume is
      // detected at once.
      const tick = async () => {
        try {
          const repo = await repoOkfService.get(repoId);
          const conv = repo && repo.conversion;
          const st = conv ? conv.status : null;
          if (st === 'done') {
            this.status = 'done';
            this.progressPct = 100;
            this.$emit('update', {
              input: {
                ...((this.draft && this.draft.input) || {}),
                converted_ids: ((this.draft && this.draft.input) || {}).document_ids || []
              }
            });
            this.$emit('gate', true);
            this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {});
            clearInterval(this.pollTimer);
          } else if (st === 'failed') {
            this.status = 'failed';
            this.errorText = this.translate(
              'okf.steps.produce.failed',
              'The conversion failed — retry, or go back and pick different inputs.'
            );
            this.$emit('gate', true);
            clearInterval(this.pollTimer);
          } else if (st === 'running') {
            this.status = 'running';
            this.readProgress(conv);
          } else {
            // No conversion registered server-side (F5): a kick that never
            // landed. Stop the loop; Retry re-kicks.
            this.status = 'failed';
            this.errorText = this.translate('okf.steps.produce.neverStarted', 'The conversion did not start — retry.');
            this.$emit('gate', true);
            clearInterval(this.pollTimer);
          }
        } catch {
          /* transient fetch error — keep polling */
        }
      };
      tick();
      this.pollTimer = setInterval(tick, 3000);
    },
    // C2: the documents leg counts FILES, the crawl leg counts PAGES (with
    // bytes as its only total). Read whichever pair exists — otherwise stay
    // indeterminate at 0 with a live counter note.
    readProgress(conv) {
      if (!conv) return;
      const filesDone = conv.files_done;
      const filesTotal = conv.files_total;
      const pagesDone = conv.pages_done;
      const pagesTotal = conv.pages_total;
      if (typeof filesTotal === 'number' && filesTotal > 0) {
        this.progressPct = Math.round(((filesDone || 0) / filesTotal) * 100);
        this.progressNote = this.translate('okf.steps.produce.filesNote', '{done} of {total} documents converted')
          .replace('{done}', String(filesDone || 0))
          .replace('{total}', String(filesTotal));
      } else if (typeof pagesTotal === 'number' && pagesTotal > 0) {
        this.progressPct = Math.round(((pagesDone || 0) / pagesTotal) * 100);
        this.progressNote = this.translate('okf.steps.produce.pagesNote', '{done} of {total} pages converted')
          .replace('{done}', String(pagesDone || 0))
          .replace('{total}', String(pagesTotal));
      } else {
        this.progressPct = 0; // indeterminate via the template binding
        if (typeof pagesDone === 'number' && pagesDone > 0) {
          this.progressNote = this.translate('okf.steps.produce.pagesSoFar', '{n} pages converted so far').replace(
            '{n}',
            String(pagesDone)
          );
        }
      }
    }
  }
};
</script>

<style scoped>
.okf-step {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.okf-step__title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}
.okf-step__hint {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step__progress {
  width: 100%;
}
.okf-step__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step__error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
.okf-step__actions {
  display: flex;
  gap: var(--space-sm);
}
</style>
