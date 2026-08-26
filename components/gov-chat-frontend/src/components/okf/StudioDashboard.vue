<!--
  OkfStudioDashboard.vue — Story 3-5 stub for Phase 2 wiring.
  Phase 3 will replace this with the full kanban: 3-column layout
  (in_progress / in_review / published), card shows health + topic count + stage,
  bulk-publish toolbar, retract placeholder.
-->
<template>
  <div class="okf-dashboard-stub">
    <div class="okf-dashboard-stub__header">
      <DsButton variant="primary" @click="$emit('new')">{{ translate('okf.dashboard.new', '+ New repository') }}</DsButton>
    </div>
    <div class="okf-dashboard-stub__lanes">
      <section v-for="lane in lanes" :key="lane.key" class="okf-dashboard-stub__lane">
        <header class="okf-dashboard-stub__lane-header">
          <h3>{{ lane.label }}</h3>
          <span class="okf-dashboard-stub__lane-count">{{ reposInLane(lane.key).length }}</span>
        </header>
        <div v-if="reposInLane(lane.key).length === 0" class="okf-dashboard-stub__empty">
          {{ translate('okf.dashboard.empty', 'No repositories here yet.') }}
        </div>
        <button
          v-for="r in reposInLane(lane.key)"
          :key="r.repo_id"
          type="button"
          class="okf-dashboard-stub__card"
          @click="$emit('resume', r.repo_id)"
        >
          <span class="okf-dashboard-stub__card-name">{{ r.name || r.repo_id }}</span>
          <span class="okf-dashboard-stub__card-stage">{{ stageLabel(r) }}</span>
        </button>
      </section>
    </div>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import DsButton from '../ds/Button.vue';

const LANES = [
  { key: 'draft',     label: 'In progress' },
  { key: 'in_review', label: 'In review' },
  { key: 'published', label: 'Published' }
];

export default {
  name: 'OkfStudioDashboard',
  components: { DsButton },
  emits: ['new', 'resume'],
  data() {
    return { lanes: LANES };
  },
  computed: {
    ...mapGetters('okf', ['reposByStage'])
  },
  mounted() {
    this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {});
  },
  methods: {
    reposInLane(key) {
      const ids = (this.reposByStage && this.reposByStage[key]) || [];
      return ids.map((id) => this.$store.getters['okf/repoById'](id)).filter(Boolean);
    },
    stageLabel(r) {
      const s = r.lifecycle_state;
      if (s === 'published') return `Published v${r.version || 1}`;
      if (s === 'review' || s === 'approve') return 'In review';
      const step = r.studio_step;
      return step != null ? `Step ${step + 1} of 10` : 'Draft';
    }
  }
};
</script>

<style scoped>
.okf-dashboard-stub { display: flex; flex-direction: column; gap: var(--space-md); }
.okf-dashboard-stub__header { display: flex; justify-content: flex-end; }
.okf-dashboard-stub__lanes { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--space-md); }
.okf-dashboard-stub__lane {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  min-height: 240px;
}
.okf-dashboard-stub__lane-header { display: flex; justify-content: space-between; margin: 0 0 var(--space-sm); }
.okf-dashboard-stub__lane-header h3 { margin: 0; font-size: var(--text-sm); font-weight: 600; }
.okf-dashboard-stub__lane-count {
  background: var(--accent-muted);
  color: var(--accent);
  border-radius: 100px;
  padding: 2px 10px;
  font-size: var(--text-xs);
}
.okf-dashboard-stub__empty { color: var(--muted); font-size: var(--text-sm); padding: var(--space-md); text-align: center; }
.okf-dashboard-stub__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
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
}
.okf-dashboard-stub__card:hover { border-color: var(--accent); background: var(--accent-muted); }
.okf-dashboard-stub__card-name { font-weight: 600; }
.okf-dashboard-stub__card-stage { color: var(--muted); font-size: var(--text-xs); }
</style>
