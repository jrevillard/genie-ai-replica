<!--
  ImportDocumentsDialog — Story 7.7 (David, 2026-09-14): multi-select
  document-repository files into ONE OKF repository. Opened from the
  Document Management tab's "Create OKF repository" batch action with the
  selection preloaded. The dialog names the repo, picks the Subject Area
  (domain) + classification strategy, shows the per-file preflight (with the
  amber "still serving free-form RAG" warning for ingested docs — import is
  ALLOWED, the repo's own ingest is gated until they are retracted), and
  POSTs convert-from-documents. DS primitives, Options API, zero new UI
  paradigms.
-->
<template>
  <div v-if="visible" class="okf-imp__overlay" @click.self="close">
    <div class="okf-imp" role="dialog" aria-modal="true" :aria-label="dialogTitle">
      <h3 class="okf-imp__title">{{ dialogTitle }}</h3>
      <p class="okf-imp__hint">
        {{
          translate(
            'okf.import.hint',
            'The documents become one repository — segmented, cross-linked and labeled together. Nothing is published; the normal review → publish → ingest workflow follows.'
          )
        }}
      </p>

      <label class="okf-imp__field">
        <span>{{ translate('okf.import.name', 'Repository name') }}</span>
        <DsInput v-model="name" size="sm" :placeholder="translate('okf.import.namePh', 'e.g. Abattoir policy pack')" />
      </label>
      <label class="okf-imp__field">
        <span>{{ translate('okf.import.domain', 'Subject Area (domain)') }}</span>
        <DsInput v-model="domain" size="sm" placeholder="general" />
      </label>
      <label class="okf-imp__field">
        <span>{{ translate('okf.import.strategy', 'Classification strategy') }}</span>
        <DsSelect v-model="classification" size="sm">
          <option value="heuristics">{{ translate('okf.import.stratHeuristics', 'Heuristics (fast, no LLM)') }}</option>
          <option value="llm">{{ translate('okf.import.stratLlm', 'LLM classification') }}</option>
          <option value="hybrid">{{ translate('okf.import.stratHybrid', 'Hybrid') }}</option>
        </DsSelect>
      </label>

      <p class="okf-imp__sec">{{ translate('okf.import.files', 'Selected documents') }} ({{ documents.length }})</p>
      <ul class="okf-imp__files">
        <li v-for="d in documents" :key="d._key" class="okf-imp__file">
          <span class="okf-imp__file-name">{{ d.file_name || d._key }}</span>
          <DsPill v-if="isServing(d)" variant="warning" :title="servingTip">{{
            translate('okf.import.servingBadge', 'serving free-form RAG')
          }}</DsPill>
          <DsPill v-else-if="d.okf_repo_id" variant="danger" :title="alreadyTip">{{
            translate('okf.import.alreadyBadge', 'already in an OKF repo')
          }}</DsPill>
        </li>
      </ul>
      <p v-if="servingCount > 0" class="okf-imp__warn">
        {{
          translate(
            'okf.import.servingWarn',
            '{n} document(s) still serve the free-form corpus. The import succeeds, but this repository cannot be ingested until they are retracted.'
          ).replace('{n}', String(servingCount))
        }}
      </p>

      <p v-if="error" class="okf-imp__error">{{ error }}</p>

      <div class="okf-imp__actions">
        <DsButton variant="ghost" small :disabled="busy" @click="close">{{
          translate('okf.import.cancel', 'Cancel')
        }}</DsButton>
        <DsButton variant="primary" small :disabled="busy || !name.trim()" @click="submit">
          <DsSpinner v-if="busy" size="sm" />
          {{ busy ? translate('okf.import.importing', 'Importing…') : translate('okf.import.go', 'Import') }}
        </DsButton>
      </div>
    </div>
  </div>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsButton from '../../ds/Button.vue';
import DsInput from '../../ds/Input.vue';
import DsPill from '../../ds/Pill.vue';
import DsSelect from '../../ds/Select.vue';
import DsSpinner from '../../ds/Spinner.vue';
import repoOkfService from '../../../services/repoOkfService';

export default {
  name: 'OkfImportDocumentsDialog',
  components: { DsButton, DsInput, DsPill, DsSelect, DsSpinner },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false },
    documents: { type: Array, default: () => [] }
  },
  emits: ['close', 'imported'],
  data() {
    return {
      name: '',
      domain: 'general',
      classification: 'heuristics',
      busy: false,
      error: ''
    };
  },
  computed: {
    dialogTitle() {
      return this.translate('okf.import.title', 'Import documents into a new OKF repository');
    },
    servingCount() {
      return this.documents.filter((d) => this.isServing(d)).length;
    },
    servingTip() {
      return this.translate(
        'okf.import.servingTip',
        'This document currently serves the free-form RAG corpus — the new repository cannot be ingested until it is retracted.'
      );
    },
    alreadyTip() {
      return this.translate('okf.import.alreadyTip', 'This document is already the source of another OKF repository.');
    }
  },
  watch: {
    visible(v) {
      if (v) {
        this.error = '';
        if (!this.name.trim()) this.name = this.defaultName();
      }
    }
  },
  methods: {
    isServing(d) {
      const s = d && d.dataprep && String(d.dataprep.status).toLowerCase().trim();
      return s === 'ingesting' || s === 'ingested' || s === 'ingested with warnings';
    },
    defaultName() {
      const first = this.documents[0];
      const base = (first && (first.file_name || first._key)) || 'imported';
      return String(base)
        .replace(/\.[^.]+$/, '')
        .replace(/[-_]+/g, ' ')
        .trim();
    },
    close() {
      if (!this.busy) this.$emit('close');
    },
    async submit() {
      if (this.busy || !this.name.trim()) return;
      this.busy = true;
      this.error = '';
      try {
        const repo = await repoOkfService.importDocuments({
          file_ids: this.documents.map((d) => d._key),
          name: this.name.trim(),
          domain: (this.domain || 'general').trim() || 'general',
          classification: this.classification
        });
        this.$emit('imported', repo);
      } catch (err) {
        const code = err && err.code;
        this.error =
          code === 'DUPLICATE_REPO'
            ? this.translate('okf.import.dupRepo', 'That repository name already exists — pick another.')
            : this.translate(
                'okf.import.failed',
                'The import could not be started. Check the documents and try again.'
              );
      } finally {
        this.busy = false;
      }
    }
  }
};
</script>

