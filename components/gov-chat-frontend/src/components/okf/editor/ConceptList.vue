<!--
  OkfConceptList.vue — Story #978 Studio editor left rail.

  Lists a repo's concepts (errors-first sort served by the backend), with a
  client-side filter (title / path / source URL). Click a row to load it into
  the center pane. Bottom action opens the Re-split modal.
-->
<template>
  <div class="okf-cl" role="region" :aria-label="translate('okf.editor.concepts.label', 'Concepts')">
    <header class="okf-cl__header">
      <span class="okf-cl__title">{{ translate('okf.editor.concepts.label', 'Concepts') }}</span>
      <span class="okf-cl__count">{{ filtered.length }}</span>
    </header>

    <DsInput
      v-model="filter"
      class="okf-cl__filter"
      :placeholder="translate('okf.editor.concepts.filter', 'Filter by title, path or URL')"
      size="sm"
    />

    <p v-if="loading" class="okf-cl__empty">
      <DsSpinner size="sm" /> {{ translate('okf.editor.concepts.loading', 'Loading…') }}
    </p>
    <p v-else-if="filtered.length === 0" class="okf-cl__empty">
      {{ translate('okf.editor.concepts.empty', 'No concepts yet — ingest or re-split from source.') }}
    </p>

    <ul v-else class="okf-cl__list">
      <li v-for="c in filtered" :key="c.concept_id">
        <button
          type="button"
          class="okf-cl__row"
          :class="{ 'okf-cl__row--selected': c.concept_id === selectedId }"
          @click="$emit('select', c.concept_id)"
        >
          <span
            class="okf-cl__status"
            :class="'okf-cl__status--' + (c.index_status || 'parsed')"
            :title="c.index_status"
          ></span>
          <span class="okf-cl__body">
            <span class="okf-cl__row-title">
              {{ c.title || c.concept_id }}
              <DsPill v-if="c.is_index" variant="accent">{{
                translate('okf.editor.concepts.indexBadge', 'index')
              }}</DsPill>
            </span>
            <span v-if="sourceOf(c)" class="okf-cl__row-source">{{ sourceOf(c) }}</span>
            <span v-if="(c.labels || []).length" class="okf-cl__row-label">{{ c.labels[0] }}</span>
          </span>
        </button>
      </li>
    </ul>

    <footer class="okf-cl__footer">
      <DsButton variant="ghost" small @click="$emit('resplit')">
        + {{ translate('okf.editor.concepts.resplit', 'Re-split from source') }}
      </DsButton>
    </footer>
  </div>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsButton from '../../ds/Button.vue';
import DsInput from '../../ds/Input.vue';
import DsPill from '../../ds/Pill.vue';
import DsSpinner from '../../ds/Spinner.vue';

export default {
  name: 'OkfConceptList',
  components: { DsButton, DsInput, DsPill, DsSpinner },
  mixins: [translateMixin],
  props: {
    concepts: { type: Array, default: () => [] },
    selectedId: { type: String, default: null },
    loading: { type: Boolean, default: false }
  },
  emits: ['select', 'resplit'],
  data() {
    return {
      filter: ''
    };
  },
  computed: {
    filtered() {
      const s = (this.filter || '').toLowerCase().trim();
      if (!s) return this.concepts;
      return this.concepts.filter((c) => {
        const hay = [c.title, c.concept_id, c.path, this.sourceOf(c)].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(s);
      });
    }
  },
  methods: {
    sourceOf(c) {
      const s = (c.sources || []).find((x) => x && x.resource);
      return s ? s.resource : '';
    }
  }
};
</script>

<style scoped>
.okf-cl {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  min-height: 0;
}
.okf-cl__header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.okf-cl__title {
  font-size: var(--text-sm);
  font-weight: 600;
}
.okf-cl__count {
  background: var(--accent-muted);
  color: var(--accent);
  padding: 1px 8px;
  border-radius: 100px;
  font-size: var(--text-xs);
}
.okf-cl__filter {
  width: 100%;
}
.okf-cl__empty {
  color: var(--muted);
  font-size: var(--text-sm);
  text-align: center;
  padding: var(--space-md) 0;
  margin: 0;
}
.okf-cl__list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}
.okf-cl__row {
  display: flex;
  gap: var(--space-sm);
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: var(--space-xs) var(--space-sm);
  margin-bottom: 2px;
  font: inherit;
  color: var(--fg);
  cursor: pointer;
}
.okf-cl__row:hover {
  background: var(--accent-muted);
}
.okf-cl__row--selected {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-cl__status {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
  background: var(--muted);
}
.okf-cl__status--indexed {
  background: var(--success);
}
.okf-cl__status--parsed {
  background: var(--warning);
}
.okf-cl__status--failed {
  background: var(--danger);
}
.okf-cl__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.okf-cl__row-title {
  font-size: var(--text-sm);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}
.okf-cl__row-source {
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.okf-cl__row-label {
  font-size: var(--text-xs);
  color: var(--accent);
}
.okf-cl__footer {
  border-top: 1px solid var(--border);
  padding-top: var(--space-sm);
}
</style>
