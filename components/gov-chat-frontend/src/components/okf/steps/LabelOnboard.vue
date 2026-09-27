<!--
  OkfStepLabel — Amendment A decision (David, 2026-09-27): labels are
  AUTOMATED from the Knowledge Hierarchy (L2 services bounded to the
  repository's Subject Area) — this step explains the automation and
  PREVIEWS the live assignment. The old free-text chip adder is gone:
  labels are never free text, and per-topic adjustments happen in Curate.
-->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.label.title', 'Labels — automated') }}</h3>
    <p class="okf-step__hint">
      {{ translate('okf.steps.label.hint', 'Every topic is labeled automatically from the Knowledge Hierarchy.') }}
      <DsInfoTip
        :text="
          translate(
            'okf.glossary.labelsAuto',
            'The Knowledge Hierarchy is the curated taxonomy of public services. Labels are its Level-2 services, bounded to this repository\'s Subject Area — focused labels keep retrieval precise. They are assigned automatically; free-text labels are never introduced.'
          )
        "
      />
    </p>

    <div v-if="loading" class="okf-step__loading">
      <DsSpinner size="sm" />
      <span>{{ translate('okf.steps.label.loading', 'Reading labels…') }}</span>
    </div>
    <p v-else-if="loadError" class="okf-step__error">{{ loadError }}</p>
    <template v-else>
      <p v-if="concepts.length" class="okf-step__preview-line">{{ previewLine }}</p>
      <ul v-if="sample.length" class="okf-step__sample">
        <li v-for="c in sample" :key="c.concept_id">
          <span class="okf-step__sample-title">{{ c.title || c.path }}</span>
          <span class="okf-step__sample-labels">
            <DsTag v-for="l in (c.labels || []).slice(0, 3)" :key="l" :label="l" />
            <span v-if="!(c.labels || []).length" class="okf-step__unlabeled">{{
              translate('okf.steps.label.unlabeled', 'no labels yet')
            }}</span>
          </span>
        </li>
      </ul>
      <p class="okf-step__note">
        {{
          translate(
            'okf.steps.label.adjust',
            "Adjust any topic's labels in Curate — labels stay bounded to this repository's Subject Area."
          )
        }}
      </p>
    </template>
  </div>
</template>

<script>
import DsInfoTip from '../../ds/InfoTip.vue';
import DsSpinner from '../../ds/Spinner.vue';
import DsTag from '../../ds/Tag.vue';
import repoOkfService from '../../../services/repoOkfService';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepLabel',
  components: { DsInfoTip, DsSpinner, DsTag },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['gate'],
  data() {
    return { concepts: [], loading: false, loadError: '' };
  },
  computed: {
    labeledCount() {
      return this.concepts.filter((c) => (c.labels || []).length > 0).length;
    },
    previewLine() {
      return this.translate('okf.steps.label.preview', '{labeled} of {n} topics carry Knowledge-Hierarchy labels.')
        .replace('{labeled}', String(this.labeledCount))
        .replace('{n}', String(this.concepts.length));
    },
    sample() {
      return this.concepts.slice(0, 5);
    }
  },
  mounted() {
    this.$emit('gate', true); // the automation needs no steward input here
    this.loadPreview();
  },
  methods: {
    async loadPreview() {
      const repoId = this.draft && this.draft.repo_id;
      if (!repoId) return; // pre-create — nothing to preview yet
      this.loading = true;
      this.loadError = '';
      try {
        // strict: the error branch must be REACHABLE (C3) — the default []
        // swallow made a backend failure render as a silent empty preview.
        this.concepts = await repoOkfService.listConcepts(repoId, { strict: true });
      } catch {
        this.loadError = this.translate('okf.steps.label.loadFailed', 'Could not read the labels right now.');
      } finally {
        this.loading = false;
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
.okf-step__loading {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step__preview-line {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 500;
}
.okf-step__sample {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-step__sample li {
  display: flex;
  gap: var(--space-sm);
  align-items: baseline;
  font-size: var(--text-sm);
}
.okf-step__sample-title {
  min-width: 160px;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.okf-step__sample-labels {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
.okf-step__unlabeled {
  color: var(--muted);
  font-size: var(--text-xs);
}
.okf-step__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step__error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
</style>
