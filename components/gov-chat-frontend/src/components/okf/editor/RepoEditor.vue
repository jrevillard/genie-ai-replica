<!--
  OkfRepoEditor.vue — Story #978 Studio editor (Editor sub-tab content).

  Three-pane layout:
    left   — OkfConceptList (concepts, filter, re-split entry)
    center — OkfConceptEditor (Source | Rendered, debounced save)
    right  — metadata panel: type / title / label (single-select from the
             Knowledge Hierarchy services level), status + trust display.
             Writes are immediate via conceptService.update (server-side
             frontmatter splice) so they never clobber unsaved center-pane
             edits.
  Hosts the Resplit + Autocorrect modals.
-->
<template>
  <div class="okf-re" role="region" :aria-label="translate('okf.editor.label', 'Repository editor')">
    <OkfConceptList
      class="okf-re__rail"
      :concepts="concepts"
      :selected-id="selectedId"
      :loading="loading"
      :label-options="labelOptions"
      @select="onSelect"
      @add="addOpen = true"
      @resplit="resplitOpen = true"
      @delete="onDeleteAsk"
      @label="onTreeLabel"
    />

    <div class="okf-re__center">
      <div class="okf-re__view-toggle" role="tablist" :aria-label="translate('okf.editor.pane', 'View pane')">
        <DsButton :variant="centerView === 'files' ? 'primary' : 'secondary'" small @click="centerView = 'files'">
          {{ translate('okf.editor.pane.files', 'Files') }}
        </DsButton>
        <DsButton :variant="centerView === 'graph' ? 'primary' : 'secondary'" small @click="centerView = 'graph'">
          {{ translate('okf.editor.pane.graph', 'Graph') }}
        </DsButton>
      </div>
      <template v-if="centerView === 'files'">
        <template v-if="selectedId">
          <OkfConceptEditor ref="conceptEditor" :repo-id="repoId" :concept-id="selectedId" @saved="onConceptSaved" />
        </template>
        <p v-else class="okf-re__placeholder">
          {{ translate('okf.editor.pickConcept', 'Select a concept from the list to start editing.') }}
        </p>
      </template>
      <OkfRepoGraphView
        v-show="centerView === 'graph'"
        :repo-id="repoId"
        :concepts="concepts"
        :selected-id="selectedId"
        @select="onGraphNodeSelect"
      />
    </div>

    <aside class="okf-re__meta" :aria-label="translate('okf.editor.meta.label', 'Concept metadata')">
      <template v-if="selectedRow">
        <h4 class="okf-re__meta-title">{{ translate('okf.editor.meta.label', 'Concept metadata') }}</h4>

        <DsFormGroup :label="translate('okf.editor.meta.type', 'Type')" input-id="okf-meta-type">
          <DsSelect
            id="okf-meta-type"
            v-model="metaType"
            :placeholder="translate('okf.editor.meta.typePlaceholder', 'Select type…')"
            size="sm"
            @update:model-value="onMetaChange"
          >
            <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </DsSelect>
        </DsFormGroup>

        <DsFormGroup :label="translate('okf.editor.meta.title', 'Title')" input-id="okf-meta-title">
          <DsInput id="okf-meta-title" v-model="metaTitle" size="sm" @update:model-value="onMetaChange" />
        </DsFormGroup>

        <DsFormGroup
          :label="translate('okf.editor.meta.labelLabel', 'Label (Knowledge Hierarchy)')"
          input-id="okf-meta-label"
        >
          <!-- Options via slot (DsSelect has no options prop); a selectable
               empty first option lets the steward UNassign a label. -->
          <DsSelect id="okf-meta-label" v-model="metaLabel" size="sm" @update:model-value="onMetaChange">
            <option value="">{{ translate('okf.editor.meta.noLabel', 'No label') }}</option>
            <option v-for="opt in labelOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </DsSelect>
        </DsFormGroup>

        <dl class="okf-re__meta-facts">
          <dt>{{ translate('okf.editor.meta.status', 'Index status') }}</dt>
          <dd>{{ selectedRow.index_status || '—' }}</dd>
          <dt>{{ translate('okf.editor.meta.trust', 'Trust tier') }}</dt>
          <dd>{{ selectedRow.trust_tier || '—' }}</dd>
        </dl>

        <p v-if="metaError" class="okf-re__meta-error">{{ metaError }}</p>
        <p v-if="metaSaved" class="okf-re__meta-saved">{{ translate('okf.editor.meta.saved', 'Metadata saved') }}</p>
      </template>
      <p v-else class="okf-re__meta-empty">{{ translate('okf.editor.meta.none', 'No concept selected') }}</p>

      <footer class="okf-re__actions">
        <DsButton variant="secondary" small @click="autocorrectOpen = true">
          {{ translate('okf.editor.autocorrect.button', 'Autocorrect') }}
        </DsButton>
      </footer>
    </aside>

    <OkfAddConceptModal
      :visible="addOpen"
      :repo-id="repoId"
      :has-index="hasIndex"
      @close="addOpen = false"
      @created="onConceptCreated"
    />

    <DsDialog
      :visible="deleteAsk !== null"
      :title="translate('okf.editor.delete.title', 'Delete file')"
      size="sm"
      :actions="deleteActions"
      @close="deleteAsk = null"
      @action="onDeleteAction"
    >
      <p>
        {{
          translate(
            'okf.editor.delete.body',
            'This permanently removes the file, its indexed chunks and its graph links.'
          )
        }}
        <strong>{{ deleteAsk && (deleteAsk.title || deleteAsk.concept_id) }}</strong>
      </p>
    </DsDialog>

    <OkfResplitModal
      :visible="resplitOpen"
      :repo-id="repoId"
      :file-id="sourceFileId"
      @close="resplitOpen = false"
      @done="onResplitDone"
    />
    <OkfAutocorrectPanel
      :visible="autocorrectOpen"
      :repo-id="repoId"
      @close="autocorrectOpen = false"
      @applied="onAutocorrectApplied"
    />
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import translateMixin from '../../../mixins/translateMixin';
import serviceTreeService from '../../../services/serviceTreeService';
import conceptService from '../../../services/conceptService';
import DsButton from '../../ds/Button.vue';
import DsFormGroup from '../../ds/FormGroup.vue';
import DsInput from '../../ds/Input.vue';
import DsSelect from '../../ds/Select.vue';
import OkfConceptList from './ConceptList.vue';
import OkfConceptEditor from './ConceptEditor.vue';
import OkfResplitModal from './ResplitModal.vue';
import OkfAddConceptModal from './AddConceptModal.vue';
import OkfRepoGraphView from './RepoGraphView.vue';
import DsDialog from '../../ds/Dialog.vue';
import okfRepoOps from '../../../services/okfRepoOps';
import OkfAutocorrectPanel from './AutocorrectPanel.vue';

