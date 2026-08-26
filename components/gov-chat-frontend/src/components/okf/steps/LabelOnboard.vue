<!-- Step 4: Label Onboard — pick 3-7 labels (the categorical axes). -->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.label.title', 'Pick the labels') }}</h3>
    <p class="okf-step__hint">{{ translate('okf.steps.label.hint', 'Labels are the categorical axes of your ontology — what kinds of things are these topics? Choose 3-7.') }}</p>
    <div class="okf-step__chips">
      <DsTag v-for="l in local.labels" :key="l" :label="l" removable @remove="removeLabel(l)" />
      <button type="button" class="okf-step__add" @click="addLabel">{{ translate('okf.steps.label.add', '+ Add label') }}</button>
    </div>
    <div v-if="adding" class="okf-step__adder">
      <DsInput v-model="newLabel" :placeholder="translate('okf.steps.label.placeholder', 'e.g. Permits')" />
      <DsButton variant="primary" small @click="confirmAdd">{{ translate('okf.steps.label.addConfirm', 'Add') }}</DsButton>
      <DsButton variant="ghost" small @click="cancelAdd">{{ translate('common.cancel', 'Cancel') }}</DsButton>
    </div>
  </div>
</template>

<script>
import DsTag from '../../ds/Tag.vue';
import DsInput from '../../ds/Input.vue';
import DsButton from '../../ds/Button.vue';

export default {
  name: 'OkfStepLabel',
  components: { DsTag, DsInput, DsButton },
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  data() {
    return {
      local: { labels: ((this.draft && this.draft.labels) || []).slice() },
      adding: false,
      newLabel: ''
    };
  },
  methods: {
    addLabel() { this.adding = true; },
    confirmAdd() {
      const v = (this.newLabel || '').trim();
      if (v && this.local.labels.indexOf(v) === -1) this.local.labels.push(v);
      this.newLabel = '';
      this.adding = false;
    },
    cancelAdd() { this.newLabel = ''; this.adding = false; },
    removeLabel(l) {
      this.local.labels = this.local.labels.filter((x) => x !== l);
    }
  }
};
</script>

<style scoped>
.okf-step { display: flex; flex-direction: column; gap: var(--space-md); }
.okf-step__title { margin: 0; font-size: var(--text-md); font-weight: 600; }
.okf-step__hint { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.okf-step__chips { display: flex; flex-wrap: wrap; gap: var(--space-sm); align-items: center; }
.okf-step__add {
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--muted);
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-xs);
}
.okf-step__add:hover { color: var(--accent); border-color: var(--accent); }
.okf-step__adder { display: flex; gap: var(--space-sm); align-items: center; }
</style>
