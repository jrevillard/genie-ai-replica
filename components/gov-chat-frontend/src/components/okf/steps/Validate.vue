<!--
  OkfStepValidate.vue — Story 3-8 Step 6 (Validation panel).

  Big health ring (DsHealthRing sized to fill ~30% of the width) +
  one-sentence headline + count line + 5 issue groups (per conformance-service
  hard/warning codes). Expert mode unlocks "Show raw validation report (JSON)".
  Validation calls live-validation API in Phase 6+ (NOT_READY in this slice).
-->
<template>
  <div class="okf-step-validate">
    <div class="okf-step-validate__health">
      <DsHealthRing :score="healthScore" :size="'lg'" :show-label="true" :aria-label="healthAria" />
      <p class="okf-step-validate__headline">{{ headline }}</p>
      <p class="okf-step-validate__count">{{ summaryLine }}</p>
    </div>

    <div class="okf-step-validate__groups">
      <details v-for="g in issueGroups" :key="g.code" :open="g.count > 0" class="okf-step-validate__group">
        <summary>
          <span class="okf-step-validate__group-label">{{ g.label }}</span>
          <span class="okf-step-validate__group-count">{{ g.count }}</span>
        </summary>
        <p v-if="g.count === 0" class="okf-step-validate__group-empty">
          {{ translate('okf.validation.none', 'None') }}
        </p>
        <ul v-else class="okf-step-validate__group-list">
          <li v-for="(item, idx) in g.items" :key="idx">
            <span>{{ item.label || item.message || '—' }}</span>
            <span v-if="expert" class="okf-step-validate__group-code">{{ item.code }}</span>
          </li>
        </ul>
      </details>
    </div>

    <p v-if="!expert" class="okf-step-validate__expert-hint">
      {{
        translate(
          'okf.validation.expertHint',
          'Switch to Expert mode to see raw validation JSON, filter by severity, and override checks.'
        )
      }}
    </p>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import DsHealthRing from '../../ds/HealthRing.vue';
import translateMixin from '../../../mixins/translateMixin';

const ISSUE_GROUPS = [
  { code: 'MISSING_TYPE', label: 'Concept type missing', count: 0, items: [] },
  { code: 'BAD_ACTOR_PREFIX', label: 'Bad actor prefix', count: 0, items: [] },
  { code: 'INVALID_STATUS_ENUM', label: 'Invalid status value', count: 0, items: [] },
  { code: 'UNPARSEABLE_STALE_AFTER', label: 'Unparseable freshness date', count: 0, items: [] },
  { code: 'SOURCE_MISSING_RESOURCE', label: 'Sources missing resources', count: 0, items: [] }
];

