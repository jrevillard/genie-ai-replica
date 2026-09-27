<!--
  OkfStepCurate.vue — Amendment A slice 2 (B4+B3): the FULL editor embedded.
  Functional equivalence with the OKF editor by COMPOSITION (the Studio §3
  rule): the three-pane OkfRepoEditor carries concept list, body+frontmatter
  editing with debounced save, KH label metadata, add/delete/resplit and the
  autocorrect modal — the wizard wraps it in the friendlier guided frame
  (narrative hint, Basic-mode default, live context rail) and owns the gate.
-->
<template>
  <div class="okf-step-curate2">
    <p class="okf-step-curate2__hint">
      {{
        translate(
          'okf.steps.curate.embedHint',
          'Review and improve each topic: fix the text, set its type and Knowledge-Hierarchy label, add or remove topics. Everything you fix here is what the assistant will cite later.'
        )
      }}
    </p>
    <OkfRepoEditor
      v-if="repoId"
      :key="repoId"
      class="okf-step-curate2__editor"
      :repo-id="repoId"
      :source-file-id="sourceFileId"
      :read-only="readOnly"
    />
    <p v-else class="okf-step-curate2__empty">
      {{ translate('okf.steps.curate.noRepo', 'No repository yet — go back to Entry and create or choose one first.') }}
    </p>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import OkfRepoEditor from '../editor/RepoEditor.vue';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepCurate',
  components: { OkfRepoEditor },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['gate'],
  computed: {
    ...mapGetters('okf', ['repoById']),
    repoId() {
      return (this.draft && this.draft.repo_id) || '';
    },
    sourceFileId() {
      return (this.draft && this.draft.source_file_id) || null;
    },
    // READ ONLY (David, 2026-08-30): a serving repo is frozen — the editor
    // disables mutations itself; the wizard surfaces the same state.
    readOnly() {
      const repo = this.repoId && this.repoById(this.repoId);
      return !!(repo && repo.ingested_at);
    }
  },
  mounted() {
    // A2 gate: Curate never blocks the flow — validation reports whatever is
    // still wrong (dead-end-free UX); the editor carries the real work.
    this.$emit('gate', true);
  }
};
</script>

<style scoped>
.okf-step-curate2 {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-height: 480px;
}
.okf-step-curate2__hint {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step-curate2__editor {
  flex: 1 1 auto;
}
.okf-step-curate2__empty {
  color: var(--muted);
  padding: var(--space-xl);
  text-align: center;
}
</style>
