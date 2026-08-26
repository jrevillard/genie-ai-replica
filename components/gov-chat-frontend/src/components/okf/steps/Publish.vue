<!-- Step 9: Publish — confirm dialog + toast. -->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.publish.title', 'Publish this repository') }}</h3>
    <p class="okf-step__hint">{{ translate('okf.steps.publish.hint', 'Publishing creates version v1 of this repository.') }}</p>
    <div class="okf-step__checklist">
      <DsStatusTag :variant="checklistVariants.name">{{ translate('okf.steps.publish.nameOk', 'Repository name set') }}</DsStatusTag>
      <DsStatusTag :variant="checklistVariants.labels">{{ translate('okf.steps.publish.labelsOk', 'Labels selected') }}</DsStatusTag>
      <DsStatusTag :variant="checklistVariants.topics">{{ translate('okf.steps.publish.topicsOk', 'Topics reviewed') }}</DsStatusTag>
    </div>
  </div>
</template>

<script>
import DsStatusTag from '../../ds/StatusTag.vue';

export default {
  name: 'OkfStepPublish',
  components: { DsStatusTag },
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  computed: {
    checklistVariants() {
      const d = this.draft || {};
      return {
        name: d.name ? 'success' : 'pending',
        labels: Array.isArray(d.labels) && d.labels.length >= 1 ? 'success' : 'pending',
        topics: (d.concept_count || 0) > 0 ? 'success' : 'pending'
      };
    }
  }
};
</script>

<style scoped>
.okf-step { display: flex; flex-direction: column; gap: var(--space-md); }
.okf-step__title { margin: 0; font-size: var(--text-md); font-weight: 600; }
.okf-step__hint { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.okf-step__checklist { display: flex; gap: var(--space-sm); flex-wrap: wrap; }
</style>
