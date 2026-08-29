<!--
  OkfStudioDashboard.vue — Story 3-5.

  Multi-repo kanban: 3 lanes (in_progress / in_review / published). Each card
  shows the THREE things the UX rule #5 mandates — health ring, topic count,
  stage. Domain, lifecycle status, last edited, who edited, conformance
  breakdown all live in the card hover popover.

  Bulk-publish toolbar (DsDialog pattern, rule #4): a multi-select footer that
  appears when ≥2 cards selected. Per-repo result list shows per-row outcomes;
  never force-publishes past a gate.

  Expert-mode filters (rule #7): hidden when toggle is Basic.
-->
<template>
  <div class="okf-dashboard">
    <header class="okf-dashboard__bar">
      <div class="okf-dashboard__bar-left">
        <h3 class="okf-dashboard__title">{{ translate('okf.dashboard.title', 'Repositories') }}</h3>
        <span class="okf-dashboard__count">{{ totalCount }}</span>
      </div>
      <div class="okf-dashboard__bar-right">
        <DsButton variant="primary" @click="$emit('new')">{{
          translate('okf.dashboard.new', '+ New repository')
        }}</DsButton>
      </div>
    </header>

    <div v-if="expertMode" class="okf-dashboard__filters">
      <!-- DsSelect takes options via slot (no options prop) — the previous
           :options binding landed in $attrs and rendered an EMPTY select. -->
      <DsSelect
        v-model="filters.domain"
        class="okf-dashboard__filter-domain"
        :aria-label="translate('okf.dashboard.filter.domain', 'Filter by subject area')"
      >
        <option v-for="opt in domainFilterOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </DsSelect>
      <DsInput v-model="filters.search" :placeholder="translate('okf.dashboard.search', 'Search...')" />
    </div>

    <div class="okf-dashboard__lanes">
      <section v-for="lane in lanes" :key="lane.key" class="okf-dashboard__lane">
        <header class="okf-dashboard__lane-header">
          <h4>{{ lane.label }}</h4>
          <span class="okf-dashboard__lane-count">{{ reposInLane(lane.key).length }}</span>
        </header>
        <p v-if="reposInLane(lane.key).length === 0" class="okf-dashboard__empty">{{ lane.emptyText }}</p>
        <button
          v-for="r in reposInLane(lane.key)"
          :key="r.repo_id"
          type="button"
          class="okf-dashboard__card"
          :class="cardClasses(r)"
          @click="onCardClick(r)"
        >
          <span class="okf-dashboard__card-row">
            <input
              type="checkbox"
              class="okf-dashboard__card-checkbox"
              :checked="isSelected(r.repo_id)"
              :disabled="r.lifecycle_state !== 'review' && r.lifecycle_state !== 'approve'"
              :aria-label="
                translate('okf.dashboard.select', 'Select {name} for bulk publish').replace(
                  '{name}',
                  r.name || r.repo_id
                )
              "
              @click.stop="toggleSelected(r.repo_id)"
            />
            <span class="okf-dashboard__card-name">{{ r.name || r.repo_id }}</span>
          </span>
          <span class="okf-dashboard__card-row">
            <DsHealthRing :score="healthScore(r)" :size="'sm'" :aria-label="healthAria(r)" />
            <span class="okf-dashboard__card-count"
              >{{ r.concept_count || 0 }} {{ translate('okf.dashboard.topics', 'topics') }}</span
            >
            <span class="okf-dashboard__card-stage">{{ stageLabel(r) }}</span>
          </span>
          <span v-if="isStale(r)" class="okf-dashboard__card-stale">{{
            translate('okf.dashboard.stale', 'stale')
          }}</span>
        </button>
      </section>
    </div>

    <nav v-if="selectedIds.length >= 2" class="okf-dashboard__bulk" aria-label="Bulk actions">
      <span>{{ translate('okf.dashboard.bulk.selected', '{n} selected').replace('{n}', selectedIds.length) }}</span>
      <DsButton variant="primary" @click="bulkOpen = true">{{
        translate('okf.dashboard.bulk.publish', 'Publish selected')
      }}</DsButton>
      <DsButton variant="ghost" @click="selectedIds = []">{{ translate('common.clear', 'Clear') }}</DsButton>
    </nav>

    <DsDialog
      :visible="bulkOpen"
      :title="translate('okf.dashboard.bulk.title', 'Publish selected repositories')"
      size="lg"
      :actions="bulkActions"
      @close="bulkOpen = false"
      @action="onBulkAction"
    >
      <p>
        {{
          translate(
            'okf.dashboard.bulk.body',
            'Once published, downstream chat answers can use them. Each repository below lists its final outcome.'
          )
        }}
      </p>
      <DsTable :columns="bulkColumns" :rows="selectedRows">
        <template #cell-name="{ row }">{{ row.name || row.repo_id }}</template>
        <template #cell-status="{ row }">
          <DsStatusTag
            :variant="row.lifecycle_state === 'review' || row.lifecycle_state === 'approve' ? 'pending' : 'info'"
          >
            {{ translate('okf.dashboard.bulk.status.ready', 'Ready') }}
          </DsStatusTag>
        </template>
        <template #cell-topics="{ row }">{{ row.concept_count || 0 }}</template>
      </DsTable>
      <p v-if="bulkResults.length" class="okf-dashboard__bulk-results">
        {{ translate('okf.dashboard.bulk.results', 'Results') }}:
        <span
          v-for="r in bulkResults"
          :key="r.repo_id"
          :class="{ 'okf-dashboard__bulk-results-ok': r.ok, 'okf-dashboard__bulk-results-fail': !r.ok }"
        >
          {{ r.name || r.repo_id }} — {{ r.ok ? '✓' : '✗ ' + (r.code || 'failed') }}
        </span>
      </p>
    </DsDialog>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import translateMixin from '../../mixins/translateMixin';
import DsButton from '../ds/Button.vue';
import DsDialog from '../ds/Dialog.vue';
import DsInput from '../ds/Input.vue';
import DsSelect from '../ds/Select.vue';
import DsStatusTag from '../ds/StatusTag.vue';
import DsHealthRing from '../ds/HealthRing.vue';
import DsTable from '../ds/Table.vue';

const LANES = [
  { key: 'draft', label: 'In progress', emptyText: 'No drafts yet' },
  { key: 'in_review', label: 'In review', emptyText: 'Nothing in review' },
  { key: 'published', label: 'Published', emptyText: 'No published repositories yet' }
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

export default {
  name: 'OkfStudioDashboard',
  components: {
    DsButton,
    DsDialog,
    DsInput,
    DsSelect,
    DsStatusTag,
    DsHealthRing,
    DsTable
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
      domainFilterOptions: DOMAIN_OPTIONS
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
    selectedRows() {
      return this.selectedIds
        .map((id) => this.$store.getters['okf/repoById'](id))
        .filter(Boolean)
        .filter((r) => this.matchesFilters(r));
    },
    bulkColumns() {
      return [
        { key: 'name', label: this.translate('okf.dashboard.bulk.col.name', 'Name') },
        { key: 'status', label: this.translate('okf.dashboard.bulk.col.status', 'Status') },
        { key: 'topics', label: this.translate('okf.dashboard.bulk.col.topics', 'Topics') }
      ];
    },
    bulkActions() {
      return [
        { key: 'cancel', label: this.translate('common.cancel', 'Cancel'), variant: 'secondary' },
        {
          key: 'publish',
          label: this.translate('okf.dashboard.bulk.publishConfirm', `Publish ${this.selectedIds.length}`),
          variant: 'primary'
        }
      ];
    }
  },
  mounted() {
    this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {});
  },
  methods: {
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
      const s = r.lifecycle_state;
      if (s === 'published') return `Published v${r.version || 1}`;
      if (s === 'review' || s === 'approve') return this.translate('okf.dashboard.stage.inReview', 'In review');
      const step = r.studio_step;
      return step != null
        ? this.translate('okf.dashboard.stage.stepOf', `Step ${step + 1} of 10`)
        : this.translate('okf.dashboard.stage.draft', 'Draft');
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
      if (!m) return 'No metrics yet';
      return `Health: ${pct} percent, ${m.concept_count || 0} concepts`;
    },
    isStale(r) {
      const s = r.lifecycle?.stale_after;
      if (!s) return false;
      return Date.parse(s) <= Date.now();
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
    onBulkAction(key) {
      if (key === 'publish') this.runBulkPublish();
      else this.bulkOpen = false;
    },
    async runBulkPublish() {
      const repoIds = this.selectedRows.map((r) => r.repo_id);
      this.bulkResults = [];
      for (const repoId of repoIds) {
        const result = await this.$store.dispatch('okf/mintVersion', {
          repoId,
          body: { trigger: 'publish' },
          actor: { sub: 'studio-bulk' }
        });
        const r = this.$store.getters['okf/repoById'](repoId);
        this.bulkResults.push({
          repo_id: repoId,
          name: r ? r.name : repoId,
          ok: !!(result && result.ok),
          code: result && result.code
        });
      }
      this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {});
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
.okf-dashboard__title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}
.okf-dashboard__count {
  background: var(--accent-muted);
  color: var(--accent);
  padding: 2px 10px;
  border-radius: 100px;
  font-size: var(--text-xs);
}
.okf-dashboard__filters {
  display: flex;
  gap: var(--space-sm);
}
.okf-dashboard__filter-domain {
  max-width: 260px;
}
.okf-dashboard__lanes {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: var(--space-md);
}
.okf-dashboard__lane {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  min-height: 240px;
}
.okf-dashboard__lane-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0 0 var(--space-sm);
}
.okf-dashboard__lane-header h4 {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
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
  margin-bottom: var(--space-xs);
  font: inherit;
  color: var(--fg);
  cursor: pointer;
  position: relative;
}
.okf-dashboard__card:hover {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-dashboard__card--selected {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-dashboard__card-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}
.okf-dashboard__card-checkbox {
  margin: 0;
}
.okf-dashboard__card-name {
  font-weight: 600;
}
.okf-dashboard__card-count {
  font-size: var(--text-xs);
  color: var(--muted);
}
.okf-dashboard__card-stage {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--muted);
}
.okf-dashboard__card-stale {
  position: absolute;
  top: 4px;
  right: 6px;
  background: var(--warning-bg);
  color: var(--warning);
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 100px;
}
.okf-dashboard__bulk {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  background: var(--accent-muted);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
}
.okf-dashboard__bulk-results {
  margin: var(--space-md) 0 0 0;
  font-size: var(--text-sm);
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
.okf-dashboard__bulk-results-ok {
  color: var(--success);
}
.okf-dashboard__bulk-results-fail {
  color: var(--danger);
}
</style>
