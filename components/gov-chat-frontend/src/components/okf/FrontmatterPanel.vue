<!--
  FrontmatterPanel.vue — Story 1.6 (2026-10-08) shared per-repo frontmatter
  surface. Used by BOTH the wizard Curate step (as the "Tags" sub-card) AND
  the editor's right meta pane (as a "Repo frontmatter" section). One
  component = one source of truth for the per-repo frontmatter UX (per
  David's 2026-10-08 directive: "this must be consistent across the wizard
  and the editor").

  Responsibilities:
    - Load the current rows via getFrontmatter(repoId)
    - "Refresh suggestions" CTA → suggestFrontmatter(repoId), mirror the
      LLM-proposed set into the local view as unapproved rows
    - Edit per-field (add/remove values inline) — the wizard's gate stays
      gated on approved rows, the editor is the persistent surface for
      committing changes via patchFrontmatter on save
    - "Save" CTA → patchFrontmatter(repoId, rows) → server re-embeds via TEI
    - "Approve all" CTA → marks every row approved (no re-embed; the LLM
      tags become curator-approved)

  Props:
    repoId       — the OKF repo (required)
    readOnly     — disable edits + CTAs (used by the wizard's read-only
                   pre-publish state and by the editor's role-gated read
                   view)
    showTitle    — render the heading; default true (wizard wants it, the
                   editor puts it inside a section header)
    compact      — single-line tag chips, smaller padding (editor right rail)

  Events:
    - gate:       — emitted with `true` when at least 3 topic + 1 forbidden
                   rows are approved; `false` otherwise. The wizard's Curate
                   step forwards this to its parent step.
    - saved:      — emitted after a successful patchFrontmatter with the
                   summary row from the server.
    - error:      — emitted with {phase: 'load'|'suggest'|'patch', error}
                   for parents that want to surface a banner.
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
          'Tags describe what this repo contains and — equally important — what it does NOT contain (the forbidden list). They decide which queries route to this repo. The LLM proposes from a chunk sample; review and approve before Publish.'
        )
      }}
    </p>
    <div v-if="rows.length" class="okf-fmp__fields">
      <div v-for="field in fields" :key="field" class="okf-fmp__field">
        <div class="okf-fmp__field-name">
          {{ fieldLabel(field) }}
          <span class="okf-fmp__field-count">({{ fieldRows(field).length }})</span>
        </div>
        <div class="okf-fmp__values">
          <span
            v-for="row in fieldRows(field)"
            :key="row._key"
            class="okf-fmp__tag"
            :class="row.approved_at ? 'is-approved' : 'is-unapproved'"
          >
            <input
              v-if="!readOnly"
              class="okf-fmp__tag-remove"
              type="button"
              :aria-label="translate('okf.frontmatter.removeTag', 'Remove tag')"
              :title="translate('okf.frontmatter.removeTag', 'Remove tag')"
              value="×"
              @click="removeRow(row)"
            />
            <span class="okf-fmp__tag-value">{{ row.value }}</span>
            <button
              v-if="!row.approved_at && !readOnly"
              class="okf-fmp__tag-approve"
              type="button"
              :aria-label="translate('okf.frontmatter.approveTag', 'Approve tag')"
              :title="translate('okf.frontmatter.approveTag', 'Approve tag')"
              @click="approveRow(row)"
            >
              ✓
            </button>
          </span>
          <span v-if="!fieldRows(field).length" class="okf-fmp__empty">
            {{ translate('okf.frontmatter.fieldEmpty', '—') }}
          </span>
        </div>
        <div v-if="!readOnly" class="okf-fmp__add">
          <input
            class="okf-fmp__add-input"
            type="text"
            v-model="addDrafts[field]"
            :placeholder="translate('okf.frontmatter.addPlaceholder', 'Add ' + field)"
            @keydown.enter.prevent="addRow(field)"
          />
          <DsButton
            variant="ghost"
            small
            :disabled="!addDrafts[field] || !addDrafts[field].trim()"
            @click="addRow(field)"
          >
            {{ translate('okf.frontmatter.add', 'Add') }}
          </DsButton>
        </div>
      </div>
    </div>
    <p v-else class="okf-fmp__empty-all">
      {{
        translate(
          'okf.frontmatter.none',
          'No tags yet. The LLM will draft them when you click Refresh suggestions.'
        )
      }}
    </p>
    <p v-if="suggestionError" class="okf-fmp__error">{{ suggestionError }}</p>
    <p v-if="error" class="okf-fmp__error">{{ error }}</p>
    <footer v-if="!readOnly" class="okf-fmp__footer">
      <DsButton variant="primary" small :disabled="!canSave || saving" @click="onSave">
        {{
          saving
            ? translate('okf.frontmatter.saving', 'Saving…')
            : translate('okf.frontmatter.save', 'Save tags')
        }}
      </DsButton>
      <DsButton variant="ghost" small :disabled="!hasUnapproved || saving" @click="approveAll">
        {{ translate('okf.frontmatter.approveAll', 'Approve all') }}
      </DsButton>
      <span v-if="savedAt" class="okf-fmp__saved">
        {{ translate('okf.frontmatter.saved', 'Saved') }}
        <span class="okf-fmp__saved-time">{{ formatSavedAt(savedAt) }}</span>
      </span>
    </footer>
  </section>