const TYPE_OPTIONS = ['topic', 'entity', 'process', 'event', 'source'].map((t) => ({ value: t, label: t }));

export default {
  name: 'OkfRepoEditor',
  components: {
    DsButton,
    DsDialog,
    DsFormGroup,
    DsInput,
    DsSelect,
    OkfConceptList,
    OkfConceptEditor,
    OkfResplitModal,
    OkfAddConceptModal,
    OkfRepoGraphView,
    OkfAutocorrectPanel
  },
  mixins: [translateMixin],
  props: {
    repoId: { type: String, required: true },
    // The doc-repo file linked at create time — re-split needs it until the
    // server can resolve the link itself (files.okf_repo_id).
    sourceFileId: { type: String, default: null }
  },
  emits: ['resplit-done'],
  data() {
    return {
      typeOptions: TYPE_OPTIONS,
      labelOptions: [],
      centerView: 'files',
      resplitOpen: false,
      addOpen: false,
      deleteAsk: null,
      deleting: false,
      autocorrectOpen: false,
      // Right-rail bindings — synced from the selected row, written immediately.
      metaType: '',
      metaTitle: '',
      metaLabel: '',
      metaError: '',
      metaSaved: false,
      metaSyncing: false
    };
  },
  computed: {
    ...mapGetters('okf', ['conceptsByRepo', 'selectedConceptId', 'editorLoading', 'repoById']),
    concepts() {
      return this.conceptsByRepo(this.repoId);
    },
    selectedId() {
      return this.selectedConceptId;
    },
    loading() {
      return this.editorLoading;
    },
    repo() {
      return this.repoById(this.repoId) || {};
    },
    hasIndex() {
      return this.concepts.some((c) => c.is_index);
    },
    deleteActions() {
      return [
        {
          key: 'cancel',
          label: this.translate('common.cancel', 'Cancel'),
          variant: 'secondary',
          disabled: this.deleting
        },
        {
          key: 'confirm',
          label: this.translate('okf.editor.delete.confirm', 'Delete'),
          variant: 'danger',
          disabled: this.deleting
        }
      ];
    },
    selectedRow() {
      return this.concepts.find((c) => c.concept_id === this.selectedId) || null;
    }
  },
  watch: {
    selectedRow: {
      immediate: true,
      handler(row) {
        this.syncMetaFields(row);
      }
    }
  },
  async mounted() {
    await this.$store.dispatch('okf/openEditor', { repoId: this.repoId });
    // Auto-select the index concept when present, else the first row.
    if (!this.selectedId && this.concepts.length > 0) {
      const indexRow = this.concepts.find((c) => c.is_index);
      this.onSelect((indexRow || this.concepts[0]).concept_id);
    }
    this.loadLabelOptions();
  },
  methods: {
    onSelect(conceptId) {
      this.metaSaved = false;
      this.metaError = '';
      this.$store.commit('okf/setSelectedConcept', conceptId);
    },
    syncMetaFields(row) {
      this.metaSyncing = true;
      const fm = (row && row.frontmatter) || {};
      this.metaType = fm.type || row.type || '';
      this.metaTitle = row.title || fm.title || '';
      this.metaLabel = (fm.labels && fm.labels[0]) || (row.labels && row.labels[0]) || '';
      this.$nextTick(() => {
        this.metaSyncing = false;
      });
    },
    async loadLabelOptions() {
      // Labels MUST come from the Knowledge Hierarchy services level (the
      // same tree the admin dashboard curates) — never free text.
      try {
        const categories = await serviceTreeService.getAdminCategories('en');
        const options = [];
        for (const cat of categories || []) {
          for (const svc of cat.children || []) {
            const name = svc.name || svc.nameEN || svc.serviceKey || svc._key;
            if (name) options.push({ value: String(name), label: String(name) });
          }
        }
        this.labelOptions = options;
      } catch {
        this.labelOptions = []; // hierarchy unavailable — picker stays empty
      }
    },
    onMetaChange() {
      // Right-rail writes are immediate per the UX design ("selecting a label
      // writes immediately") — debounce only to coalesce title keystrokes.
      if (this.metaSyncing) return;
      if (this._metaTimer) clearTimeout(this._metaTimer);
      this._metaTimer = setTimeout(() => {
        this._metaTimer = null;
        this.onMetaFieldChange();
      }, 400);
    },
    async onMetaFieldChange() {
      if (this.metaSyncing || !this.selectedId) return;
      this.metaError = '';
      this.metaSaved = false;
      const patch = {};
      if (this.metaType) patch.type = this.metaType;
      if (this.metaTitle) patch.title = this.metaTitle;
      patch.labels = this.metaLabel ? [this.metaLabel] : [];
      try {
        await conceptService.update(this.repoId, this.selectedId, patch);
        this.metaSaved = true;
        // Refresh the row so title/labels render in the left rail too.
        await this.$store.dispatch('okf/fetchConcepts', this.repoId);
      } catch (err) {
        this.metaError = err.message || this.translate('okf.editor.meta.saveFailed', 'Metadata save (meta.saveFailed)');
      }
    },
    async onTreeLabel({ conceptId, label }) {
      // Quick label write straight from the tree (Knowledge Hierarchy).
      try {
        await okfRepoOps.applyLabel(this.repoId, conceptId, label ? [label] : []);
        await this.$store.dispatch('okf/fetchConcepts', this.repoId);
      } catch (err) {
        this.metaError = err.message || this.translate('okf.editor.meta.saveFailed', 'Metadata save failed');
      }
    },
    onGraphNodeSelect(conceptId) {
      // Graph node click -> open that file in the Files pane.
      this.centerView = 'files';
      this.onSelect(conceptId);
    },
    onConceptCreated(conceptId) {
      this.onSelect(conceptId);
    },
    onDeleteAsk(node) {
      this.deleteAsk = node;
    },
    async onDeleteAction(key) {
      if (key === 'cancel') {
        this.deleteAsk = null;
        return;
      }
      if (key !== 'confirm' || !this.deleteAsk || this.deleting) return;
      this.deleting = true;
      const result = await this.$store.dispatch('okf/deleteConcept', {
        repoId: this.repoId,
        conceptId: this.deleteAsk.concept_id
      });
      this.deleting = false;
      this.deleteAsk = null;
      if (!result.ok) this.metaError = result.message;
    },
    onConceptSaved() {
      // Body changed — index_status/content_hash were patched into the row by
      // the store action. Nothing else to do here.
    },
    onResplitDone() {
      this.$emit('resplit-done');
      this.onSelect(null);
      this.$store.commit('okf/setSelectedConcept', null);
    },
    onAutocorrectApplied() {
      // The store action already refetched the rows.
      this.metaSaved = false;
    }
  }
};
</script>

<style scoped>
.okf-re {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 280px;
  gap: var(--space-md);
  min-height: 560px;
}
.okf-re__rail {
  max-height: 640px;
}
.okf-re__view-toggle {
  display: inline-flex;
  gap: var(--space-xs);
  align-self: flex-start;
}
.okf-re__center {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.okf-re__placeholder {
  color: var(--muted);
  text-align: center;
  padding: var(--space-xl) 0;
}
.okf-re__meta {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
}
.okf-re__meta-title {
  margin: 0;
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.okf-re__meta-facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-xs) var(--space-sm);
  margin: 0;
  font-size: var(--text-sm);
}
.okf-re__meta-facts dt {
  color: var(--muted);
}
.okf-re__meta-facts dd {
  margin: 0;
}
.okf-re__meta-error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
.okf-re__meta-saved {
  margin: 0;
  color: var(--success);
  font-size: var(--text-sm);
}
.okf-re__meta-empty {
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-re__actions {
  margin-top: auto;
  border-top: 1px solid var(--border);
  padding-top: var(--space-sm);
}
</style>
