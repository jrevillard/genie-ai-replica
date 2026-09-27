<!--
  OkfStepInput.vue — Amendment A slice 4 (B1): the REAL input panels.

    documents — pick doc-repo documents (multi-select) → Produce runs the
                whole-corpus conversion into THIS repo (repo_id passthrough).
    crawl     — pick a crawled doc-repo file → Produce runs the crawl
                conversion into THIS repo (per-page split default).
    manual    — add markdown files from the file system AND/OR author a
                concept in the editor modal; each lands immediately via the
                standard import route (idempotent upsert).
    clone     — the fork already landed the content; nothing to add here.

  Selections write back to the draft (A1) and the gate reflects readiness.
-->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.input.title', 'Inputs') }}</h3>
    <p class="okf-step__hint">{{ hintText }}</p>

    <!-- DOCUMENTS / CRAWL: doc-repo picker -->
    <template v-if="variant === 'documents' || variant === 'crawl'">
      <div v-if="loadingFiles" class="okf-step__loading">
        <DsSpinner size="sm" />
        <span>{{ translate('okf.steps.input.loadingFiles', 'Loading documents…') }}</span>
      </div>
      <p v-else-if="filesError" class="okf-step__error">{{ filesError }}</p>
      <p v-else-if="files.length === 0" class="okf-step__note">
        {{ translate('okf.steps.input.noFiles', 'No documents in the document repository yet — upload some first.') }}
      </p>
      <ul v-else class="okf-step__picker" role="listbox" :aria-multiselectable="variant === 'documents'">
        <li v-for="f in files" :key="f.file_id">
          <button
            type="button"
            class="okf-step__row"
            :class="{ 'okf-step__row--selected': isSelected(f) }"
            role="option"
            :aria-selected="isSelected(f)"
            @click="toggleFile(f)"
          >
            <span class="okf-step__row-name">{{ f.file_name }}</span>
            <span v-if="f.file_size" class="okf-step__row-meta">{{ Math.round(f.file_size / 1024) }} KB</span>
            <DsInfoTip
              :text="
                translate(
                  'okf.glossary.pickSource',
                  'Sources feed the producer, which proposes topics for your review — nothing is committed until you sign off in Curate. Documents already ingested for free-form RAG are allowed; your repository stays gated from ingesting until they are retracted.'
                )
              "
            />
          </button>
        </li>
      </ul>
      <p class="okf-step__note">
        {{
          variant === 'documents'
            ? translate('okf.steps.input.multiHint', 'Pick one or more documents — selected: {n}').replace(
                '{n}',
                selectedIds.length
              )
            : translate('okf.steps.input.singleHint', 'Pick one crawled document — selected: {n}').replace(
                '{n}',
                selectedIds.length
              )
        }}
      </p>
    </template>

    <!-- CLONE: the fork already landed the content — nothing to add here. -->
    <template v-else-if="variant === 'clone'">
      <p class="okf-step__note">
        {{
          translate(
            'okf.steps.input.cloned',
            'This repository is a clone — its topics are already in place. Continue to Curate to review them.'
          )
        }}
      </p>
    </template>

    <!-- MANUAL: file-system markdown + in-wizard authoring -->
    <template v-else>
      <div class="okf-step__manual">
        <label class="okf-step__fs">
          <DsButton variant="secondary" small :disabled="fsBusy" @click="pickFiles">
            {{ translate('okf.steps.input.fsPick', '+ Add markdown files from this computer') }}
          </DsButton>
          <input
            ref="fsInput"
            type="file"
            accept=".md,.markdown,.txt"
            multiple
            class="okf-step__fs-input"
            @change="onFsFiles"
          />
        </label>
        <span class="okf-step__fs-tip">
          <DsInfoTip
            :text="
              translate(
                'okf.glossary.fsPick',
                'Each file becomes one topic — focused topics retrieve more precisely than one long document. The file name becomes the title; you can refine everything in Curate.'
              )
            "
          />
        </span>
        <DsButton variant="secondary" small @click="addOpen = true">
          {{ translate('okf.steps.input.writeOne', 'Write a topic in the editor') }}
        </DsButton>
      </div>
      <p v-if="fsBusy" class="okf-step__note">{{ translate('okf.steps.input.fsBusy', 'Importing your files…') }}</p>
      <p v-if="fsError" class="okf-step__error">{{ fsError }}</p>
      <p v-if="addedCount > 0" class="okf-step__note">
        {{ translate('okf.steps.input.added', '{n} topic(s) in this repository so far.').replace('{n}', addedCount) }}
      </p>
      <OkfAddConceptModal
        :visible="addOpen"
        :repo-id="draft && draft.repo_id"
        :has-index="false"
        @close="addOpen = false"
        @created="onConceptCreated"
      />
    </template>

    <p v-if="inputError" class="okf-step__error">{{ inputError }}</p>
  </div>
</template>

