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
        :label-options="labelOptions"
        :read-only="readOnly"
        @select="onConceptSelect"
        @add="addOpen = true"
        @delete="onDeleteAsk"
        @label="onTreeLabel"
        @pii-bulk="onPiiBulkAsk"
      />
      <!-- LIVE BULK PROGRESS + POST-ACTION FEEDBACK (#1040, UX-4 #1514):
           while the detached job runs the note IS the processed-of-total
           readout (rendered from piiBulkProgress, never a copied state);
           after it settles the terminal done/failed line takes over. -->
      <p v-if="piiBulkProgress" class="okf-step__pii-note" role="status">{{ piiBulkProgressLabel }}</p>
      <p v-else-if="piiBulkNote" class="okf-step__pii-note" role="status">{{ piiBulkNote }}</p>
    </div>
    <p v-else class="okf-step__note">
      {{ translate('okf.steps.input.noRepoYet', 'Create the repository first (go back to Entry).') }}
    </p>

    <!-- ALL FEEDERS, ALWAYS (D6): the picker renders in EVERY variant —
         audit A7-2 removed the clone exclusion; the variant only shapes the
         label and the picker's default scope. readOnly (serving repo) still
         gates every mutating feeder, matching Curate/RepoEditor. -->
    <div class="okf-step__feeders">
      <DsButton variant="primary" small :disabled="readOnly" @click="pickOpen = true">
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
        <DsButton variant="secondary" small :disabled="fsBusy || !repoId || readOnly" @click="pickFiles">
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
      <DsButton variant="secondary" small :disabled="!repoId || readOnly" @click="addOpen = true">
        {{ translate('okf.steps.input.writeOne', '+ Write a concept') }}
      </DsButton>
    </div>
    <p v-if="fsBusy" class="okf-step__note">{{ translate('okf.steps.input.fsBusy', 'Importing your files…') }}</p>
    <p v-if="fsError" class="okf-step__error">{{ fsError }}</p>
    <p v-if="fsSplitNote" class="okf-step__note" role="status" data-test-id="okf-input-split-note">
      {{ fsSplitNote }}
    </p>

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
      :has-index="hasIndex"
      @close="addOpen = false"
      @created="onConceptCreated"
    />

    <!-- Click-to-edit (D5): a saved concept is never a dead end. readOnly is
         threaded (audit A7-3): a serving repo's steward must retract before
         editing — the dialog's Save/autosave otherwise stayed live. -->
    <DsDialog
      class="genie-living-intelligence"
      :visible="editOpen"
      :title="editTitle"
      size="xl"
      @close="editOpen = false"
    >
      <OkfConceptEditor
        v-if="editOpen && editConceptId"
        :repo-id="repoId"
        :concept-id="editConceptId"
        :read-only="readOnly"
        :label-options="labelOptions"
        @saved="onConceptSaved"
      />
    </DsDialog>

    <!-- WORKBENCH DELETE CONFIRM (audit A7-4): ConceptList's contract is
         "X → delete (parent confirms)" — RepoEditor confirms via a dialog;
         the workbench now does the same instead of deleting on first click.
         Verifier A7-minor: persistent + loading gate the backdrop/Esc while
         the delete request is in flight — dismissing mid-delete no longer
         leaves the deletion running behind a closed dialog. -->
    <DsDialog
      class="genie-living-intelligence"
      :visible="deleteAsk !== null"
      :title="translate('okf.steps.input.deleteTitle', 'Delete topic')"
      size="sm"
      :persistent="deleting"
      :loading="deleting"
      :actions="deleteActions"
      @close="deleteAsk = null"
      @action="onDeleteAction"
    >
      <p>
        {{ translate('okf.steps.input.deleteBody', 'This permanently removes the topic from this repository.') }}
        <strong>{{ deleteAsk && (deleteAsk.title || deleteAsk.concept_id) }}</strong>
      </p>
    </DsDialog>

    <!-- BULK PII CONFIRM (#1040): ConceptList's Redact all / Remove all /
         Accept all emitted `pii-bulk` but the workbench never bound the
         event — the buttons rendered and did NOTHING (live: 41 flagged
         entities, zero requests, zero audit rows). Same confirm + action +
         refresh contract as RepoEditor, reusing its i18n keys. -->
    <DsDialog
      class="genie-living-intelligence"
      :visible="piiBulkAsk !== null"
      :title="piiBulkTitle"
      size="sm"
      :persistent="piiBulkBusy"
      :loading="piiBulkBusy"
      :actions="piiBulkActions"
      @close="piiBulkAsk = null"
      @action="onPiiBulkAction"
    >
      <p>{{ piiBulkBody }}</p>
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
import serviceTreeService from '../../../services/serviceTreeService';
import { buildConceptPayload, labelOptionsForDomain, applyLabel } from '../../../services/okfRepoOps';
// #80930: the bulk-PII failure composer is SHARED with editor/RepoEditor.vue
// (the verbatim duplicate catch is how the round-19 fix missed one copy).
import { bulkPiiFailureMessage } from './failureMessages';
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
      // Verifier B2 (2026-09-29): the names rows are LOAD-BEARING now —
      // Produce routes each conversion leg by the row's origin. Restore them
      // from the draft exactly like the ids, or every Back→Continue
      // round-trip (steps remount on :key) destroyed them and unstamped ids
      // misrouted at Produce.
      selectedNames: ((this.draft && this.draft.input && this.draft.input.document_names) || []).slice(),
      pickOpen: false,
      classification: (this.draft && this.draft.classification) || 'heuristics',
      fsBusy: false,
      fsError: '',
      // What the server DID to an oversized picked file. The import path
      // splits a document over the concept ceiling losslessly and reports it
      // (`split_documents`); the wizard USED to discard that answer, so a
      // curator who picked a 260 000-character page watched it become four
      // topics and was never told why.
      fsSplitNote: '',
      inputError: '',
      addOpen: false,
      // T2 workbench state
      concepts: [],
      conceptsLoading: false,
      conceptsError: '',
      editOpen: false,
      editConceptId: null,
      // WORKBENCH DELETE CONFIRM (audit A7-4) + KH label options (audit
      // A7-5): the set-label affordance was a dead end with zero options —
      // the workbench now loads the SAME Subject-Area-bounded KH options
      // the editor rail uses.
      deleteAsk: null,
      deleting: false,
      labelOptions: [],
      addedCount: (this.draft && this.draft.input && this.draft.input.concepts_added) || 0,
      // #1040 bulk PII state (mirrors RepoEditor)
      piiBulkAsk: null,
      piiBulkBusy: false,
      // Explicit post-action feedback (David: "no visual feedback in step 3"):
      // the dialog closes and the flagged pill vanishes — without this line
      // nothing TELLS the user what just happened.
      piiBulkNote: '',
      // UX-4 (#1514): live processed-of-total from the detached bulk job.
      piiBulkProgress: null
    };
  },
  computed: {
    ...mapGetters('okf', ['repoById']),
    // UX-4 (#1514): the live note while the detached bulk job runs — the
    // processed-of-total readout under the busy dialog.
    piiBulkProgressLabel() {
      const p = this.piiBulkProgress || { done: 0, total: 0 };
      return this.translate('okf.editor.piiBulk.progress', 'Applying… {done}/{total}')
        .replace('{done}', String(p.done))
        .replace('{total}', String(p.total));
    },
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
    // A7-1: mirror RepoEditor — AddConceptModal must not offer a SECOND
    // index, and must show "Append to the index" once one exists.
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
          label: this.translate('common.delete', 'Delete'),
          variant: 'danger',
          disabled: this.deleting
        }
      ];
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
    },
    // #1040 bulk PII confirm strings — same keys/fallbacks as RepoEditor.
    piiFlaggedCount() {
      return this.concepts.filter((c) => c && c.pii_state === 'hit').length;
    },
    piiBulkTitle() {
      const action = this.piiBulkAsk || 'accept';
      const key = 'okf.editor.piiBulk.title.' + action;
      const fallback = {
        redact: 'Redact all flagged content',
        remove: 'Remove all flagged content',
        accept: 'Accept all flagged entities'
      }[action];
      return this.translate(key, fallback);
    },
    piiBulkBody() {
      const action = this.piiBulkAsk || 'accept';
      const key = 'okf.editor.piiBulk.body.' + action;
      const fallback = {
        redact: 'The body of every flagged concept is replaced with the redaction notice. This cannot be undone.',
        remove: 'The body of every flagged concept is emptied. This cannot be undone.',
        accept: 'All flagged entities are marked reviewed-and-kept — they will not be flagged again unless you re-scan.'
      }[action];
      return (
        this.translate(key, fallback) +
        ' ' +
        this.translate('okf.editor.piiBulk.scope', 'Concepts affected: {n}.').replace(
          '{n}',
          String(this.piiFlaggedCount)
        )
      );
    },
    piiBulkActions() {
      return [
        {
          key: 'cancel',
          label: this.translate('common.cancel', 'Cancel'),
          variant: 'secondary',
          disabled: this.piiBulkBusy
        },
        {
          key: 'confirm',
          label: this.translate('okf.editor.piiBulk.confirm', 'Apply'),
          variant: this.piiBulkAsk === 'accept' ? 'primary' : 'danger',
          disabled: this.piiBulkBusy
        }
      ];
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
    this.loadLabelOptions();
  },
  beforeUnmount() {
    // UX-4 (#1514): a detached bulk PII poll stops within one cadence when
    // the wizard leaves this step (the server job itself continues).
    if (this._bulkPiiSignal) this._bulkPiiSignal.aborted = true;
  },
  methods: {
    emitGate() {
      this.$emit('gate', this.canAdvance);
    },
    // #1040 bulk PII — same contract as RepoEditor: ask (the ConceptList
    // click), confirm dialog action, service call, tree refresh. The flagged
    // pill and the bulk buttons disappear as the refreshed rows come back
    // clean (pii_state 'clean' server-side on every flagged concept).
    onPiiBulkAsk(action) {
      if (this.piiBulkBusy || !this.piiFlaggedCount) return;
      this.piiBulkAsk = action;
    },
    async onPiiBulkAction(key) {
      if (key === 'cancel') {
        this.piiBulkAsk = null;
        return;
      }
      if (key !== 'confirm' || !this.piiBulkAsk || this.piiBulkBusy) return;
      this.piiBulkBusy = true;
      this.inputError = '';
      const action = this.piiBulkAsk;
      try {
        // UX-4 (#1514): the DETACHED job — the arm answers the same 409
        // drain-freeze / 400 the synchronous call did, and onProgress turns
        // the note into a live processed-of-total readout (a large flagged
        // set is minutes of sequential writes; the busy dialog alone froze
        // silently over them). The signal stops the client-side poll if the
        // wizard step unmounts mid-run (the server job continues).
        this._bulkPiiSignal = { aborted: false };
        this.piiBulkProgress = { done: 0, total: 0 };
        const result = await repoOkfService.bulkPiiActionDetached(this.repoId, action, {
          onProgress: (p) => {
            this.piiBulkProgress = { done: Number(p.processed || 0), total: Number(p.total || 0) };
          },
          signal: this._bulkPiiSignal
        });
        if (!result || !result.ok) {
          this.inputError = this.translate('okf.editor.piiBulk.failed', 'The bulk PII action failed — try again.');
          return;
        }
        await this.refreshConcepts();
        // Explicit post-action confirmation (David, #1040 follow-up): what
        // ran, on how many concepts — the pill clearing alone is too subtle.
        const affected = String((result && result.concepts_affected) || this.piiFlaggedCount || 0);
        const doneFallback = {
          accept:
            'Done — every flagged entity is marked reviewed-and-kept on {n} concept(s). The PII flags are cleared.',
          redact: 'Done — the flagged content on {n} concept(s) is replaced with the redaction notice.',
          remove: 'Done — the flagged content on {n} concept(s) is removed.'
        }[action];
        this.piiBulkNote = this.translate('okf.editor.piiBulk.done_' + action, doneFallback).replace('{n}', affected);
      } catch (err) {
        // REJECTED bulkPiiAction (round 19, #80773): httpService rejects on
        // HTTP errors (409 drain freeze, 5xx), and without this catch the
        // rejection escaped try/finally — busy reset, dialog closed, no
        // inputError, flags kept as if the action had run. The message
        // composer is the SHARED one (#80930 — same as RepoEditor's handler).
        console.debug('[OkfStepInput] bulk PII action rejected', {
          code: (err && err.code) || '',
          message: err && err.message
        });
        this.inputError = bulkPiiFailureMessage(err, this.translate);
      } finally {
        this.piiBulkBusy = false;
        this.piiBulkAsk = null;
        this.piiBulkProgress = null;
      }
    },
    // T2: the tree is the live truth — refreshed after EVERY mutation.
    async refreshConcepts() {
      if (!this.repoId) return;
      this.conceptsLoading = true;
      this.conceptsError = '';
      try {
        this.concepts = await repoOkfService.listConcepts(this.repoId);
        this.addedCount = this.concepts.length;
        // First-visit nudge for the blank-canvas steward (editor_offered
        // rides the draft so Back/Forward never re-pops a declined modal).
        // Verifier A7-minor: this waits for the RESOLVED list — mounted()
        // opened the modal against an empty array, so hasIndex was false
        // even when createRepo had already seeded an index skeleton and the
        // modal offered a second index type.
        if (
          this.variant === 'manual' &&
          this.concepts.length === 0 &&
          !((this.draft && this.draft.input && this.draft.input.editor_offered) || false)
        ) {
          this.addOpen = true;
          this.writeBack({ editor_offered: true });
        }
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
      // A2 (audit): each row carries its T1 origin stamp so Produce routes
      // crawl files through the per-file crawl converter and everything else
      // through the documents batch — dispatch must key on the FILE's
      // origin, not the draft variant (mixed picks are legal in any variant).
      this.selectedNames = rows.map((r) => ({
        file_id: r.file_id,
        file_name: r.file_name,
        source: r.source || null
      }));
      this.pickOpen = false;
      // Verifier B3: the selection CHANGED — any queued conversion legs from
      // a previous selection are dead; drop them so a mid-chain Back→
      // Continue can never kick a deselected file.
      this.writeBack({ convert_queue: [], converted_ids: null });
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
      this.fsSplitNote = '';
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
          // Send the payload AS BUILT (round 17, #80363): path carries the
          // `.md` suffix and concept_id rides explicitly — the SAME shape
          // addConcept sends to this /import upsert. The old bare-slug,
          // no-concept_id form minted a different identity per shape for the
          // same slug, silently defeating the documented slug-merge (A3/F13).
          concepts.push(payload);
        }
        let imported = null;
        if (concepts.length) imported = await repoOkfService.importConcepts(this.repoId, concepts);
        await this.refreshConcepts();
        this.writeBack();
        this.fsSplitNote = this.splitNoteFrom(imported);
        if (skipped) {
          this.fsError = this.translate('okf.steps.input.skippedEmpty', '{n} empty file(s) skipped.').replace(
            '{n}',
            String(skipped)
          );
        }
      } catch (err) {
        // A NAMED refusal (the concept-document ceiling, the concept cap) carries
        // the server's own explanation — the size, the ceiling and the remedy —
        // and it speaks for itself. The generic wording is advice that cannot
        // work for such a refusal: retrying an over-ceiling import fails
        // identically forever. Only a failure that names itself AND explains
        // itself surfaces the server's words; everything else (network, timeout)
        // keeps the generic text, which IS the right advice there. Same pattern
        // as the concept editor's save (ConceptEditor.vue saveErrorMessage).
        console.warn('[okf-input] import refused', err && { status: err.status, code: err.data && err.data.error });
        const serverMessage = err && err.data && err.data.error && err.data.message;
        this.fsError = serverMessage
          ? String(serverMessage)
          : this.translate('okf.steps.input.fsFailed', 'Import failed — check the files and retry.') || 'Import failed';
      } finally {
        this.fsBusy = false;
        if (evt && evt.target) evt.target.value = '';
      }
    },
    /**
     * Turn the import's `split_documents` report into one line the curator
     * reads: which file became how many concepts.
     *
     * The server is the ONLY thing that knows this — the wizard does not
     * measure a file against the ceiling, because the ceiling is
     * OKF_MAX_CONCEPT_DOC_CHARS and it is the server that enforces it. So the
     * note is rendered from the server's own answer, never from a local
     * copy of the rule.
     */
    splitNoteFrom(result) {
      const splits = (result && result.split_documents) || [];
      if (!Array.isArray(splits) || splits.length === 0) return '';
      const files = splits
        .map((s) =>
          this.translate('okf.steps.input.splitFile', '{file} ({parts} parts)')
            .replace('{file}', String(s.from))
            .replace('{parts}', String(s.into))
        )
        .join(', ');
      // The fallbacks stay INLINE and the call stays on ONE line: the i18n
      // contract test extracts okf.* keys per line, and the locale-consistency
      // guard only recognises a translate() whose fallback is a quoted literal.
      // A hoisted constant would drop this key out of BOTH guards silently.
      return this.translate('okf.steps.input.splitReport', '{n} file(s) split to fit the size limit: {files}')
        .replace('{n}', String(splits.length))
        .replace('{files}', files);
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
    // Verifier B6 (2026-09-29): the tree's inline set-label was a dead end —
    // ConceptList emits 'label' but the workbench never consumed it. Same
    // contract as the editor rail: write via applyLabel, refresh, persist.
    async onTreeLabel({ conceptId, label }) {
      if (this.readOnly || !this.repoId || !conceptId) return;
      try {
        await applyLabel(this.repoId, conceptId, label ? [label] : []);
        await this.refreshConcepts();
        this.writeBack();
      } catch {
        this.conceptsError = this.translate('okf.steps.input.labelFailed', 'Could not set the label.');
      }
    },
    // A7-5: the SAME Subject-Area-bounded KH label options the editor rail
    // loads (okfRepoOps.labelOptionsForDomain over the admin service tree).
    // A legacy domain with no KH match falls back to the full tree.
    async loadLabelOptions() {
      try {
        const categories = await serviceTreeService.getAdminCategories('en');
        const repo = this.repoId ? this.repoById(this.repoId) || {} : {};
        const { options } = labelOptionsForDomain(categories, repo.domain || '');
        this.labelOptions = options;
      } catch {
        this.labelOptions = []; // hierarchy unavailable — picker stays empty
      }
    },
    // A7-4: confirm-before-delete, mirroring the editor's contract.
    onDeleteAsk(node) {
      if (this.readOnly) return;
      this.deleteAsk = node;
    },
    async onDeleteAction(key) {
      if (key === 'cancel') {
        this.deleteAsk = null;
        return;
      }
      if (key !== 'confirm' || !this.deleteAsk || this.deleting) return;
      const node = this.deleteAsk;
      if (!node || !node.concept_id || !this.repoId) {
        this.deleteAsk = null;
        return;
      }
      this.deleting = true;
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
      } finally {
        this.deleting = false;
        this.deleteAsk = null;
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
/* #1040 post-action success line (role=status live region) */
.okf-step__pii-note {
  margin: 0;
  color: var(--success, var(--accent));
  font-size: var(--text-sm);
}
</style>
