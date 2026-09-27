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

    <!-- CLONE: the source picker. Amendment A decision #9 (David,
         2026-09-27): clone is REAL — on Continue the 4.8 clone API copies
         the source wholesale (concepts, links, PII state, labels) into a
         repo cloned under this draft's name. Switching the workflow card
         clears any Input selection so ids never leak across variants. -->
    <div v-if="local.source === 'clone'" class="okf-step__clone">
      <label class="okf-step__clone-field">
        <span>{{ translate('okf.steps.choose.cloneSource', 'Source repository (not yet serving)') }}</span>
        <DsSelect v-model="local.clone_source_repo_id" size="sm">
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
    // Cloneable sources: repos that are NOT serving (decision #9). The
    // stage lanes carry repo_id STRINGS (store laneFor) — resolve each
    // through repoById (max-review F3: treating ids as objects rendered
    // one blank option and disabled the non-serving filter).
    cloneSources() {
      const lanes = this.reposByStage || {};
      const seen = new Set();
      const out = [];
      Object.keys(lanes).forEach((stage) => {
        (lanes[stage] || []).forEach((id) => {
          if (seen.has(id)) return;
          seen.add(id);
          const r = this.repoById(id);
          if (r && !r.ingested_at && !r.deleted_at) out.push(r);
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
  watch: {
    // v-model ordering: DsSelect spreads $attrs (the parent's @change)
    // BEFORE its own update emit, so a change handler read the PREVIOUS
    // value (max-review F6). The watcher sees the post-update value.
    'local.clone_source_repo_id'(v) {
      this.$emit('update', { clone_source_repo_id: v });
      this.emitGate();
    },
    // G3: switching the workflow card clears the Input selection so stale
    // document_ids never cross variants (a crawl kick would convert only
    // ids[0] of a documents selection).
    'local.source'(v, old) {
      if (old && v !== old) this.$emit('update', { input: null });
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
    emitGate() {
      this.$emit('gate', this.canAdvance);
    },
    // A3: the shell awaits this BEFORE advancing. The 4.8 clone API copies
    // the source wholesale (meta verbatim: links, PII state, labels) — the
    // decision-#9 sanctioned path. Entry's empty shell holds the target
    // (name,domain), and clone mints its own repo, so the shell is deleted
    // first; its 202 delete is ASYNC, so a 409 (name still registered) is
    // retried with backoff.
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
        try {
          await repoOkfService.deleteRepo(this.draft.repo_id);
        } catch {
          /* tolerate — the clone retry below still surfaces a real failure */
        }
        let clone = null;
        let lastErr = null;
        for (let attempt = 0; attempt < 3 && !clone; attempt++) {
          try {
            clone = await repoOkfService.clone(sourceId, {
              name: this.draft.name,
              domain: this.draft.domain
            });
          } catch (err) {
            lastErr = err;
            if (err && err.status === 409) {
              await new Promise((r) => setTimeout(r, 1200));
            } else {
              break;
            }
          }
        }
        if (!clone || !clone.repo_id) {
          this.cloneError =
            lastErr && lastErr.status === 409
              ? this.translate(
                  'okf.steps.choose.cloneBusy',
                  'The previous repository is still being removed — go Back and Continue again in a moment.'
                )
              : this.translate('okf.steps.choose.cloneFailed', 'The clone failed — try again.');
          return false;
        }
        this.$emit('update', {
          repo_id: clone.repo_id,
          name: clone.name || this.draft.name,
          cloned_from: sourceId,
          clone_source_repo_id: sourceId,
          concept_count: clone.concept_count || 0
        });
        this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {});
        return true;
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
