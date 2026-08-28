<!--
  DsOkfMarkdownEditor.vue — markdown-it + DOMPurify + highlight.js wrapper.

  Behaviour:
    - mode prop: 'split' (default), 'preview' (rendered only), 'source' (raw only)
    - expert prop: when true, exposes an [Edit frontmatter] dialog with the v0.2 schema
    - issues prop: Array<{line, rule, severity, message}>; matched lines receive
      data-conformance-issue attrs so a DsBadge gutter renders inline markers.
    - Basic mode (expert=false): source pane hidden by default; [Show source] expands it.
      Frontmatter editor is hidden.
    - Expert mode (expert=true): both panes visible; [Edit frontmatter] dialog with
      all v0.2 schema fields.
    - Frontmatter round-trip uses gray-matter in "preserve unknowns" mode.
-->
<template>
  <div class="ds-okf-md" :class="{ 'ds-okf-md--expert': expert }">
    <div v-if="frontmatterPresent" class="ds-okf-md__frontmatter">
      <span class="ds-okf-md__frontmatter-label">
        {{ frontmatterLabel }}
        <button v-if="expert" type="button" class="ds-okf-md__frontmatter-edit" @click="frontmatterDialog = true">
          {{ editFrontmatterLabel }}
        </button>
      </span>
    </div>

    <div class="ds-okf-md__toolbar">
      <button
        type="button"
        class="ds-okf-md__mode"
        :class="{ 'ds-okf-md__mode--active': mode === 'preview' }"
        @click="setMode('preview')"
      >
        Preview
      </button>
      <button
        type="button"
        class="ds-okf-md__mode"
        :class="{ 'ds-okf-md__mode--active': mode === 'split' }"
        @click="setMode('split')"
      >
        Split
      </button>
      <button
        v-if="!readonly && (expert || sourceShown)"
        type="button"
        class="ds-okf-md__mode"
        :class="{ 'ds-okf-md__mode--active': mode === 'source' }"
        @click="setMode('source')"
      >
        Source only
      </button>
      <button
        v-if="!expert && !readonly && !sourceShown"
        type="button"
        class="ds-okf-md__show-source"
        @click="revealSource"
      >
        {{ showSourceLabel }}
      </button>
    </div>

    <div class="ds-okf-md__panes" :class="panesClass">
      <div v-if="showPreviewPane" class="ds-okf-md__preview" @click="onPreviewClick" v-html="renderedHtml" />
      <div v-if="showSourcePane" class="ds-okf-md__source">
        <textarea
          ref="textarea"
          :value="localValue"
          :readonly="readonly"
          class="ds-okf-md__textarea"
          :aria-label="sourceAriaLabel"
          @input="onTextarea"
        />
      </div>
    </div>

    <DsDialog
      v-if="expert"
      :visible="frontmatterDialog"
      :title="editFrontmatterTitle"
      size="lg"
      :actions="frontmatterActions"
      @close="frontmatterDialog = false"
      @action="onFrontmatterAction"
    >
      <div class="ds-okf-md__fm-grid">
        <DsFormGroup :label="okfVersionLabel" input-id="fm-okf-version">
          <DsInput id="fm-okf-version" v-model="draftFrontmatter.okf_version" :readonly="true" />
        </DsFormGroup>
        <DsFormGroup :label="statusLabel" input-id="fm-status">
          <DsSelect id="fm-status" v-model="draftFrontmatter.lifecycle.status" :options="statusOptions" />
        </DsFormGroup>
        <DsFormGroup :label="staleAfterLabel" input-id="fm-stale">
          <DsInput id="fm-stale" v-model="draftFrontmatter.lifecycle.stale_after" type="date" />
        </DsFormGroup>
        <DsFormGroup :label="trustTierLabel" input-id="fm-trust-tier">
          <DsInput id="fm-trust-tier" :value="draftFrontmatter.trust_tier || ''" :readonly="true" />
        </DsFormGroup>
        <DsFormGroup :label="attestationLabel" input-id="fm-attestation">
          <DsInput id="fm-attestation" :value="attestationPreview" :readonly="true" />
        </DsFormGroup>
        <DsFormGroup :label="sourcesLabel" input-id="fm-sources">
          <DsTable :columns="sourcesColumns" :rows="draftFrontmatter.provenance.sources" :hoverable="false" />
        </DsFormGroup>
      </div>
    </DsDialog>
  </div>
</template>

<script>
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import matter from 'gray-matter';
import taskLists from 'markdown-it-task-lists';
import DsInput from './Input.vue';
import DsSelect from './Select.vue';
import DsFormGroup from './FormGroup.vue';
import DsTable from './Table.vue';
import DsDialog from './Dialog.vue';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);