<style scoped>
.okf-imp__overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay, rgba(9, 14, 20, 0.45));
}
.okf-imp {
  width: 460px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 12px);
  padding: var(--space-md) var(--space-lg);
  box-shadow: var(--shadow-lg, 0 12px 32px rgba(9, 14, 20, 0.16));
}
.okf-imp__title {
  margin: 0 0 var(--space-xs);
  font-size: var(--text-md);
}
.okf-imp__hint {
  margin: 0 0 var(--space-sm);
  color: var(--muted);
  font-size: var(--text-xs);
}
.okf-imp__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
  font-size: var(--text-sm);
}
.okf-imp__sec {
  margin: var(--space-sm) 0 var(--space-xs);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.okf-imp__files {
  list-style: none;
  margin: 0 0 var(--space-xs);
  padding: 0;
  max-height: 180px;
  overflow-y: auto;
}
.okf-imp__file {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 2px 0;
  font-size: var(--text-xs);
}
.okf-imp__file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.okf-imp__warn {
  margin: 0 0 var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--warning-bg, rgba(255, 193, 7, 0.12));
  color: var(--fg);
  font-size: var(--text-xs);
}
.okf-imp__error {
  margin: 0 0 var(--space-sm);
  color: var(--danger);
  font-size: var(--text-xs);
}
.okf-imp__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  border-top: 1px solid var(--border);
  padding-top: var(--space-sm);
}
</style>
