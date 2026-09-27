<!-- Step 2: Choose workflow — Crawl / Documents / Manual / Clone. -->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">
      {{ translate('okf.steps.choose.title', 'Where should this OKF repository start?') }}
    </h3>
    <p class="okf-step__hint">
      {{ translate('okf.steps.choose.hint', 'Pick how you want to seed this repository. You can change it later.') }}
    </p>
    <div class="okf-step__cards">
      <button
        v-for="src in sources"
        :key="src.value"
        type="button"
        class="okf-step__card"
        :class="{ 'okf-step__card--selected': local.source === src.value }"
        @click="pick(src.value)"
      >
        <span class="okf-step__card-title">{{ translate(src.titleKey, src.title) }}</span>
        <span class="okf-step__card-desc">{{ translate(src.descKey, src.desc) }}</span>
      </button>
    </div>

    <!-- CLONE: the source picker. Amendment A decision (David, 2026-09-27):
         clone is REAL — the topics are imported from the chosen draft
         repository on Continue (idempotent /import upsert, so re-running
         refreshes instead of duplicating). -->
    <div v-if="local.source === 'clone'" class="okf-step__clone">
      <label class="okf-step__clone-field">
        <span>{{ translate('okf.steps.choose.cloneSource', 'Source repository (not yet serving)') }}</span>
        <DsSelect v-model="local.clone_source_repo_id" size="sm" @change="pickSource">
          <option value="" disabled>
            {{ translate('okf.steps.choose.clonePh', 'Select the repository to clone from') }}
          </option>
          <option v-for="r in cloneSources" :key="r.repo_id" :value="r.repo_id">{{ r.name }}</option>
        </DsSelect>
      </label>
      <DsInfoTip
        :text="
          translate(
            'okf.glossary.cloneSource',
            'Cloning copies the topics AND their labels into your new repository — nothing is ingested; the clone is a normal draft you can edit freely. Only repositories that are not yet serving can be cloned.'
          )
        "
      />
      <p v-if="cloning" class="okf-step__note">
        {{ translate('okf.steps.choose.cloning', 'Cloning topics into this repository…') }}
      </p>
      <p v-if="cloneError" class="okf-step__error">{{ cloneError }}</p>
    </div>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import DsInfoTip from '../../ds/InfoTip.vue';
import DsSelect from '../../ds/Select.vue';
import repoOkfService from '../../../services/repoOkfService';
import translateMixin from '../../../mixins/translateMixin';

const SOURCES = [
  {
    value: 'documents',
    title: 'Documents',
    desc: 'Lift topics from documents you have already uploaded.',
    titleKey: 'okf.steps.choose.source.documents.title',
    descKey: 'okf.steps.choose.source.documents.desc'
  },
  {
    value: 'crawl',
    title: 'Website crawl',
    desc: 'Crawl a website and propose topics from the pages.',
    titleKey: 'okf.steps.choose.source.crawl.title',
    descKey: 'okf.steps.choose.source.crawl.desc'
  },
  {
    value: 'manual',
    title: 'Blank canvas',
    desc: 'Start from scratch and write topics yourself.',
    titleKey: 'okf.steps.choose.source.manual.title',
    descKey: 'okf.steps.choose.source.manual.desc'
  },
  {
    value: 'clone',
    title: 'Clone of an existing repository',
    desc: 'Fork the topics and structure from another OKF repository.',
    titleKey: 'okf.steps.choose.source.clone.title',
    descKey: 'okf.steps.choose.source.clone.desc'
  }
];

export default {
  name: 'OkfStepChoose',
  components: { DsInfoTip, DsSelect },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['update', 'gate'],
  data() {
    return {
      local: {
        source: (this.draft && this.draft.source) || '',
        clone_source_repo_id: (this.draft && this.draft.clone_source_repo_id) || ''
      },
      sources: SOURCES,
      cloning: false,
      cloneError: ''
    };
  },
  computed: {
    ...mapGetters('okf', ['reposByStage', 'repoById']),
    // Cloneable sources: repos that are NOT serving (decision #9) —
    // flattened from the dashboard's stage lanes.
    cloneSources() {
      const lanes = this.reposByStage || {};
      const seen = new Set();
      const out = [];
      Object.keys(lanes).forEach((stage) => {
        (lanes[stage] || []).forEach((r) => {
          if (seen.has(r.repo_id)) return;
          seen.add(r.repo_id);
          if (!r.ingested_at && !r.deleted_at) out.push(r);
        });
      });
      return out;
    },
    // A2 gate: a workflow must be chosen — and a clone needs its source.
    canAdvance() {
      if (!this.local.source) return false;
      if (this.local.source === 'clone') return !!this.local.clone_source_repo_id;
      return true;
    }
  },
  mounted() {
    this.emitGate();
  },
  methods: {
    // A1 write-back: the choice lives in the draft — re-entry restores it.
    pick(value) {
      this.local.source = value;
      this.$emit('update', { source: value });
      this.emitGate();
    },
    pickSource() {
      this.$emit('update', { clone_source_repo_id: this.local.clone_source_repo_id });
      this.emitGate();
    },
    emitGate() {
      this.$emit('gate', this.canAdvance);
    },
    // A3: the shell awaits this BEFORE advancing. Clone copies the source's
    // concepts (frontmatter + body) into the repo Entry already created via
    // the standard /import upsert — no destroy-and-mint dance, no duplicate
    // (name,domain) 409 against the async 202 delete.
    async beforeAdvance() {
      if (this.local.source !== 'clone') return true;
      const sourceId = this.local.clone_source_repo_id;
      if (!sourceId || !(this.draft && this.draft.repo_id)) {
        this.cloneError = this.translate('okf.steps.choose.cloneNeed', 'Pick the repository to clone from first.');
        return false;
      }
      this.cloning = true;
      this.cloneError = '';
      try {
        const rows = await repoOkfService.listConcepts(sourceId);
        const concepts = [];
        const CHUNK = 5;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const details = await Promise.all(
            rows.slice(i, i + CHUNK).map((r) => repoOkfService.getConcept(sourceId, r.concept_id).catch(() => null))
          );
          details.forEach((d) => {
            if (!d) return;
            concepts.push({
              path: d.path || d.concept_id,
              frontmatter: d.frontmatter || { type: 'topic', title: d.title || d.path },
              body: d.body || ''
            });
          });
        }
        if (concepts.length) await repoOkfService.importConcepts(this.draft.repo_id, concepts);
        this.$emit('update', {
          cloned_from: sourceId,
          clone_source_repo_id: sourceId,
          concept_count: concepts.length
        });
        return true;
      } catch {
        this.cloneError = this.translate('okf.steps.choose.cloneFailed', 'The clone failed — try again.');
        return false;
      } finally {
        this.cloning = false;
      }
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
.okf-step__cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}
.okf-step__card {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  text-align: left;
  padding: var(--space-md);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font: inherit;
  color: var(--fg);
}
.okf-step__card:hover {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-step__card--selected {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-step__card-title {
  font-weight: 600;
}
.okf-step__card-desc {
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step__clone {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.okf-step__clone-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  font-size: var(--text-sm);
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
