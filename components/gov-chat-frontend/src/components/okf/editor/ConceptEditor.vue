<!--
  OkfConceptEditor.vue — Story #978 Studio editor center pane.

  Loads the selected concept's full meta row (frontmatter + body), composes it
  into markdown, and edits it in a DsOkfMarkdownEditor with a Source | Rendered
  toggle (Source default). Save is debounced (1.5s after the last keystroke);
  the Save button forces it. Emits 'saved' with the server result so the
  parent can refresh the row.
-->
<template>
  <div class="okf-ce">
    <div class="okf-ce__toolbar">
      <div class="okf-ce__view-toggle" role="tablist" :aria-label="translate('okf.editor.view', 'Editor view')">
        <DsButton :variant="view === 'source' ? 'primary' : 'secondary'" small @click="view = 'source'">
          {{ translate('okf.editor.view.source', 'Source') }}
        </DsButton>
        <DsButton :variant="view === 'rendered' ? 'primary' : 'secondary'" small @click="view = 'rendered'">
          {{ translate('okf.editor.view.rendered', 'Rendered') }}
        </DsButton>
      </div>

      <span class="okf-ce__path">{{ pathLabel }}</span>

      <span class="okf-ce__save-status" :class="{ 'okf-ce__save-status--dirty': dirty }">
        {{ saveStatusLabel }}
      </span>

      <DsButton variant="primary" small :disabled="readOnly || !dirty || saving" @click="saveNow">
        {{ translate('okf.editor.save', 'Save') }}
      </DsButton>
    </div>

    <p v-if="loadError" class="okf-ce__error">{{ loadError }}</p>
    <div v-else-if="!markdownLoaded" class="okf-ce__loading">
      <DsSpinner size="md" /> {{ translate('okf.editor.loadingConcept', 'Loading concept…') }}
    </div>
    <DsOkfMarkdownEditor
      v-else
      :value="markdown"
      :mode="view === 'rendered' ? 'preview' : 'source'"
      :readonly="view === 'rendered' || readOnly"
      :aria-label="conceptTitle"
      @update:value="onEdit"
    />
  </div>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsButton from '../../ds/Button.vue';
import DsSpinner from '../../ds/Spinner.vue';
import DsOkfMarkdownEditor from '../../ds/OkfMarkdownEditor.vue';

const AUTOSAVE_DEBOUNCE_MS = 1500;

export default {
  name: 'OkfConceptEditor',
  components: { DsButton, DsSpinner, DsOkfMarkdownEditor },
  mixins: [translateMixin],
  props: {
    repoId: { type: String, default: null },
    conceptId: { type: String, default: null },
    // READ ONLY (serving repo): the steward must retract before editing.
    readOnly: { type: Boolean, default: false }
  },
  emits: ['saved'],
  data() {
    return {
      view: 'source', // Source default per the UX design
      markdown: '',
      markdownLoaded: false,
      savedMarkdown: '',
      // The conceptId the current markdown was LOADED for. Saves always
      // target this id — the conceptId watcher fires AFTER props have been
      // updated, so using the prop there would save the OLD markdown under
      // the NEW concept's id (cross-concept clobber).
      loadedConceptId: null,
      loadError: '',
      saving: false,
      lastSavedAt: null,
      saveTimer: null
    };
  },
  computed: {
    dirty() {
      return this.markdown !== this.savedMarkdown;
    },
    conceptTitle() {
      return this.conceptId || '';
    },
    pathLabel() {
      return this.conceptId ? `concepts/${this.conceptId}.md` : '';
    },
    saveStatusLabel() {
      if (this.saving) return this.translate('okf.editor.saving', 'Saving…');
      if (this.dirty) return this.translate('okf.editor.unsaved', 'Unsaved changes');
      if (this.lastSavedAt) return this.translate('okf.editor.saved', 'Saved');
      return '';
    }
  },
  watch: {
    conceptId: {
      immediate: true,
      handler(next, prev) {
        if (next === prev) return;
        this.flushPendingSave();
        this.loadConcept(next);
      }
    }
  },
  beforeUnmount() {
    this.flushPendingSave();
    if (this.saveTimer) clearTimeout(this.saveTimer);
  },
  methods: {
    async loadConcept(conceptId) {
      this.markdownLoaded = false;
      this.loadError = '';
      this.loadedConceptId = null;
      if (!conceptId || !this.repoId) {
        this.markdown = '';
        this.savedMarkdown = '';
        return;
      }
      const result = await this.$store.dispatch('okf/getConcept', { repoId: this.repoId, conceptId });
      if (!result.ok || !result.concept) {
        this.loadError = this.translate('okf.editor.loadFailed', 'Could not load this concept.');
        return;
      }
      const row = result.concept;
      // Compose editable markdown: frontmatter (may be empty) + body.
      const fm = row.frontmatter || {};
      const body = row.body || '';
      let md;
      if (Object.keys(fm).length > 0) {
        md = this.stringifyMarkdown(body, fm);
      } else {
        md = body;
      }
      this.markdown = md;
      this.savedMarkdown = md;
      this.loadedConceptId = conceptId;
      this.markdownLoaded = true;
    },
    stringifyMarkdown(body, frontmatter) {
      // gray-matter round-trip — same serializer the PATCH endpoint parses
      // with (parser-service), so no fidelity loss.
      const matter = require('gray-matter');
      return matter.stringify(body || '', frontmatter || {});
    },
    onEdit(value) {
      this.markdown = value;
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveNow(), AUTOSAVE_DEBOUNCE_MS);
    },
    flushPendingSave() {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      if (this.dirty && !this.saving) this.saveNow();
    },
    async saveNow() {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      // Save against the LOADED concept id — never the (already-updated) prop.
      const conceptId = this.loadedConceptId;
      if (!this.dirty || this.saving || !conceptId || !this.repoId) return;
      this.saving = true;
      try {
        const result = await this.$store.dispatch('okf/patchConcept', {
          repoId: this.repoId,
          conceptId,
          markdown: this.markdown
        });
        if (result && result.ok) {
          this.savedMarkdown = this.markdown;
          this.lastSavedAt = Date.now();
          this.$emit('saved', { conceptId, result });
        }
      } finally {
        this.saving = false;
      }
    }
  }
};
</script>

<style scoped>
.okf-ce {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-width: 0;
  min-height: 0;
}
.okf-ce__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.okf-ce__view-toggle {
  display: inline-flex;
  gap: var(--space-xs);
}
.okf-ce__path {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.okf-ce__save-status {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: nowrap;
}
.okf-ce__save-status--dirty {
  color: var(--warning);
}
.okf-ce__loading,
.okf-ce__error {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--muted);
  padding: var(--space-lg) 0;
  margin: 0;
}
.okf-ce__error {
  color: var(--danger);
}
</style>
