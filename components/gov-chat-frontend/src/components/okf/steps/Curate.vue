<!--
  OkfStepCurate.vue — Amendment A slice 2 (B4+B3): the FULL editor embedded.
  Functional equivalence with the OKF editor by COMPOSITION (the Studio §3
  rule): the three-pane OkfRepoEditor carries concept list, body+frontmatter
  editing with debounced save, KH label metadata, add/delete/resplit and the
  autocorrect modal — the wizard wraps it in the friendlier guided frame
  (narrative hint, Basic-mode default, live context rail) and owns the gate.

  Story 1.6 (2026-10-07) — frontmatter "Tags" sub-card: shows the current
  curated tag set (topic / entity / scope / forbidden / summary / keyword)
  and a "Refresh suggestions" CTA that calls okf-server's
  POST /api/okf/repos/:id/frontmatter/suggest. The suggested set is shown
  read-only with approve / reject affordances — the wizard's Publish step
  is what carries the saved set through to the lifecycle publishFrontmatter
  hook (lifecycle-service.js → 409 FRONTMATTER_REQUIRED gate).
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
    <div v-if="repoId" class="okf-step-curate2__tags-card">
      <header class="okf-step-curate2__tags-header">
        <h3 class="okf-step-curate2__tags-title">
          {{ translate('okf.steps.curate.tagsTitle', 'Frontmatter tags — what this repo is about') }}
        </h3>
        <DsButton variant="ghost" small :disabled="suggesting || readOnly" @click="onSuggestTags">
          {{
            suggesting
              ? translate('okf.steps.curate.tagsSuggesting', 'Curating…')
              : translate('okf.steps.curate.tagsRefresh', 'Refresh suggestions')
          }}
        </DsButton>
      </header>
      <p class="okf-step-curate2__tags-help">
        {{
          translate(
            'okf.steps.curate.tagsHelp',
            'Tags describe what this repo contains and — equally important — what it does NOT contain (the forbidden list). They decide which queries route to this repo. The LLM proposes from a chunk sample; review and approve before Publish.'
          )
        }}
      </p>
      <div v-if="frontmatter.length" class="okf-step-curate2__tags-list">
        <div v-for="field in fields" :key="field" class="okf-step-curate2__tags-field">
          <div class="okf-step-curate2__tags-field-name">
            {{ fieldLabel(field) }}
            <span class="okf-step-curate2__tags-field-count">({{ fieldValues(field).length }})</span>
          </div>
          <div class="okf-step-curate2__tags-values">
            <span
              v-for="row in fieldValues(field)"
              :key="row._key"
              class="okf-step-curate2__tag"
              :class="row.approved_at ? 'is-approved' : 'is-unapproved'"
            >
              {{ row.value }}
            </span>
            <span v-if="!fieldValues(field).length" class="okf-step-curate2__tags-empty">
              {{ translate('okf.steps.curate.tagsFieldEmpty', '—') }}
            </span>
          </div>
        </div>
      </div>
      <p v-else class="okf-step-curate2__tags-empty">
        {{
          translate(
            'okf.steps.curate.tagsNone',
            'No tags yet. The LLM will draft them when you click Refresh suggestions.'
          )
        }}
      </p>
      <p v-if="suggestionError" class="okf-step-curate2__tags-error">
        {{ suggestionError }}
      </p>
    </div>
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
import DsButton from '../../ds/Button.vue';
import { getFrontmatter, suggestFrontmatter } from '../../../services/frontmatterService';

const FIELDS = ['topic', 'entity', 'scope', 'forbidden', 'summary', 'keyword'];

export default {
  name: 'OkfStepCurate',
  components: { OkfRepoEditor, DsButton },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['gate'],
  data() {
    return {
      fields: FIELDS,
      frontmatter: [],
      suggesting: false,
      suggestionError: null
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
  watch: {
    repoId: {
      immediate: true,
      handler(id) {
        if (id) this.loadFrontmatter();
      }
    }
  },
  mounted() {
    // A2 gate: Curate never blocks the flow — validation reports whatever is
    // still wrong (dead-end-free UX); the editor carries the real work.
    this.$emit('gate', true);
  },
  methods: {
    async loadFrontmatter() {
      try {
        const res = await getFrontmatter(this.repoId);
        this.frontmatter = (res && res.frontmatter) || [];
      } catch {
        this.frontmatter = [];
      }
    },
    fieldLabel(field) {
      return this.translate(`okf.steps.curate.tagsField.${field}`, field);
    },
    fieldValues(field) {
      return this.frontmatter.filter((row) => row.field === field);
    },
    async onSuggestTags() {
      this.suggesting = true;
      this.suggestionError = null;
      try {
        // The wizard's Curate step is READ-ONLY with respect to the suggested
        // set — the curator's job is to see what the LLM proposes and then
        // either accept (the wizard emits it through the lifecycle publish
        // hook in Publish.vue) or reject (the curator refines manually via
        // the editor pane, which is the persistent surface). The suggested
        // set here is just an indicator; we do NOT write back yet.
        const res = await suggestFrontmatter(this.repoId);
        const suggested = (res && res.suggested) || null;
        if (!suggested) {
          this.suggestionError = this.translate(
            'okf.steps.curate.tagsSuggestEmpty',
            'The LLM returned no tags. Try again after the corpus grows.'
          );
        } else {
          // Mirror the suggested shape into the local frontmatter view as
          // unapproved rows (so the curator sees the count + a flag that
          // they are LLM-suggested, not yet saved). The Publish gate will
          // refuse to proceed unless the rows are persisted via the editor
          // or via the lifecycle hook.
          const rows = [];
          for (const field of FIELDS) {
            const values = Array.isArray(suggested[field])
              ? suggested[field]
              : field === 'summary' || field === 'scope'
                ? [suggested[field]]
                : [];
            for (const value of values) {
              if (!value) continue;
              rows.push({
                _key: `suggested:${field}:${value}`,
                field,
                value,
                approved_at: null
              });
            }
          }
          this.frontmatter = rows;
        }
      } catch (e) {
        this.suggestionError = (e && e.message) || 'Suggest failed.';
      } finally {
        this.suggesting = false;
      }
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
.okf-step-curate2__tags-card {
  border: 1px solid var(--border, var(--divider));
  border-radius: 8px;
  padding: var(--space-md);
  background: var(--surface-muted, var(--surface-alt, transparent));
}
.okf-step-curate2__tags-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}
.okf-step-curate2__tags-title {
  margin: 0;
  font-size: var(--text-md);
}
.okf-step-curate2__tags-help {
  margin: var(--space-xs) 0 var(--space-sm);
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step-curate2__tags-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-step-curate2__tags-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.okf-step-curate2__tags-field-name {
  font-weight: 600;
  font-size: var(--text-sm);
}
.okf-step-curate2__tags-field-count {
  color: var(--muted);
  font-weight: 400;
  margin-left: 4px;
}
.okf-step-curate2__tags-values {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.okf-step-curate2__tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface, var(--background));
  border: 1px solid var(--border, var(--divider));
  font-size: var(--text-xs);
}
.okf-step-curate2__tag.is-unapproved {
  border-style: dashed;
  color: var(--muted);
}
.okf-step-curate2__tags-empty,
.okf-step-curate2__tags-error {
  margin: var(--space-xs) 0 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step-curate2__tags-error {
  color: var(--danger, var(--error, #b00020));
}
</style>
