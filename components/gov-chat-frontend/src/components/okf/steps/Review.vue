<!-- Step 8: Review — summary before publish. -->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.review.title', 'Review') }}</h3>
    <p class="okf-step__hint">{{ translate('okf.steps.review.hint', 'A summary of what you are about to publish.') }}</p>
    <div class="okf-step__summary">
      <p><strong>{{ translate('okf.steps.review.repo', 'Repository') }}:</strong> {{ (draft && draft.name) || '—' }}</p>
      <p><strong>{{ translate('okf.steps.review.topics', 'Topics') }}:</strong> {{ (draft && draft.concept_count) || 0 }}</p>
      <p><strong>{{ translate('okf.steps.review.labels', 'Labels') }}:</strong> {{ labelList }}</p>
      <p><strong>{{ translate('okf.steps.review.sources', 'Sources') }}:</strong> {{ sourceList }}</p>
    </div>
  </div>
</template>

<script>
export default {
  name: 'OkfStepReview',
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  computed: {
    labelList() {
      const labels = (this.draft && this.draft.labels) || [];
      return labels.length ? labels.join(', ') : '—';
    },
    sourceList() {
      const sources = (this.draft && this.draft.provenance && this.draft.provenance.sources) || [];
      return sources.length ? `${sources.length} source(s)` : '—';
    }
  }
};
</script>

<style scoped>
.okf-step { display: flex; flex-direction: column; gap: var(--space-md); }
.okf-step__title { margin: 0; font-size: var(--text-md); font-weight: 600; }
.okf-step__hint { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.okf-step__summary { display: flex; flex-direction: column; gap: var(--space-xs); font-size: var(--text-sm); }
</style>
