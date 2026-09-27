<!--
  OkfSourceDialog — the wizard's source picker (3.10 T1, decisions D1+D6).

  Multi-select over the document repository (bundles are never sources):
    - SEARCH: debounced `GET /files?search=` (backend supported it; the old
      dialog never sent it — David's field report #1).
    - ORIGIN CHIPS: All | Crawls | Uploads — driven by the files doc's
      `source` stamp (backend T1); pre-stamp legacy docs count as uploads.
    - PROVENANCE: every crawl row carries a `crawl` pill whose tooltip is
      the seed URL; serving-RAG / already-in-repo preflight pills (W1)
      warn why a conversion may 409 later.
    - MULTI-CRAWL (D3): the crawl variant selects MANY crawl files — one
      repo, topics merged (merge accounting = Produce, T3). There is no
      single-select mode anymore.
  The dialog ONLY selects — the step's Produce owns what happens with the
  sources. Uploads land in the document repository and are selected on
  arrival (all feeders stay available — D6).
-->
<template>
  <div v-if="visible" class="okf-src__overlay" @click.self="close">
    <div class="okf-src" role="dialog" aria-modal="true" :aria-label="title">
      <h3 class="okf-src__title">{{ title }}</h3>
      <p class="okf-src__hint">
        {{
          translate(
            'okf.src.hint',
            'Pick sources from the document repository, upload new ones from this computer, or both.'
          )
        }}
      </p>

      <!-- Document repository -->
      <p class="okf-src__sec">{{ translate('okf.src.repoSec', 'From the document repository') }}</p>
      <div class="okf-src__toolbar">
        <DsInput
          v-model="search"
          size="sm"
          type="search"
          :placeholder="translate('okf.src.searchPh', 'Search by name or site…')"
          :aria-label="translate('okf.src.searchPh', 'Search by name or site…')"
        />
        <div class="okf-src__chips" role="group" :aria-label="translate('okf.src.chipsLabel', 'Filter by origin')">
          <button
            v-for="chip in chipOptions"
            :key="chip.value"
            type="button"
            class="okf-src__chip"
            :class="{ 'okf-src__chip--on': sourceFilter === chip.value }"
            :aria-pressed="sourceFilter === chip.value"
            @click="setFilter(chip.value)"
          >
            {{ chip.label }}
          </button>
        </div>
      </div>
      <div v-if="loading" class="okf-src__loading">
        <DsSpinner size="sm" />
        <span>{{ translate('okf.src.loading', 'Loading documents…') }}</span>
      </div>
      <p v-else-if="loadError" class="okf-src__error">
        {{ loadError }}
        <DsButton variant="secondary" small @click="loadPage(1)">{{ translate('okf.src.retry', 'Retry') }}</DsButton>
      </p>
      <p v-else-if="rows.length === 0" class="okf-src__note">
        {{
          isFiltered
            ? translate('okf.src.noMatches', 'Nothing matches this search or filter.')
            : translate('okf.src.empty', 'No documents in the repository yet — upload some below.')
        }}
      </p>
      <ul v-else class="okf-src__list" role="listbox" :aria-multiselectable="true">
        <li v-for="f in rows" :key="f.file_id">
          <button
            type="button"
            class="okf-src__row"
            :class="{ 'okf-src__row--selected': isSelected(f) }"
            role="option"
            :aria-selected="isSelected(f)"
            @click="toggle(f)"
          >
            <span class="okf-src__row-name">{{ f.file_name }}</span>
            <DsPill v-if="isCrawl(f)" variant="info" :title="crawlTip(f)">{{
              translate('okf.src.crawlBadge', 'crawl')
            }}</DsPill>
            <DsPill v-if="isServing(f)" variant="warning" :title="servingTip">{{
              translate('okf.src.servingBadge', 'serving free-form RAG')
            }}</DsPill>
            <DsPill v-else-if="f.okf_repo_id" variant="danger" :title="alreadyTip">{{
              translate('okf.src.alreadyBadge', 'already in an OKF repo')
            }}</DsPill>
            <span v-if="f.file_size" class="okf-src__row-meta">{{ Math.round(f.file_size / 1024) }} KB</span>
          </button>
        </li>
      </ul>
      <DsButton
        v-if="canLoadMore"
        variant="ghost"
        small
        :disabled="loading"
        class="okf-src__more"
        @click="loadPage(page + 1)"
      >
        {{ translate('okf.src.more', 'Load more') }}
      </DsButton>
      <p v-if="rows.length || total" class="okf-src__total">
        {{ translate('okf.src.total', '{n} document(s)').replace('{n}', String(total || rows.length)) }}
      </p>

      <!-- Local file system -->
      <template v-if="allowUpload">
        <p class="okf-src__sec">{{ translate('okf.src.fsSec', 'From this computer') }}</p>
        <div class="okf-src__fs">
          <label class="okf-src__fs-label">
            <DsButton variant="secondary" small :disabled="uploading" @click="pickFiles">
              {{ translate('okf.src.fsPick', '+ Upload files') }}
            </DsButton>
            <input ref="fsInput" type="file" multiple class="okf-src__fs-input" @change="onFsFiles" />
          </label>
          <span v-if="uploading" class="okf-src__note">{{ translate('okf.src.uploading', 'Uploading…') }}</span>
          <span v-else-if="uploadedNote" class="okf-src__note">{{ uploadedNote }}</span>
        </div>
        <p v-if="uploadError" class="okf-src__error">{{ uploadError }}</p>
        <p class="okf-src__note">
          {{
            translate(
              'okf.src.fsNote',
              'Uploaded files join the document repository and are selected here automatically.'
            )
          }}
        </p>
      </template>

      <p class="okf-src__count">
        {{ translate('okf.src.count', 'Selected: {n}').replace('{n}', String(selectedIds.length)) }}
      </p>

      <p v-if="confirmError" class="okf-src__error">{{ confirmError }}</p>

      <div class="okf-src__actions">
        <DsButton variant="ghost" small :disabled="uploading" @click="close">{{
          translate('okf.src.cancel', 'Cancel')
        }}</DsButton>
        <DsButton variant="primary" small :disabled="uploading || selectedIds.length === 0" @click="confirm">
          {{ translate('okf.src.confirm', 'Use {n} source(s)').replace('{n}', String(selectedIds.length)) }}
        </DsButton>
      </div>
    </div>
  </div>
</template>

<script>
import DsButton from '../../ds/Button.vue';
import DsInput from '../../ds/Input.vue';
import DsPill from '../../ds/Pill.vue';
import DsSpinner from '../../ds/Spinner.vue';
import documentFileService from '../../../services/documentFileService';
import translateMixin from '../../../mixins/translateMixin';

// The backend validates limit ≤ 50 (fileController getFilesSchema) — a
// bigger page is a guaranteed 400 (slice-4a lesson, 2026-09-27).
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

export default {
  name: 'OkfSourceDialog',
  components: { DsButton, DsInput, DsPill, DsSpinner },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false },
    // file_ids pre-selected from the draft (re-entry restores them)
    selected: { type: Array, default: () => [] },
    // whether the picker shows the upload section (D6: every caller passes
    // true — ALL feeders stay available in EVERY variant; the prop exists so
    // a future surface CAN scope the picker)
    allowUpload: { type: Boolean, default: true },
    // initial origin chip (D1/D3): the crawl variant opens scoped to crawls;
    // the steward can still switch chips — nothing is ever locked (D6).
    defaultSource: { type: String, default: 'all' }
  },
  emits: ['close', 'confirm'],
  data() {
    return {
      rows: [],
      page: 1,
      pageSize: PAGE_SIZE,
      total: 0,
      // reactive: canLoadMore keys off the RAW page size (F8) — a plain
      // instance prop would never invalidate the computed
      lastRawCount: 0,
      loading: false,
      loadError: '',
      // 3.10 T1: search + origin chips
      search: '',
      sourceFilter: this.defaultSource === 'crawl' ? 'crawl' : 'all',
      searchTimer: null,
      selectedIds: (this.selected || []).slice(),
      uploading: false,
      uploadError: '',
      uploadedNote: '',
      confirmError: ''
    };
  },
  computed: {
    title() {
      return this.translate('okf.src.title', 'Choose the source documents');
    },
    chipOptions() {
      return [
        { value: 'all', label: this.translate('okf.src.chipAll', 'All') },
        { value: 'crawl', label: this.translate('okf.src.chipCrawl', 'Crawls') },
        { value: 'upload', label: this.translate('okf.src.chipUpload', 'Uploads') }
      ];
    },
    isFiltered() {
      return this.search.trim().length > 0 || this.sourceFilter !== 'all';
    },
    canLoadMore() {
      // F8: the backend puts the count at body.pagination.totalFiles (not
      // body.total). Without it, a RAW FULL page is the only honest hint —
      // comparing the BUNDLE-FILTERED rows against page*size hides the
      // button whenever a bundle zip shrank the page.
      if (this.total > 0) return this.rows.length < this.total;
      return this.lastRawCount === this.pageSize;
    },
    // W1 preflight pills (port of the 7.7 dialog's warnings): the steward
    // sees WHY a document may 409 later — the server-side guards stay the
    // real safety (DOCUMENT_IN_ANOTHER_REPO / SOURCES_NOT_RETRACTED).
    servingTip() {
      return this.translate(
        'okf.src.servingTip',
        'This document currently serves the free-form RAG corpus — the conversion succeeds, but this repository cannot be ingested until it is retracted.'
      );
    },
    alreadyTip() {
      return this.translate(
        'okf.src.alreadyTip',
        'This document is already the source of another OKF repository — the conversion will refuse it.'
      );
    }
  },
  watch: {
    visible(v) {
      if (v) {
        this.loadError = '';
        this.uploadError = '';
        this.confirmError = '';
        if (this.rows.length === 0) this.loadPage(1);
      }
    },
    // T1: search + chip changes reload from page 1 (debounced for typing).
    search() {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.loadPage(1), SEARCH_DEBOUNCE_MS);
    },
    sourceFilter() {
      clearTimeout(this.searchTimer);
      this.loadPage(1);
    }
  },
  beforeUnmount() {
    clearTimeout(this.searchTimer);
  },
  mounted() {
    if (this.visible) this.loadPage(1);
  },
  methods: {
    // W1: serving free-form RAG = the doc-repo dataprep status; already
    // claimed = the okf_repo_id stamp (Story 2.5).
    isServing(f) {
      const s = f && f.dataprep && String(f.dataprep.status).toLowerCase().trim();
      return s === 'ingesting' || s === 'ingested' || s === 'ingested with warnings';
    },
    // T1 (D1): the origin stamp — pre-stamp legacy docs have no attribute;
    // they were uploads (the only pre-stamp creation path).
    isCrawl(f) {
      return f && f.source === 'crawl';
    },
    crawlTip(f) {
      const seed = (f && f.source_url) || '';
      return seed
        ? this.translate('okf.src.crawlTip', 'Crawled from: {url}').replace('{url}', seed)
        : this.translate('okf.src.crawlBadge', 'crawl');
    },
    setFilter(v) {
      this.sourceFilter = v;
    },
    async loadPage(p) {
      this.loading = true;
      this.loadError = '';
      try {
        const params = { page: p, limit: this.pageSize };
        const term = this.search.trim();
        if (term) params.search = term;
        if (this.sourceFilter === 'crawl' || this.sourceFilter === 'upload') params.source = this.sourceFilter;
        const body = await documentFileService.getFiles(params);
        this.page = p;
        const raw = Array.isArray(body) ? body : (body && (body.data || body.items || body.files)) || [];
        // bundle zips are the OKF artifacts — never sources
        const kept = raw.filter((f) => !f.is_bundle);
        this.lastRawCount = raw.length;
        this.rows = p === 1 ? kept : this.rows.concat(kept);
        // F8: the count lives at pagination.totalFiles on this backend;
        // body.total accepted for forward-compat.
        const t = body && (body.total != null ? body.total : body.pagination && body.pagination.totalFiles);
        if (typeof t === 'number') this.total = t;
      } catch {
        this.loadError = this.translate('okf.src.loadFailed', 'Could not load the document list.');
      } finally {
        this.loading = false;
      }
    },
    isSelected(f) {
      return this.selectedIds.includes(f.file_id);
    },
    toggle(f) {
      if (this.isSelected(f)) {
        this.selectedIds = this.selectedIds.filter((id) => id !== f.file_id);
      } else {
        this.selectedIds = this.selectedIds.concat([f.file_id]);
      }
    },
    pickFiles() {
      const el = this.$refs.fsInput;
      if (el) el.click();
    },
    async onFsFiles(evt) {
      const picked = (evt && evt.target && evt.target.files) || [];
      if (!picked.length) return;
      this.uploading = true;
      this.uploadError = '';
      let ok = 0;
      try {
        for (const file of picked) {
          const formData = new FormData();
          formData.append('file', file);
          const res = await documentFileService.uploadFile(formData);
          const created = (res && res.data) || res || {};
          const fileId = created.file_id || created.id;
          if (fileId) {
            this.rows = [{ file_id: fileId, file_name: created.file_name || file.name }, ...this.rows];
            if (!this.selectedIds.includes(fileId)) {
              this.selectedIds = this.selectedIds.concat([fileId]);
            }
            ok += 1;
          }
        }
        this.uploadedNote = this.translate('okf.src.uploaded', '{n} file(s) uploaded.').replace('{n}', String(ok));
      } catch {
        this.uploadError = this.translate('okf.src.uploadFailed', 'An upload failed — check the files and retry.');
      } finally {
        this.uploading = false;
        if (evt && evt.target) evt.target.value = '';
      }
    },
    confirm() {
      if (this.selectedIds.length === 0) {
        this.confirmError = this.translate('okf.src.needOne', 'Select at least one source.');
        return;
      }
      // Rows ride along so the step can show file names in its summary; ids
      // NOT present in the loaded rows (restored from the draft) stay in ids.
      this.$emit('confirm', {
        ids: this.selectedIds.slice(),
        rows: this.rows.filter((r) => this.selectedIds.includes(r.file_id))
      });
    },
    close() {
      if (!this.uploading) this.$emit('close');
    }
  }
};
</script>

