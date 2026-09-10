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
  <div class="okf-re" role="region" :aria-label="translate('okf.editor.label', 'Repository editor')" :style="gridStyle">
    <OkfConceptList
      class="okf-re__rail"
      :concepts="concepts"
      :selected-id="selectedId"
      :loading="loading"
      :label-options="labelOptions"
      :read-only="readOnly"
      @select="onSelect"
      @add="addOpen = true"
      @resplit="resplitOpen = true"
      @delete="onDeleteAsk"
      @label="onTreeLabel"
    />
    <!-- FLEXIBLE COLUMNS (David, 2026-09-09): drag either splitter to resize;
         double-click resets that pane; arrow keys nudge (a11y). Track order
         MUST match DOM order: rail | split | center | split | meta. -->
    <div
      class="okf-re__split"
      role="separator"
      aria-orientation="vertical"
      tabindex="0"
      :aria-label="translate('okf.editor.resizeRail', 'Drag to resize the file list')"
      :title="translate('okf.editor.resizeTip', 'Drag to resize — double-click to reset')"
      @pointerdown="onSplitDown($event, 'rail')"
      @dblclick="resetPane('rail')"
      @keydown="onSplitKey($event, 'rail')"
    ></div>

    <div class="okf-re__center">
      <div class="okf-re__view-toggle" role="tablist" :aria-label="translate('okf.editor.paneLabel', 'View pane')">
        <DsButton :variant="centerView === 'files' ? 'primary' : 'secondary'" small @click="centerView = 'files'">
          {{ translate('okf.editor.pane.files', 'Files') }}
        </DsButton>
        <DsButton :variant="centerView === 'graph' ? 'primary' : 'secondary'" small @click="centerView = 'graph'">
          {{ translate('okf.editor.pane.graph', 'Graph') }}
        </DsButton>
      </div>
      <template v-if="centerView === 'files'">
        <!-- CROSS-REPO STALE-STATE GUARD (David, 2026-09-06): render the
             editor ONLY for a concept that exists in THIS repo's list — a
             selection left over from another repo can never reach the
             fetch, so one repo's id can never pair with another repo's
             concept (the child mounts and fetches BEFORE the parent's
            openEditor reset runs). -->
        <template v-if="selectedRow">
          <OkfConceptEditor
            ref="conceptEditor"
            :repo-id="repoId"
            :concept-id="selectedRow.concept_id"
            :read-only="readOnly"
            :label-options="labelOptions"
            @saved="onConceptSaved"
          />
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

    <div
      class="okf-re__split"
      role="separator"
      aria-orientation="vertical"
      tabindex="0"
      :aria-label="translate('okf.editor.resizeMeta', 'Drag to resize the metadata pane')"
      :title="translate('okf.editor.resizeTip', 'Drag to resize — double-click to reset')"
      @pointerdown="onSplitDown($event, 'meta')"
      @dblclick="resetPane('meta')"
      @keydown="onSplitKey($event, 'meta')"
    ></div>

    <aside class="okf-re__meta" :aria-label="translate('okf.editor.meta.label', 'Concept metadata')">
      <template v-if="selectedRow">
        <h4 class="okf-re__meta-title">{{ translate('okf.editor.meta.label', 'Concept metadata') }}</h4>

        <DsFormGroup :label="translate('okf.editor.meta.type', 'Type')" input-id="okf-meta-type">
          <DsSelect
            id="okf-meta-type"
            v-model="metaType"
            :placeholder="translate('okf.editor.meta.typePlaceholder', 'Select type…')"
            size="sm"
            :disabled="readOnly"
            @update:model-value="onMetaChange"
          >
            <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </DsSelect>
        </DsFormGroup>

        <DsFormGroup :label="translate('okf.editor.meta.title', 'Title')" input-id="okf-meta-title">
          <DsInput
            id="okf-meta-title"
            v-model="metaTitle"
            size="sm"
            :disabled="readOnly"
            @update:model-value="onMetaChange"
          />
        </DsFormGroup>

        <DsFormGroup input-id="okf-meta-label">
          <template #label>
            {{ translate('okf.editor.meta.labelLabel', 'Label (Knowledge Hierarchy)') }}
            <DsInfoTip
              :text="
                translate(
                  'okf.glossary.label',
                  'A category from the Knowledge Hierarchy that tells the assistant what kind of thing this concept is. Labels are how answers find the right content.'
                )
              "
            />
          </template>
          <!-- Options via slot (DsSelect has no options prop); a selectable
               empty first option lets the steward UNassign a label. -->
          <DsSelect
            id="okf-meta-label"
            v-model="metaLabel"
            size="sm"
            :disabled="readOnly"
            @update:model-value="onMetaChange"
          >
            <option value="">{{ translate('okf.editor.meta.noLabel', 'No label') }}</option>
            <option v-for="opt in labelOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </DsSelect>
          <p v-if="!labelBounded" class="okf-re__meta-unbounded">
            {{
              translate(
                'okf.glossary.subjectAreaMissing',
                "This repository's Subject Area is not in the Knowledge Hierarchy — showing every label."
              )
            }}
          </p>
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
        <DsButton variant="secondary" small :disabled="readOnly" @click="autocorrectOpen = true">
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
import DsInfoTip from '../../ds/InfoTip.vue';
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
    DsInfoTip,
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
    sourceFileId: { type: String, default: null },
    // READ ONLY (serving repo): concept + metadata mutations are disabled.
    readOnly: { type: Boolean, default: false }
  },
  emits: ['resplit-done'],
  data() {
    return {
      typeOptions: TYPE_OPTIONS,
      labelOptions: [],
      // False when the repo's Subject Area has no KH match — the picker then
      // shows the full tree plus the unbounded hint (legacy repos only).
      labelBounded: true,
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
      metaSyncing: false,
      // FLEXIBLE COLUMNS (David, 2026-09-09): draggable pane widths (px),
      // persisted per browser. The center pane always flexes.
      railWidth: 260,
      metaWidth: 280
    };
  },
  computed: {
    ...mapGetters('okf', ['conceptsByRepo', 'selectedConceptId', 'editorLoading', 'repoById']),
    gridStyle() {
      return {
        gridTemplateColumns: `${this.railWidth}px 6px minmax(0, 1fr) 6px ${this.metaWidth}px`
      };
    },
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
    /** Auto-open the index file (else the first) once the list arrives —
     *  mounted() is too early on a fresh repo, where fetchConcepts resolves
     *  AFTER mount. */
    concepts: {
      immediate: true,
      handler(rows) {
        if (!this.selectedId && rows.length > 0) {
          const indexRow = rows.find((c) => c.is_index);
          this.onSelect((indexRow || rows[0]).concept_id);
        }
      }
    },
    selectedRow: {
      immediate: true,
      handler(row) {
        this.syncMetaFields(row);
      }
    }
  },
  async mounted() {
    this.restorePaneWidths();
    await this.$store.dispatch('okf/openEditor', { repoId: this.repoId });
    this.loadLabelOptions();
  },
  methods: {
    // ── FLEXIBLE COLUMNS (David, 2026-09-09) ──────────────────────────────
    // Pointer-drag on either splitter (drag anywhere — listeners sit on the
    // window for the drag's lifetime), double-click resets, arrow keys nudge.
    onSplitDown(evt, which) {
      evt.preventDefault();
      const startX = evt.clientX;
      const startW = which === 'rail' ? this.railWidth : this.metaWidth;
      // The rail grows with the mouse; the meta pane's handle sits at
      // (container − metaWidth), so dragging it RIGHT must SHRINK the pane —
      // the delta sign flips or the handle runs opposite to the mouse.
      const dir = which === 'rail' ? 1 : -1;
      const move = (e) => this.setPaneWidth(which, startW + dir * (e.clientX - startX));
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.savePaneWidths();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    onSplitKey(evt, which) {
      const step = evt.shiftKey ? 48 : 16;
      if (evt.key !== 'ArrowLeft' && evt.key !== 'ArrowRight') return;
      evt.preventDefault();
      const cur = which === 'rail' ? this.railWidth : this.metaWidth;
      this.setPaneWidth(which, cur + (evt.key === 'ArrowLeft' ? -step : step));
      this.savePaneWidths();
    },
    resetPane(which) {
      this.setPaneWidth(which, which === 'rail' ? 260 : 280);
      this.savePaneWidths();
    },
    setPaneWidth(which, px) {
      const clamped = Math.max(180, Math.min(560, Math.round(px)));
      if (which === 'rail') this.railWidth = clamped;
      else this.metaWidth = clamped;
    },
    savePaneWidths() {
      try {
        localStorage.setItem('okf.editor.panes', JSON.stringify({ rail: this.railWidth, meta: this.metaWidth }));
      } catch {
        /* storage unavailable — widths stay session-local */
      }
    },
    restorePaneWidths() {
      try {
        const raw = localStorage.getItem('okf.editor.panes');
        if (!raw) return;
        const p = JSON.parse(raw);
        this.setPaneWidth('rail', Number(p && p.rail) || 260);
        this.setPaneWidth('meta', Number(p && p.meta) || 280);
      } catch {
        /* ignore malformed storage */
      }
    },
    onSelect(conceptId) {
      this.metaSaved = false;
      this.metaError = '';
      this.$store.commit('okf/setSelectedConcept', conceptId);
    },
    syncMetaFields(row) {
      this.metaSyncing = true;
      // row is NULL while the concept list is loading (fresh repo) — clear
      // the fields instead of dereferencing.
      if (!row) {
        this.metaType = '';
        this.metaTitle = '';
        this.metaLabel = '';
        this.$nextTick(() => {
          this.metaSyncing = false;
        });
        return;
      }
      const fm = row.frontmatter || {};
      this.metaType = fm.type || row.type || '';
      this.metaTitle = row.title || fm.title || '';
      this.metaLabel = (fm.labels && fm.labels[0]) || (row.labels && row.labels[0]) || '';
      this.$nextTick(() => {
        this.metaSyncing = false;
      });
    },
    async loadLabelOptions() {
      // Labels MUST come from the Knowledge Hierarchy services level (the
      // same tree the admin dashboard curates) — never free text — and are
      // BOUNDED TO THE SUBJECT AREA (David, 2026-09-05): only the services
      // under this repo's domain category. A legacy domain with no KH match
      // falls back to the full tree (bounded: false → hint shows) so
      // curation is never blocked.
      try {
        const categories = await serviceTreeService.getAdminCategories('en');
        const repo = this.$store.getters['okf/repoById'](this.repoId) || {};
        const { options, bounded } = okfRepoOps.labelOptionsForDomain(categories, repo.domain || '');
        this.labelOptions = options;
        this.labelBounded = bounded;
      } catch {
        this.labelOptions = []; // hierarchy unavailable — picker stays empty
        this.labelBounded = true;
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
        // REPO_READ_ONLY must surface "retract to edit" — actionable, never raw.
        const code = (err && (err.code || (err.data && err.data.error))) || '';
        this.metaError = okfRepoOps.friendlyLifecycleError(
          code,
          err && err.message,
          this.translate('okf.editor.meta.saveFailed', 'Metadata save failed')
        );
      }
    },
    async onTreeLabel({ conceptId, label }) {
      // Quick label write straight from the tree (Knowledge Hierarchy).
      try {
        await okfRepoOps.applyLabel(this.repoId, conceptId, label ? [label] : []);
        await this.$store.dispatch('okf/fetchConcepts', this.repoId);
      } catch (err) {
        const code = (err && (err.code || (err.data && err.data.error))) || '';
        this.metaError = okfRepoOps.friendlyLifecycleError(
          code,
          err && err.message,
          this.translate('okf.editor.meta.saveFailed', 'Metadata save failed')
        );
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
  gap: 0;
  min-height: 560px;
}
/* FLEXIBLE COLUMNS (David, 2026-09-09): the vertical drag handle between the
   file rail and the editor, and between the editor and the metadata rail. */
.okf-re__split {
  width: 6px;
  margin: 0 var(--space-xs);
  border-radius: var(--radius-sm);
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s ease;
  touch-action: none;
}
.okf-re__split:hover,
.okf-re__split:focus-visible,
.okf-re__split:active {
  background: var(--accent-muted);
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
.okf-re__meta-unbounded {
  margin: var(--space-xs) 0 0;
  color: var(--muted);
  font-size: var(--text-xs);
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
