<!-- Step 3: Produce — running the producer; shows progress. -->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.produce.title', 'Generate topics') }}</h3>
    <p class="okf-step__hint">{{ translate('okf.steps.produce.hint', 'We are reading your sources and proposing topics.') }}</p>
    <div class="okf-step__progress">
      <DsProgress :value="0" :indeterminate="true" :show-label="true" :label="translate('okf.steps.produce.progress', 'Producer running...')" />
    </div>
    <p class="okf-step__placeholder">{{ translate('okf.steps.produce.placeholder', 'Phase 6 wires this to the producer service; for now this step is a placeholder.') }}</p>
  </div>
</template>

<script>
import DsProgress from '../../ds/Progress.vue';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepProduce',
  components: { DsProgress },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } }
};
</script>

<style scoped>
.okf-step { display: flex; flex-direction: column; gap: var(--space-md); }
.okf-step__title { margin: 0; font-size: var(--text-md); font-weight: 600; }
.okf-step__hint { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.okf-step__progress { width: 100%; }
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
