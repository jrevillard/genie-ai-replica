<!-- Step 2: Input — variant-specific (documents/crawl/manual/clone). -->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.input.title', 'Inputs') }}</h3>
    <p class="okf-step__hint">{{ hintText }}</p>
    <p class="okf-step__placeholder">{{ placeholderText }}</p>
  </div>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepInput',
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  computed: {
    hintText() {
      const s = (this.draft && this.draft.source) || 'documents';
      const keys = {
        documents: 'okf.steps.input.documents',
        crawl: 'okf.steps.input.crawl',
        manual: 'okf.steps.input.manual',
        clone: 'okf.steps.input.clone'
      };
      return this.translate(keys[s] || 'okf.steps.input.documents', 'Pick the documents that should seed the topic list.');
    },
    placeholderText() {
      const s = (this.draft && this.draft.source) || 'documents';
      return this.translate('okf.steps.input.placeholder', `Phase 4 wires the ${s} selection UI; for now this step is a placeholder.`);
    }
  }
};
</script>

<style scoped>
.okf-step { display: flex; flex-direction: column; gap: var(--space-md); }
.okf-step__title { margin: 0; font-size: var(--text-md); font-weight: 600; }
.okf-step__hint { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.okf-step__placeholder {
  margin: 0;
  padding: var(--space-md);
  background: var(--bg);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: var(--text-sm);
}
</style>
