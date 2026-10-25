<!--
  RagasGuideDialog.vue — the operator guide for the RAGAS tab (David,
  2026-10-23: "a fairly detailed help section … the things to do and not
  to do … the best approach to generating and enhancing benchmark suites
  and the best approach to running those benchmarks along with the effect
  of changing models and what to expect").

  This is deliberately NOT the field glossary that sits behind the Help
  toggle in RagasPanel.vue. That one answers "what is this control?".
  This one answers "what should I do with it, in what order, and what
  happens if I get it wrong" — five chapters, each with things to do,
  things to avoid, and a grounded expectation of time and numbers.

  Shape follows HeadTestDialog.vue (the established OKF dialog paradigm):
  DsDialog + DsTabs, one pane per chapter, Options API, translateMixin for
  every string. Content is per-chapter arrays of dotted keys rather than
  real arrays, because translateMixin resolves leaf values as STRINGS only
  (translateMixin.js:60-63 returns a string or the fallback) — an array
  value would fall through to the fallback on every call.
-->
<template>
  <DsDialog
    :visible="visible"
    :title="translate('okf.ragas.guide.title', 'RAGAS benchmarking guide')"
    size="xl"
    :actions="actions"
    @close="$emit('close')"
    @action="onAction"
  >
    <p class="okf-guide__intro">
      {{ translate('okf.ragas.guide.intro', '') }}
    </p>

    <DsTabs v-model="tab" :tabs="tabDefs" fill>
      <div v-for="ch in chapters" v-show="tab === ch.key" :key="ch.key" class="okf-guide__pane">
        <DsCard padding="lg" class="okf-guide__card">
          <h5 class="okf-guide__chapter-title">{{ ch.title }}</h5>
          <p class="okf-guide__chapter-intro">{{ ch.intro }}</p>

          <div class="okf-guide__list-head">
            <DsPill variant="success">{{ translate('okf.ragas.guide.labels.do', 'Do this') }}</DsPill>
          </div>
          <ul class="okf-guide__list">
            <li v-for="(item, i) in ch.do" :key="`d${i}`" class="okf-guide__item">
              <span class="okf-guide__bullet okf-guide__bullet--do" aria-hidden="true">✓</span>
              <span>{{ item }}</span>
            </li>
          </ul>

          <div class="okf-guide__list-head">
            <DsPill variant="danger">{{ translate('okf.ragas.guide.labels.dont', "Don't") }}</DsPill>
          </div>
          <ul class="okf-guide__list">
            <li v-for="(item, i) in ch.dont" :key="`x${i}`" class="okf-guide__item">
              <span class="okf-guide__bullet okf-guide__bullet--dont" aria-hidden="true">✕</span>
              <span>{{ item }}</span>
            </li>
          </ul>

          <div class="okf-guide__list-head">
            <DsPill variant="info">{{ translate('okf.ragas.guide.labels.expect', 'What to expect') }}</DsPill>
          </div>
          <p class="okf-guide__expect">{{ ch.expect }}</p>

          <!-- The error→result MAPPING (David 2026-10-25: "whatever you
               decide to do with errors and how they are mapped to
               benchmark results must be documented in the embedded guide
               for users"). A table, because the mapping IS a table: one
               row per state the panel can report, what that state means,
               and what it does to the number being read. -->
          <div v-if="ch.table" class="okf-guide__table-wrap">
            <h6 class="okf-guide__table-title">{{ ch.table.title }}</h6>
            <DsTable :columns="ch.table.columns" :rows="ch.table.rows" row-key="state" striped>
              <template #cell-state="{ row }">
                <DsPill :variant="row.variant">{{ row.state }}</DsPill>
              </template>
            </DsTable>
          </div>
        </DsCard>
      </div>
    </DsTabs>

    <a class="okf-guide__more" href="https://www.ragas.io/" target="_blank" rel="noopener noreferrer">{{
      translate('okf.ragas.guide.more', 'Read more at ragas.io')
    }}</a>
  </DsDialog>
</template>

<script>
import DsDialog from '../../ds/Dialog.vue';
import DsTabs from '../../ds/Tabs.vue';
import DsCard from '../../ds/Card.vue';
import DsPill from '../../ds/Pill.vue';
import DsTable from '../../ds/Table.vue';
import translateMixin from '../../../mixins/translateMixin';

// Chapter order is the order an operator actually works in: build the
// suite, fix the suite, run it, know what you changed, read the number —
// and then what the states in that number mean.
const CHAPTER_KEYS = ['generate', 'curate', 'run', 'models', 'read', 'errors'];

// The states the panel can report for a row, and what each one does to
// the result. The order is the order an operator meets them.
//
// These are NOT invented: each row is the behaviour the SERVER implements
// (ragas-suite-service.js summarizeRun + the run's coverage block) and the
// panel renders (the invalid-run banner, the stacked outcome bar, the
// per-metric coverage note).
const ERROR_ROWS = [
  { key: 'error', variant: 'danger' },
  { key: 'abstained', variant: 'warning' },
  { key: 'unmeasured', variant: 'info' },
  { key: 'belowThreshold', variant: 'warning' },
  { key: 'outOfScope', variant: 'neutral' }
];

export default {
  name: 'RagasGuideDialog',
  components: { DsDialog, DsTabs, DsCard, DsPill, DsTable },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false }
  },
  emits: ['close'],
  data() {
    return { tab: 'generate' };
  },
  computed: {
    actions() {
      return [{ key: 'close', variant: 'primary', label: this.translate('okf.ragas.guide.close', 'Close') }];
    },
    /**
     * Each chapter is 4 "do" bullets, 3 "don't" bullets and one
     * expectation — a shape that forces the guidance to be actionable
     * rather than descriptive. All values go through translate() so a
     * locale gap degrades to the English default rather than to a blank
     * line.
     */
    chapters() {
      const pick = (key, prefix, count) =>
        Array.from({ length: count }, (_, i) =>
          this.translate(`okf.ragas.guide.chapters.${key}.${prefix}${i + 1}`, '')
        );
      return CHAPTER_KEYS.map((key) => ({
        key,
        title: this.translate(`okf.ragas.guide.chapters.${key}.title`, key),
        intro: this.translate(`okf.ragas.guide.chapters.${key}.intro`, ''),
        do: pick(key, 'd', 4),
        dont: pick(key, 'x', 3),
        expect: this.translate(`okf.ragas.guide.chapters.${key}.expect`, ''),
        table: key === 'errors' ? this.errorTable : null
      }));
    },
    /**
     * The error→result MAPPING. Every cell is a translate() call on its
     * own key: translateMixin resolves leaf values as STRINGS only, so a
     * table cannot be carried as an array of objects in the locale file.
     */
    errorTable() {
      const base = 'okf.ragas.guide.chapters.errors.table';
      const columns = [
        { key: 'state', label: this.translate(`${base}.col.state`, 'State') },
        { key: 'meaning', label: this.translate(`${base}.col.meaning`, 'What it means') },
        { key: 'effect', label: this.translate(`${base}.col.effect`, 'What it does to the result') }
      ];
      const rows = ERROR_ROWS.map((r) => ({
        variant: r.variant,
        state: this.translate(`${base}.${r.key}.state`, r.key),
        meaning: this.translate(`${base}.${r.key}.meaning`, ''),
        effect: this.translate(`${base}.${r.key}.effect`, '')
      }));
      return {
        title: this.translate(`${base}.title`, 'How each state maps to the result'),
        columns,
        rows
      };
    },
    tabDefs() {
      return this.chapters.map((c) => ({ value: c.key, label: c.title }));
    }
  },
  watch: {
    // Reopening on the chapter you left is the friendly behaviour, but a
    // stale tab from a previous visit that no longer exists would render
    // an empty pane — so reset only when the dialog reopens from closed.
    visible(open) {
      if (open) this.tab = CHAPTER_KEYS[0];
    }
  },
  methods: {
    onAction(key) {
      if (key === 'close') this.$emit('close');
    }
  }
};
</script>

