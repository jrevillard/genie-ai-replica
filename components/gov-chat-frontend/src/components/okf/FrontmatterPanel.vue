<!--
  FrontmatterPanel.vue — Story 1.7 (2026-10-08, simplified) per-repo
  frontmatter chip editor. Used by BOTH the wizard Curate step (as the
  "Tags" sub-card) AND the editor's right meta pane (as a "Repo
  frontmatter" section). One component = one source of truth for the
  per-repo frontmatter UX.

  Model (per David, 2026-10-08):
    - The tags ARE the frontmatter. The curator edits them either here
      (chip UI — add / remove / refresh-suggest from LLM) or directly in
      the index.md YAML center pane. The two views share the same data.
    - No "approve" state. Every value in the frontmatter counts. The
      publish gate reads the frontmatter shape (≥3 topic, ≥1 forbidden)
      directly from the doc field; it does not require a per-row
      approved_at stamp.
    - "Refresh suggestions" → call the LLM, REPLACE the local view with
      the LLM-proposed set. The curator can re-add or remove as they
      refine.
    - "Save tags" → write the current chip set to BOTH the index.md
      YAML (concept PATCH) and the repo doc field (repo PATCH). The
      YAML is the curator-facing view; the doc field is the canonical
      store the retriever + publish gate read.

  Storage target: okf_repositories.frontmatter (Story 1.7, supersedes
  the Story 1.6 dedicated collection). The two-write path is in
  `okf.js:saveFrontmatter`. The server's existing
  `writeFrontmatterToRepoDoc` accepts the same shape; the publish gate
  in `lifecycle-service.js` reads the topic + forbidden counts and
  ignores the absent `_approved` list.

  Props:
    repoId       — the OKF repo (required)
    readOnly     — disable edits + CTAs
    showTitle    — render the heading; default true
    compact      — single-line tag chips, smaller padding

  Events:
    - saved:      — emitted after a successful two-write save
    - error:      — emitted with {phase, error} for parents
    - flush-before-save: emitted BEFORE save so the parent can flush
                   any debounced autosave that would otherwise race
                   the write (the embedded concept editor's 1.5s
                   debounce)
-->
<template>
  <section class="okf-fmp" :class="{ 'is-compact': compact }">
    <header v-if="showTitle" class="okf-fmp__header">
      <h3 class="okf-fmp__title">
        {{ translate('okf.frontmatter.title', 'Frontmatter tags — what this repo is about') }}
      </h3>
      <DsButton variant="ghost" small :disabled="suggesting || readOnly" @click="onSuggestTags">
        {{
          suggesting
            ? translate('okf.frontmatter.suggesting', 'Curating…')
            : translate('okf.frontmatter.refresh', 'Refresh suggestions')
        }}
      </DsButton>
    </header>
    <p v-if="!compact" class="okf-fmp__help">
      {{
        translate(
          'okf.frontmatter.help',
          'Tags describe what this repo contains and — equally important — what it does NOT contain (the forbidden list). They decide which queries route to this repo. Click Refresh to draft from the corpus, or edit the chips below. Publish requires ≥3 topic + ≥1 forbidden.'
        )
      }}
    </p>
    <div class="okf-fmp__fields">
      <div v-for="field in fields" :key="field" class="okf-fmp__field">
        <div class="okf-fmp__field-name">
          {{ fieldLabel(field) }}
          <span class="okf-fmp__field-count">({{ fieldValues(field).length }})</span>
        </div>
        <div class="okf-fmp__values">
          <span v-for="(value, idx) in fieldValues(field)" :key="`${field}:${value}`" class="okf-fmp__tag">
            <button
              v-if="!readOnly"
              class="okf-fmp__tag-remove"
              type="button"
              :aria-label="translate('okf.frontmatter.removeTag', 'Remove tag')"
              :title="translate('okf.frontmatter.removeTag', 'Remove tag')"
              @click="removeValue(field, idx)"
            >
              ×
            </button>
            <span class="okf-fmp__tag-value">{{ value }}</span>
          </span>
          <span v-if="!fieldValues(field).length" class="okf-fmp__empty">
            {{ translate('okf.frontmatter.fieldEmpty', '—') }}
          </span>
        </div>
        <div v-if="!readOnly" class="okf-fmp__add">
          <input
            v-model="addDrafts[field]"
            class="okf-fmp__add-input"
            type="text"
            :placeholder="translate('okf.frontmatter.addPlaceholder', 'Add ' + field)"
            @keydown.enter.prevent="addValue(field)"
          />
          <DsButton
            variant="ghost"
            small
            :disabled="!addDrafts[field] || !addDrafts[field].trim()"
            @click="addValue(field)"
          >
            {{ translate('okf.frontmatter.add', 'Add') }}
          </DsButton>
        </div>
      </div>
    </div>
    <p v-if="suggestionError" class="okf-fmp__error">{{ suggestionError }}</p>
    <p v-if="error" class="okf-fmp__error">{{ error }}</p>
    <footer v-if="!readOnly" class="okf-fmp__footer">
      <DsButton variant="primary" small :disabled="!canSave || saving" @click="onSave">
        {{ saving ? translate('okf.frontmatter.saving', 'Saving…') : translate('okf.frontmatter.save', 'Save tags') }}
      </DsButton>
      <span v-if="savedAt" class="okf-fmp__saved">
        {{ translate('okf.frontmatter.saved', 'Saved') }}
        <span class="okf-fmp__saved-time">{{ formatSavedAt(savedAt) }}</span>
      </span>
    </footer>
  </section>
