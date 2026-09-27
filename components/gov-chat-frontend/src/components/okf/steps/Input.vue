<!--
  OkfStepInput.vue — Amendment A slice 4a (B1): the REAL input panels.

    documents — the dual-source dialog (OkfSourceDialog): pick from the
                document repository AND/OR upload from this computer →
                Produce runs the whole-corpus conversion into THIS repo
                (repo_id passthrough).
    crawl     — the same dialog in single mode (no upload): one crawled
                doc-repo file → Produce runs the crawl conversion
                (per-page split default).
    manual    — the EDITOR is the surface: it opens on arrival (first
                visit), markdown files from the file system remain
                available; each lands immediately via the standard import
                route (idempotent upsert).
    clone     — the fork already landed the content; nothing to add here.

  Selections write back to the draft (A1) and the gate reflects readiness.
  The input patch SPREADS the existing draft.input — the wizard merges
  patches shallowly, so a whole-object replace would drop Produce's
  conversion_kicked flag on a Back-visit.
-->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.input.title', 'Inputs') }}</h3>
    <p class="okf-step__hint">{{ hintText }}</p>

    <!-- DOCUMENTS / CRAWL: the dual-source picker dialog -->
    <template v-if="variant === 'documents' || variant === 'crawl'">
      <div class="okf-step__manual">
        <DsButton variant="primary" small @click="pickOpen = true">
          {{
            variant === 'crawl'
              ? translate('okf.steps.input.chooseCrawl', 'Choose the crawled document')
              : translate('okf.steps.input.chooseDocs', 'Choose source documents')
          }}
        </DsButton>
        <DsInfoTip
          :text="
            translate(
              'okf.glossary.pickSource',
              'Sources feed the producer, which proposes topics for your review — nothing is committed until you sign off in Curate. Documents already ingested for free-form RAG are allowed; your repository stays gated from ingesting until they are retracted.'
            )
          "
        />
      </div>
      <p class="okf-step__note">{{ selectionSummary }}</p>
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
              'okf.glossary.classification',
              'How the producer decides the labels for each topic: heuristics is fast and free; LLM reads every page (better for complex layouts); hybrid starts heuristic and escalates the hard ones. Curation only — it never triggers ingestion.'
            )
          "
        />
      </label>
      <OkfSourceDialog
        :visible="pickOpen"
        :mode="variant === 'crawl' ? 'single' : 'multi'"
        :allow-upload="variant === 'documents'"
        :selected="selectedIds"
        @close="pickOpen = false"
        @confirm="onSourcesConfirmed"
      />
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

    <!-- MANUAL: the editor is the surface; FS markdown stays available -->
    <template v-else>
      <div class="okf-step__manual">
        <DsButton variant="primary" small @click="addOpen = true">
          {{ translate('okf.steps.input.writeOne', 'Open the editor') }}
        </DsButton>
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
import DsSelect from '../../ds/Select.vue';
import OkfAddConceptModal from '../editor/AddConceptModal.vue';
import OkfSourceDialog from '../wizard/OkfSourceDialog.vue';
import repoOkfService from '../../../services/repoOkfService';
import { buildConceptPayload } from '../../../services/okfRepoOps';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepInput',
  components: { DsButton, DsInfoTip, DsSelect, OkfAddConceptModal, OkfSourceDialog },
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
        documents: 'Pick the documents that should seed the topic list — from the repository or your computer.',
        crawl: 'Pick the crawled document to turn into topics.',
        manual: 'Write your topics in the editor, or add markdown files from your computer.',
        clone: 'This repository is a clone — its topics are already in place.'
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
    },
    // C1: the classification choice rides the draft so Produce's kick uses
    // it (the curation spec's user-selectable heuristics|llm|hybrid).
    classification(v) {
      this.$emit('update', { classification: v });
    }
  },
  mounted() {
    this.emitGate();
    // The editor IS the blank-canvas surface (David, 2026-09-27): open it on
    // the first arrival. editor_offered rides the draft so Back/Forward and
    // re-entry don't re-pop the modal once declined.
    if (
      this.variant === 'manual' &&
      this.addedCount === 0 &&
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
    // per-field. addedCount is refreshed from the SERVER truth after every
    // import (a local += drifted from the upsert reality).
    async onFsFiles(evt) {
      const picked = (evt && evt.target && evt.target.files) || [];
      if (!picked.length) return;
      this.fsBusy = true;
      this.fsError = '';
      try {
        const existing = (await repoOkfService.listConcepts(this.draft.repo_id)).map((c) => c.concept_id);
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
        if (concepts.length) await repoOkfService.importConcepts(this.draft.repo_id, concepts);
        this.addedCount = (await repoOkfService.listConcepts(this.draft.repo_id)).length;
        this.writeBack();
        this.emitGate();
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
.okf-step__manual {
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
.okf-step__fs-tip {
  display: inline-flex;
  align-items: center;
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
