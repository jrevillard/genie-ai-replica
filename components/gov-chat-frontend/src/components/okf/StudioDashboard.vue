<!-- OkfStudioDashboard.vue — Story #978 lifecycle edition (David, 2026-08-28).
  Five lifecycle lanes — In progress / In review / Published / Ingested /
  Retracted. Published != Ingested: the serving flag separates them.
  Each card carries the repo's contextual lifecycle action, Versions, Export
  and Delete (hidden while an ingested version is serving — retract first).
  Card click opens the editor; action buttons never trigger the open. -->
<template>
  <div class="okf-dashboard">
    <header class="okf-dashboard__bar">
      <div class="okf-dashboard__bar-left">
        <h3 class="okf-dashboard__title">{{ translate('okf.dashboard.title', 'Repositories') }}</h3>
        <span class="okf-dashboard__count">{{ totalCount }}</span>
        <span v-if="actionError" class="okf-dashboard__action-error">{{ actionError }}</span>
      </div>
      <div class="okf-dashboard__bar-right">
        <DsButton variant="primary" @click="$emit('new')">{{
          translate('okf.dashboard.new', '+ New repository')
        }}</DsButton>
      </div>
    </header>

    <div v-if="expertMode" class="s">
      <DsSelect
        v-model="filters.domain"
        class="okf-dashboard__filter-domain"
        :aria-label="translate('okf.dashboard.filter.domain', 'Filter by subject area')"
      >
        <option v-for="opt in domainFilterOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </DsSelect>
      <DsInput v-model="filters.search" :placeholder="translate('okf.dashboard.search', 'Search...')" />
      <DsButton variant="ghost" small @click="refreshAll">{{ translate('common.refresh', 'Refresh') }}</DsButton>
    </div>

    <div class="okf-dashboard__lanes">
      <section v-for="lane in lanes" :key="lane.key" class="okf-dashboard__lane">
        <header class="okf-dashboard__lane-header">
          <h4>{{ lane.label }}</h4>
          <span class="okf-dashboard__lane-count">{{ reposInLane(lane.key).length }}</span>
        </header>
        <p v-if="reposInLane(lane.key).length === 0" class="okf-dashboard__empty">{{ lane.emptyText }}</p>
        <div v-for="r in reposInLane(lane.key)" :key="r.repo_id" class="okf-dashboard__card-wrap">
          <button type="button" class="okf-dashboard__card" :class="cardClasses(r)" @click="onCardClick(r)">
            <span class="okf-dashboard__card-row">
              <input
                v-if="canBulk(r)"
                type="checkbox"
                class="okf-dashboard__card-checkbox"
                :checked="isSelected(r.repo_id)"
                :aria-label="selectAria(r)"
                @click.stop="toggleSelected(r.repo_id)"
              />
              <span class="okf-dashboard__card-name">{{ r.name || r.repo_id }}</span>
              <span v-if="r.version" class="okf-dashboard__card-version">v{{ r.version }}</span>
            </span>
            <span class="okf-dashboard__card-row">
              <!-- BUILDING GATE (David, 2026-09-02): an animated build state —
                the file is processed in the background and the card stays in
                this lane until every concept shows Indexed. -->
              <DsSpinner v-if="isBuilding(r)" size="sm" :aria-label="buildingAria(r)" />
              <DsHealthRing v-else :score="healthScore(r)" :size="'sm'" :aria-label="healthAria(r)" />
              <span class="okf-dashboard__card-count">
                {{ r.concept_count || 0 }} {{ translate('okf.dashboard.topics', 'topics') }}
              </span>
              <span class="okf-dashboard__card-stage">{{ stageLabel(r) }}</span>
            </span>
          </button>
          <div class="okf-dashboard__card-actions" role="group" :aria-label="actionsAria(r)">
            <!-- Building: NO lifecycle action is offered (the server refuses
              every transition with 409 BUILD/INDEXING_IN_PROGRESS anyway) —
              a disabled Building… chip tells the steward to wait. -->
            <DsButton v-if="isBuilding(r)" variant="secondary" small disabled>
              {{ translate('okf.dashboard.card.building', 'Building…') }}
            </DsButton>
            <DsButton v-else variant="secondary" small :disabled="actionBusy" @click.stop="onLifecycle(r)">
              {{ contextualLabel(r) }}
            </DsButton>
            <DsButton variant="ghost" small :disabled="actionBusy" @click.stop="onVersions(r)">
              {{ translate('okf.dashboard.card.versions', 'Versions') }}
            </DsButton>
            <DsButton variant="ghost" small :disabled="actionBusy" @click.stop="onLogs(r)">
              {{ translate('okf.dashboard.card.logs', 'Logs') }}
            </DsButton>
            <DsButton variant="ghost" small :disabled="exportBusy" @click.stop="onExport(r)">
              {{ translate('okf.dashboard.card.export', 'Export') }}
            </DsButton>
            <DsButton v-if="!isServing(r)" variant="ghost" small :disabled="actionBusy" @click.stop="onRenameAsk(r)">
              {{ translate('okf.dashboard.card.rename', 'Rename') }}
            </DsButton>
            <DsButton
              v-if="!isServing(r)"
              variant="ghost"
              small
              :disabled="actionBusy"
              class="okf-dashboard__card-delete"
              @click.stop="onDeleteAsk(r)"
            >
              {{ translate('okf.dashboard.card.delete', 'Delete') }}
            </DsButton>
          </div>
        </div>
      </section>
    </div>

    <!-- Publish confirm: mints vN+1 + supersedes the previous bundle zip. -->
    <DsDialog
      :visible="publishAsk !== null"
      :title="translate('okf.dashboard.publish.title', 'Publish')"
      size="sm"
      :actions="publishActions"
      @close="publishAsk = null"
      @action="onPublishAction"
    >
      <p>{{ publishBodyText }}</p>
      <p v-if="publishError" class="okf-dashboard__dialog-error">{{ publishError }}</p>
      <div v-if="piiBlocked">
        <p class="okf-dashboard__pii-note">
          {{
            translate(
              'okf.dashboard.pii.note',
              'The flagged entities are part of the published content. If you have reviewed them (e.g. official contact details), acknowledge and continue.'
            )
          }}
        </p>
        <DsButton variant="secondary" small :disabled="actionBusy" @click="onAcknowledgeAndPublish">
          {{ translate('okf.dashboard.pii.ack', 'Acknowledge flagged entities & publish') }}
        </DsButton>
      </div>
    </DsDialog>

    <DsDialog
      :visible="deleteAsk !== null"
      :title="translate('okf.dashboard.delete.title', 'Delete repository')"
      size="sm"
      :actions="deleteActions"
      @close="deleteAsk = null"
      @action="onDeleteAction"
    >
      <p>
        {{
          translate(
            'okf.dashboard.delete.body',
            'This permanently removes the repository, its concepts, indexed content, graph and bundle artifacts. It cannot be undone.'
          )
        }}
        <strong>{{ deleteAsk && (deleteAsk.name || deleteAsk.repo_id) }}</strong>
      </p>
      <p v-if="deleteError" class="okf-dashboard__dialog-error">{{ deleteError }}</p>
    </DsDialog>

    <DsDialog
      :visible="bulkOpen"
      :title="translate('okf.dashboard.bulk.title', 'Publish selected repositories')"
      size="md"
      :actions="[
        { key: 'cancel', label: translate('common.cancel', 'Cancel'), variant: 'secondary' },
        {
          key: 'publish',
          label: translate('okf.dashboard.bulk.publishConfirm', 'Publish {n}').replace(
            '{n}',
            String(selectedIds.length)
          ),
          variant: 'primary'
        }
      ]"
      @close="bulkOpen = false"
      @action="onBulkAction"
    >
      <p>
        {{
          translate(
            'okf.dashboard.bulk.body',
            'Each repository is published with the full gate check (PII review, indexing, conformance). Per-repository outcomes:'
          )
        }}
      </p>
      <ul class="okf-dashboard__bulk-results">
        <li
          v-for="r in bulkResults"
          :key="r.repo_id"
          :class="r.ok ? 'okf-dashboard__bulk-ok' : 'okf-dashboard__bulk-fail'"
        >
          {{ r.name || r.repo_id }} — {{ r.ok ? '✓ published' : '✗ ' + (r.code || 'failed') }}
        </li>
      </ul>
      <p v-if="bulkResults.length === 0" class="okf-dashboard__bulk-pending">
        {{ translate('okf.dashboard.bulk.pending', 'Confirm to publish the selected repositories.') }}
      </p>
    </DsDialog>

    <OkfVersionsDialog
      :visible="versionsRepo !== null"
      :repo="versionsRepo"
      @close="versionsRepo = null"
      @changed="onVersionsChanged"
    />

    <OkfLogsDialog :visible="logsOpen" :repo="logsRepo" @close="logsOpen = false" />

    <OkfRenameRepoDialog
      :visible="renameRepo !== null"
      :repo="renameRepo"
      @close="renameRepo = null"
      @renamed="onRenamed"
    />
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import translateMixin from '../../mixins/translateMixin';
import DsButton from '../ds/Button.vue';
import DsDialog from '../ds/Dialog.vue';
import DsInput from '../ds/Input.vue';
import DsSelect from '../ds/Select.vue';
import DsHealthRing from '../ds/HealthRing.vue';
import DsSpinner from '../ds/Spinner.vue';
import OkfVersionsDialog from './editor/VersionsDialog.vue';
import OkfLogsDialog from './editor/LogsDialog.vue';
import OkfRenameRepoDialog from './editor/RenameRepoDialog.vue';
import okfRepoOps from '../../services/okfRepoOps';