<script>
import DsButton from '../../ds/Button.vue';
import DsInfoTip from '../../ds/InfoTip.vue';
import DsSpinner from '../../ds/Spinner.vue';
import OkfAddConceptModal from '../editor/AddConceptModal.vue';
import documentFileService from '../../../services/documentFileService';
import repoOkfService from '../../../services/repoOkfService';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepInput',
  components: { DsButton, DsInfoTip, DsSpinner, OkfAddConceptModal },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['update', 'gate'],
  data() {
    return {
      files: [],
      loadingFiles: false,
      filesError: '',
      selectedIds: ((this.draft && this.draft.input && this.draft.input.document_ids) || []).slice(),
      fsBusy: false,
      fsError: '',
      inputError: '',
      addOpen: false,
      addedCount: (this.draft && this.draft.input && this.draft.input.concepts_added) || 0
    };
  },
  computed: {
    variant() {
      return (this.draft && this.draft.source) || 'documents';
    },
    hintText() {
      const keys = {
        documents: 'okf.steps.input.documents',
        crawl: 'okf.steps.input.crawl',
        manual: 'okf.steps.input.manual',
        clone: 'okf.steps.input.clone'
      };
      const fallbacks = {
        documents: 'Pick the documents that should seed the topic list.',
        crawl: 'Pick the crawled document to turn into topics.',
        manual: 'Add markdown files from your computer, or write topics in the editor.',
        clone: 'This repository is a clone — its topics are already in place.'
      };
      const k = keys[this.variant] || keys.documents;
      return this.translate(k, fallbacks[this.variant] || fallbacks.documents);
    },
    // A2 gate: documents/crawl need a selection; manual needs ≥1 topic added;
    // clone needs nothing — the fork already landed the content.
    canAdvance() {
      if (this.variant === 'clone') return true;
      if (this.variant === 'manual') return this.addedCount > 0;
      return this.selectedIds.length > 0;
    }
  },
  watch: {
    canAdvance() {
      this.emitGate();
    }
  },
  mounted() {
    this.emitGate();
    if (this.variant === 'documents' || this.variant === 'crawl') this.loadFiles();
  },
  methods: {
    emitGate() {
      this.$emit('gate', this.canAdvance);
    },
    writeBack() {
      this.$emit('update', {
        input: {
          document_ids: this.selectedIds.slice(),
          concepts_added: this.addedCount
        }
      });
    },
    isSelected(f) {
      return this.selectedIds.includes(f.file_id);
    },
    toggleFile(f) {
      if (this.variant === 'crawl') {
        this.selectedIds = this.isSelected(f) ? [] : [f.file_id];
      } else if (this.isSelected(f)) {
        this.selectedIds = this.selectedIds.filter((id) => id !== f.file_id);
      } else {
        this.selectedIds = this.selectedIds.concat([f.file_id]);
      }
      this.writeBack();
      this.emitGate();
    },
    async loadFiles() {
      this.loadingFiles = true;
      this.filesError = '';
      try {
        const res = await documentFileService.getFiles({ limit: 200 });
        const rows = Array.isArray(res) ? res : (res && (res.data || res.items || res.files)) || [];
        // bundle zips are the OKF artifacts — never sources
        this.files = rows.filter((f) => !f.is_bundle);
      } catch {
        this.filesError = this.translate('okf.steps.input.loadFailed', 'Could not load the document list.');
      } finally {
        this.loadingFiles = false;
      }
    },
    pickFiles() {
      const el = this.$refs.fsInput;
      if (el) el.click();
    },
    // A3-adjacent idempotency: /import is an UPSERT per concept_id (the file
    // name), so re-adding the same files refreshes instead of duplicating.
    async onFsFiles(evt) {
      const picked = (evt && evt.target && evt.target.files) || [];
      if (!picked.length) return;
      this.fsBusy = true;
      this.fsError = '';
      try {
        const concepts = [];
        for (const file of picked) {
          const body = await file.text();
          const title = file.name.replace(/\.(md|markdown|txt)$/i, '');
          concepts.push({
            path: title,
            frontmatter: { type: 'topic', title },
            body
          });
        }
        await repoOkfService.importConcepts(this.draft.repo_id, concepts);
        this.addedCount += concepts.length;
        this.writeBack();
        this.emitGate();
      } catch {
        this.fsError =
          this.translate('okf.steps.input.fsFailed', 'Import failed — check the files and retry.') || 'Import failed';
      } finally {
        this.fsBusy = false;
        if (evt && evt.target) evt.target.value = '';
      }
    },
    onConceptCreated() {
      this.addedCount += 1;
      this.writeBack();
      this.emitGate();
    },
    // A3: the shell awaits this BEFORE advancing — documents/crawl hand off
    // to Produce, which runs the conversion; manual is already landed.
    async beforeAdvance() {
      if (this.variant === 'documents' || this.variant === 'crawl') {
        if (!this.draft.repo_id) {
          this.inputError = this.translate('okf.steps.input.noRepo', 'Create the repository first (go back to Entry).');
          return false;
        }
        this.writeBack();
      }
      return true;
    }
  }
};
</script>

<style scoped>
.okf-step {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.okf-step__title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}
.okf-step__hint {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step__loading {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step__picker {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  max-height: 320px;
  overflow-y: auto;
}
.okf-step__row {
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
.okf-step__row:hover {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-step__row--selected {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-step__row-name {
  flex: 1 1 auto;
  font-weight: 500;
}
.okf-step__row-meta {
  color: var(--muted);
  font-size: var(--text-xs);
}
.okf-step__manual {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  flex-wrap: wrap;
}
.okf-step__fs {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}
.okf-step__fs-input {
  display: none;
}
.okf-step__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step__error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
</style>
