<!--
  OkfStepAutocorrect — 3.10 T4 (E7.1): the step is REAL now. The full
  autocorrect stack already existed (backend POST /:repo_id/autocorrect
  with dry_run propose/apply + the editor's AutocorrectPanel) — the step
  just never wired it and shipped placeholder text instead. The panel is
  EMBEDDED (A9: inline mode — the original always-open MODAL had no close
  handler, so Cancel/✕ were dead and the overlay walled off the wizard);
  after applying, the steward is pointed back to Curate.
-->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.autocorrect.title', 'Auto-fix') }}</h3>
    <p class="okf-step__hint">
      {{
        translate(
          'okf.steps.autocorrect.hint',
          'Some issues can be fixed automatically — review the proposals and apply the ones you agree with.'
        )
      }}
      <DsInfoTip
        :text="
          translate(
            'okf.glossary.autocorrect',
            'Auto-fix only touches frontmatter (titles, types, structure) — never your written content. Proposals are shown before anything changes; applying writes the fixes immediately and you can review the result in Curate.'
          )
        "
      />
    </p>
    <p v-if="!repoId" class="okf-step__note">
      {{ translate('okf.steps.autocorrect.noRepo', 'No repository yet — go back to Entry and create one first.') }}
    </p>
    <p v-else-if="applied" class="okf-step__note">
      {{
        translate(
          'okf.steps.autocorrect.applied',
          'Fixes applied — continue, or go back to Curate to review the result.'
        )
      }}
    </p>
    <OkfAutocorrectPanel :visible="!!repoId" inline :repo-id="repoId" @applied="onApplied" />
  </div>
</template>

<script>
import DsInfoTip from '../../ds/InfoTip.vue';
import OkfAutocorrectPanel from '../editor/AutocorrectPanel.vue';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepAutocorrect',
  components: { DsInfoTip, OkfAutocorrectPanel },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['gate'],
  data() {
    return { applied: false };
  },
  computed: {
    repoId() {
      return (this.draft && this.draft.repo_id) || '';
    }
  },
  mounted() {
    // A2: the step never blocks — proposals may be empty; applying is
    // optional. Dead-end-free.
    this.$emit('gate', true);
  },
  methods: {
    onApplied() {
      this.applied = true;
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
.okf-step__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
</style>
