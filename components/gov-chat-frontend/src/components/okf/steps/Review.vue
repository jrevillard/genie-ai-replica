<!--
  OkfStepReview.vue — Amendment A: the review step shows the LIVE lifecycle
  state and where the ritual finishes. DECISION (David, 2026-09-27): the
  lifecycle transitions — submit → approve → publish — live OUTSIDE the
  wizard (the Editor and the Studio dashboard own them); this step performs
  NO transitions. It reads the live repo doc (never the dead draft shapes)
  and hands the steward off through the footer's "Open the Editor".
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
        <strong>{{ translate('okf.steps.review.labels', 'Labels') }}</strong>
        <DsInfoTip
          :text="
            translate(
              'okf.glossary.labelsAuto',
              'Labels are assigned automatically from the Knowledge Hierarchy — L2 services bounded to this repository\'s Subject Area. Review and adjust them per topic in Curate.'
            )
          "
        />
        <strong>:</strong>
        {{ conceptCount > 0 ? translate('okf.steps.review.labelsSet', 'set per topic in Curate') : '—' }}
      </p>
      <p>
        <strong>{{ translate('okf.steps.review.sources', 'Sources') }}:</strong> {{ sourceCount }}
      </p>
    </div>

    <div class="okf-step__handoff">
      <p class="okf-step__note">
        {{
          translate(
            'okf.steps.review.ritualOutside',
            'The review ritual — submit for review, reviewer approval, publish — happens in the Editor and the Studio dashboard, not here. Open the Editor to finish.'
          )
        }}
        <DsInfoTip
          :text="
            translate(
              'okf.glossary.reviewHandoff',
              'Keeping the approval ritual in one place (the Editor/dashboard) means reviewers always sign off on the same surface with the same audit trail — the wizard prepares the repository, the ritual publishes it.'
            )
          "
        />
      </p>
    </div>

    <!-- REPOSITORY TOOLS (Amendment A decision #4, David 2026-09-27):
      read-only summaries + actions reach the wizard here — versions,
      action log and rename use the SAME dialogs the editor hosts. -->
    <div class="okf-step__tools">
      <span class="okf-step__tools-summary">{{ versionSummary }}</span>
      <DsButton variant="secondary" small :disabled="!repo" @click="versionsOpen = true">
        {{ translate('okf.steps.review.versions', 'Versions') }}
      </DsButton>
      <DsButton variant="secondary" small :disabled="!repo" @click="logsOpen = true">
        {{ translate('okf.steps.review.logs', 'Action log') }}
      </DsButton>
      <DsButton variant="secondary" small :disabled="!repo || frozen" @click="renameOpen = true">
        {{ translate('okf.steps.review.rename', 'Rename') }}
      </DsButton>
    </div>
    <OkfVersionsDialog
      :visible="versionsOpen"
      :repo="repo"
      @close="versionsOpen = false"
      @changed="loadVersionSummary"
    />
    <OkfLogsDialog :visible="logsOpen" :repo="repo" @close="logsOpen = false" />
    <OkfRenameRepoDialog :visible="renameOpen" :repo="repo" @close="renameOpen = false" @renamed="onRenamed" />
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import DsButton from '../../ds/Button.vue';
import DsInfoTip from '../../ds/InfoTip.vue';
import OkfVersionsDialog from '../editor/VersionsDialog.vue';
import OkfLogsDialog from '../editor/LogsDialog.vue';
import OkfRenameRepoDialog from '../editor/RenameRepoDialog.vue';
import repoOkfService from '../../../services/repoOkfService';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepReview',
  components: { DsButton, DsInfoTip, OkfVersionsDialog, OkfLogsDialog, OkfRenameRepoDialog },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['gate'],
  data() {
    return { versionsOpen: false, logsOpen: false, renameOpen: false, versionCount: 0, latestVersion: null };
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
    frozen() {
      return !!(this.repo && this.repo.ingested_at);
    },
    versionSummary() {
      if (!this.versionCount)
        return this.translate('okf.steps.review.noVersions', 'No versions yet — publish mints v1.');
      return this.translate('okf.steps.review.versionSummary', '{n} version(s) · latest v{latest}')
        .replace('{n}', String(this.versionCount))
        .replace('{latest}', String(this.latestVersion || 1));
    }
  },
  mounted() {
    this.$emit('gate', true); // review never blocks — the hand-off is next
    this.loadVersionSummary();
  },
  methods: {
    async loadVersionSummary() {
      const repoId = this.draft && this.draft.repo_id;
      if (!repoId) return;
      try {
        const versions = await repoOkfService.listVersions(repoId);
        this.versionCount = versions.length;
        this.latestVersion = versions.length ? versions[0].bundle_version : null;
      } catch {
        /* a summary must never block the step */
      }
    },
    onRenamed() {
      this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {});
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
.okf-step__handoff {
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.okf-step__tools {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  flex-wrap: wrap;
}
.okf-step__tools-summary {
  color: var(--muted);
  font-size: var(--text-sm);
  margin-right: auto;
}
.okf-step__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
</style>