<style scoped>
.okf-src__overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay, rgba(9, 14, 20, 0.45));
}
.okf-src {
  width: 560px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 12px);
  padding: var(--space-md) var(--space-lg);
  box-shadow: var(--shadow-lg, 0 12px 32px rgba(9, 14, 20, 0.16));
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-src__title {
  margin: 0;
  font-size: var(--text-md);
}
.okf-src__hint {
  margin: 0 0 var(--space-xs);
  color: var(--muted);
  font-size: var(--text-xs);
}
.okf-src__sec {
  margin: var(--space-xs) 0 0;
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.okf-src__toolbar {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin-top: var(--space-xs);
}
.okf-src__chips {
  display: flex;
  gap: var(--space-xs);
}
.okf-src__chip {
  padding: 2px 10px;
  font-size: var(--text-xs);
  font-family: inherit;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.okf-src__chip:hover {
  border-color: var(--accent);
  color: var(--fg);
}
.okf-src__chip--on {
  background: var(--accent-muted);
  border-color: var(--accent);
  color: var(--fg);
}
.okf-src__loading {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-src__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  max-height: 220px;
  overflow-y: auto;
}
.okf-src__row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  text-align: left;
  padding: var(--space-xs) var(--space-sm);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font: inherit;
  color: var(--fg);
}
.okf-src__row:hover {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-src__row--selected {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-src__row-name {
  flex: 1 1 auto;
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.okf-src__row-meta {
  color: var(--muted);
  font-size: var(--text-xs);
}
.okf-src__more {
  align-self: flex-start;
}
.okf-src__total {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-xs);
}
.okf-src__fs {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  flex-wrap: wrap;
}
.okf-src__fs-label {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}
.okf-src__fs-input {
  display: none;
}
.okf-src__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-xs);
}
.okf-src__count {
  margin: var(--space-xs) 0 0;
  font-size: var(--text-sm);
  font-weight: 500;
}
.okf-src__error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-xs);
}
.okf-src__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  border-top: 1px solid var(--border);
  padding-top: var(--space-sm);
  margin-top: var(--space-xs);
}
</style>
