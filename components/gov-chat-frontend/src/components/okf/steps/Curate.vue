<!--
  OkfStepCurate.vue — Amendment A slice 2 (B4+B3): the FULL editor embedded.
  Functional equivalence with the OKF editor by COMPOSITION (the Studio §3
  rule): the three-pane OkfRepoEditor carries concept list, body+frontmatter
  editing with debounced save, KH label metadata, add/delete/resplit and the
  autocorrect modal — the wizard wraps it in the friendlier guided frame
  (narrative hint, Basic-mode default, live context rail) and owns the gate.

  Story 1.7 (2026-10-08, supersedes the Story 1.6 dedicated
  collection): the per-repo frontmatter lives in the OKF repo's
  index.md YAML frontmatter block, in the editor's center pane
  (the same place the curator edits every other concept's
  per-file frontmatter). The wizard's Curate step embeds the full
  editor; the curator edits the index.md YAML directly. No
  separate panel — the new design is "one frontmatter, in one
  place" (David 2026-10-08: "the user should be able to modify
  the tags in the existing frontmatter editor").

  The chip UI is now mounted via <FrontmatterPanel> at the top of
  the step (above the embedded editor). The panel owns the
  Refresh / Approve all / Save tags CTAs. The save path is the
  two-write flow: (1) PATCH the index concept with the new YAML
  (writes the index.md on disk), (2) PATCH the repo doc with the
  frontmatter field (writes okf_repositories.frontmatter so the
  retriever + Publish gate see the new tags). The panel flushes
  the editor's debounced autosave before saving (race-condition
  guard per the Story 1.7 audit).
-->
<template>
  <div class="okf-step-curate2">
    <p class="okf-step-curate2__hint">
      {{
        translate(
          'okf.steps.curate.embedHint',
          'Review and improve each topic: fix the text, set its type and Knowledge-Hierarchy label, add or remove topics. Per-repo tags (topic / entity / forbidden / summary / keyword) live in the index.md YAML frontmatter block below — edit them in the chip UI or the markdown source view. Everything you fix here is what the assistant will cite later.'
        )
      }}
    </p>
    <FrontmatterPanel
      v-if="repoId"
      :repo-id="repoId"
      :read-only="readOnly"
      :show-title="true"
      :compact="false"
      @saved="onPanelSaved"
      @flush-before-save="flushEmbeddedEditorSave"
    />
    <OkfRepoEditor
      v-if="repoId"
      ref="repoEditor"
      :key="repoId + ':' + editorReloadKey"
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
import FrontmatterPanel from '../FrontmatterPanel.vue';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepCurate',
  components: { OkfRepoEditor, FrontmatterPanel },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['gate'],
  data() {
    return {
      // Bump after a successful Save so the embedded editor remounts
      // and reloads the index.md YAML block the panel just wrote.
      editorReloadKey: 0
    };
  },
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
  },
  methods: {
    onPanelSaved() {
      // The panel wrote the index.md YAML AND okf_repositories.frontmatter.
      // Remount the embedded editor so the center pane re-reads the
      // freshly-saved YAML on the next render cycle.
      this.editorReloadKey += 1;
    },
    flushEmbeddedEditorSave() {
      // Race-condition guard (per the post-Story-1.7 audit): the embedded
      // editor's debounced autosave (1.5s) can overwrite our just-saved
      // YAML if the curator was typing in the center pane when Save was
      // clicked. Forward the panel's `flush-before-save` event to the
      // editor, which forwards to the concept editor's flushPendingSave().
      const ed = this.$refs.repoEditor;
      if (ed && typeof ed.flushPendingSave === 'function') ed.flushPendingSave();
    }
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