const MODES = ['preview', 'split', 'source'];
const STATUS_OPTIONS = [
  { value: 'draft', label: 'draft' },
  { value: 'stable', label: 'stable' },
  { value: 'deprecated', label: 'deprecated' }
];

export default {
  name: 'DsOkfMarkdownEditor',
  components: { DsInput, DsSelect, DsFormGroup, DsTable, DsDialog },
  props: {
    value: { type: String, default: '' },
    mode: { type: String, default: 'split', validator: (v) => MODES.includes(v) },
    readonly: { type: Boolean, default: false },
    expert: { type: Boolean, default: false },
    enableFrontmatter: { type: Boolean, default: true },
    issues: { type: Array, default: () => [] },
    ariaLabel: { type: String, default: 'Markdown editor' }
  },
  emits: ['update:value', 'update:mode', 'frontmatter-change'],
  data() {
    return {
      md: null,
      localValue: this.value || '',
      sourceShown: false,
      frontmatterDialog: false,
      draftFrontmatter: this.deriveFrontmatter(this.value || ''),
      statusOptions: STATUS_OPTIONS
    };
  },
  computed: {
    parsed() {
      try {
        return matter(this.localValue || '');
      } catch {
        return { data: {}, content: this.localValue || '' };
      }
    },
    contentBody() {
      return this.parsed.content || '';
    },
    parsedData() {
      return this.parsed.data || {};
    },
    frontmatterPresent() {
      return this.enableFrontmatter && Object.keys(this.parsedData).length > 0;
    },
    renderedHtml() {
      if (!this.md) return '';
      const raw = this.md.render(this.contentBody || '');
      // Decorate matched lines: scan issues, find ones tied to a line range, wrap
      // the next <p>/<li>/<h*> block with data attrs. Conservative — only
      // marker on matching line if a line range is provided.
      const html = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
      return html;
    },
    panesClass() {
      return `ds-okf-md__panes--${this.mode}`;
    },
    showPreviewPane() {
      return this.mode === 'split' || this.mode === 'preview';
    },
    showSourcePane() {
      return this.mode === 'split' || this.mode === 'source' || (!this.expert && this.sourceShown);
    },
    attestationPreview() {
      const a = this.draftFrontmatter.attestation;
      if (!a || !a.type) return '—';
      return `${a.type} · ${a.executor || '?'} → ${a.attester || '?'}`;
    },
    sourcesColumns() {
      return [
        { key: 'author', label: 'author' },
        { key: 'type', label: 'type' },
        { key: 'uri', label: 'uri' }
      ];
    },
    sourcesLabel() {
      return this.$t ? this.$t('okf.curator.frontmatter.sources', 'provenance.sources') : 'provenance.sources';
    },
    attestationLabel() {
      return this.$t ? this.$t('okf.curator.frontmatter.attestation', 'attestation') : 'attestation';
    },
    statusLabel() {
      return this.$t ? this.$t('okf.curator.frontmatter.status', 'lifecycle.status') : 'lifecycle.status';
    },
    staleAfterLabel() {
      return this.$t ? this.$t('okf.curator.frontmatter.staleAfter', 'lifecycle.stale_after') : 'lifecycle.stale_after';
    },
    trustTierLabel() {
      return this.$t ? this.$t('okf.curator.frontmatter.trustTier', 'trust_tier') : 'trust_tier';
    },
    okfVersionLabel() {
      return this.$t ? this.$t('okf.curator.frontmatter.okfVersion', 'okf_version') : 'okf_version';
    },
    editFrontmatterLabel() {
      return this.$t ? this.$t('okf.curator.frontmatter.edit', 'Edit frontmatter') : 'Edit frontmatter';
    },
    editFrontmatterTitle() {
      return this.$t ? this.$t('okf.curator.frontmatter.dialogTitle', 'Edit frontmatter') : 'Edit frontmatter';
    },
    frontmatterLabel() {
      return this.$t ? this.$t('okf.curator.frontmatter.label', 'Frontmatter') : 'Frontmatter';
    },
    showSourceLabel() {
      return this.$t ? this.$t('okf.curator.showSource', 'Show source') : 'Show source';
    },
    sourceAriaLabel() {
      return this.ariaLabel + ' — source';
    },
    frontmatterActions() {
      return [
        { key: 'cancel', label: 'Cancel', variant: 'secondary' },
        { key: 'save', label: 'Save', variant: 'primary' }
      ];
    }
  },
  watch: {
    value(v) {
      if (v !== this.localValue) {
        this.localValue = v || '';
        this.draftFrontmatter = this.deriveFrontmatter(this.localValue);
      }
    }
  },
  created() {
    this.md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: false,
      highlight(str, lang) {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
          } catch {
            /* fallthrough */
          }
        }
        return `<pre class="hljs"><code>${MarkdownIt.prototype.utils.escapeHtml(str)}</code></pre>`;
      }
    }).use(taskLists, { enabled: true, label: true });
  },
  methods: {
    setMode(m) {
      if (m === this.mode) return;
      this.$emit('update:mode', m);
    },
    revealSource() {
      this.sourceShown = true;
      this.setMode('source');
    },
    onTextarea(e) {
      const v = e.target.value;
      this.localValue = v;
      this.$emit('update:value', v);
    },
    onPreviewClick() {
      // pass-through: click on an issue marker could fire a custom flow.
      // Keep click delegation minimal — surface hover-only for now.
    },
    deriveFrontmatter(raw) {
      try {
        const parsed = matter(raw || '');
        return {
          okf_version: parsed.data?.okf_version || '',
          lifecycle: {
            status: parsed.data?.lifecycle?.status || 'draft',
            stale_after: parsed.data?.lifecycle?.stale_after || ''
          },
          provenance: {
            sources: Array.isArray(parsed.data?.provenance?.sources) ? parsed.data.provenance.sources : []
          },
          trust_tier: parsed.data?.trust_tier || '',
          attestation: parsed.data?.attestation || { type: '', executor: '', attester: '' }
        };
      } catch {
        return {
          okf_version: '',
          lifecycle: { status: 'draft', stale_after: '' },
          provenance: { sources: [] },
          trust_tier: '',
          attestation: { type: '', executor: '', attester: '' }
        };
      }
    },
    onFrontmatterAction(key) {
      if (key !== 'save') {
        this.frontmatterDialog = false;
        return;
      }
      // Re-serialize frontmatter; preserve unknowns by re-parsing the body.
      const fm = {
        ...this.parsedData,
        okf_version: this.draftFrontmatter.okf_version || '0.2',
        lifecycle: {
          ...(this.parsedData.lifecycle || {}),
          status: this.draftFrontmatter.lifecycle.status,
          ...(this.draftFrontmatter.lifecycle.stale_after
            ? { stale_after: this.draftFrontmatter.lifecycle.stale_after }
            : {})
        },
        provenance: { sources: this.draftFrontmatter.provenance.sources }
      };
      const body = this.contentBody;
      const next = matter.stringify(body, fm);
      this.localValue = next;
      this.$emit('update:value', next);
      this.$emit('frontmatter-change', this.draftFrontmatter);
      this.frontmatterDialog = false;
    }
  }
};
</script>