</template>

<script>
import translateMixin from '../../mixins/translateMixin';
import DsButton from '../ds/Button.vue';
import {
  getFrontmatter,
  suggestFrontmatter,
  patchFrontmatter
} from '../../services/frontmatterService';

const FIELDS = ['topic', 'entity', 'scope', 'forbidden', 'summary', 'keyword'];

// Local row shape (matches the server payload closely, plus a stable
// client-side _key for the v-for + addRow/removeRow identity). On save
// the component flattens these into the {topic:[], entity:[], ...} shape
// the PATCH endpoint expects.
let _localKeyCounter = 0;
function nextLocalKey() {
  _localKeyCounter += 1;
  return `local-${Date.now()}-${_localKeyCounter}`;
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
  emits: ['gate', 'saved', 'error'],
  data() {
    return {
      fields: FIELDS,
      rows: [],
      // The LLM-suggested set, kept separate so the user can decide
      // what to keep / what to drop without a server roundtrip.
      addDrafts: { topic: '', entity: '', scope: '', forbidden: '', summary: '', keyword: '' },
      suggesting: false,
      suggestionError: null,
      saving: false,
      error: null,
      savedAt: null
    };
  },
  computed: {
    hasUnapproved() {
      return this.rows.some((r) => !r.approved_at);
    },
    canSave() {
      // Save is allowed when there's any change to persist. We send the
      // whole shape on every save (the server merges it), so the only
      // disable condition is "no rows at all" (would clear the gate).
      return this.rows.length > 0;
    }
  },
  watch: {
    repoId: {
      immediate: true,
      handler(id) {
        if (id) this.loadFrontmatter();
      }
    },
    rows: {
      handler() {
        this.emitGate();
      },
      deep: true
    }
  },
  mounted() {
    this.emitGate();
  },
  methods: {
    fieldLabel(field) {
      return this.translate(`okf.frontmatter.field.${field}`, field);
    },
    fieldRows(field) {
      return this.rows.filter((r) => r.field === field);
    },
    async loadFrontmatter() {
      this.error = null;
      try {
        const res = await getFrontmatter(this.repoId);
        this.rows = Array.isArray(res && res.frontmatter) ? res.frontmatter : [];
        this.savedAt = null;
      } catch (e) {
        this.rows = [];
        this.error = (e && e.message) || 'Failed to load frontmatter.';
        this.$emit('error', { phase: 'load', error: e });
      }
    },
    addRow(field) {
      const raw = (this.addDrafts[field] || '').trim();
      if (!raw) return;
      this.rows.push({
        _key: nextLocalKey(),
        field,
        value: raw,
        approved_at: null,
        approved_by: null
      });
      this.addDrafts[field] = '';
      this.savedAt = null;
    },
    removeRow(row) {
      this.rows = this.rows.filter((r) => r._key !== row._key);
      this.savedAt = null;
    },
    approveRow(row) {
      const idx = this.rows.findIndex((r) => r._key === row._key);
      if (idx === -1) return;
      this.rows.splice(idx, 1, { ...row, approved_at: new Date().toISOString() });
      this.savedAt = null;
    },
    approveAll() {
      const now = new Date().toISOString();
      this.rows = this.rows.map((r) => (r.approved_at ? r : { ...r, approved_at: now }));
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
        // Merge: keep existing approved rows, add new unapproved rows for
        // each LLM-proposed value that isn't already present.
        this.rows = mergeSuggested(this.rows, suggested, FIELDS);
        this.savedAt = null;
      } catch (e) {
        this.suggestionError =
          (e && e.response && e.response.data && e.response.data.message) ||
          (e && e.message) ||
          'Suggest failed.';
        this.$emit('error', { phase: 'suggest', error: e });
      } finally {
        this.suggesting = false;
      }
    },
    async onSave() {
      if (!this.canSave) return;
      this.saving = true;
      this.error = null;
      try {
        const shape = rowsToShape(this.rows);
        const res = await patchFrontmatter(this.repoId, shape);
        this.savedAt = new Date();
        this.$emit('saved', res);
        // Reload so the local view reflects server-assigned _keys +
        // approved_at timestamps (the gate is "approved" not "in local
        // memory approved" — server is source of truth).
        await this.loadFrontmatter();
      } catch (e) {
        this.error =
          (e && e.response && e.response.data && e.response.data.message) ||
          (e && e.message) ||
          'Save failed.';
        this.$emit('error', { phase: 'patch', error: e });
      } finally {
        this.saving = false;
      }
    },
    emitGate() {
      // Gate: at least 3 topic + 1 forbidden + every row approved.
      let topic = 0;
      let forbidden = 0;
      for (const r of this.rows) {
        if (!r.approved_at) {
          this.$emit('gate', false);
          return;
        }
        if (r.field === 'topic') topic += 1;
        else if (r.field === 'forbidden') forbidden += 1;
      }
      this.$emit('gate', topic >= 3 && forbidden >= 1);
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

// Pure helper: take existing rows + LLM-suggested shape → merged row list.
// Keeps existing approved rows untouched; adds LLM-suggested values as
// new unapproved rows (case-insensitive dedupe).
function mergeSuggested(existingRows, suggested, fields) {
  const merged = existingRows.slice();
  const existingByFieldValue = new Map();
  for (const r of merged) {
    existingByFieldValue.set(`${r.field}::${String(r.value).toLowerCase()}`, true);
  }
  for (const field of fields) {
    const values = suggested[field];
    if (!Array.isArray(values)) continue;
    for (const v of values) {
      const s = String(v || '').trim();
      if (!s) continue;
      const k = `${field}::${s.toLowerCase()}`;
      if (existingByFieldValue.has(k)) continue;
      merged.push({
        _key: nextLocalKey(),
        field,
        value: s,
        approved_at: null,
        approved_by: null
      });
      existingByFieldValue.set(k, true);
    }
  }
  return merged;
}

// Pure helper: row list → server payload shape. scope + summary are
// single values; the rest are arrays.
function rowsToShape(rows) {
  const out = { topic: [], entity: [], scope: '', forbidden: [], summary: '', keyword: [] };
  for (const r of rows) {
    const v = String(r.value || '').trim();
    if (!v) continue;
    if (r.field === 'scope') {
      out.scope = v;
    } else if (r.field === 'summary') {
      out.summary = v;
    } else if (Array.isArray(out[r.field])) {
      out[r.field].push(v);
    }
  }
  return out;
}
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
.okf-fmp__tag.is-approved {
  border-color: var(--color-success-border, var(--color-success));
  background: var(--color-success-bg, var(--color-surface-success));
}
.okf-fmp__tag.is-unapproved {
  border-style: dashed;
  color: var(--color-text-muted);
}
.okf-fmp__tag-remove,
.okf-fmp__tag-approve {
  appearance: none;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  padding: 0 2px;
}
.okf-fmp__tag-approve {
  color: var(--color-success, currentColor);
}
.okf-fmp__empty,
.okf-fmp__empty-all {
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