</template>

<script>
import { mapActions } from 'vuex';
import translateMixin from '../../mixins/translateMixin';
import DsButton from '../ds/Button.vue';
import { getFrontmatter, suggestFrontmatter } from '../../services/frontmatterService';

// Frontmatter shape keys, in display order. The server's
// writeFrontmatterToRepoDoc + lifecycle-service gate read this exact
// shape (see okf-server/services/lifecycle-service.js:625 for the
// topicCount / forbiddenCount read).
const FIELDS = ['topic', 'entity', 'scope', 'forbidden', 'summary', 'keyword'];

// Build an empty shape for the local view.
function emptyShape() {
  return {
    topic: [],
    entity: [],
    scope: '',
    forbidden: [],
    summary: '',
    keyword: []
  };
}

export default {
  name: 'FrontmatterPanel',
  components: { DsButton },
  mixins: [translateMixin],
  props: {
    repoId: { type: String, required: true },
    readOnly: { type: Boolean, default: false },
    showTitle: { type: Boolean, default: true },
    compact: { type: Boolean, default: false }
  },
  emits: ['saved', 'error', 'flush-before-save'],
  data() {
    return {
      fields: FIELDS,
      // Per-field string arrays (topic/entity/forbidden/keyword) and
      // single-value fields (scope/summary). The shape mirrors what
      // gets persisted to the YAML + the doc field.
      shape: emptyShape(),
      addDrafts: { topic: '', entity: '', scope: '', forbidden: '', summary: '', keyword: '' },
      suggesting: false,
      suggestionError: null,
      saving: false,
      error: null,
      savedAt: null
    };
  },
  computed: {
    canSave() {
      // Save is allowed when the shape has any content. We send the
      // whole shape on every save (the server merges it), so the only
      // disable condition is "totally empty" (would clear the gate).
      const s = this.shape;
      return (
        s.topic.length > 0 ||
        s.entity.length > 0 ||
        s.forbidden.length > 0 ||
        s.keyword.length > 0 ||
        (s.scope && s.scope.trim()) ||
        (s.summary && s.summary.trim())
      );
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
  methods: {
    ...mapActions('okf', ['saveFrontmatter']),
    fieldLabel(field) {
      return this.translate(`okf.frontmatter.field.${field}`, field);
    },
    fieldValues(field) {
      if (field === 'scope' || field === 'summary') {
        return this.shape[field] ? [this.shape[field]] : [];
      }
      return Array.isArray(this.shape[field]) ? this.shape[field] : [];
    },
    async loadFrontmatter() {
      this.error = null;
      try {
        const res = await getFrontmatter(this.repoId);
        // getFrontmatter returns { frontmatter: [ {field, value} ... ] }.
        // Flatten into the shape. Approved-agnostic — the value is in
        // the frontmatter, that's all we need.
        const next = emptyShape();
        const rows = (res && res.frontmatter) || [];
        for (const r of rows) {
          if (!r || !r.field) continue;
          if (r.field === 'scope' || r.field === 'summary') {
            next[r.field] = r.value || '';
          } else if (Array.isArray(next[r.field])) {
            next[r.field].push(r.value);
          }
        }
        this.shape = next;
        this.savedAt = null;
      } catch (e) {
        this.shape = emptyShape();
        this.error = (e && e.message) || 'Failed to load frontmatter.';
        this.$emit('error', { phase: 'load', error: e });
      }
    },
    addValue(field) {
      const raw = (this.addDrafts[field] || '').trim();
      if (!raw) return;
      if (field === 'scope' || field === 'summary') {
        this.shape[field] = raw;
      } else {
        if (this.shape[field].some((v) => v.toLowerCase() === raw.toLowerCase())) return;
        this.shape[field] = [...this.shape[field], raw];
      }
      this.addDrafts[field] = '';
      this.savedAt = null;
    },
    removeValue(field, idx) {
      if (field === 'scope' || field === 'summary') {
        this.shape[field] = '';
      } else {
        this.shape[field] = this.shape[field].filter((_, i) => i !== idx);
      }
      this.savedAt = null;
    },
    async onSuggestTags() {
      this.suggesting = true;
      this.suggestionError = null;
      try {
        const res = await suggestFrontmatter(this.repoId);
        const suggested = (res && res.suggested) || null;
        if (!suggested) {
          this.suggestionError = this.translate(
            'okf.frontmatter.suggestEmpty',
            'The LLM returned no tags. Try again after the corpus grows.'
          );
          return;
        }
        // REPLACE the local view with the LLM-suggested set (per
        // 2026-10-08 directive — the curator can re-add or remove).
        this.shape = {
          topic: Array.isArray(suggested.topic) ? suggested.topic.slice() : [],
          entity: Array.isArray(suggested.entity) ? suggested.entity.slice() : [],
          scope: typeof suggested.scope === 'string' ? suggested.scope : '',
          forbidden: Array.isArray(suggested.forbidden) ? suggested.forbidden.slice() : [],
          summary: typeof suggested.summary === 'string' ? suggested.summary : '',
          keyword: Array.isArray(suggested.keyword) ? suggested.keyword.slice() : []
        };
        this.savedAt = null;
      } catch (e) {
        this.suggestionError =
          (e && e.response && e.response.data && e.response.data.message) || (e && e.message) || 'Suggest failed.';
        this.$emit('error', { phase: 'suggest', error: e });
      } finally {
        this.suggesting = false;
      }
    },
    async onSave() {
      if (!this.canSave) return;
      // Race-condition guard: ask the parent to flush any debounced
      // autosave before the two-write save. The parent forwards to
      // the embedded concept editor's flushPendingSave(). If no
      // parent listens, the emit is a no-op.
      this.$emit('flush-before-save');
      this.saving = true;
      this.error = null;
      try {
        const res = await this.saveFrontmatter({ repoId: this.repoId, shape: this.shape });
        if (!res || !res.ok) {
          const step = (res && res.step) || 'unknown';
          const code = (res && res.code) || 'SAVE_FAILED';
          this.error = this.translate(
            'okf.frontmatter.errorWithStep',
            `Save failed at step "${step}" (${code}) — retry.`
          );
          this.$emit('error', { phase: 'patch', error: res });
          return;
        }
        this.savedAt = new Date();
        this.$emit('saved', res);
        await this.loadFrontmatter();
      } catch (e) {
        const r = e && e.response && e.response.data;
        const msg = (r && (r.message || r.error || (r.error && r.error.message))) || (e && e.message) || 'Save failed.';
        this.error = typeof msg === 'string' ? msg : JSON.stringify(msg);
        this.$emit('error', { phase: 'patch', error: e });
      } finally {
        this.saving = false;
      }
    },
    formatSavedAt(d) {
      if (!d) return '';
      try {
        return d.toLocaleTimeString();
      } catch {
        return '';
      }
    }
  }
};
</script>

<style scoped>
.okf-fmp {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-md);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
}
.okf-fmp__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}
.okf-fmp__title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
}
.okf-fmp__help {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.okf-fmp__fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.okf-fmp__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-fmp__field-name {
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-muted);
}
.okf-fmp__field-count {
  color: var(--color-text-faint);
  font-weight: var(--font-weight-regular);
}
.okf-fmp__values {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
.okf-fmp__tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: 2px var(--space-xs);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  border: 1px solid var(--color-border);
  background: var(--color-surface-base);
}
.okf-fmp__tag-value {
  color: var(--color-text);
}
.okf-fmp__tag-remove {
  appearance: none;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  padding: 0 2px;
}
.okf-fmp__empty {
  color: var(--color-text-faint);
  font-size: var(--text-xs);
}
.okf-fmp__add {
  display: flex;
  gap: var(--space-xs);
}
.okf-fmp__add-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 2px var(--space-xs);
  font-size: var(--text-xs);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-base);
}
.okf-fmp__error {
  margin: 0;
  color: var(--color-danger, currentColor);
  font-size: var(--text-xs);
}
.okf-fmp__footer {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
.okf-fmp__saved {
  color: var(--color-success, currentColor);
  font-size: var(--text-xs);
}
.okf-fmp__saved-time {
  color: var(--color-text-faint);
  margin-left: var(--space-2xs);
}
.okf-fmp.is-compact {
  padding: var(--space-sm);
  gap: var(--space-sm);
}
.okf-fmp.is-compact .okf-fmp__title {
  font-size: var(--text-xs);
}
</style>
