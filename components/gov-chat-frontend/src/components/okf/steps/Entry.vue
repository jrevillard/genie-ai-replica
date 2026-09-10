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
      <DsFormGroup input-id="okf-entry-domain">
        <template #label>
          {{ translate('okf.steps.entry.domainLabel', 'Subject area') }}
          <DsInfoTip
            :text="
              translate(
                'okf.glossary.subjectArea',
                'Where does this knowledge belong? The Subject Area groups your repository and focuses which labels you can choose. It cannot be changed after creation.'
              )
            "
          />
        </template>
        <DsSelect id="okf-entry-domain" v-model="local.domain">
          <option value="">{{ translate('okf.glossary.selectSubjectArea', 'Select a subject area…') }}</option>
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
import DsInfoTip from '../../ds/InfoTip.vue';
import okfRepoOps from '../../../services/okfRepoOps';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepEntry',
  components: { DsFormGroup, DsInput, DsSelect, DsInfoTip },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  data() {
    return {
      local: {
        name: (this.draft && this.draft.name) || '',
        // NO hard-coded default (the old 'transport' is dead): an empty value
        // forces an explicit choice via the placeholder option. Domain is
        // IMMUTABLE post-create — whatever this draft carries is what the
        // repo is born with. (okfRepoOps.createRepo still falls back to
        // 'general' as a safety net if an empty value ever reaches it.)
        domain: (this.draft && this.draft.domain) || ''
      },
      domainOptions: []
    };
  },
  mounted() {
    this.refreshDomainOptions();
  },
  methods: {
    // SUBJECT AREAS follow the Knowledge Hierarchy Categories (David,
    // 2026-09-04: "in the wizard and however else in the editor") — the SAME
    // shared loader the dashboard filter and create dialog use (category
    // level, 'general' only when the tree is unreachable). Passing the
    // draft's domain as a legacy candidate keeps an old draft value
    // selectable: the loader appends it as "X (legacy)" when the KH list
    // doesn't carry it, and never duplicates a KH-listed one.
    async refreshDomainOptions() {
      const opts = await okfRepoOps.loadSubjectAreaOptions(this.local.domain ? [this.local.domain] : []);
      this.domainOptions = opts;
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
.okf-step__fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}
</style>