<style scoped>
.okf-guide__intro {
  color: var(--muted);
  margin: 0 0 var(--space-md);
}

.okf-guide__pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}

.okf-guide__chapter-title {
  margin: 0 0 var(--space-xs);
  font-size: 1.05rem;
}

.okf-guide__chapter-intro {
  color: var(--muted);
  margin: 0 0 var(--space-md);
}

.okf-guide__list-head {
  margin-top: var(--space-md);
  margin-bottom: var(--space-xs);
}

.okf-guide__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.okf-guide__item {
  display: flex;
  gap: var(--space-sm);
  align-items: flex-start;
  padding: var(--space-xs) 0;
  line-height: 1.5;
}

.okf-guide__bullet {
  flex: 0 0 auto;
  font-weight: 700;
  line-height: 1.5;
}

.okf-guide__bullet--do {
  color: var(--success);
}

.okf-guide__bullet--dont {
  color: var(--danger);
}

.okf-guide__expect {
  margin: 0;
  color: var(--muted);
}

.okf-guide__table-wrap {
  margin-top: var(--space-lg);
}

.okf-guide__table-title {
  margin: 0 0 var(--space-xs);
  font-size: 0.95rem;
}

.okf-guide__more {
  display: inline-block;
  margin-top: var(--space-md);
  font-size: 0.85rem;
}
</style>
