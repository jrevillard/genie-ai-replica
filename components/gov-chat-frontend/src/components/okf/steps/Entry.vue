<!-- Step 0: Entry/metadata — name + subject area. -->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.entry.title', 'Repository name & subject area') }}</h3>
    <p class="okf-step__hint">
      {{ translate('okf.steps.entry.hint', 'Give this OKF repository a clear name and pick its subject area.') }}
    </p>
    <div class="okf-step__fields">
      <DsFormGroup :label="translate('okf.steps.entry.nameLabel', 'Repository name')" input-id="okf-entry-name">
        <DsInput
          id="okf-entry-name"
          v-model="local.name"
          :placeholder="translate('okf.steps.entry.namePh', 'e.g. Transport permits NL')"
        />
      </DsFormGroup>
      <DsFormGroup :label="translate('okf.steps.entry.domainLabel', 'Subject area')" input-id="okf-entry-domain">
        <DsSelect id="okf-entry-domain" v-model="local.domain">
          <option v-for="opt in domainOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </DsSelect>
      </DsFormGroup>
    </div>
  </div>
</template>

<script>
import DsFormGroup from '../../ds/FormGroup.vue';
import DsInput from '../../ds/Input.vue';
import DsSelect from '../../ds/Select.vue';
import translateMixin from '../../../mixins/translateMixin';

const DOMAINS = [
  { value: 'transport', label: 'Transport' },
  { value: 'health', label: 'Health' },
  { value: 'education', label: 'Education' },
  { value: 'social-services', label: 'Social services' },
  { value: 'agriculture', label: 'Agriculture' },
  { value: 'housing', label: 'Housing' },
  { value: 'civil-registry', label: 'Civil registry' }
];

export default {
  name: 'OkfStepEntry',
  components: { DsFormGroup, DsInput, DsSelect },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  data() {
    return {
      local: {
        name: (this.draft && this.draft.name) || '',
        domain: (this.draft && this.draft.domain) || 'transport'
      },
      domainOptions: DOMAINS
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
.okf-step__fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}
</style>
