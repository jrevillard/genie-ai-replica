<!--
  DsOkfMarkdownEditor.vue — markdown-it + DOMPurify + highlight.js wrapper.

  MAIN-THREAD SAFETY (David, 2026-09-13, "Page Unresponsive" fix): large
  crawled concepts froze the whole page — the old renderedHtml computed ran
  gray-matter over the FULL document plus markdown-it render + DOMPurify
  sanitize synchronously, on every keystroke and every load. Now:
    - frontmatter is split out by a bounded regex and only the fm BLOCK is
      parsed (O(frontmatter), not O(document));
    - the preview renders ASYNC in fence-aware chunks that yield to the event
      loop between chunks, debounced after edits, with a DsProgress strip —
      the page stays responsive and shows progress instead of freezing.

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
        :class="{ 'ds-okf-md__mode--active': currentMode === 'preview' }"
        @click="setMode('preview')"
      >
        Preview
      </button>
      <button
        type="button"
        class="ds-okf-md__mode"
        :class="{ 'ds-okf-md__mode--active': currentMode === 'split' }"
        @click="setMode('split')"
      >
        Split
      </button>
      <button
        v-if="!readonly && (expert || sourceShown)"
        type="button"
        class="ds-okf-md__mode"
        :class="{ 'ds-okf-md__mode--active': currentMode === 'source' }"
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
      <div v-if="showPreviewPane" class="ds-okf-md__previewwrap">
        <!-- CHUNKED-RENDER PROGRESS (2026-09-13): visible feedback while large
             bodies render — the UI thread is yielding between chunks, so this
             stays animated instead of the old page-wide freeze. -->
        <div v-if="rendering" class="ds-okf-md__renderbar">
          <DsProgress
            :value="renderDone"
            :max="renderTotal || 1"
            size="xs"
            show-label
            :label="renderLabel"
            :aria-label="renderLabel"
          />
        </div>
        <div class="ds-okf-md__preview" @click="onPreviewClick" v-html="renderedHtml" />
      </div>
      <div v-if="showSourcePane" class="ds-okf-md__source">
        <!-- MARKDOWN FORMATTING TOOLBAR (David, 2026-09-06): OKF bodies ARE
             markdown, but users unfamiliar with the syntax need the buttons.
             Insert-at-selection via the textarea's selectionStart/End —
             keyboard-free operation. -->
        <div
          v-if="!readonly && formatToolbar"
          class="ds-okf-md__format"
          role="toolbar"
          :aria-label="formatToolbarLabel"
        >
          <button
            v-for="action in formatActions"
            :key="action.key"
            type="button"
            class="ds-okf-md__fmt"
            :title="action.title"
            :aria-label="action.title"
            @click="applyFormat(action)"
          >
            {{ action.glyph }}
          </button>
        </div>
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
          <DsSelect id="fm-status" v-model="draftFrontmatter.lifecycle.status">
            <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </DsSelect>
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
import DsProgress from './Progress.vue';
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
// MARKDOWN FORMATTING ACTIONS (David, 2026-09-06): wrap = surround the
// selection (or a placeholder); line = prefix every line of the selected
// block; block = insert a scaffold at the cursor.
const FORMAT_ACTIONS = [
  {
    key: 'bold',
    type: 'wrap',
    pre: '**',
    post: '**',
    placeholder: 'bold text',
    glyph: 'B',
    titleKey: 'okf.md.bold',
    titleDefault: 'Bold'
  },
  {
    key: 'italic',
    type: 'wrap',
    pre: '*',
    post: '*',
    placeholder: 'italic text',
    glyph: 'I',
    titleKey: 'okf.md.italic',
    titleDefault: 'Italic'
  },
  {
    key: 'h1',
    type: 'line',
    pre: '# ',
    placeholder: 'Heading 1',
    glyph: 'H1',
    titleKey: 'okf.md.h1',
    titleDefault: 'Heading 1'
  },
  {
    key: 'h2',
    type: 'line',
    pre: '## ',
    placeholder: 'Heading 2',
    glyph: 'H2',
    titleKey: 'okf.md.h2',
    titleDefault: 'Heading 2'
  },
  {
    key: 'h3',
    type: 'line',
    pre: '### ',
    placeholder: 'Heading 3',
    glyph: 'H3',
    titleKey: 'okf.md.h3',
    titleDefault: 'Heading 3'
  },
  {
    key: 'bullet',
    type: 'line',
    pre: '- ',
    placeholder: 'List item',
    glyph: '•—',
    titleKey: 'okf.md.bullet',
    titleDefault: 'Bullet list'
  },
  {
    key: 'numbered',
    type: 'line',
    numbered: true,
    placeholder: 'List item',
    glyph: '1.',
    titleKey: 'okf.md.numbered',
    titleDefault: 'Numbered list'
  },
  {
    key: 'link',
    type: 'wrap',
    pre: '[',
    post: '](https://…)',
    placeholder: 'link text',
    glyph: '🔗',
    titleKey: 'okf.md.link',
    titleDefault: 'Insert link'
  },
  {
    key: 'code',
    type: 'wrap',
    pre: '`',
    post: '`',
    placeholder: 'code',
    glyph: '</>',
    titleKey: 'okf.md.code',
    titleDefault: 'Inline code'
  },
  {
    key: 'table',
    type: 'block',
    scaffold: '\n| Column | Column |\n| --- | --- |\n| Value | Value |\n',
    glyph: '▦',
    titleKey: 'okf.md.table',
    titleDefault: 'Insert table'
  }
];
const STATUS_OPTIONS = [
  { value: 'draft', label: 'draft' },
  { value: 'stable', label: 'stable' },
  { value: 'deprecated', label: 'deprecated' }
];

