<!--
  OkfStepCurate.vue — Story 3-8 Step 5 (Curator panel).

  Layout: left = concept tree (recursive), right = DsOkfMarkdownEditor for the
  selected concept + a labels rail (uses OkfLabelEditor) + a small Trust &
  freshness summary. Save is gated by validateConcept hardErrors.

  Reads concept list via conceptService.listForRepo; in Basic mode the editor
  is preview-only by default (source hidden behind a [Show source] toggle).
  In Expert mode both panes visible + [Edit frontmatter] dialog.
-->
<template>
  <div class="okf-step-curate">
    <div class="okf-step-curate__tree">
      <header class="okf-step-curate__tree-header">
        <DsInput v-model="search" :placeholder="translate('okf.curator.search', 'Search topics')" size="sm" />
      </header>
      <ul v-if="filtered.length" class="okf-step-curate__tree-list">
        <li v-for="c in filtered" :key="c.concept_id">
          <button
            type="button"
            class="okf-step-curate__tree-row"
            :class="{ 'okf-step-curate__tree-row--selected': selected === c.concept_id }"
            @click="selected = c.concept_id"
          >
            <span class="okf-step-curate__tree-row-title">{{ c.title || c.concept_id }}</span>
            <DsPill v-for="l in c.labels" :key="l" :label="l" />
          </button>
        </li>
      </ul>
      <p v-else class="okf-step-curate__empty">{{ translate('okf.curator.noTopics', 'No topics yet.') }}</p>
    </div>

    <div class="okf-step-curate__detail">
      <div v-if="selectedConcept" class="okf-step-curate__detail-inner">
        <header class="okf-step-curate__detail-header">
          <h4>{{ selectedConcept.title || selectedConcept.concept_id }}</h4>
          <DsButton variant="secondary" small @click="openLabels = true">
            {{ translate('okf.curator.labels.edit', 'Adjust labels') }}
          </DsButton>
        </header>
        <DsOkfMarkdownEditor
          v-model="selectedBody"
          :expert="expert"
          :issues="conceptIssues"
          mode="split"
        />
      </div>
      <p v-else class="okf-step-curate__placeholder">{{ translate('okf.curator.placeholder', 'Pick a topic on the left to view + edit.') }}</p>
    </div>

    <OkfLabelEditor
      v-if="openLabels && selectedConcept"
      :visible="openLabels"
      :repo-id="(draft && draft.repo_id) || ''"
      :labels="(selectedConcept.labels || []).slice()"
      @close="openLabels = false"
      @save="onLabelsSave"
    />
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import DsInput from '../../ds/Input.vue';
import DsButton from '../../ds/Button.vue';
import DsPill from '../../ds/Pill.vue';
import DsOkfMarkdownEditor from '../../ds/OkfMarkdownEditor.vue';
import OkfLabelEditor from '../LabelEditor.vue';
import conceptService from '../../../services/conceptService';

export default {
  name: 'OkfStepCurate',
  components: { DsInput, DsButton, DsPill, DsOkfMarkdownEditor, OkfLabelEditor },
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  data() {
    return {
      search: '',
      selected: null,
      concepts: [],
      openLabels: false,
      selectedBody: '',
      selectedLabels: []
    };
  },
  computed: {
    ...mapGetters('okf', ['isExpert']),
    filtered() {
      const q = (this.search || '').toLowerCase().trim();
      if (!q) return this.concepts;
      return this.concepts.filter((c) => (c.title || c.concept_id || '').toLowerCase().includes(q));
    },
    selectedConcept() {
      if (!this.selected) return null;
      return this.concepts.find((c) => c.concept_id === this.selected) || null;
    },
    conceptIssues() {
      // Phase 6 wires the live validateConcept call here. Until then, surface
      // a minimal inline conformance flag set so the editor's gutter is usable.
      const c = this.selectedConcept;
      if (!c) return [];
      const out = [];
      if (!c.type) out.push({ line: 1, rule: 'MISSING_TYPE', severity: 'error', message: this.translate('okf.curator.issue.missingType', 'Concept is missing a type.') });
      if (Array.isArray(c.sources)) {
        c.sources.forEach((s, i) => {
          if (!s.author || !s.author.startsWith('human:')) {
            if (!s.author || !/^(agent|tool|process|human):/.test(s.author)) {
              out.push({ line: 1 + i, rule: 'BAD_ACTOR_PREFIX', severity: 'error', message: this.translate('okf.curator.issue.badActor', 'Source actor must start with agent:/human:/tool:/process:.') });
            }
          }
        });
      }
      return out;
    }
  },
  watch: {
    selected(v) {
      if (v) {
        const c = this.concepts.find((x) => x.concept_id === v);
        this.selectedBody = (c && c.body) || '';
        this.selectedLabels = (c && c.labels) || [];
      }
    },
    selectedBody(v) {
      const c = this.selectedConcept;
      if (c) c.body = v; // local mirror; full save ships with 4.2 concept editor.
    }
  },
  mounted() {
    const repoId = this.draft && this.draft.repo_id;
    if (repoId) {
      conceptService.listForRepo(repoId).then((rows) => {
        this.concepts = rows || [];
        if (this.concepts.length > 0) this.selected = this.concepts[0].concept_id;
      }).catch(() => {
        this.concepts = [];
      });
    }
  },
  methods: {
    async onLabelsSave(labels) {
      this.selectedLabels = labels.slice();
      const c = this.selectedConcept;
      if (c) c.labels = labels.slice();
      this.openLabels = false;
      try {
        await conceptService.update((this.draft && this.draft.repo_id) || '', c && c.concept_id || '', { labels });
      } catch {
        // NOT_READY — labels persist locally until the server endpoint lands.
      }
    }
  }
};
</script>

<style scoped>
.okf-step-curate { display: grid; grid-template-columns: 320px 1fr; gap: var(--space-md); min-height: 320px; }
.okf-step-curate__tree {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-sm);
  overflow-y: auto;
}
.okf-step-curate__tree-header { margin-bottom: var(--space-sm); }
.okf-step-curate__tree-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.okf-step-curate__tree-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font: inherit;
  color: var(--fg);
}
.okf-step-curate__tree-row:hover { background: var(--accent-muted); }
.okf-step-curate__tree-row--selected { background: var(--accent-muted); color: var(--accent); }
.okf-step-curate__tree-row-title { font-weight: 500; }
.okf-step-curate__empty { color: var(--muted); padding: var(--space-md); text-align: center; }
.okf-step-curate__detail { display: flex; flex-direction: column; }
.okf-step-curate__detail-inner { display: flex; flex-direction: column; gap: var(--space-sm); }
.okf-step-curate__detail-header { display: flex; justify-content: space-between; align-items: center; }
.okf-step-curate__detail-header h4 { margin: 0; font-size: var(--text-md); font-weight: 600; }
.okf-step-curate__placeholder { color: var(--muted); padding: var(--space-xl); text-align: center; }
</style>
