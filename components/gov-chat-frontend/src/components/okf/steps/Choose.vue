<!-- Step 1: Choose workflow — Crawl / Documents / Manual / Clone. -->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">
      {{ translate('okf.steps.choose.title', 'Where should this OKF repository start?') }}
    </h3>
    <p class="okf-step__hint">
      {{ translate('okf.steps.choose.hint', 'Pick how you want to seed this repository. You can change it later.') }}
    </p>
    <div class="okf-step__cards">
      <button
        v-for="src in sources"
        :key="src.value"
        type="button"
        class="okf-step__card"
        :class="{ 'okf-step__card--selected': local.source === src.value }"
        @click="local.source = src.value"
      >
        <span class="okf-step__card-title">{{ translate(src.titleKey, src.title) }}</span>
        <span class="okf-step__card-desc">{{ translate(src.descKey, src.desc) }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';

const SOURCES = [
  {
    value: 'documents',
    title: 'Documents',
    desc: 'Lift topics from documents you have already uploaded.',
    titleKey: 'okf.steps.choose.source.documents.title',
    descKey: 'okf.steps.choose.source.documents.desc'
  },
  {
    value: 'crawl',
    title: 'Website crawl',
    desc: 'Crawl a website and propose topics from the pages.',
    titleKey: 'okf.steps.choose.source.crawl.title',
    descKey: 'okf.steps.choose.source.crawl.desc'
  },
  {
    value: 'manual',
    title: 'Blank canvas',
    desc: 'Start from scratch and write topics yourself.',
    titleKey: 'okf.steps.choose.source.manual.title',
    descKey: 'okf.steps.choose.source.manual.desc'
  },
  {
    value: 'clone',
    title: 'Clone of an existing repository',
    desc: 'Fork the topics and structure from another OKF repository.',
    titleKey: 'okf.steps.choose.source.clone.title',
    descKey: 'okf.steps.choose.source.clone.desc'
  }
];

export default {
  name: 'OkfStepChoose',
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  data() {
    return {
      local: { source: (this.draft && this.draft.source) || 'documents' },
      sources: SOURCES
    };
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
.okf-step__cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}
.okf-step__card {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  text-align: left;
  padding: var(--space-md);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font: inherit;
  color: var(--fg);
}
.okf-step__card:hover {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-step__card--selected {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-step__card-title {
  font-weight: 600;
}
.okf-step__card-desc {
  color: var(--muted);
  font-size: var(--text-sm);
}
</style>
