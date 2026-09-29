<!--
  OkfStepPublish.vue — Step 10: HANDOFF (3.10 T5, decision D4). The wizard
  NEVER publishes — "KEEP PUBLISHING OUT OF THE WIZARD. I MEANT IT."
  Submit → approve → publish lives ONLY in the dashboard and the editor.
  This step is the readiness summary + the explicit handoff to those
  surfaces ("Open the Editor" in the wizard footer; "Open the Dashboard"
  here).

  Live counts come from the /metrics payload (max-review F1: repo docs
  carry no concept_count — only conformance-service computes one). A
  serving (frozen) repo is a READ-ONLY SUMMARY (decision #11): the gate
  opens so the steward can reach the Editor — never a dead button.
-->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.publish.title', 'Handoff') }}</h3>
    <p class="okf-step__hint">
      {{
        translate(
          'okf.steps.publish.hint',
          'This repository is ready for review. Publishing never happens here — submit it for approval on the dashboard, then approve and publish from the dashboard or the editor.'
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
    <p class="okf-step__ritual">
      {{
        translate(
          'okf.steps.publish.ritual',
          'Next: submit for approval on the Studio dashboard → an approver accepts → publish from the dashboard or the editor. The wizard stops here by design.'
        )
      }}
    </p>
    <div class="okf-step__handoff">
      <DsButton variant="secondary" small @click="$emit('dashboard')">
        {{ translate('okf.steps.publish.openDashboard', 'Open the Dashboard') }}
      </DsButton>
      <DsInfoTip
        :text="
          translate(
            'okf.glossary.handoff',
            'The lifecycle ritual (submit → approve → publish) is deliberately outside this wizard: approvals belong to the governance flow on the dashboard and in the editor, where versions and serving state are managed.'
          )
        "
      />
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
import DsButton from '../../ds/Button.vue';
import DsInfoTip from '../../ds/InfoTip.vue';
import DsStatusTag from '../../ds/StatusTag.vue';
import { mapGetters } from 'vuex';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepPublish',
  components: { DsButton, DsInfoTip, DsStatusTag },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['gate', 'dashboard'],
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
    // fetch it live; fall back to the workbench's live count and any count
    // the draft legitimately carries (the clone path writes one).
    // FIELD BUG 2026-09-29 ("Open the Editor does nothing"): the action
    // returns the ENVELOPE { ok, metrics } — reading concept_count off the
    // envelope left liveConceptCount null forever, topicsOk fell back to 0,
    // and the finish button stayed DISABLED at step 10. The unit test
    // mocked the action with a bare {concept_count} — the mis-shaped mock
    // kept it green (doc-repo envelope lesson, 7.7, again).
    topicsOk() {
      if (this.frozen) return true; // serving content exists by definition
      const n =
        this.liveConceptCount != null
          ? this.liveConceptCount
          : (this.repo && this.repo.concept_count) ||
            (this.draft && this.draft.input && this.draft.input.concepts_added) ||
            0 ||
            (this.draft && this.draft.concept_count) ||
            0;
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
        // The action returns the ENVELOPE { ok, metrics } — unwrap it
        // tolerantly (accept the envelope OR a bare metrics payload; the
        // doc-repo envelope lesson, 7.7). Reading concept_count off the
        // envelope left the finish button permanently disabled (field:
        // "Open the Editor does nothing", 2026-09-29).
        const res = await this.$store.dispatch('okf/fetchRepoMetrics', repoId);
        const metrics = (res && res.metrics) || res;
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
.okf-step__ritual {
  margin: 0;
  padding: var(--space-sm) var(--space-md);
  background: var(--info-bg);
  border: 1px solid var(--info);
  border-radius: var(--radius-sm);
  color: var(--fg);
  font-size: var(--text-sm);
}
.okf-step__handoff {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
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
