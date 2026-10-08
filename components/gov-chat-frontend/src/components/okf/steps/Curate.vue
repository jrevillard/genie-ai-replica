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

  The "Refresh tags" CTA in this step is the auto-generate entry
  point. Click → POST /api/okf/repos/:id/frontmatter/suggest (the
  LLM-only thin shim from Story 1.7) returns the proposed set →
  the wizard writes the proposed set into the index.md YAML block
  via the existing concept PATCH (which writes through to
  okf_repositories.frontmatter server-side) → the curator sees the
  YAML appear in the editor's center pane and edits from there.
  Same single source of truth, no separate write path.
-->
<template>
  <div class="okf-step-curate2">
    <p class="okf-step-curate2__hint">
      {{
        translate(
          'okf.steps.curate.embedHint',
          'Review and improve each topic: fix the text, set its type and Knowledge-Hierarchy label, add or remove topics. Per-repo tags (topic / entity / forbidden / summary / keyword) live in the index.md YAML frontmatter block below — edit them in the markdown source view. Everything you fix here is what the assistant will cite later.'
        )
      }}
    </p>
    <div v-if="repoId && !readOnly" class="okf-step-curate2__suggest">
      <DsButton
        variant="ghost"
        small
        :disabled="suggesting || readOnly"
        @click="onSuggestTags"
      >
        {{
          suggesting
            ? translate('okf.steps.curate.tagsSuggesting', 'Curating…')
            : translate('okf.steps.curate.tagsRefresh', 'Refresh tags from concept topics')
        }}
      </DsButton>
      <p v-if="suggestionError" class="okf-step-curate2__suggest-error">
        {{ suggestionError }}
      </p>
      <p v-if="lastSuggestion" class="okf-step-curate2__suggest-ok">
        {{
          translate(
            'okf.steps.curate.tagsWritten',
            'Suggested tags written to the index.md YAML block. Review the tags below and edit if needed.'
          )
        }}
      </p>
    </div>
    <OkfRepoEditor
      v-if="repoId"
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
import { mapGetters, mapActions } from 'vuex';
import OkfRepoEditor from '../editor/RepoEditor.vue';
import DsButton from '../../ds/Button.vue';
import translateMixin from '../../../mixins/translateMixin';
import { suggestFrontmatter } from '../../../services/frontmatterService';
import repoOkfService from '../../../services/repoOkfService';
import matter from 'gray-matter';

export default {
  name: 'OkfStepCurate',
  components: { OkfRepoEditor, DsButton },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['gate'],
  data() {
    return {
      suggesting: false,
      suggestionError: null,
      lastSuggestion: null,
      // Bump after a successful Refresh so the embedded editor remounts
      // and reloads the index.md YAML block the wizard just wrote.
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
    ...mapActions('okf', ['patchConcept', 'loadConcept']),
    async onSuggestTags() {
      if (!this.repoId || this.suggesting) return;
      this.suggesting = true;
      this.suggestionError = null;
      this.lastSuggestion = null;
      try {
        // 1. Ask the LLM (via the thin /suggest shim) for the proposed
        //    set. Reads concept-meta (per Story 1.7's concept-only
        //    contract), calls vLLM, returns the proposed set.
        const res = await suggestFrontmatter(this.repoId);
        const suggested = (res && res.suggested) || null;
        if (!suggested) {
          this.suggestionError = this.translate(
            'okf.steps.curate.tagsSuggestEmpty',
            'The LLM returned no tags. Try again after the corpus grows.'
          );
          return;
        }
        // 2. Fetch the current index.md so the new frontmatter block
        //    replaces (not appends to) the existing one. The concept
        //    PATCH writes the full markdown; the server's
        //    patchConceptFields path (Story 1.7) writes the parsed
        //    frontmatter through to okf_repositories.frontmatter
        //    atomically.
        const indexMarkdown = await repoOkfService.getConcept(this.repoId, 'index');
        const next = mergeFrontmatterIntoIndexMarkdown(indexMarkdown, suggested);
        // 3. Persist via the existing concept PATCH (the editor's
        //    normal save path — same one the center pane uses on
        //    every debounced save).
        await this.patchConcept({
          repoId: this.repoId,
          conceptId: 'index',
          markdown: next
        });
        this.lastSuggestion = suggested;
        this.editorReloadKey += 1;
        // 4. The Publish step's gate is a computed read of
        //    okf_repositories.frontmatter — it'll pick up the new
        //    tags on the next render cycle. No explicit gate fire here.
      } catch (e) {
        this.suggestionError =
          (e && e.response && e.response.data && e.response.data.message) ||
          (e && e.message) ||
          'Suggest failed.';
      } finally {
        this.suggesting = false;
      }
    }
  }
};

// Pure helper: replace (or insert) the per-repo `frontmatter:` block
// in the index.md's YAML frontmatter. Preserves the rest of the YAML
// (type / title / labels / links) and the body verbatim. Mirrors the
// YAML block the existing concept PATCH already understands.
function mergeFrontmatterIntoIndexMarkdown(markdown, suggested) {
  // Parse the existing markdown (the raw string from the server
  // already has the YAML frontmatter at the top — gray-matter returns
  // { data, content }).
  const parsed = matter(markdown || '');
  const existing = parsed.data || {};
  // Replace the frontmatter subset that comes from the LLM; preserve
  // everything else.
  const nextFm = {
    ...existing,
    frontmatter: {
      topic: Array.isArray(suggested.topic) ? suggested.topic : [],
      entity: Array.isArray(suggested.entity) ? suggested.entity : [],
      scope: typeof suggested.scope === 'string' ? suggested.scope : '',
      forbidden: Array.isArray(suggested.forbidden) ? suggested.forbidden : [],
      summary: typeof suggested.summary === 'string' ? suggested.summary : '',
      keyword: Array.isArray(suggested.keyword) ? suggested.keyword : []
    }
  };
  // Re-serialize. matter.stringify writes the YAML block + the body
  // with a single '---' separator.
  return matter.stringify(parsed.content || '', nextFm);
}
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
.okf-step-curate2__suggest {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  align-items: flex-start;
}
.okf-step-curate2__suggest-error {
  margin: 0;
  color: var(--danger, var(--error, #b00020));
  font-size: var(--text-xs);
}
.okf-step-curate2__suggest-ok {
  margin: 0;
  color: var(--success, currentColor);
  font-size: var(--text-xs);
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


