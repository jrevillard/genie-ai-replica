<!-- OkfBuildProgressCard.vue — BUILDING GATE metrics card (David, 2026-09-03).
  Hover popup content for Studio dashboard cards: creation progress at a
  glance. Self-refreshing (polls the repo every 5s while mounted) so the
  numbers move without a dashboard refresh — same self-fetching pattern as
  LogsDialog. Pure display + one service read; no store coupling. -->
<template>
  <div class="okf-bp">
    <header class="okf-bp__head">
      <span class="okf-bp__title">{{ translate('okf.build.title', 'Build progress') }}</span>
      <DsPill variant="info">{{ stageLabel }}</DsPill>
    </header>
    <div class="okf-bp__metric">
      <span class="okf-bp__big">{{ indexed }} / {{ total }}</span>
      <span class="okf-bp__pct">{{ pct }}%</span>
    </div>
    <div class="okf-bp__metric-label">
      {{ translate('okf.build.conceptsIndexed', 'concepts indexed') }}
    </div>
    <div class="okf-bp__bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
      <div class="okf-bp__bar-fill" :style="{ width: pct + '%' }"></div>
    </div>
    <dl v-if="conversionRows.length" class="okf-bp__rows">
      <div v-for="row in conversionRows" :key="row.k" class="okf-bp__row">
        <dt>{{ row.k }}</dt>
        <dd>{{ row.v }}</dd>
      </div>
    </dl>
    <p v-if="elapsed" class="okf-bp__hint">{{ elapsed }}</p>
    <p class="okf-bp__hint">
      {{ translate('okf.build.hint', 'The repository stays In progress until every concept shows Indexed.') }}
    </p>
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
    stage() {
      const c = this.view.conversion;
      if (c && !['done', 'failed'].includes(c.status)) return c.stage || c.status || 'queued';
      return 'indexing';
    },
    stageLabel() {
      if (this.stage === 'indexing') return this.translate('okf.build.stage.indexing', 'Indexing');
      const hit = STAGES.find(([k]) => k === this.stage);
      return this.translate('okf.build.stage.' + this.stage, hit ? hit[1] : this.stage);
    },
    total() {
      return this.view.concept_count || 0;
    },
    indexed() {
      const pending = this.view.indexing_pending || 0;
      return Math.max(0, this.total - pending);
    },
    pct() {
      if (!this.total) return 0;
      return Math.min(100, Math.round((this.indexed / this.total) * 100));
    },
    conversionRows() {
      const c = this.view.conversion;
      if (!c || ['done', 'failed'].includes(c.status)) return [];
      const rows = [];
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
    elapsed() {
      const started = (this.view.conversion && this.view.conversion.started_at) || this.view.created_at;
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
</style>
