<!--
  OkfStepInput.vue — 3.10 T2: the UNIVERSAL WORKBENCH (decisions D5+D6).

  Every variant lands here once the repository exists (the wizard owns
  creation at Entry) and sees THE SAME surface:
    - the concept TREE (the editor's real ConceptList — grouped, index
      pinned, click-to-edit in a focused ConceptEditor dialog, delete) —
      no count-only states, ever;
    - ALL FEEDERS, ALWAYS (D6: "once it is an OKF repo there is NOTHING
      to stop us from adding files from any source type"): the source
      picker (searchable, tagged — T1), local uploads (inside the
      picker), markdown import from this computer, and hand-written
      concepts (AddConceptModal). The Entry variant only pre-highlights
      a feeder (the picker opens scoped to crawls for the crawl variant)
      and shapes the initial hint.
  Production is data-driven, not variant-driven: whatever sources are
  picked (in ANY variant) convert at Produce (T3). Manual authoring and
  source picking compose freely.

  Selections write back to the draft (A1); patches SPREAD draft.input —
  the wizard merges shallowly, so a whole-object replace would drop
  Produce's conversion_kicked flag on a Back-visit.
-->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.input.title', 'Inputs') }}</h3>
    <p class="okf-step__hint">{{ hintText }}</p>

    <!-- THE WORKBENCH TREE (D5): what the repo looks like so far -->
    <div v-if="repoId" class="okf-step__bench">
      <div class="okf-step__bench-head">
        <span class="okf-step__bench-title">{{
          translate('okf.steps.input.benchTitle', 'Topics in this repository')
        }}</span>
        <span class="okf-step__bench-count">{{
          translate('okf.steps.input.benchCount', '{n}').replace('{n}', String(concepts.length))
        }}</span>
      </div>
      <div v-if="conceptsLoading" class="okf-step__bench-loading">
        <DsSpinner size="sm" />
        <span>{{ translate('okf.steps.input.benchLoading', 'Reading topics…') }}</span>
      </div>
      <p v-else-if="conceptsError" class="okf-step__error">{{ conceptsError }}</p>
      <p v-else-if="concepts.length === 0" class="okf-step__note">
        {{
          translate(
            'okf.steps.input.benchEmpty',
            'Nothing here yet — pick sources below, import markdown, or write your first topic.'
          )
        }}
      </p>
      <OkfConceptList
        v-else
        :concepts="concepts"
        :selected-id="editConceptId"
        :label-options="[]"
        :read-only="readOnly"
        @select="onConceptSelect"
        @add="addOpen = true"
        @delete="onConceptDelete"
      />
    </div>
    <p v-else class="okf-step__note">
      {{ translate('okf.steps.input.noRepoYet', 'Create the repository first (go back to Entry).') }}
    </p>

    <!-- ALL FEEDERS, ALWAYS (D6) -->
    <div class="okf-step__feeders">
      <DsButton v-if="variant !== 'clone'" variant="primary" small @click="pickOpen = true">
        {{
          variant === 'crawl'
            ? translate('okf.steps.input.chooseCrawl', 'Choose crawled documents')
            : translate('okf.steps.input.chooseDocs', 'Choose source documents')
        }}
        <DsInfoTip
          :text="
            translate(
              'okf.glossary.pickSource',
              'Sources feed the producer, which proposes topics for your review — nothing is committed until you sign off in Curate. Documents already ingested for free-form RAG are allowed; your repository stays gated from ingesting until they are retracted.'
            )
          "
        />
      </DsButton>
      <label class="okf-step__fs">
        <DsButton variant="secondary" small :disabled="fsBusy || !repoId" @click="pickFiles">
          {{ translate('okf.steps.input.fsPick', '+ Import markdown from this computer') }}
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
      <DsButton variant="secondary" small :disabled="!repoId" @click="addOpen = true">
        {{ translate('okf.steps.input.writeOne', '+ Write a concept') }}
      </DsButton>
    </div>
    <p v-if="fsBusy" class="okf-step__note">{{ translate('okf.steps.input.fsBusy', 'Importing your files…') }}</p>
    <p v-if="fsError" class="okf-step__error">{{ fsError }}</p>

    <p v-if="variant === 'documents' || variant === 'crawl'" class="okf-step__note">{{ selectionSummary }}</p>
    <label v-if="variant === 'documents' || variant === 'crawl'" class="okf-step__cls">
      <span>{{ translate('okf.steps.input.classification', 'Classification strategy') }}</span>
      <DsSelect v-model="classification" size="sm">
        <option value="heuristics">{{ translate('okf.steps.input.clsHeur', 'Heuristics (fast, no LLM)') }}</option>
        <option value="llm">{{ translate('okf.steps.input.clsLlm', 'LLM classification') }}</option>
        <option value="hybrid">{{ translate('okf.steps.input.clsHybrid', 'Hybrid') }}</option>
      </DsSelect>
      <DsInfoTip
        :text="
          translate(
            'okf.glossary.classificationStrategy',
            'How the producer decides the labels for each topic: heuristics is fast and free; LLM reads every page (better for complex layouts); hybrid starts heuristic and escalates the hard ones. Curation only — it never triggers ingestion.'
          )
        "
      />
    </label>

    <OkfSourceDialog
      :visible="pickOpen"
      :default-source="variant === 'crawl' ? 'crawl' : 'all'"
      :allow-upload="true"
      :selected="selectedIds"
      @close="pickOpen = false"
      @confirm="onSourcesConfirmed"
    />

    <OkfAddConceptModal
      :visible="addOpen"
      :repo-id="repoId"
      :has-index="false"
      @close="addOpen = false"
      @created="onConceptCreated"
    />

    <!-- Click-to-edit (D5): a saved concept is never a dead end -->
    <DsDialog :visible="editOpen" :title="editTitle" size="xl" scrollable @close="editOpen = false">
      <OkfConceptEditor
        v-if="editOpen && editConceptId"
        :repo-id="repoId"
        :concept-id="editConceptId"
        @saved="onConceptSaved"
      />
    </DsDialog>

    <p v-if="inputError" class="okf-step__error">{{ inputError }}</p>
  </div>
</template>

<script>
import DsButton from '../../ds/Button.vue';
import DsDialog from '../../ds/Dialog.vue';
import DsInfoTip from '../../ds/InfoTip.vue';
import DsSelect from '../../ds/Select.vue';
import DsSpinner from '../../ds/Spinner.vue';
import OkfAddConceptModal from '../editor/AddConceptModal.vue';
import OkfConceptEditor from '../editor/ConceptEditor.vue';
import OkfConceptList from '../editor/ConceptList.vue';
import OkfSourceDialog from '../wizard/OkfSourceDialog.vue';
import { mapGetters } from 'vuex';
import repoOkfService from '../../../services/repoOkfService';
import { buildConceptPayload } from '../../../services/okfRepoOps';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepInput',
  components: {
    DsButton,
    DsDialog,
    DsInfoTip,
    DsSelect,
    DsSpinner,
    OkfAddConceptModal,
    OkfConceptEditor,
    OkfConceptList,
    OkfSourceDialog
  },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['update', 'gate'],
  data() {
    return {
      selectedIds: ((this.draft && this.draft.input && this.draft.input.document_ids) || []).slice(),
      selectedNames: [],
      pickOpen: false,
      classification: (this.draft && this.draft.classification) || 'heuristics',
      fsBusy: false,
      fsError: '',
      inputError: '',
      addOpen: false,
      // T2 workbench state
      concepts: [],
      conceptsLoading: false,
      conceptsError: '',
      editOpen: false,
      editConceptId: null,
      addedCount: (this.draft && this.draft.input && this.draft.input.concepts_added) || 0
    };
  },
  computed: {
    ...mapGetters('okf', ['repoById']),
    variant() {
      return (this.draft && this.draft.source) || 'documents';
    },
    repoId() {
      return (this.draft && this.draft.repo_id) || '';
    },
    readOnly() {
      const repo = this.repoId && this.repoById(this.repoId);
      return !!(repo && repo.ingested_at);
    },
    editTitle() {
      const c = this.concepts.find((x) => x.concept_id === this.editConceptId);
      return c ? c.title || c.path : this.translate('okf.steps.input.editTitle', 'Edit concept');
    },
    hintText() {
      const keys = {
        documents: 'okf.steps.input.documents',
        crawl: 'okf.steps.input.crawl',
        manual: 'okf.steps.input.manual',
        clone: 'okf.steps.input.clone'
      };
      const fallbacks = {
        documents:
          'Pick the documents that should seed the topic list — from the repository or your computer. Everything you add lands in the tree below.',
        crawl: 'Pick the crawled documents to turn into topics — every crawl you ran is here, tagged and searchable.',
        manual:
          'Write your topics, import markdown, or pick sources — the tree below always shows what this repository holds.',
        clone: 'This repository is a clone — its topics are already in place. Add more sources any time.'
      };
      const k = keys[this.variant] || keys.documents;
      return this.translate(k, fallbacks[this.variant] || fallbacks.documents);
    },
    selectionSummary() {
      if (this.selectedIds.length === 0) {
        return this.translate('okf.steps.input.noneSelected', 'No sources selected yet.');
      }
      const names = this.selectedNames.filter((n) => this.selectedIds.includes(n.file_id));
      if (names.length === this.selectedIds.length && names.length > 0) {
        const shown = names
          .slice(0, 3)
          .map((n) => n.file_name)
          .join(', ');
        const more =
          names.length > 3
            ? this.translate('okf.steps.input.moreN', ' +{n} more').replace('{n}', String(names.length - 3))
            : '';
        return shown + more;
      }
      return this.translate('okf.steps.input.selectedN', 'Selected: {n}').replace(
        '{n}',
        String(this.selectedIds.length)
      );
    },
    // A2 gate (E2.4): content from ANY feeder satisfies it — picked sources
    // (they convert at Produce) or concepts already in the tree. Clone is
    // free (the fork landed the content).
    canAdvance() {
      if (this.variant === 'clone') return true;
      return this.selectedIds.length > 0 || this.concepts.length > 0;
    }
  },
  watch: {
    canAdvance() {
      this.emitGate();
    },
    // C1: the classification choice rides the draft so Produce's kick uses
    // it (the curation spec's user-selectable heuristics|llm|hybrid).
    classification(v) {
      this.$emit('update', { classification: v });
    }
  },
  mounted() {
    this.emitGate();
    this.refreshConcepts();
    // First-visit nudge for the blank-canvas steward (editor_offered rides
    // the draft so Back/Forward never re-pops a declined modal).
    if (
      this.variant === 'manual' &&
      this.concepts.length === 0 &&
      !((this.draft && this.draft.input && this.draft.input.editor_offered) || false)
    ) {
      this.addOpen = true;
      this.writeBack({ editor_offered: true });
    }
  },
  methods: {
    emitGate() {
      this.$emit('gate', this.canAdvance);
    },
    // T2: the tree is the live truth — refreshed after EVERY mutation.
    async refreshConcepts() {
      if (!this.repoId) return;
      this.conceptsLoading = true;
      this.conceptsError = '';
      try {
        this.concepts = await repoOkfService.listConcepts(this.repoId);
        this.addedCount = this.concepts.length;
      } catch {
        this.conceptsError = this.translate('okf.steps.input.benchFailed', 'Could not read the topics right now.');
      } finally {
        this.conceptsLoading = false;
        this.emitGate();
      }
    },
    // Merge with the EXISTING draft.input — the wizard's patch merge is
    // shallow (Object.assign on the draft), so replacing the input object
    // wholesale would drop conversion_kicked (Produce) or editor_offered.
    writeBack(extras) {
      this.$emit('update', {
        input: {
          ...((this.draft && this.draft.input) || {}),
          ...this.currentInput(),
          ...(extras || {})
        }
      });
    },
    currentInput() {
      return {
        document_ids: this.selectedIds.slice(),
        // T3: names ride the draft so Produce's per-source accounting can
        // label each conversion leg without re-fetching file metadata.
        document_names: this.selectedNames.slice(),
        concepts_added: this.addedCount
      };
    },
    onSourcesConfirmed(payload) {
      const rows = Array.isArray(payload) ? payload : (payload && payload.rows) || [];
      const ids = Array.isArray(payload) ? payload : (payload && payload.ids) || rows.map((r) => r.file_id);
      this.selectedIds = ids.slice();
      this.selectedNames = rows.map((r) => ({ file_id: r.file_id, file_name: r.file_name }));
      this.pickOpen = false;
      this.writeBack();
      this.emitGate();
    },
    pickFiles() {
      const el = this.$refs.fsInput;
      if (el) el.click();
    },
    // A3-adjacent idempotency: /import is an UPSERT per concept_id, and the
    // concept_id comes from the SAME sanctioned slug builder AddConceptModal
    // uses (F13) — 'Water Points.md' and a hand-added 'Water Points' now
    // land as ONE topic, never two. The picked file's own frontmatter wins
    // per-field. The tree refreshes from SERVER truth after every import.
    async onFsFiles(evt) {
      const picked = (evt && evt.target && evt.target.files) || [];
      if (!picked.length) return;
      this.fsBusy = true;
      this.fsError = '';
      try {
        const existing = this.concepts.map((c) => c.concept_id);
        const taken = new Set(existing);
        const concepts = [];
        let skipped = 0;
        for (const file of picked) {
          const raw = await file.text();
          if (!raw.trim()) {
            skipped += 1;
            continue;
          }
          const title = file.name.replace(/\.(md|markdown|txt)$/i, '');
          const payload = buildConceptPayload({ title, type: 'topic', body: raw, existingIds: [...taken] });
          taken.add(payload.concept_id);
          concepts.push({ path: payload.concept_id, frontmatter: payload.frontmatter, body: payload.body });
        }
        if (concepts.length) await repoOkfService.importConcepts(this.repoId, concepts);
        await this.refreshConcepts();
        this.writeBack();
        if (skipped) {
          this.fsError = this.translate('okf.steps.input.skippedEmpty', '{n} empty file(s) skipped.').replace(
            '{n}',
            String(skipped)
          );
        }
      } catch {
        this.fsError =
          this.translate('okf.steps.input.fsFailed', 'Import failed — check the files and retry.') || 'Import failed';
      } finally {
        this.fsBusy = false;
        if (evt && evt.target) evt.target.value = '';
      }
    },
    onConceptCreated() {
      this.refreshConcepts();
      this.writeBack();
    },
    // T2: click-to-edit — a saved concept reopens in the focused editor.
    onConceptSelect(conceptId) {
      this.editConceptId = conceptId;
      this.editOpen = true;
    },
    async onConceptDelete(node) {
      if (!node || !node.concept_id || !this.repoId) return;
      try {
        await repoOkfService.deleteConcept(this.repoId, node.concept_id);
        if (this.editConceptId === node.concept_id) {
          this.editOpen = false;
          this.editConceptId = null;
        }
        await this.refreshConcepts();
        this.writeBack();
      } catch {
        this.conceptsError = this.translate('okf.steps.input.deleteFailed', 'Could not delete the concept.');
      }
    },
    async onConceptSaved() {
      this.editOpen = false;
      this.editConceptId = null;
      await this.refreshConcepts();
      this.writeBack();
    },
    // A3: the shell awaits this BEFORE advancing — documents/crawl hand off
    // to Produce, which runs the conversion; manual is already landed.
    async beforeAdvance() {
      if (this.variant === 'documents' || this.variant === 'crawl') {
        if (!this.repoId) {
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
.okf-step__bench {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-sm);
  background: var(--bg);
}
.okf-step__bench-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.okf-step__bench-title {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.okf-step__bench-count {
  font-size: var(--text-sm);
  font-weight: 600;
}
.okf-step__bench-loading {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step__feeders {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  flex-wrap: wrap;
}
.okf-step__cls {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  max-width: 320px;
  font-size: var(--text-sm);
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
