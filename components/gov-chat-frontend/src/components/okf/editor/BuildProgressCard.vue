<!-- OkfBuildProgressCard.vue — BUILDING GATE metrics card (David, 2026-09-03).
  Hover popup content for Studio dashboard cards, split by the import/RAG
  boundary (David, 2026-09-04): IMPORT phase (stage 1) shows conversion
  progress only — RAG indexing does not run before the lifecycle ingest
  transition; RAG phase (armed at ingest via repo.rag_ingestion) shows
  index progress instead. Self-refreshing (polls the repo every 5s while
  mounted) so the numbers move without a dashboard refresh — same
  self-fetching pattern as LogsDialog. Pure display + one service read. -->
<template>
  <div class="okf-bp">
    <header class="okf-bp__head">
      <span class="okf-bp__title">{{ title }}</span>
      <span class="okf-bp__head-pills">
        <!-- D-B (David, 2026-09-07) + ALL-STAGES (David, 2026-09-12): the
             curation method and the LIFECYCLE stage are badges on EVERY
             popup, at every stage — heuristics|llm|hybrid and
             importing|reviewing|ingesting|serving|retracted. The
             fine-grained machine stage (queued/splitting/adding/indexing)
             stays in the body rows where it has progress to anchor it. -->
        <DsPill v-if="classificationMethod" variant="neutral">{{ classificationMethod }}</DsPill>
        <DsPill :variant="lifecycleVariant">{{ lifecycleStageLabel }}</DsPill>
      </span>
    </header>
    <template v-if="phase === 'rag'">
      <div class="okf-bp__metric">
        <span class="okf-bp__big">{{ ragDone }} / {{ ragTotal }}</span>
        <span class="okf-bp__pct">{{ pct }}%</span>
      </div>
      <div class="okf-bp__metric-label">
        {{ translate('okf.build.conceptsIndexed', 'concepts indexed') }}
      </div>
      <div class="okf-bp__bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
        <div class="okf-bp__bar-fill" :style="{ width: pct + '%' }"></div>
      </div>
      <p v-if="ragError" class="okf-bp__hint">{{ ragError }}</p>
    </template>
    <dl v-if="phase === 'serving' && servingRows.length" class="okf-bp__rows">
      <div v-for="row in servingRows" :key="row.k" class="okf-bp__row">
        <dt>{{ row.k }}</dt>
        <dd>{{ row.v }}</dd>
      </div>
    </dl>
    <dl v-if="statusRows.length" class="okf-bp__rows">
      <div v-for="row in statusRows" :key="row.k" class="okf-bp__row">
        <dt>{{ row.k }}</dt>
        <dd>{{ row.v }}</dd>
      </div>
    </dl>
    <!-- P0-UI FAILED-state clarity (David, 2026-09-08: "100% clarity on what
         went wrong and how to fix"): a drain that finished with failures
         must NEVER look healthy — the card shows BOTH that it serves AND
         which concepts failed, why, and the fix path. -->
    <div v-if="failedConcepts.length" class="okf-bp__failures">
      <p class="okf-bp__failures-title">{{ failedHeading }}</p>
      <ul class="okf-bp__failures-list">
        <li v-for="f in failureRows" :key="f.concept_id">
          <code>{{ f.concept_id }}</code> — {{ f.error }}
        </li>
      </ul>
      <p v-if="failedExtra > 0" class="okf-bp__hint">
        {{ translate('okf.build.drainFailed.more', '+ {n} more').replace('{n}', String(failedExtra)) }}
      </p>
      <p class="okf-bp__hint">
        {{ translate('okf.build.drainFailed.fixPath', 'Re-ingest to retry: retract → create version → ingest.') }}
      </p>
    </div>
    <dl v-if="phase !== 'serving' && conversionRows.length" class="okf-bp__rows">
      <div v-for="row in conversionRows" :key="row.k" class="okf-bp__row">
        <dt>{{ row.k }}</dt>
        <dd>{{ row.v }}</dd>
      </div>
    </dl>
    <!-- D-B curation stats: the LLM pass's visible progress (per-concept
         label/description/type coverage), rendered only when the repo
         carries a curation payload. -->
    <dl v-if="phase === 'import' && curationRows.length" class="okf-bp__rows">
      <div v-for="row in curationRows" :key="row.k" class="okf-bp__row">
        <dt>{{ row.k }}</dt>
        <dd>{{ row.v }}</dd>
      </div>
    </dl>
    <p v-if="elapsed" class="okf-bp__hint">{{ elapsed }}</p>
    <p class="okf-bp__hint">{{ hint }}</p>
  </div>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsPill from '../../ds/Pill.vue';
import repoOkfService from '../../../services/repoOkfService';