const LANES = [
  { key: 'draft', label: 'In progress', emptyText: 'No drafts yet' },
  { key: 'in_review', label: 'In review', emptyText: 'Nothing in review' },
  { key: 'published', label: 'Published', emptyText: 'No published repositories yet' },
  { key: 'ingested', label: 'Ingested', emptyText: 'Nothing ingested yet' },
  { key: 'retracted', label: 'Retracted', emptyText: 'Nothing retracted' }
];

const DOMAIN_OPTIONS = [
  { value: '', label: 'All subject areas' },
  { value: 'transport', label: 'Transport' },
  { value: 'health', label: 'Health' },
  { value: 'education', label: 'Education' },
  { value: 'social-services', label: 'Social services' },
  { value: 'agriculture', label: 'Agriculture' },
  { value: 'housing', label: 'Housing' },
  { value: 'civil-registry', label: 'Civil registry' }
];

const CONTEXTUAL_LABELS = {
  submit: 'Submit for review',
  approve: 'Approve',
  publish: 'Publish',
  ingest: 'Ingest',
  retract: 'Retract'
};

export default {
  name: 'OkfStudioDashboard',
  components: {
    DsButton,
    DsDialog,
    DsInput,
    DsSelect,
    DsHealthRing,
    DsSpinner,
    OkfVersionsDialog,
    OkfLogsDialog,
    OkfRenameRepoDialog
  },
  mixins: [translateMixin],
  emits: ['new', 'resume'],
  data() {
    return {
      lanes: LANES,
      selectedIds: [],
      bulkOpen: false,
      bulkResults: [],
      filters: { domain: '', search: '' },
      domainFilterOptions: DOMAIN_OPTIONS,
      actionBusy: false,
      exportBusy: false,
      actionError: '',
      publishAsk: null,
      publishError: '',
      piiBlocked: false,
      deleteAsk: null,
      deleteError: '',
      versionsRepo: null,
      logsOpen: false,
      logsRepo: null,
      renameRepo: null
    };
  },
  computed: {
    ...mapGetters('okf', ['reposByStage', 'isExpert']),
    expertMode() {
      return this.isExpert;
    },
    totalCount() {
      return this.lanes.reduce((acc, l) => acc + this.reposInLane(l.key).length, 0);
    },
    publishBodyText() {
      if (!this.publishAsk) return '';
      const next = (this.publishAsk.version || 0) + 1;
      const file = (this.publishAsk.name || this.publishAsk.repo_id) + '-v' + next + '.zip';
      return this.translate(
        'okf.dashboard.publish.body',
        'Publishing mints v{n} and stores bundle "{file}" in the document repository, superseding the previous zip. The new version is not serving until you Ingest it.'
      )
        .replace('{n}', String(next))
        .replace('{file}', file);
    },
    selectedRows() {
      return this.selectedIds
        .map((id) => this.$store.getters['okf/repoById'](id))
        .filter(Boolean)
        .filter((r) => this.matchesFilters(r));
    },
    publishActions() {
      return [
        { key: 'cancel', label: this.translate('common.cancel', 'Cancel'), variant: 'secondary' },
        { key: 'confirm', label: this.translate('okf.dashboard.publish.confirm', 'Publish'), variant: 'primary' }
      ];
    },
    deleteActions() {
      return [
        { key: 'cancel', label: this.translate('common.cancel', 'Cancel'), variant: 'secondary' },
        { key: 'confirm', label: this.translate('okf.dashboard.delete.confirm', 'Delete'), variant: 'danger' }
      ];
    }
  },
  mounted() {
    this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {});
  },
  methods: {
    refreshAll() {
      this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {});
    },
    reposInLane(key) {
      const ids = (this.reposByStage && this.reposByStage[key]) || [];
      return ids
        .map((id) => this.$store.getters['okf/repoById'](id))
        .filter(Boolean)
        .filter((r) => this.matchesFilters(r));
    },
    matchesFilters(r) {
      if (this.filters.domain && r.domain !== this.filters.domain) return false;
      const s = (this.filters.search || '').toLowerCase().trim();
      if (!s) return true;
      return (r.name || '').toLowerCase().includes(s) || (r.domain || '').toLowerCase().includes(s);
    },
    stageLabel(r) {
      if (this.isBuilding(r)) {
        return this.translate('okf.dashboard.stage.building', 'Building…');
      }
      const s = r.lifecycle_state;
      if (s === 'publish' && r.ingested_at) {
        return this.translate('okf.dashboard.stage.ingested', 'Ingested v{n}').replace('{n}', String(r.version || ''));
      }
      if (s === 'publish') {
        return this.translate('okf.dashboard.stage.published', 'Published v{n}').replace(
          '{n}',
          String(r.version || '')
        );
      }
      if (s === 'retracted') return this.translate('okf.dashboard.stage.retracted', 'Retracted');
      if (s === 'review' || s === 'approve') return this.translate('okf.dashboard.stage.inReview', 'In review');
      const step = r.studio_step;
      return step != null
        ? this.translate('okf.dashboard.stage.stepOf', 'Step ' + (step + 1) + ' of 10')
        : this.translate('okf.dashboard.stage.draft', 'Draft');
    },
    contextualAction(r) {
      const s = r.lifecycle_state;
      if (s === 'review') return 'approve';
      if (s === 'approve') return 'publish';
      if (s === 'publish' && r.ingested_at) return 'retract';
      if (s === 'publish') return 'ingest';
      if (s === 'retracted') return 'ingest';
      return 'submit';
    },
    contextualLabel(r) {
      const action = this.contextualAction(r);
      return this.translate('okf.lifecycle.' + action, CONTEXTUAL_LABELS[action]);
    },
    isServing(r) {
      return !!(r.lifecycle_state === 'publish' && r.ingested_at);
    },
    isBuilding(r) {
      return okfRepoOps.isBuilding(r);
    },
    buildingAria() {
      return this.translate('okf.dashboard.card.buildingAria', 'Building — the source file is still being processed');
    },
    canBulk(r) {
      if (this.isBuilding(r)) return false; // building repos never bulk-publish
      return ['approve', 'publish', 'retracted'].includes(r.lifecycle_state);
    },
    selectAria(r) {
      return this.translate('okf.dashboard.select', 'Select {name} for bulk publish').replace(
        '{name}',
        r.name || r.repo_id
      );
    },
    actionsAria(r) {
      return this.translate('okf.dashboard.card.actions', 'Actions for {name}').replace('{name}', r.name || r.repo_id);
    },
    cardClasses(r) {
      return { 'okf-dashboard__card--selected': this.isSelected(r.repo_id) };
    },
    isSelected(id) {
      return this.selectedIds.indexOf(id) !== -1;
    },
    toggleSelected(id) {
      if (this.isSelected(id)) this.selectedIds = this.selectedIds.filter((x) => x !== id);
      else this.selectedIds = [...this.selectedIds, id];
    },
    onCardClick(r) {
      this.$emit('resume', r.repo_id);
    },
    async onLifecycle(r) {
      const action = this.contextualAction(r);
      if (action === 'publish') {
        this.publishError = '';
        this.piiBlocked = false;
        this.publishAsk = r;
        return;
      }
      this.actionBusy = true;
      this.actionError = '';
      const res = await this.$store.dispatch('okf/lifecycleTransition', { repoId: r.repo_id, action });
      this.actionBusy = false;
      if (!res.ok) this.actionError = okfRepoOps.friendlyLifecycleError(res.code, res.message);
    },
    onVersions(r) {
      this.versionsRepo = r;
    },
    onLogs(r) {
      this.logsRepo = r;
      this.logsOpen = true;
    },
    onRenameAsk(r) {
      this.renameRepo = r;
    },
    onRenamed() {
      this.refreshAll();
    },
    onVersionsChanged() {
      this.refreshAll();
    },
    async onExport(r) {
      this.exportBusy = true;
      this.actionError = '';
      try {
        await okfRepoOps.exportRepoZip(r);
      } catch (err) {
        this.actionError = err.message || 'Export failed';
      } finally {
        this.exportBusy = false;
      }
    },
    onDeleteAsk(r) {
      this.deleteError = '';
      this.deleteAsk = r;
    },
    async onDeleteAction(key) {
      if (key === 'cancel') {
        this.deleteAsk = null;
        return;
      }
      if (key !== 'confirm' || !this.deleteAsk) return;
      this.actionBusy = true;
      this.deleteError = '';
      const res = await this.$store.dispatch('okf/deleteRepoAction', { repoId: this.deleteAsk.repo_id });
      this.actionBusy = false;
      this.deleteAsk = null;
      if (!res.ok) this.actionError = res.message || 'Delete failed';
    },
    async onPublishAction(key) {
      if (key === 'cancel') {
        this.publishAsk = null;
        return;
      }
      if (key !== 'confirm' || !this.publishAsk) return;
      this.actionBusy = true;
      this.publishError = '';
      this.piiBlocked = false;
      const res = await this.$store.dispatch('okf/lifecycleTransition', {
        repoId: this.publishAsk.repo_id,
        action: 'publish'
      });
      this.actionBusy = false;
      if (!res.ok) {
        this.publishError = okfRepoOps.friendlyLifecycleError(res.code, res.message);
        if (res.code === 'PII_GATE_BLOCKED') this.piiBlocked = true;
        return; // keep the dialog open — the steward decides on the ack
      }
      this.publishAsk = null;
      this.refreshAll();
    },
    async onAcknowledgeAndPublish() {
      // The explicit, audited steward decision: reviewed flagged entities.
      this.actionBusy = true;
      try {
        await okfRepoOps.acknowledgePii(this.publishAsk.repo_id, true);
      } catch (err) {
        this.actionBusy = false;
        this.publishError = err.message || 'Acknowledgement failed';
        return;
      }
      this.actionBusy = false;
      await this.onPublishAction('confirm');
    },
    healthScore(r) {
      const m = r.metrics;
      if (!m || typeof m.concept_count !== 'number' || m.concept_count === 0) return 0;
      const issues = (m.conformance_issue_count || 0) + (m.stale_concept_count || 0);
      const ratio = issues / Math.max(m.concept_count, 1);
      return Math.max(0, Math.min(100, Math.round(100 * (1 - ratio))));
    },
    healthAria(r) {
      const pct = this.healthScore(r);
      const m = r.metrics;
      if (!m) return 'No metrics';
      return 'Health: ' + pct + ' percent, ' + (m.concept_count || 0) + ' concepts';
    },
    async runBulkPublish() {
      const repoIds = this.selectedRows.map((r) => r.repo_id);
      this.bulkResults = [];
      for (const repoId of repoIds) {
        const res = await this.$store.dispatch('okf/lifecycleTransition', { repoId, action: 'publish' });
        const r = this.$store.getters['okf/repoById'](repoId);
        this.bulkResults.push({ repo_id: repoId, name: r ? r.name : repoId, ok: !!res.ok, code: res.code });
      }
      this.refreshAll();
    },
    onBulkAction(key) {
      if (key === 'publish') this.runBulkPublish();
      else this.bulkOpen = false;
    }
  }
};
</script>

