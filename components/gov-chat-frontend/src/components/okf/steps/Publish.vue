<!-- Step 9: Publish — confirm dialog + toast. -->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.publish.title', 'Publish this repository') }}</h3>
    <p class="okf-step__hint">
      {{ translate('okf.steps.publish.hint', 'Publishing creates version v1 of this repository.') }}
    </p>
    <div class="okf-step__checklist">
      <DsStatusTag :variant="checklistVariants.name">{{
        translate('okf.steps.publish.nameOk', 'Repository name set')
      }}</DsStatusTag>
      <DsStatusTag :variant="checklistVariants.labels">{{
        translate('okf.steps.publish.labelsOk', 'Labels selected')
      }}</DsStatusTag>
      <DsStatusTag :variant="checklistVariants.topics">{{
        translate('okf.steps.publish.topicsOk', 'Topics reviewed')
      }}</DsStatusTag>
    </div>
  </div>
</template>

<script>
import DsStatusTag from '../../ds/StatusTag.vue';
import { mapGetters } from 'vuex';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepPublish',
  components: { DsStatusTag },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['gate'],
  computed: {
    ...mapGetters('okf', ['repoById']),
    // B8 (Amendment A): the checklist reads the LIVE repo doc — never the
    // dead draft shapes. Each item is a real publish gate the steward can
    // still act on.
    repo() {
      return (this.draft && this.draft.repo_id && this.repoById(this.draft.repo_id)) || null;
    },
    nameOk() {
      return !!((this.repo && this.repo.name) || (this.draft && this.draft.name));
    },
    topicsOk() {
      return ((this.repo && this.repo.concept_count) || (this.draft && this.draft.concept_count) || 0) > 0;
    },
    notFrozen() {
      return !(this.repo && this.repo.ingested_at);
    },
    canPublish() {
      return this.nameOk && this.topicsOk && this.notFrozen;
    },
    checklistVariants() {
      return {
        name: this.nameOk ? 'success' : 'pending',
        labels: this.topicsOk ? 'success' : 'pending',
        topics: this.topicsOk ? 'success' : 'pending'
      };
    }
  },
  watch: {
    canPublish() {
      this.$emit('gate', this.canPublish);
    }
  },
  mounted() {
    this.$emit('gate', this.canPublish);
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
.okf-step__checklist {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
</style>