export default {
  name: 'OkfStepValidate',
  components: { DsHealthRing },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  data() {
    return {
      issueGroups: ISSUE_GROUPS.map((g) => ({ ...g }))
    };
  },
  computed: {
    ...mapGetters('okf', ['isExpert']),
    expertMode() {
      return this.expert;
    },
    healthScore() {
      // Prefer server metrics when the fetch succeeded; else derive from issues.
      const m = this._metrics;
      if (m && typeof m.concept_count === 'number' && m.concept_count > 0) {
        const issues = (m.conformance_issue_count || 0) + (m.stale_concept_count || 0);
        return Math.max(0, Math.min(100, Math.round(100 * (1 - issues / Math.max(m.concept_count, 1)))));
      }
      const total = this.issueGroups.reduce((acc, g) => acc + g.count, 0);
      const concepts = (this.draft && this.draft.concept_count) || 1;
      return Math.max(0, Math.min(100, Math.round(100 * (1 - total / Math.max(concepts, 5)))));
    },
    healthAria() {
      const total = this.issueGroups.reduce((acc, g) => acc + g.count, 0);
      return `Health: ${this.healthScore} percent, ${total} issue(s)`;
    },
    headline() {
      const blockers = this.issueGroups
        .filter((g) => g.code === 'MISSING_TYPE' || g.code === 'BAD_ACTOR_PREFIX')
        .reduce((acc, g) => acc + g.count, 0);
      const warnings = this.issueGroups.reduce((acc, g) => acc + g.count, 0) - blockers;
      if (blockers > 0)
        return this.translate(
          'okf.validation.headline.blockers',
          `${blockers} blocking issue(s) — fix before publishing`
        );
      if (warnings > 0)
        return this.translate('okf.validation.headline.warnings', `${warnings} thing(s) need your review`);
      return this.translate('okf.validation.headline.ok', 'Looks good. Nothing to fix.');
    },
    summaryLine() {
      const concepts = (this.draft && this.draft.concept_count) || 0;
      const blockers = this.issueGroups
        .filter((g) => g.code === 'MISSING_TYPE' || g.code === 'BAD_ACTOR_PREFIX')
        .reduce((acc, g) => acc + g.count, 0);
      const warnings = this.issueGroups.reduce((acc, g) => acc + g.count, 0) - blockers;
      const clean = Math.max(0, concepts - blockers - warnings);
      return this.translate('okf.validation.summary', '{clean} clean · {warnings} needs review · {blockers} blocking')
        .replace('{clean}', clean)
        .replace('{warnings}', warnings)
        .replace('{blockers}', blockers);
    }
  },
  mounted() {
    // Story #978: populate the issue groups from REAL data - the
    // autocorrect dry-run (frontmatter conformance), per-concept index
    // status, and the repo metrics. No more hard-coded zeros.
    this.refresh();
  },
  methods: {
    async refresh() {
      this._metrics = null;
      const repoId = this.draft && this.draft.repo_id;
      if (!repoId) return;
      const [ac, concepts, metrics] = await Promise.allSettled([
        this.$store.dispatch('okf/autocorrectRepo', { repoId, dryRun: true }),
        this.$store.dispatch('okf/fetchConcepts', repoId),
        this.$store.dispatch('okf/fetchRepoMetrics', repoId)
      ]);
      const groups = new Map();
      const addIssue = (code, label, item) => {
        if (!groups.has(code)) groups.set(code, { code, label, count: 0, items: [] });
        const g = groups.get(code);
        g.count += 1;
        g.items.push(item);
      };
      // 1. Autocorrect dry-run: planned frontmatter fixes + warnings.
      const acVal = ac.status === 'fulfilled' ? ac.value : null;
      const changes = (acVal && acVal.changes) || [];
      const warnings = (acVal && acVal.warnings) || [];
      for (const ch of changes) {
        addIssue(ch.reason || ch.field || 'AUTOCORRECT', ch.reason || ch.field || 'Fixable', {
          label: ch.concept_id + ': ' + (ch.before == null ? '(none)' : String(ch.before)) + ' -> ' + ch.after
        });
      }
      for (const w of warnings) {
        addIssue(w.rule || 'WARNING', w.rule || 'Warning', { label: w.concept_id + ' - ' + (w.message || '') });
      }
      // 2. Index failures (per-concept index_status from the concept list).
      const rows = (concepts.status === 'fulfilled' && concepts.value && concepts.value.concepts) || [];
      for (const row of rows) {
        if (row.index_status === 'failed') {
          addIssue('INDEX_FAILED', 'Index failed', { label: row.concept_id + ' - re-index failed; edit or re-split' });
        }
      }
      this.issueGroups = Array.from(groups.values());
      this._metrics = metrics.status === 'fulfilled' ? metrics.value : null;
    }
  }
};
</script>

<style scoped>
.okf-step-validate {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.okf-step-validate__health {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.okf-step-validate__headline {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}
.okf-step-validate__count {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step-validate__groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-step-validate__group {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-sm) var(--space-md);
}
.okf-step-validate__group summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  font-weight: 500;
}
.okf-step-validate__group-count {
  background: var(--accent-muted);
  color: var(--accent);
  padding: 2px 10px;
  border-radius: 100px;
  font-size: var(--text-xs);
}
.okf-step-validate__group-empty {
  margin: var(--space-xs) 0 0 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step-validate__group-list {
  margin: var(--space-xs) 0 0 0;
  padding-left: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--text-sm);
}
.okf-step-validate__group-code {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  margin-left: var(--space-xs);
}
.okf-step-validate__expert-hint {
  margin: 0;
  padding: var(--space-sm) var(--space-md);
  background: var(--bg);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: var(--text-sm);
}
</style>
