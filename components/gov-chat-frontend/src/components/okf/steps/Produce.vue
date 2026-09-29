<!--
  OkfStepProduce.vue — Amendment A slice 4 (B2 for documents/crawl): runs the
  EXISTING conversion services into THIS repo (repo_id passthrough) and shows
  REAL progress. Manual/clone content skips production — the gate opens at
  once (nothing to generate).

  Idempotency (max-review F5 hardening): a kick whose POST FAILED is resumed
  as FAILED with a Retry — never as a phantom "running". A recorded
  conversion only counts for the inputs it converted (converted_ids): picking
  NEW sources re-kicks. Progress reads whichever counter pair the backend
  actually writes (documents: files_done/files_total; crawl: pages_done +
  bytes; max-review C2). Producer 409s (DUPLICATE_CONTENT,
  CONVERSION_IN_FLIGHT) surface with their actionable message (F10).
-->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.produce.title', 'Generate topics') }}</h3>
    <p class="okf-step__hint">
      {{ translate('okf.steps.produce.hint', 'We are reading your sources and proposing topics.') }}
    </p>

    <template v-if="needsProduction">
      <div class="okf-step__progress">
        <DsProgress
          :value="progressPct"
          :indeterminate="status === 'running' && progressPct === 0"
          :show-label="true"
          :label="progressLabel"
        />
      </div>
      <p v-if="status === 'running'" class="okf-step__note">
        {{
          translate(
            'okf.steps.produce.running',
            'Converting… you can watch progress here; nothing is committed until you review in Curate.'
          )
        }}
      </p>
      <p v-if="status === 'failed'" class="okf-step__error">{{ errorText }}</p>
      <!-- T3 (D2): per-source merge accounting — the steward sees what each
           source contributed. Exact-slug merges are silent server-side; the
           delta is what THIS source added on top of the running total. -->
      <ul v-if="sourceLog.length" class="okf-step__log">
        <li v-for="(e, i) in sourceLog" :key="i" class="okf-step__log-row">
          <span class="okf-step__log-name">{{ e.name }}</span>
          <span class="okf-step__log-stat">{{ e.stat }}</span>
        </li>
      </ul>
      <p v-if="status === 'done'" class="okf-step__note">
        {{
          translate('okf.steps.produce.done', '{n} topic(s) are ready — continue to review them in Curate.').replace(
            '{n}',
            String(conceptCount)
          )
        }}
      </p>
      <div class="okf-step__actions">
        <DsButton variant="secondary" small :disabled="status === 'running'" @click="kick">
          {{
            status === 'failed'
              ? translate('okf.steps.produce.retry', 'Retry conversion')
              : translate('okf.steps.produce.restart', 'Run again')
          }}
        </DsButton>
      </div>
    </template>

    <template v-else>
      <p class="okf-step__note">
        {{
          translate(
            'okf.steps.produce.manualSkip',
            'Hand-written topics need no generation — continue to Curate to review them.'
          )
        }}
      </p>
    </template>
  </div>
</template>

