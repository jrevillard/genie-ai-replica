<!--
  OkfStepProduce.vue — Amendment A slice 4 (B2 for documents/crawl): runs the
  EXISTING conversion services into THIS repo (repo_id passthrough) and shows
  REAL progress. Manual/clone content skips production — the gate opens at
  once (nothing to generate). Idempotent: a kicked conversion is recorded on
  the draft (conversion_kicked) and re-entering resumes polling, never
  re-kicks; a failed conversion surfaces the error with a Retry.
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
          :indeterminate="status === 'running'"
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
      <p v-if="status === 'failed'" class="okf-step__error">
        {{
          translate('okf.steps.produce.failed', 'The conversion failed — retry, or go back and pick different inputs.')
        }}
      </p>
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
      return this.translate('okf.steps.produce.progress', 'Producer running...');
    }
  },
  watch: {
    status(s) {
      // A2 gate: open when there is nothing left to wait for (or a retry is
      // possible) — never a dead end while running (Back stays available).
      this.$emit('gate', s !== 'running');
    }
  },
  mounted() {
    this.$emit('gate', !this.needsProduction);
    if (!this.needsProduction) return;
    const input = (this.draft && this.draft.input) || {};
    const ready =
      this.variant === 'crawl' ? (input.document_ids || []).length > 0 : (input.document_ids || []).length > 0;
    if (!ready) return; // nothing selected — Input will send the steward back
    // IDEMPOTENT KICK: a recorded kick resumes polling; only a fresh draft
    // (no kick, no live conversion) starts the conversion.
    const repoConversion = this.repoConversionStatus();
    if (input.conversion_kicked || repoConversion === 'running' || repoConversion === 'done') {
      this.status = repoConversion === 'failed' ? 'failed' : repoConversion === 'done' ? 'done' : 'running';
      this.poll();
    } else {
      this.kick();
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
    async kick() {
      const repoId = this.draft && this.draft.repo_id;
      const ids = ((this.draft && this.draft.input) || {}).document_ids || [];
      if (!repoId || ids.length === 0) {
        this.status = 'failed';
        this.$emit('gate', true);
        return;
      }
      this.status = 'running';
      this.$emit('gate', false);
      this.$emit('update', { input: { ...(this.draft.input || {}), document_ids: ids, conversion_kicked: true } });
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
      } catch {
        this.status = 'failed';
        this.$emit('gate', true);
      }
    },
    poll() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      const repoId = this.draft && this.draft.repo_id;
      if (!repoId) return;
      this.pollTimer = setInterval(async () => {
        try {
          const repo = await repoOkfService.get(repoId);
          const conv = repo && repo.conversion;
          const st = conv ? conv.status : null;
          if (st === 'done') {
            this.status = 'done';
            this.progressPct = 100;
            this.$emit('gate', true);
            this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {});
            clearInterval(this.pollTimer);
          } else if (st === 'failed') {
            this.status = 'failed';
            this.$emit('gate', true);
            clearInterval(this.pollTimer);
          } else {
            this.status = 'running';
            const pages = (conv && conv.pages_done) || 0;
            const total = (conv && conv.pages_total) || 0;
            this.progressPct = total > 0 ? Math.round((pages / total) * 100) : this.progressPct;
          }
        } catch {
          /* transient poll error — keep polling */
        }
      }, 3000);
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