const STAGES = [
  ['queued', 'Queued'],
  ['downloading', 'Downloading'],
  ['splitting', 'Splitting'],
  ['adding', 'Adding']
];

export default {
  name: 'OkfBuildProgressCard',
  components: { DsPill },
  mixins: [translateMixin],
  props: {
    /** The card's cached repo — instant first render; refreshed below. */
    repo: { type: Object, required: true }
  },
  data() {
    return { fresh: null, timer: null };
  },
  computed: {
    view() {
      return this.fresh || this.repo || {};
    },
    /** ALL-STAGES popup (David, 2026-09-12): serving | rag | import keep
     * their progress bodies; review | retracted | idle give every other
     * lifecycle stage a real popup with badges + summary rows. */
    phase() {
      if (this.view.ingested_at) return 'serving';
      if (this.view.lifecycle_state === 'retracted') return 'retracted';
      const rag = this.view.rag_ingestion;
      if (rag && rag.status === 'draining') return 'rag';
      if (['review', 'approve'].includes(this.view.lifecycle_state)) return 'review';
      const conv = this.view.conversion;
      if (conv && !['done', 'failed'].includes(conv.status)) return 'import';
      return 'idle';
    },
    title() {
      if (this.phase === 'serving') return this.translate('okf.build.title.serving', 'Serving status');
      if (this.phase === 'rag') return this.translate('okf.build.title.rag', 'Ingestion progress');
      if (this.phase === 'review') return this.translate('okf.build.title.review', 'Review status');
      if (this.phase === 'retracted') return this.translate('okf.build.title.retracted', 'Retraction status');
      if (this.phase === 'idle') return this.translate('okf.build.title.idle', 'Repository status');
      return this.translate('okf.build.title.import', 'Import progress');
    },
    // THE BADGES (David, 2026-09-12): the lifecycle stage at a glance —
    // importing | reviewing | ingesting | serving | retracted.
    lifecycleStage() {
      if (this.phase === 'serving') return 'serving';
      if (this.phase === 'rag') return 'ingesting';
      if (this.phase === 'review') return 'reviewing';
      if (this.phase === 'retracted') return 'retracted';
      return 'importing';
    },
    lifecycleStageLabel() {
      const fallback = {
        importing: 'Importing',
        reviewing: 'Reviewing',
        ingesting: 'Ingesting',
        serving: 'Serving',
        retracted: 'Retracted'
      }[this.lifecycleStage];
      return this.translate('okf.build.lifecycle.' + this.lifecycleStage, fallback);
    },
    lifecycleVariant() {
      return {
        serving: 'success',
        ingesting: 'info',
        importing: 'accent',
        reviewing: 'warning',
        retracted: 'neutral'
      }[this.lifecycleStage];
    },
    // The curation classification badge — EVERY stage (the old card showed
    // it only during import and only from the curation payload; the repo's
    // persisted classification is the durable source).
    classificationMethod() {
      const m = this.view.classification || (this.curation && this.curation.method);
      return ['heuristics', 'llm', 'hybrid'].includes(m) ? m : '';
    },
    servingRows() {
      if (this.phase !== 'serving') return [];
      const rows = [];
      if (this.view.version) {
        rows.push({ k: this.translate('okf.build.serving.version', 'Serving version'), v: 'v' + this.view.version });
      }
      if (this.view.ingested_graph_name) {
        rows.push({ k: this.translate('okf.build.serving.graph', 'Serving graph'), v: this.view.ingested_graph_name });
      }
      const rag = this.view.rag_ingestion;
      if (rag && typeof rag.concepts_total === 'number') {
        rows.push({
          k: this.translate('okf.build.conceptsIndexed', 'concepts indexed'),
          v: (rag.concepts_done || 0) + ' / ' + rag.concepts_total
        });
      }
      return rows;
    },
    // Summary rows for the non-progress phases (review | retracted | idle):
    // identity + scale, so every popup says something true about the repo.
    statusRows() {
      if (!['review', 'retracted', 'idle'].includes(this.phase)) return [];
      const rows = [];
      if (this.view.domain) {
        rows.push({ k: this.translate('okf.build.row.subject', 'Subject area'), v: this.view.domain });
      }
      if (typeof this.view.concept_count === 'number') {
        rows.push({ k: this.translate('okf.build.row.topics', 'Topics'), v: String(this.view.concept_count) });
      }
      if (this.view.version) {
        rows.push({
          k: this.translate('okf.build.row.lastVersion', 'Last version'),
          v: 'v' + this.view.version
        });
      }
      return rows;
    },
    ragDone() {
      const rag = this.view.rag_ingestion;
      return (rag && rag.concepts_done) || 0;
    },
    ragTotal() {
      const rag = this.view.rag_ingestion;
      return (rag && rag.concepts_total) || 0;
    },
    ragError() {
      const rag = this.view.rag_ingestion;
      return (rag && rag.error) || '';
    },
    // P0-UI FAILED-state clarity: rag_ingestion.failed_concepts
    // [{concept_id, error}] — 65's honest row-failures shape. Fully
    // guarded: absent on healthy/old records renders nothing.
    failedConcepts() {
      const rag = this.view.rag_ingestion;
      const list = rag && Array.isArray(rag.failed_concepts) ? rag.failed_concepts : [];
      return list.filter((f) => f && (f.concept_id || f.error));
    },
    failureRows() {
      return this.failedConcepts.slice(0, 5);
    },
    failedExtra() {
      return Math.max(0, this.failedConcepts.length - 5);
    },
    failedHeading() {
      const n = this.failedConcepts.length;
      // partial-serving phrasing when the version IS live — a partial must
      // never read as healthy, nor as a total failure.
      const key = this.phase === 'serving' ? 'okf.build.drainFailed.partialHeading' : 'okf.build.drainFailed.heading';
      const fallback =
        this.phase === 'serving' ? 'Serving, but {n} concepts failed to ingest.' : '{n} concepts failed to ingest.';
      return this.translate(key, fallback).replace('{n}', String(n));
    },
    stage() {
      if (this.phase === 'serving') return 'serving';
      const c = this.view.conversion;
      if (c && !['done', 'failed'].includes(c.status)) return c.stage || c.status || 'queued';
      return 'indexing';
    },
    stageLabel() {
      if (this.stage === 'indexing') return this.translate('okf.build.stage.indexing', 'Indexing');
      if (this.stage === 'serving') return this.translate('okf.build.stage.serving', 'Serving');
      const hit = STAGES.find(([k]) => k === this.stage);
      return this.translate('okf.build.stage.' + this.stage, hit ? hit[1] : this.stage);
    },
    pct() {
      if (!this.ragTotal) return 0;
      return Math.min(100, Math.round((this.ragDone / this.ragTotal) * 100));
    },
    conversionRows() {
      const c = this.view.conversion;
      if (!c || ['done', 'failed'].includes(c.status)) return [];
      // The fine-grained machine stage anchors the lifecycle badge (the
      // head pill shows Importing; this row shows queued/splitting/adding).
      const rows = [{ k: this.translate('okf.build.stage.label', 'Stage'), v: this.stageLabel }];
      if (typeof c.pages_done === 'number') {
        rows.push({ k: this.translate('okf.build.pages', 'Pages processed'), v: String(c.pages_done) });
      }
      if (typeof c.batches_done === 'number') {
        rows.push({ k: this.translate('okf.build.batches', 'Batches stored'), v: String(c.batches_done) });
      }
      if (c.bytes_total) {
        rows.push({
          k: this.translate('okf.build.bytes', 'Source read'),
          v: this.fmtBytes(c.bytes_done || 0) + ' / ' + this.fmtBytes(c.bytes_total)
        });
      }
      return rows;
    },
    // D-B: the LLM curation pass payload (absent on old repos). Field names
    // settle with the coordinator's llm-curation-service landing — every
    // access is guarded so an absent/differently-shaped payload renders
    // nothing rather than breaking the card.
    curation() {
      const c = this.view.curation;
      return c && typeof c === 'object' ? c : null;
    },
    curationRows() {
      const c = this.curation;
      if (!c || this.phase !== 'import') return [];
      const rows = [];
      // Coordinator's final payload: {method, total, curated, labeled,
      // described, typed, fallbacks, done?} — total is the denominator;
      // concepts_total accepted as a legacy alias mid-landing.
      const total =
        typeof c.total === 'number' ? c.total : typeof c.concepts_total === 'number' ? c.concepts_total : null;
      const stat = (n) => (total !== null ? (n || 0) + ' / ' + total : String(n || 0));
      if (typeof c.curated === 'number') {
        rows.push({ k: this.translate('okf.build.curation.curated', 'Curated'), v: stat(c.curated) });
      }
      if (typeof c.labeled === 'number') {
        rows.push({ k: this.translate('okf.build.curation.labeled', 'Labeled'), v: stat(c.labeled) });
      }
      if (typeof c.described === 'number') {
        rows.push({ k: this.translate('okf.build.curation.described', 'Described'), v: stat(c.described) });
      }
      if (typeof c.typed === 'number') {
        rows.push({ k: this.translate('okf.build.curation.typed', 'Typed'), v: stat(c.typed) });
      }
      if (typeof c.fallbacks === 'number' && c.fallbacks > 0) {
        rows.push({ k: this.translate('okf.build.curation.fallbacks', 'LLM fallbacks'), v: String(c.fallbacks) });
      }
      return rows;
    },
    elapsed() {
      // Only the two RUNNING phases show an elapsed line — review/retracted/
      // idle popups are status summaries, not clocks.
      if (!['import', 'rag'].includes(this.phase)) return '';
      // PHASE-AWARE (David's "Started 222 h ago", 2026-09-08): the drain's
      // start is the drain record's requested_at — NEVER the import
      // conversion's started_at (frozen at crawl time; Kenya showed a
      // 9-day-old import timestamp during a live v10 drain).
      let started;
      if (this.phase === 'import') {
        started = this.view.conversion && this.view.conversion.started_at;
      } else {
        started = (this.view.rag_ingestion && this.view.rag_ingestion.requested_at) || this.view.ingested_at;
      }
      if (!started) return '';
      const ms = Date.now() - new Date(started).getTime();
      if (!(ms > 0)) return '';
      const mins = Math.floor(ms / 60000);
      if (mins < 1) return this.translate('okf.build.elapsed.lt1', 'Started less than a minute ago');
      if (mins < 60) {
        return this.translate('okf.build.elapsed.min', 'Started {n} min ago').replace('{n}', String(mins));
      }
      const h = Math.floor(mins / 60);
      return this.translate('okf.build.elapsed.hr', 'Started {n} h ago').replace('{n}', String(h));
    },
    // Per-phase guidance line — the ALL-STAGES popup always ends with what
    // is true now and what happens next.
    hint() {
      const hints = {
        serving: ['okf.build.hint.serving', 'This version is serving RAG traffic — retract it to make changes.'],
        rag: [
          'okf.build.hint.rag',
          'The RAG index is building — the version starts serving once every concept is indexed.'
        ],
        import: ['okf.build.hint.import', 'The repository stays in Import until the file conversion completes.'],
        review: ['okf.build.hint.review', 'In review — a reviewer signs off, then the steward publishes and ingests.'],
        retracted: [
          'okf.build.hint.retracted',
          'Out of service — Submit → Review → Approve → Publish → Ingest to re-serve.'
        ],
        idle: ['okf.build.hint.idle', 'Import complete — Submit for review to continue the workflow.']
      };
      const [key, fallback] = hints[this.phase] || hints.idle;
      return this.translate(key, fallback);
    }
  },
  mounted() {
    this.refresh();
    this.timer = setInterval(this.refresh, 5000);
  },
  beforeUnmount() {
    if (this.timer) clearInterval(this.timer);
  },
  methods: {
    async refresh() {
      try {
        const fresh = await repoOkfService.get(this.repo.repo_id);
        if (fresh && fresh.repo_id) this.fresh = fresh;
      } catch {
        /* keep the cached view — a transient failure must not blank the popup */
      }
    },
    fmtBytes(n) {
      const units = ['B', 'KB', 'MB', 'GB'];
      let v = Number(n) || 0;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
      }
      return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + units[i];
    }
  }
};
</script>