<script>
import DsButton from '../../ds/Button.vue';
import DsProgress from '../../ds/Progress.vue';
import repoOkfService from '../../../services/repoOkfService';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepProduce',
  components: { DsButton, DsProgress },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['update', 'gate'],
  data() {
    return {
      status: 'idle', // idle | running | done | failed
      progressPct: 0,
      progressNote: '',
      errorText: '',
      pollTimer: null,
      // T3 (D2/D3): multi-crawl conversion queue + per-source accounting.
      sourceQueue: [],
      sourceLog: [],
      conceptCount: 0
    };
  },
  computed: {
    needsProduction() {
      // T3 (D6): production is DATA-driven, not variant-driven — whatever
      // sources were picked in Input (in ANY variant) convert here.
      return ((this.draft && this.draft.input && this.draft.input.document_ids) || []).length > 0;
    },
    variant() {
      return (this.draft && this.draft.source) || 'documents';
    },
    progressLabel() {
      if (this.status === 'done') return this.translate('okf.steps.produce.labelDone', 'Conversion complete');
      if (this.status === 'failed') return this.translate('okf.steps.produce.labelFailed', 'Conversion failed');
      return this.progressNote || this.translate('okf.steps.produce.progress', 'Producer running...');
    }
  },
  watch: {
    status(s) {
      // A2 gate: open when there is nothing left to wait for (or a retry is
      // possible) — never a dead end while running (Back stays available).
      this.$emit('gate', s !== 'running');
    }
  },
  async mounted() {
    this.$emit('gate', !this.needsProduction);
    if (!this.needsProduction) return;
    const input = (this.draft && this.draft.input) || {};
    const ids = input.document_ids || [];
    if (ids.length === 0) return; // nothing selected — Input will send the steward back
    const live = this.repoConversionStatus();
    if (input.conversion_kicked && live == null && !input.converted_ids) {
      // F5: a kick whose POST may never have landed. The STORE copy can be
      // stale — verify against the LIVE repo before declaring failure.
      let liveStatus = null;
      try {
        const fresh = await repoOkfService.get(this.draft.repo_id);
        liveStatus = fresh && fresh.conversion ? fresh.conversion.status : null;
      } catch {
        /* fall through to failed */
      }
      if (liveStatus === 'running') {
        this.status = 'running';
        this.poll();
        return;
      }
      if (liveStatus === 'done') {
        // T3: route through the queue-aware completion — a mid-queue restart
        // continues the remaining crawl files; a finished chain finalizes.
        await this.onConversionDone();
        return;
      }
      this.status = 'failed';
      this.errorText = this.translate('okf.steps.produce.neverStarted', 'The conversion did not start — retry.');
      this.$emit('gate', true);
      return;
    }
    const stale = input.converted_ids && JSON.stringify(input.converted_ids) !== JSON.stringify(ids);
    if (live === 'running' && !stale) {
      this.status = 'running';
      this.poll();
    } else if (live === 'failed' && !stale) {
      this.status = 'failed';
      this.errorText = this.translate(
        'okf.steps.produce.failed',
        'The conversion failed — retry, or go back and pick different inputs.'
      );
      this.$emit('gate', true);
    } else if (live === 'done' && !stale && (input.convert_queue || []).length > 0) {
      // T3: the chain finished one leg server-side but the draft still has
      // queue — resume the remaining legs (seed the LOCAL queue — the
      // running chain reads local state, not the prop). Legacy drafts
      // stored plain crawl-id strings; normalizeLegs maps them to crawl legs.
      this.status = 'running';
      this.sourceLog = (input.source_log || []).slice();
      this._lastCount = await this.fetchConceptCount();
      const queued = this.validLegsOnly(this.normalizeLegs(input.convert_queue));
      if (queued.length !== this.normalizeLegs(input.convert_queue).length) {
        // Verifier B3: the queue contains legs that are no longer selected —
        // the steward changed the selection mid-chain. Drop the stale queue
        // and re-kick cleanly for the CURRENT selection (conversions upsert
        // by slug — the re-run is idempotent).
        this.status = 'idle';
        this.$emit('update', { input: { ...input, convert_queue: [], conversion_kicked: false } });
        await this.kick();
        return;
      }
      this.sourceQueue = queued;
      const next = this.sourceQueue.shift();
      this.$emit('update', {
        input: { ...input, convert_queue: this.sourceQueue.slice() }
      });
      await this.kickNextLeg(next);
    } else if (live === 'done' && !stale) {
      this.status = 'done';
      this.progressPct = 100;
      this.sourceLog = (input.source_log || []).slice();
      this.conceptCount = await this.fetchConceptCount();
      this.$emit('gate', true);
    } else {
      // fresh draft, stale terminal state for NEW inputs, or no live state —
      // (re-)kick for the CURRENT selection.
      await this.kick();
    }
  },
  beforeUnmount() {
    // Verifier B4: the leg-wait timer must die with the component — its
    // status==='running' guard alone passes on an UNMOUNTED instance
    // (Options-API data survives), re-kicking into the void.
    this._unmounted = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this._legWaitTimer) clearTimeout(this._legWaitTimer);
  },
  methods: {
    repoConversionStatus() {
      const repo = this.draft && this.draft.repo_id ? this.$store.getters['okf/repoById'](this.draft.repo_id) : null;
      const conv = repo && repo.conversion;
      return conv ? conv.status || 'running' : null;
    },
    friendlyError(err) {
      const code = err && (err.code || (err.data && err.data.error));
      const msg = (err && (err.message || (err.data && err.data.message))) || '';
      if (code === 'DUPLICATE_CONTENT' || /already imported/i.test(msg)) {
        return this.translate(
          'okf.steps.produce.dupContent',
          'These sources are already imported into another OKF repository. Retract or delete that repository first, or pick different documents.'
        );
      }
      if (code === 'CONVERSION_IN_FLIGHT' || /in flight/i.test(msg)) {
        return this.translate(
          'okf.steps.produce.inFlight',
          'A conversion is already running for this repository — wait for it to finish.'
        );
      }
      return this.translate(
        'okf.steps.produce.failed',
        'The conversion failed — retry, or go back and pick different inputs.'
      );
    },
    async kick() {
      const repoId = this.draft && this.draft.repo_id;
      const input = (this.draft && this.draft.input) || {};
      const ids = input.document_ids || [];
      if (!repoId || ids.length === 0) {
        this.status = 'failed';
        this.errorText = this.translate('okf.steps.produce.noSources', 'No sources selected — go back to Input.');
        this.$emit('gate', true);
        return;
      }
      this.status = 'running';
      this.$emit('gate', false);
      this.$emit('update', {
        input: { ...input, document_ids: ids, conversion_kicked: true }
      });
      try {
        // Baseline for per-source accounting (D2): how many topics exist
        // before the first conversion lands.
        this._lastCount = await this.fetchConceptCount();
        const classification = (this.draft && this.draft.classification) || 'heuristics';
        // A2 (audit): the conversion ROUTE keys on each file's recorded
        // ORIGIN, never on the draft variant — mixed picks are legal in any
        // variant. Crawl files must go through the per-file crawl converter
        // (it gives every page its URL-derived slug identity, which is what
        // makes the cross-crawl exact-slug merge work); a crawl file sent
        // through the documents batch is heading-segmented and loses that.
        // A non-crawl upload sent through the crawl converter yields ZERO
        // pages silently. Unknown-origin ids (legacy drafts without name
        // rows) default to the documents batch — it converts any format.
        const legs = this.buildLegs(ids);
        this.sourceQueue = legs.slice(1);
        this.$emit('update', {
          input: {
            ...((this.draft && this.draft.input) || {}),
            convert_queue: this.sourceQueue.slice()
          }
        });
        await this.kickNextLeg(legs[0], classification);
      } catch (err) {
        // F10: the producer's 409s carry the remedy — surface them instead
        // of looping a doomed Retry.
        this.failLeg(err);
      }
    },
    // A2: legs = [documents batch (once)] + [one leg per crawl file], in the
    // order the steward picked them (documents first — the crawl chain then
    // merges on top). Queue entries ride the draft as descriptors so a
    // restart resumes the RIGHT route per file; legacy drafts stored plain
    // crawl-id strings and are normalized to crawl legs.
    // Verifier B1 (2026-09-29): an id with NO names row falls back to the
    // DRAFT VARIANT — a crawl-variant draft's unstamped ids are crawl files
    // (the seeded handoff path); defaulting them to the documents batch
    // heading-segments them and destroys per-URL slug identity. Only a
    // variant with no crawl signal defaults to documents.
    buildLegs(ids) {
      const names = ((this.draft && this.draft.input) || {}).document_names || [];
      const variant = this.variant;
      const originOf = (id) => {
        const hit = names.find((n) => n && n.file_id === id);
        if (hit) return hit.source === 'crawl' ? 'crawl' : 'documents';
        return variant === 'crawl' ? 'crawl' : 'documents';
      };
      const crawlIds = ids.filter((id) => originOf(id) === 'crawl');
      const docIds = ids.filter((id) => originOf(id) !== 'crawl');
      const legs = [];
      if (docIds.length > 0) legs.push({ k: 'd', ids: docIds });
      for (const id of crawlIds) legs.push({ k: 'c', id });
      return legs;
    },
    // Verifier B3: the queue only ever describes the CURRENT selection — a
    // leg whose id is no longer selected is stale (selection changed
    // mid-chain) and must not kick.
    validLegsOnly(legs) {
      const ids = ((this.draft && this.draft.input) || {}).document_ids || [];
      return legs.filter((leg) =>
        leg.k === 'c' ? ids.includes(leg.id) : (leg.ids || []).every((x) => ids.includes(x))
      );
    },
    normalizeLegs(queue) {
      return (queue || [])
        .map((leg) => (typeof leg === 'string' ? { k: 'c', id: leg } : leg))
        .filter((leg) => leg && (leg.k === 'c' ? !!leg.id : (leg.ids || []).length > 0));
    },
    sourceName(fileId) {
      const names = ((this.draft && this.draft.input) || {}).document_names || [];
      const hit = names.find((n) => n.file_id === fileId);
      return (hit && hit.file_name) || fileId;
    },
    async fetchConceptCount() {
      const repoId = this.draft && this.draft.repo_id;
      if (!repoId) return 0;
      try {
        // B1 (audit): the index concept is a meta row the conversion creates,
        // not a produced topic — counting it over-reported every total/delta.
        const rows = await repoOkfService.listConcepts(repoId);
        return rows.filter((c) => c && !c.is_index).length;
      } catch {
        return this._lastCount || 0;
      }
    },
    // A3 (audit): a leg whose kick THROWS must never wedge the step at
    // "running" — before this guard, a mid-chain 409/5xx/network failure was
    // swallowed by the poll's transient catch AFTER the interval cleared, so
    // the gate stayed closed and Retry stayed disabled. Failure surfaces the
    // F10 remedy with a live Retry. Verifier A3-minor: the abandoned chain's
    // queue is dropped too — kick() rebuilds it from document_ids on Retry.
    failLeg(err) {
      this.status = 'failed';
      this.errorText = this.friendlyError(err);
      this.$emit('update', {
        input: { ...((this.draft && this.draft.input) || {}), conversion_kicked: false, convert_queue: [] }
      });
      this.$emit('gate', true);
      if (this.pollTimer) clearInterval(this.pollTimer);
    },
    isInFlightError(err) {
      const code = err && (err.code || (err.data && err.data.error));
      const msg = (err && (err.message || (err.data && err.data.message))) || '';
      return code === 'CONVERSION_IN_FLIGHT' || /in flight/i.test(msg);
    },
    // One leg of the chain: kick it, then poll(). `classification` rides the
    // FIRST leg (the draft already carries it for re-kicks).
    async kickNextLeg(leg, classification) {
      const repoId = this.draft && this.draft.repo_id;
      if (!leg) {
        await this.onAllConversionsDone();
        return;
      }
      this._currentLeg = leg;
      this._currentSource = this.legName(leg);
      try {
        if (leg.k === 'c') {
          await repoOkfService.convertFromCrawlInto({
            repo_id: repoId,
            file_id: leg.id,
            classification: classification || (this.draft && this.draft.classification) || 'heuristics',
            split_mode: 'B'
          });
        } else {
          await repoOkfService.importDocuments({
            file_ids: leg.ids,
            repo_id: repoId,
            name: (this.draft && this.draft.name) || undefined,
            classification: classification || (this.draft && this.draft.classification) || 'heuristics'
          });
        }
        this._legRetry = 0;
      } catch (err) {
        // The live-registry delete lags the "done" poll by a beat — a next-leg
        // kick can read CONVERSION_IN_FLIGHT against the JUST-FINISHED leg.
        // Retry briefly (2s/4s/6s) before declaring failure (audit A3).
        if (this.isInFlightError(err) && (this._legRetry || 0) < 3) {
          this._legRetry = (this._legRetry || 0) + 1;
          const wait = 2000 * this._legRetry;
          this.progressNote = this.translate(
            'okf.steps.produce.legWait',
            'Waiting for the previous conversion to release…'
          );
          // Verifier B4: store the handle and guard on _unmounted — the
          // status check alone passes on an unmounted instance.
          this._legWaitTimer = setTimeout(() => {
            if (!this._unmounted && this.status === 'running') this.kickNextLeg(leg, classification);
          }, wait);
          return;
        }
        this.failLeg(err);
        return;
      }
      this.poll();
    },
    legName(leg) {
      if (leg.k === 'c') return this.sourceName(leg.id);
      return this.translate('okf.steps.produce.docsLeg', '{n} selected document(s)').replace(
        '{n}',
        String((leg.ids || []).length)
      );
    },
    // ONE conversion finished: account it, then either continue the queue
    // (multi-crawl) or finalize. The RUNNING chain's queue is local state —
    // the draft copy exists so a restart knows a chain was mid-flight.
    async onConversionDone() {
      // B1 (audit): prefer the server's ingest summary (created/updated) over
      // the raw count delta — "updated" IS the exact-slug auto-merge count,
      // and the summary excludes the index concept the delta over-counts.
      const summary = this._lastConv && this._lastConv.summary;
      const count = await this.fetchConceptCount();
      const delta = Math.max(0, count - (this._lastCount || 0));
      this.conceptCount = count;
      this._lastCount = count;
      if (this._currentLeg) {
        const stat =
          summary && typeof summary.created === 'number'
            ? this.translate('okf.steps.produce.sourceStatMerged', '+{n} new · {m} merged by slug (total {t})')
                .replace('{n}', String(summary.created))
                .replace('{m}', String(summary.updated || 0))
                .replace('{t}', String(count))
            : this.translate('okf.steps.produce.sourceStat', '+{n} new (total {t})')
                .replace('{n}', String(delta))
                .replace('{t}', String(count));
        this.sourceLog.push({ name: this._currentSource, stat });
        // The accounting survives remounts (audit B1): rows ride the draft.
        this.$emit('update', {
          input: { ...((this.draft && this.draft.input) || {}), source_log: this.sourceLog.slice() }
        });
      }
      // Restart resume: a fresh mount with a draft queue seeds the local one
      // (verifier B3: stale legs — no longer selected — are dropped).
      if (this.sourceQueue.length === 0) {
        const input = (this.draft && this.draft.input) || {};
        this.sourceQueue = this.validLegsOnly(this.normalizeLegs(input.convert_queue));
      }
      if (this.sourceQueue.length > 0) {
        const next = this.sourceQueue.shift();
        this.$emit('update', {
          input: {
            ...((this.draft && this.draft.input) || {}),
            convert_queue: this.sourceQueue.slice()
          }
        });
        this.status = 'running';
        await this.kickNextLeg(next);
        return;
      }
      await this.onAllConversionsDone();
    },
    async onAllConversionsDone() {
      this.status = 'done';
      this.progressPct = 100;
      this.conceptCount = this._lastCount || this.conceptCount;
      this.$emit('update', {
        input: {
          ...((this.draft && this.draft.input) || {}),
          converted_ids: ((this.draft && this.draft.input) || {}).document_ids || [],
          convert_queue: [],
          source_log: this.sourceLog.slice()
        }
      });
      this.$emit('gate', true);
      this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {});
      if (this.pollTimer) clearInterval(this.pollTimer);
    },
    poll() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      const repoId = this.draft && this.draft.repo_id;
      if (!repoId) return;
      // First tick is IMMEDIATE (F5): a fresh kick must not sit at "running"
      // for 3s on stale store data, and a failed-first-fetch resume is
      // detected at once.
      const tick = async () => {
        if (this._unmounted) return; // verifier B4: a kick in flight must not poll past unmount
        try {
          const repo = await repoOkfService.get(repoId);
          const conv = repo && repo.conversion;
          this._lastConv = conv; // B1: the done-branch accounting reads the summary
          const st = conv ? conv.status : null;
          if (st === 'done') {
            clearInterval(this.pollTimer);
            await this.onConversionDone();
          } else if (st === 'failed') {
            this.status = 'failed';
            this.errorText = this.translate(
              'okf.steps.produce.failed',
              'The conversion failed — retry, or go back and pick different inputs.'
            );
            this.$emit('gate', true);
            clearInterval(this.pollTimer);
          } else if (st === 'running') {
            this.status = 'running';
            this.readProgress(conv);
          } else {
            // No conversion registered server-side (F5): a kick that never
            // landed. Stop the loop; Retry re-kicks.
            this.status = 'failed';
            this.errorText = this.translate('okf.steps.produce.neverStarted', 'The conversion did not start — retry.');
            this.$emit('gate', true);
            clearInterval(this.pollTimer);
          }
        } catch {
          /* transient fetch error — keep polling */
        }
      };
      tick();
      this.pollTimer = setInterval(tick, 3000);
    },
    // C2: the documents leg counts FILES, the crawl leg counts PAGES (with
    // bytes as its only total). Read whichever pair exists — otherwise stay
    // indeterminate at 0 with a live counter note.
    readProgress(conv) {
      if (!conv) return;
      const filesDone = conv.files_done;
      const filesTotal = conv.files_total;
      const pagesDone = conv.pages_done;
      const pagesTotal = conv.pages_total;
      if (typeof filesTotal === 'number' && filesTotal > 0) {
        this.progressPct = Math.round(((filesDone || 0) / filesTotal) * 100);
        this.progressNote = this.translate('okf.steps.produce.filesNote', '{done} of {total} documents converted')
          .replace('{done}', String(filesDone || 0))
          .replace('{total}', String(filesTotal));
      } else if (typeof pagesTotal === 'number' && pagesTotal > 0) {
        this.progressPct = Math.round(((pagesDone || 0) / pagesTotal) * 100);
        this.progressNote = this.translate('okf.steps.produce.pagesNote', '{done} of {total} pages converted')
          .replace('{done}', String(pagesDone || 0))
          .replace('{total}', String(pagesTotal));
      } else {
        this.progressPct = 0; // indeterminate via the template binding
        if (typeof pagesDone === 'number' && pagesDone > 0) {
          this.progressNote = this.translate('okf.steps.produce.pagesSoFar', '{n} pages converted so far').replace(
            '{n}',
            String(pagesDone)
          );
        }
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
.okf-step__progress {
  width: 100%;
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
.okf-step__log {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-step__log-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
  font-size: var(--text-sm);
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.okf-step__log-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.okf-step__log-stat {
  color: var(--muted);
  white-space: nowrap;
}
.okf-step__actions {
  display: flex;
  gap: var(--space-sm);
}
</style>
