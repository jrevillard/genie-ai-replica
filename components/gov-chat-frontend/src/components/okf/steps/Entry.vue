<!-- Step 0: Entry/metadata — name + subject area; creates the repo on advance
     (3.4 Amendment A, A3): the wizard OWNS creation now, idempotently. -->
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
          :disabled="hasRepo"
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
        <DsSelect id="okf-entry-domain" v-model="local.domain" :disabled="hasRepo">
          <option value="">{{ translate('okf.glossary.selectSubjectArea', 'Select a subject area…') }}</option>
          <option v-for="opt in domainOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </DsSelect>
      </DsFormGroup>
    </div>
    <p v-if="hasRepo" class="okf-step__note">
      {{ translate('okf.steps.entry.createdHint', 'Repository created — rename it later from the editor.') }}
    </p>
    <p v-if="createError" class="okf-step__error">{{ createError }}</p>
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
  emits: ['update', 'gate'],
  data() {
    return {
      local: {
        name: (this.draft && this.draft.name) || '',
        // NO hard-coded default (the old 'transport' is dead): an empty value
        // forces an explicit choice via the placeholder option. Domain is
        // IMMUTABLE post-create — whatever this draft carries is what the
        // repo is born with. (createRepo still falls back to 'general' as a
        // safety net if an empty value ever reaches it.)
        domain: (this.draft && this.draft.domain) || ''
      },
      domainOptions: [],
      createError: '',
      creating: false
    };
  },
  computed: {
    hasRepo() {
      return !!(this.draft && this.draft.repo_id);
    },
    // A2 gate contract: the shell's Continue renders THIS. Open when the
    // repo already exists (created here or an existing repo opened), or when
    // both creation inputs are filled.
    canAdvance() {
      if (this.hasRepo) return true;
      return this.local.name.trim().length > 0 && !!this.local.domain;
    }
  },
  watch: {
    'local.name'() {
      this.writeBack();
    },
    'local.domain'() {
      this.writeBack();
    }
  },
  mounted() {
    this.refreshDomainOptions();
    this.emitGate();
  },
  methods: {
    // A1 write-back: selections live in the DRAFT (idempotent re-entry) —
    // the wizard persists on every advance, so re-entering restores them.
    writeBack() {
      this.$emit('update', { name: this.local.name, domain: this.local.domain });
      this.emitGate();
    },
    emitGate() {
      this.$emit('gate', this.canAdvance);
    },
    async refreshDomainOptions() {
      const opts = await okfRepoOps.loadSubjectAreaOptions(this.local.domain ? [this.local.domain] : []);
      this.domainOptions = opts;
    },
    // A3 create-on-advance: the shell awaits this hook BEFORE advancing.
    // Idempotent — a draft with a repo_id (dialog-created, prior advance, or
    // an existing repo opened in the wizard) skips creation entirely.
    async beforeAdvance() {
      if (this.hasRepo) return true;
      if (!this.canAdvance) return false;
      this.creating = true;
      this.createError = '';
      const result = await this.$store.dispatch('okf/createRepo', {
        name: this.local.name.trim(),
        domain: this.local.domain
      });
      this.creating = false;
      if (!result || !result.ok) {
        this.createError =
          result && result.code === 'DUPLICATE_REPO'
            ? this.translate(
                'okf.create.duplicate',
                'A repository with this name already exists - open it from the dashboard or pick another name.'
              )
            : (result && result.message) || this.translate('okf.create.failed', 'Repository creation failed');
        this.emitGate();
        return false; // the shell does NOT advance — the steward fixes the input
      }
      const repo = result.repo;
      // write the minted identity back so the shell + every later step see it
      this.$emit('update', { repo_id: repo.repo_id, name: repo.name, domain: repo.domain });
      return true;
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