<style scoped>
.okf-bp {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  font-size: var(--text-sm);
}
.okf-bp__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-sm);
}
.okf-bp__head-pills {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
}
.okf-bp__title {
  font-weight: 600;
}
.okf-bp__metric {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
}
.okf-bp__big {
  font-size: var(--text-lg);
  font-weight: 700;
  font-family: var(--font-mono);
}
.okf-bp__pct {
  color: var(--accent);
  font-weight: 600;
}
.okf-bp__metric-label {
  color: var(--muted);
  margin-top: -2px;
}
.okf-bp__bar {
  height: 6px;
  border-radius: 100px;
  background: var(--accent-muted);
  overflow: hidden;
}
.okf-bp__bar-fill {
  height: 100%;
  border-radius: 100px;
  background: var(--accent);
  transition: width 0.4s ease;
}
.okf-bp__rows {
  margin: var(--space-xs) 0 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.okf-bp__row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-md);
}
.okf-bp__row dt {
  color: var(--muted);
}
.okf-bp__row dd {
  margin: 0;
  font-family: var(--font-mono);
}
.okf-bp__hint {
  margin: var(--space-xs) 0 0;
  color: var(--muted);
  font-size: var(--text-xs);
}
.okf-bp__failures {
  margin-top: var(--space-sm);
  padding: var(--space-sm);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  background: var(--danger-bg);
}
.okf-bp__failures-title {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-sm);
  font-weight: 600;
}
.okf-bp__failures-list {
  margin: var(--space-xs) 0 0;
  padding-left: var(--space-lg);
  font-size: var(--text-xs);
  color: var(--fg);
}
.okf-bp__failures-list li + li {
  margin-top: 2px;
}
</style>