export default {
  name: 'DsOkfMarkdownEditor',
  components: { DsInput, DsSelect, DsFormGroup, DsTable, DsDialog, DsProgress },
  props: {
    value: { type: String, default: '' },
    mode: { type: String, default: 'split', validator: (v) => MODES.includes(v) },
    readonly: { type: Boolean, default: false },
    expert: { type: Boolean, default: false },
    enableFrontmatter: { type: Boolean, default: true },
    formatToolbar: { type: Boolean, default: true },
    issues: { type: Array, default: () => [] },
    ariaLabel: { type: String, default: 'Markdown editor' }
  },
  emits: ['update:value', 'update:mode', 'frontmatter-change'],
  data() {
    return {
      md: null,
      localValue: this.value || '',
      // The LIVE mode — the internal Preview/Split/Source bar owns it and
      // emits update:mode so a parent-bound prop stays in sync. (Before
      // 2026-09-06 the bar emitted into the void: no consumer listened, so
      // the tabs were dead — David's screenshot.)
      currentMode: this.mode,
      sourceShown: false,
      frontmatterDialog: false,
      draftFrontmatter: this.deriveFrontmatter(this.value || ''),
      statusOptions: STATUS_OPTIONS,
      // ASYNC CHUNKED RENDER (2026-09-13): renderedHtml is filled by the
      // debounced chunked pipeline below — never a whole-document synchronous
      // computed again.
      renderedHtml: '',
      rendering: false,
      renderDone: 0,
      renderTotal: 0
    };
  },
  computed: {
    parsed() {
      // CHEAP SPLIT (2026-09-13): parse ONLY the frontmatter block — the old
      // full gray-matter parse of the whole document ran on every keystroke.
      try {
        const s = String(this.localValue || '');
        const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(s);
        if (!m) return { data: {}, content: s };
        return { data: matter('---\n' + m[1] + '\n---').data || {}, content: s.slice(m[0].length) };
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
    renderLabel() {
      const base = this.$t ? this.$t('okf.md.rendering', 'Rendering…') : 'Rendering…';
      const pct = Math.round((this.renderDone / (this.renderTotal || 1)) * 100);
      return base + ' ' + pct + '%';
    },
    panesClass() {
      return `ds-okf-md__panes--${this.currentMode}`;
    },
    showPreviewPane() {
      return this.currentMode === 'split' || this.currentMode === 'preview';
    },
    showSourcePane() {
      return this.currentMode === 'split' || this.currentMode === 'source';
    },
    formatToolbarLabel() {
      return this.$t ? this.$t('okf.md.toolbar', 'Formatting') : 'Formatting';
    },
    formatActions() {
      return FORMAT_ACTIONS.map((a) => ({
        ...a,
        title: this.$t ? this.$t(a.titleKey, a.titleDefault) : a.titleDefault
      }));
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
    mode(v) {
      this.currentMode = v;
    },
    value(v) {
      if (v !== this.localValue) {
        this.localValue = v || '';
        this.draftFrontmatter = this.deriveFrontmatter(this.localValue);
      }
    },
    // ASYNC CHUNKED RENDER triggers: body edits re-render debounced; a mode
    // switch that reveals the preview pane renders immediately.
    contentBody() {
      this.scheduleRender();
    },
    currentMode() {
      if (this.showPreviewPane) this.scheduleRender(true);
    }
  },
  mounted() {
    if (this.showPreviewPane) this.scheduleRender(true);
  },
  beforeUnmount() {
    if (this._renderTimer) clearTimeout(this._renderTimer);
  },
  created() {
    // markdown-it v14 REMOVED MarkdownIt.prototype.utils — the old
    // escapeHtml call in the fence highlighter threw
    // "Cannot read properties of undefined (reading 'escapeHtml')" and the
    // whole Rendered pane vanished on any document containing a code fence
    // (2026-09-09). Close over the INSTANCE (md.utils survives in v14) with
    // an inline escape as the belt-and-braces fallback.
    let mdRef = null;
    this.md = mdRef = new MarkdownIt({
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
        const esc =
          mdRef && mdRef.utils && mdRef.utils.escapeHtml
            ? mdRef.utils.escapeHtml
            : (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<pre class="hljs"><code>${esc(str)}</code></pre>`;
      }
    }).use(taskLists, { enabled: true, label: true });
  },
  methods: {
    // ── ASYNC CHUNKED RENDER (2026-09-13 "Page Unresponsive" fix) ─────────
    // Fence-aware splitter: chunks break ONLY at line boundaries outside a
    // ``` / ~~~ fence, so no code block is ever split across renders.
    splitRenderChunks(body) {
      if (body.length <= 48000) return [body];
      const chunks = [];
      let start = 0;
      let fence = false;
      let i = 0;
      while (i < body.length) {
        const nl = body.indexOf('\n', i);
        const lineEnd = nl === -1 ? body.length : nl + 1;
        const line = body.slice(i, lineEnd);
        if (/^\s*(```|~~~)/.test(line)) fence = !fence;
        if (!fence && lineEnd - start >= 48000) {
          chunks.push(body.slice(start, lineEnd));
          start = lineEnd;
        }
        i = lineEnd;
      }
      if (start < body.length) chunks.push(body.slice(start));
      return chunks.length ? chunks : [body];
    },
    // Debounced scheduler — rapid typing never queues a render per keystroke.
    scheduleRender(immediate) {
      if (this._renderTimer) {
        clearTimeout(this._renderTimer);
        this._renderTimer = null;
      }
      if (!this.showPreviewPane) return; // never render a hidden pane
      if (immediate) {
        this.renderNow();
        return;
      }
      this._renderTimer = setTimeout(() => {
        this._renderTimer = null;
        this.renderNow();
      }, 250);
    },
    // Chunked pipeline: render + sanitize one bounded chunk at a time,
    // yielding to the event loop between chunks (macrotask) so scroll, input
    // and buttons stay LIVE — the old synchronous whole-document render is
    // what froze the page and summoned the browser's "Page Unresponsive".
    async renderNow() {
      if (!this.md) return;
      const seq = (this._renderSeq = (this._renderSeq || 0) + 1);
      const body = this.contentBody || '';
      if (!body) {
        this.renderedHtml = '';
        this.rendering = false;
        return;
      }
      const chunks = this.splitRenderChunks(body);
      this.rendering = chunks.length > 1;
      this.renderDone = 0;
      this.renderTotal = chunks.length;
      let html = '';
      for (let i = 0; i < chunks.length; i++) {
        if (seq !== this._renderSeq) return; // superseded by a newer edit
        html += DOMPurify.sanitize(this.md.render(chunks[i]), { USE_PROFILES: { html: true } });
        this.renderDone = i + 1;
        if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 0));
      }
      if (seq !== this._renderSeq) return;
      this.renderedHtml = html;
      this.rendering = false;
    },
    setMode(m) {
      if (!MODES.includes(m) || m === this.currentMode) return;
      this.currentMode = m;
      this.$emit('update:mode', m);
    },
    /** Insert markdown at the cursor/selection (formatting toolbar). */
    applyFormat(action) {
      const el = this.$refs.textarea;
      if (!el || this.readonly) return;
      const value = this.localValue || '';
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : value.length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
      let next;
      let cursorStart;
      let cursorEnd;
      if (action.type === 'wrap') {
        const sel = value.slice(start, end);
        const inner = sel || action.placeholder;
        next = value.slice(0, start) + action.pre + inner + action.post + value.slice(end);
        cursorStart = start + action.pre.length;
        cursorEnd = cursorStart + inner.length;
      } else if (action.type === 'line') {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const block = value.slice(lineStart, end) || action.placeholder;
        const lines = block
          .split('\n')
          .map((l, i) => (action.numbered ? `${i + 1}. ${l}` : `${action.pre}${l}`))
          .join('\n');
        next = value.slice(0, lineStart) + lines + value.slice(end);
        cursorStart = lineStart;
        cursorEnd = lineStart + lines.length;
      } else {
        next = value.slice(0, start) + action.scaffold + value.slice(end);
        cursorStart = start + action.scaffold.length;
        cursorEnd = cursorStart;
      }
      this.localValue = next;
      this.$emit('update:value', next);
      this.$nextTick(() => {
        el.focus();
        el.setSelectionRange(cursorStart, cursorEnd);
      });
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
        // Cheap fm-only split — same rationale as the parsed computed.
        const s = String(raw || '');
        const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(s);
        const parsed = m ? matter('---\n' + m[1] + '\n---') : { data: {} };
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
.ds-okf-md__format {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: var(--space-xs) var(--space-sm);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.ds-okf-md__fmt {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg);
  min-width: 30px;
  padding: 2px 7px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-xs);
  font-weight: 600;
}
.ds-okf-md__fmt:hover {
  border-color: var(--accent);
  color: var(--accent);
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

.ds-okf-md__previewwrap {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.ds-okf-md__renderbar {
  padding: var(--space-xs) var(--space-md) 0;
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
