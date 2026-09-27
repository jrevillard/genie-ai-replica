<!--
  OkfStepPublish.vue — Step 10 (Finish): the readiness checklist + the
  hand-off. The lifecycle ritual lives OUTSIDE the wizard (Amendment A
  decision #8) — this step's gate opens onto "Open the Editor".

  Live counts come from the /metrics payload (max-review F1: repo docs
  carry no concept_count — only conformance-service computes one). A
  serving (frozen) repo is a READ-ONLY SUMMARY (decision #11): the gate
  opens so the steward can reach the Editor — never a dead button.
-->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.publish.title', 'Ready to finish') }}</h3>
    <p class="okf-step__hint">
      {{
        translate(
          'okf.steps.publish.hint',
          'Publishing creates a version of this repository — from the Editor, when the ritual is due.'
        )
      }}
    </p>
    <div class="okf-step__checklist">
      <DsStatusTag :variant="checklistVariants.name">{{
        translate('okf.steps.publish.nameOk', 'Repository name set')
      }}</DsStatusTag>
      <DsStatusTag :variant="checklistVariants.topics">{{ topicsLabel }}</DsStatusTag>
      <DsStatusTag :variant="checklistVariants.labels">{{
        translate('okf.steps.publish.labelsOk', 'Labels assigned')
      }}</DsStatusTag>
    </div>
    <p v-if="frozen" class="okf-step__frozen">
      {{
        translate(
          'okf.steps.publish.frozen',
          'This repository is serving — a read-only summary here. Open the Editor to manage versions or retract.'
        )
      }}
    </p>
    <p v-if="!topicsOk && !frozen" class="okf-step__pending">
      {{ translate('okf.steps.publish.noTopics', 'No topics yet — go back to Curate to produce or write them.') }}
    </p>
  </div>
</template>

<script>
import DsStatusTag from '../../ds/StatusTag.vue';
import { mapGetters } from 'vuex';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepPublish',
  components: { DsStatusTag },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['gate'],
  data() {
    return { liveConceptCount: null };
  },
  computed: {
    ...mapGetters('okf', ['repoById']),
    // B8 (Amendment A): the checklist reads the LIVE repo doc — never the
    // dead draft shapes. Each item is a real readiness signal.
    repo() {
      return (this.draft && this.draft.repo_id && this.repoById(this.draft.repo_id)) || null;
    },
    nameOk() {
      return !!((this.repo && this.repo.name) || (this.draft && this.draft.name));
    },
    frozen() {
      return !!(this.repo && this.repo.ingested_at);
    },
    // F1: concept_count lives on the METRICS payload, not the repo doc —
    // fetch it live; fall back to any count the draft legitimately carries
    // (the clone path writes one).
    topicsOk() {
      if (this.frozen) return true; // serving content exists by definition
      const n =
        this.liveConceptCount != null
          ? this.liveConceptCount
          : (this.repo && this.repo.concept_count) || (this.draft && this.draft.concept_count) || 0;
      return n > 0;
    },
    topicsLabel() {
      if (this.frozen) return this.translate('okf.steps.publish.topicsServing', 'Topics serving');
      return this.topicsOk
        ? this.translate('okf.steps.publish.topicsOk', 'Topics reviewed')
        : this.translate('okf.steps.publish.topicsPending', 'No topics yet');
    },
    canPublish() {
      // F7: frozen/serving NEVER dead-ends — the gate opens onto the
      // read-only summary and its Editor hand-off.
      return this.nameOk && (this.topicsOk || this.frozen);
    },
    checklistVariants() {
      return {
        name: this.nameOk ? 'success' : 'pending',
        labels: this.frozen || this.topicsOk ? 'success' : 'pending',
        topics: this.topicsOk ? 'success' : 'pending'
      };
    }
  },
  watch: {
    canPublish() {
      this.$emit('gate', this.canPublish);
    }
  },
  mounted() {
    this.$emit('gate', this.canPublish);
    this.loadCount();
  },
  methods: {
    async loadCount() {
      const repoId = this.draft && this.draft.repo_id;
      if (!repoId) return;
      try {
        const metrics = await this.$store.dispatch('okf/fetchRepoMetrics', repoId);
        if (metrics && typeof metrics.concept_count === 'number') this.liveConceptCount = metrics.concept_count;
      } catch {
        /* the fallbacks stand */
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
.okf-step__checklist {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
.okf-step__frozen {
  margin: 0;
  padding: var(--space-sm) var(--space-md);
  background: var(--warning-bg);
  border: 1px solid var(--warning);
  border-radius: var(--radius-sm);
  color: var(--fg);
  font-size: var(--text-sm);
}
.okf-step__pending {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
</style>
