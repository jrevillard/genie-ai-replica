<!--
  OkfStepReview.vue — Amendment A slice 3b (B7): the review step surfaces the
  REAL lifecycle. The summary reads the live repo doc (never the dead draft
  shapes) and the lifecycle action is the SAME state-valid transition the
  wizard publishes through (R-C): draft/register → submit; review → (approve
  is the reviewer's sign-off, dispatched here); retracted → submit; publish/
  serving → nothing left (the footer's Publish/Ingest handles it).
-->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.review.title', 'Review') }}</h3>
    <p class="okf-step__hint">
      {{ translate('okf.steps.review.hint', 'A summary of what you are about to publish.') }}
    </p>
    <div class="okf-step__summary">
      <p>
        <strong>{{ translate('okf.steps.review.repo', 'Repository') }}:</strong> {{ repoName }}
      </p>
      <p>
        <strong>{{ translate('okf.steps.review.state', 'Lifecycle state') }}:</strong> {{ stateLabel }}
        <DsInfoTip
          :text="
            translate(
              'okf.glossary.lifecycle',
              'The six-step contract: draft → review → approved → published (mint + bundle) → ingested (serving in RAG) → retracted (back to edit). Content only becomes citable after ingest — and only reviewed content can publish.'
            )
          "
        />
      </p>
      <p>
        <strong>{{ translate('okf.steps.review.topics', 'Topics') }}:</strong> {{ conceptCount }}
      </p>
      <p>
        <strong>{{ translate('okf.steps.review.labels', 'Labels') }}:</strong>
        {{ conceptCount > 0 ? translate('okf.steps.review.labelsSet', 'set per topic in Curate') : '—' }}
      </p>
      <p>
        <strong>{{ translate('okf.steps.review.sources', 'Sources') }}:</strong> {{ sourceCount }}
      </p>
    </div>

    <div v-if="lifecycleAction" class="okf-step__action">
      <DsButton variant="secondary" small :disabled="acting" @click="runLifecycle">
        {{ actionLabel }}
      </DsButton>
      <DsInfoTip
        :text="
          translate(
            'okf.glossary.reviewAction',
            'The next lifecycle step for this repository in its current state. Publishing mints a version and exports the bundle; ingest then makes the content retrievable.'
          )
        "
      />
    </div>
    <p v-else class="okf-step__note">
      {{
        translate(
          'okf.steps.review.nothingToDo',
          'Nothing to review — this repository is already serving or has no lifecycle step pending here.'
        )
      }}
    </p>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import DsButton from '../../ds/Button.vue';
import DsInfoTip from '../../ds/InfoTip.vue';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepReview',
  components: { DsButton, DsInfoTip },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['gate'],
  data() {
    return { acting: false };
  },
  computed: {
    ...mapGetters('okf', ['repoById']),
    repo() {
      return (this.draft && this.draft.repo_id && this.repoById(this.draft.repo_id)) || null;
    },
    repoName() {
      return (this.repo && this.repo.name) || (this.draft && this.draft.name) || '—';
    },
    conceptCount() {
      return (this.repo && this.repo.concept_count) || (this.draft && this.draft.concept_count) || 0;
    },
    sourceCount() {
      const sources = (this.repo && this.repo.source_documents) || [];
      return sources.length ? `${sources.length}` : '0';
    },
    stateLabel() {
      if (!this.repo) return this.translate('okf.wizard.state.draft', 'draft');
      if (this.repo.ingested_at) return this.translate('okf.wizard.status.published', 'published');
      const state = this.repo.lifecycle_state || 'draft';
      return this.translate(`okf.wizard.state.${state}`, state);
    },
    // R-C parity: only transitions VALID for the current state are offered.
    lifecycleAction() {
      if (!this.repo || this.repo.ingested_at) return null;
      const s = this.repo.lifecycle_state;
      if (s === 'draft' || s === 'register' || s === 'retracted') return 'submit';
      if (s === 'review') return 'approve';
      return null; // publish/publish+serving — the footer Publish owns it
    },
    actionLabel() {
      if (this.lifecycleAction === 'approve')
        return this.translate('okf.steps.review.approve', 'Approve (review sign-off)');
      return this.translate('okf.steps.review.submit', 'Submit for review');
    }
  },
  mounted() {
    this.$emit('gate', true); // review never blocks — the publish gates do
  },
  methods: {
    async runLifecycle() {
      if (!this.lifecycleAction || !this.repo || this.acting) return;
      this.acting = true;
      try {
        const result = await this.$store.dispatch('okf/lifecycleTransition', {
          repoId: this.repo.repo_id,
          action: this.lifecycleAction,
          actor: { sub: 'studio-wizard' }
        });
        if (result && result.ok) {
          await this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {});
        }
      } finally {
        this.acting = false;
      }
    }
  }
};
</script>

<style scoped>
.okf-step__summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  font-size: var(--text-sm);
}
.okf-step__action {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}
.okf-step__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
</style>