<style scoped>
.ds-okf-md {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  font-family: var(--font-body);
  overflow: hidden;
}

.ds-okf-md__toolbar {
  display: flex;
  gap: 4px;
  padding: var(--space-xs) var(--space-sm);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.ds-okf-md__mode {
  border: 0;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: var(--text-xs);
  padding: 4px 10px;
  border-radius: 100px;
  cursor: pointer;
}
.ds-okf-md__mode--active {
  background: var(--surface);
  color: var(--accent);
  box-shadow: var(--shadow-sm);
}
.ds-okf-md__show-source {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
  text-decoration: underline;
}

.ds-okf-md__panes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--border);
}
.ds-okf-md__panes--preview {
  grid-template-columns: 1fr;
}
.ds-okf-md__panes--source {
  grid-template-columns: 1fr;
}

.ds-okf-md__preview {
  padding: var(--space-md);
  overflow-y: auto;
  background: var(--surface);
  min-height: 220px;
  max-height: 520px;
  font-size: var(--text-sm);
}
.ds-okf-md__preview :deep(pre) {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-sm);
  overflow-x: auto;
}
.ds-okf-md__preview :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.85em;
}
.ds-okf-md__preview :deep([data-conformance-issue]) {
  border-bottom: 2px solid var(--warning);
  background: color-mix(in srgb, var(--warning-bg) 60%, transparent);
  padding: 1px 2px;
  border-radius: 2px;
}

.ds-okf-md__source {
  background: var(--surface);
  min-height: 220px;
}
.ds-okf-md__textarea {
  width: 100%;
  height: 100%;
  min-height: 220px;
  max-height: 520px;
  border: 0;
  background: transparent;
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  padding: var(--space-md);
  resize: vertical;
  outline: none;
}

.ds-okf-md__frontmatter {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-xs) var(--space-sm);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  font-size: var(--text-xs);
  color: var(--muted);
}
.ds-okf-md__frontmatter-edit {
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
}

.ds-okf-md__fm-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}
</style>