<style scoped>
.okf-dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.okf-dashboard__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.okf-dashboard__bar-left {
  display: flex;
  gap: var(--space-sm);
  align-items: baseline;
}
.okf-dashboard__action-error {
  color: var(--danger);
  font-size: var(--text-sm);
}
.okf-dashboard__lanes {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-sm);
  overflow-x: auto;
}
.okf-dashboard__lane {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  min-height: 240px;
  min-width: 180px;
}
.okf-dashboard__lane-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0 0 var(--space-sm);
}
.okf-dashboard__lane-count {
  background: var(--accent-muted);
  color: var(--accent);
  padding: 2px 10px;
  border-radius: 100px;
  font-size: var(--text-xs);
}
.okf-dashboard__empty {
  color: var(--muted);
  font-size: var(--text-sm);
  padding: var(--space-md);
  text-align: center;
}
.okf-dashboard__card-wrap {
  margin-bottom: var(--space-xs);
}
.okf-dashboard__card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-sm);
  font: inherit;
  color: var(--fg);
  cursor: pointer;
}
.okf-dashboard__card:hover {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-dashboard__card-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}
.okf-dashboard__card-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.okf-dashboard__card-version {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--muted);
}
.okf-dashboard__card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.okf-dashboard__card-delete {
  --ds-btn-ghost-color: var(--danger);
}
.okf-dashboard__bulk-results {
  margin: var(--space-sm) 0 0;
  padding-left: var(--space-md);
  font-size: var(--text-sm);
}
.okf-dashboard__bulk-ok {
  color: var(--success);
}
.okf-dashboard__bulk-fail {
  color: var(--danger);
}
.okf-dashboard__bulk-pending {
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-dashboard__pii-note {
  margin: 0 0 var(--space-xs);
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-dashboard__dialog-error {
  color: var(--danger);
  font-size: var(--text-sm);
  margin: var(--space-sm) 0 0;
}
</style>
