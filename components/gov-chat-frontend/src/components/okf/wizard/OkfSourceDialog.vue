<!--
  OkfSourceDialog — Amendment A slice 4a (David, 2026-09-27): the wizard's
  source picker for the Documents choice. Selection from BOTH sources in one
  dialog — the document repository (paginated; bundles are never sources) and
  the local file system (uploads land in the document repository and are
  selected on arrival). mode 'single' (crawl) allows one source at a time and
  hides the upload section. Dialog paradigm per ImportDocumentsDialog
  (overlay + panel, DS primitives, Options API); the dialog ONLY selects —
  the step's Produce owns what happens with the sources.
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
      <div v-if="loading" class="okf-src__loading">
        <DsSpinner size="sm" />
        <span>{{ translate('okf.src.loading', 'Loading documents…') }}</span>
      </div>
      <p v-else-if="loadError" class="okf-src__error">
        {{ loadError }}
        <DsButton variant="secondary" small @click="loadPage(1)">{{ translate('okf.src.retry', 'Retry') }}</DsButton>
      </p>
      <p v-else-if="rows.length === 0" class="okf-src__note">
        {{ translate('okf.src.empty', 'No documents in the repository yet — upload some below.') }}
      </p>
      <ul v-else class="okf-src__list" role="listbox" :aria-multiselectable="mode === 'multi'">
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
import DsSpinner from '../../ds/Spinner.vue';
import documentFileService from '../../../services/documentFileService';
import translateMixin from '../../../mixins/translateMixin';

// The backend validates limit ≤ 50 (fileController getFilesSchema) — a
// bigger page is a guaranteed 400 (slice-4a lesson, 2026-09-27).
const PAGE_SIZE = 50;

export default {
  name: 'OkfSourceDialog',
  components: { DsButton, DsSpinner },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false },
    // 'multi' (documents) | 'single' (crawl)
    mode: { type: String, default: 'multi' },
    // file_ids pre-selected from the draft (re-entry restores them)
    selected: { type: Array, default: () => [] },
    // 'single' mode (crawl sources) has no upload section
    allowUpload: { type: Boolean, default: true }
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
      selectedIds: (this.selected || []).slice(),
      uploading: false,
      uploadError: '',
      uploadedNote: '',
      confirmError: ''
    };
  },
  computed: {
    title() {
      return this.mode === 'single'
        ? this.translate('okf.src.titleSingle', 'Choose the crawled document')
        : this.translate('okf.src.title', 'Choose the source documents');
    },
    canLoadMore() {
      // F8: the backend puts the count at body.pagination.totalFiles (not
      // body.total). Without it, a RAW FULL page is the only honest hint —
      // comparing the BUNDLE-FILTERED rows against page*size hides the
      // button whenever a bundle zip shrank the page.
      if (this.total > 0) return this.rows.length < this.total;
      return this.lastRawCount === this.pageSize;
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
    }
  },
  mounted() {
    if (this.visible) this.loadPage(1);
  },
  methods: {
    async loadPage(p) {
      this.loading = true;
      this.loadError = '';
      try {
        const body = await documentFileService.getFiles({ page: p, limit: this.pageSize });
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
      if (this.mode === 'single') {
        this.selectedIds = this.isSelected(f) ? [] : [f.file_id];
      } else if (this.isSelected(f)) {
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
              this.selectedIds = this.mode === 'single' ? [fileId] : this.selectedIds.concat([fileId]);
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
  width: 520px;
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
