/**
 * headTestService — Story 1-8 (2026-10-08): the OKF Testing Lab client. Thin wrapper over the okf-server endpoints:
 *
 *   POST /okf/repos/:id/head/rebuild            — re-run the vectorized head
 *   POST /okf/repos/:id/routing-test            — two-leg single-query test
 *   POST /okf/repos/:id/routing-explain         — 1-8c claim-side explain
 *   POST /okf/repos/:id/routing-testsuite       — LLM suite generation
 *   POST /okf/repos/:id/routing-testsuite/:key/queries — curator additions
 *   POST /okf/repos/:id/routing-testsuite/:key/run     — run-all + summary
 *   POST /okf/repos/:id/routing-testsuite/:key/explain — 1-8c batch advice
 *   GET  /okf/repos/:id/routing-testsuite/runs         — analytics history
 *   GET  /okf/repos/:id/frontmatter/history            — 1-8d save history
 *   POST /okf/repos/:id/frontmatter/revert             — 1-8d revert (admin)
 *
 * Error surface: httpService rejections carry the server envelope in
 * err.data ({error, message}) — callers map to {ok, code, message}.
 */

import httpService from './httpService';

function rid(repoId) {
  return encodeURIComponent(repoId);
}

const headTestService = {
  /** Re-run buildVectorizedHead from the CURRENT stored frontmatter
   * (fixes a missing head — publish is warn-only on a TEI outage — or a
   * stale one — frontmatter edited after publish). Admin action. */
  async rebuildHead(repoId) {
    const res = await httpService.post(`/okf/repos/${rid(repoId)}/head/rebuild`);
    return res && res.data ? res.data : null;
  },

  /** The two-leg simulation for ONE query. body: {query, formula?,
   * include_probes?, sibling_limit?}. Returns the full contract:
   * under_test / siblings[] / verdict / fidelity. */
  async routingTest(repoId, body) {
    const res = await httpService.post(`/okf/repos/${rid(repoId)}/routing-test`, body);
    return res && res.data ? res.data : null;
  },

  /** Generate a test suite (LLM positives + confusable-sibling negatives
   * + deterministic forbidden-derived negatives). Admin, LLM-burning. */
  async generateSuite(repoId, opts = {}) {
    const res = await httpService.post(`/okf/repos/${rid(repoId)}/routing-testsuite`, opts);
    return res && res.data ? res.data : null;
  },

  /** Curator free-text additions (kind: 'positive' | 'negative'). */
  async addSuiteQueries(repoId, suiteKey, queries) {
    const res = await httpService.post(
      `/okf/repos/${rid(repoId)}/routing-testsuite/${encodeURIComponent(suiteKey)}/queries`,
      {
        queries
      }
    );
    return res && res.data ? res.data : null;
  },

  /** Story 1-8f — load ONE saved suite (full rows) back into the Lab. */
  async getSuite(repoId, suiteKey) {
    const res = await httpService.get(`/okf/repos/${rid(repoId)}/routing-testsuite/${encodeURIComponent(suiteKey)}`);
    return res && res.data ? res.data : null;
  },

  /** Story 1-8f — name/rename a saved suite. */
  async renameSuite(repoId, suiteKey, name) {
    const res = await httpService.post(
      `/okf/repos/${rid(repoId)}/routing-testsuite/${encodeURIComponent(suiteKey)}/rename`,
      {
        name
      }
    );
    return res && res.data ? res.data : null;
  },

  /** Story 1-8g — delete a saved suite (and its run docs). */
  async deleteSuite(repoId, suiteKey) {
    const res = await httpService.delete(`/okf/repos/${rid(repoId)}/routing-testsuite/${encodeURIComponent(suiteKey)}`);
    return res && res.data ? res.data : null;
  },

  /** Story 1-8g — the click-test: one query against the LIVE corpus
   * (embed → top-K → the pipeline's TEI rerank → coverage verdict),
   * persisted on the matching suite rows. */
  async probeSuiteQuery(repoId, suiteKey, query) {
    const res = await httpService.post(
      `/okf/repos/${rid(repoId)}/routing-testsuite/${encodeURIComponent(suiteKey)}/probe`,
      {
        query
      }
    );
    return res && res.data ? res.data : null;
  },

  /** Story 1-8f — edit a suite's rows in place: kind flips (the mislabel
   * fix — the row is searched in BOTH arrays) and removes. Returns the
   * updated suite doc. */
  async updateSuiteRows(repoId, suiteKey, payload) {
    const res = await httpService.post(
      `/okf/repos/${rid(repoId)}/routing-testsuite/${encodeURIComponent(suiteKey)}/rows`,
      payload
    );
    return res && res.data ? res.data : null;
  },

  /** Execute every suite query, aggregate pass rates / margins / steals.
   * 1-8g-v: the run is ASYNC — 202 {run_key, status:'running'}; the dialog
   * polls getRun until the doc lands (a 100+100 suite outlives the
   * gateway's 60s; live 2026-10-11 the results 504'd twice and were never
   * shown even though the server finished them). */
  async runSuite(repoId, suiteKey) {
    const res = await httpService.post(
      `/okf/repos/${rid(repoId)}/routing-testsuite/${encodeURIComponent(suiteKey)}/run`
    );
    return res && res.data ? res.data : null;
  },

  /** 1-8g-v — poll/load ONE run: {status:'running'} keep-waiting,
   * {status:'failed', error}, or the full run doc. */
  async getRun(repoId, suiteKey, runKey) {
    const res = await httpService.get(
      `/okf/repos/${rid(repoId)}/routing-testsuite/${encodeURIComponent(suiteKey)}/runs/${encodeURIComponent(runKey)}`
    );
    return res && res.data ? res.data : null;
  },

  /** Story 1-8c — explain ONE query's gate outcome; when the head claims
   * it, carries suggestion {tags[], source: 'llm'|'none', reason} with
   * proposed forbidden tags. The full routing-test contract rides along
   * (under_test / siblings / verdict / fidelity). */
  async explainRouting(repoId, query) {
    const res = await httpService.post(`/okf/repos/${rid(repoId)}/routing-explain`, { query });
    return res && res.data ? res.data : null;
  },

  /** Story 1-8c — BATCH advice for the latest run of a suite: every
   * failing negative in one pass, ONE LLM call. Returns {suite_key,
   * run_key, failing_count, failing_queries[], suggested_tags[], source,
   * note}. */
  /**
   * Story 1-8c, async since 1-8g-y: POST answers 202 `{run_key, status:'running'}`
   * and the work continues server-side. It fans out over the shared remote GPU
   * node (one embed per failing negative in guardSuggestions, plus the LLM
   * pass), which outran the gateway — the curator saw a spinner, no local GPU
   * activity, then a 504 with the advice never arriving. Poll with
   * getExplainFailures() until status leaves 'running'.
   */
  async explainSuiteFailures(repoId, suiteKey) {
    const res = await httpService.post(
      `/okf/repos/${rid(repoId)}/routing-testsuite/${encodeURIComponent(suiteKey)}/explain`
    );
    return res && res.data ? res.data : null;
  },

  /** The async explain's poll: {status:'running'} | {status:'failed', error} | payload. */
  async getExplainFailures(repoId, suiteKey, runKey) {
    const res = await httpService.get(
      `/okf/repos/${rid(repoId)}/routing-testsuite/${encodeURIComponent(suiteKey)}/explain/${encodeURIComponent(runKey)}`
    );
    return res && res.data ? res.data : null;
  },

  /** Analytics history (kind: 'run' | 'suite' | 'all'). */
  async listRuns(repoId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.kind) params.set('kind', opts.kind);
    const qs = params.toString();
    const res = await httpService.get(`/okf/repos/${rid(repoId)}/routing-testsuite/runs${qs ? '?' + qs : ''}`);
    const body = res && res.data;
    return body && Array.isArray(body.runs) ? body.runs : [];
  },

  /** Story 1-8d — the bounded frontmatter save history (newest first;
   * server caps at 10). Each entry: {saved_at, actor, forbidden_count,
   * shape}. Backs the Lab's Revert-tags panel. */
  async frontmatterHistory(repoId) {
    const res = await httpService.get(`/okf/repos/${rid(repoId)}/frontmatter/history`);
    const body = res && res.data;
    return body && Array.isArray(body.entries) ? body.entries : [];
  },

  /** Story 1-8d — restore the frontmatter snapshotted at saved_at (the
   * server re-enters its own update(), so the revert is itself
   * snapshotted — revert-of-revert works). Admin action. Returns
   * {repo_id, reverted_to, frontmatter}. */
  async revertFrontmatter(repoId, savedAt) {
    const res = await httpService.post(`/okf/repos/${rid(repoId)}/frontmatter/revert`, { saved_at: savedAt });
    return res && res.data ? res.data : null;
  },

  /** Story 1-8d — the COMPREHENSIVE advisor: aggregates the queries of the
   * last N runs (all classes), simulates tag-set configurations against the
   * gate, recommends the globally-optimal add/remove set under a
   * zero-positive-harm constraint. Admin action (one LLM call). Returns
   * {current_scorecard, recommended_scorecard, changes:{add,remove},
   * add_eval, remove_eval, note, ...}.
   *
   * 2026-10-20 — async (202 + poll): with a thinking model configured the
   * advisor takes minutes and the synchronous POST died at the gateway
   * ("The upstream server is timing out") while the server kept working.
   * Poll here (not in the component) so the dialog's existing spinner and
   * error handling stay untouched. Tolerates a synchronous server that
   * answers 200 inline (no job_key) — not coupled to deploy order. */
  async recommendTags(repoId, payload = {}) {
    const res = await httpService.post(`/okf/repos/${rid(repoId)}/routing-advisor`, payload);
    const started = res && res.data;
    if (!started || !started.job_key) return started;
    const POLL_MS = 2000;
    // A ceiling, so a wedged job surfaces as a readable error instead of an
    // endless spinner. The job doc keeps its state server-side regardless.
    const DEADLINE_MS = 15 * 60 * 1000;
    const deadline = Date.now() + DEADLINE_MS;
    // TRANSIENT TOLERANCE (round 18, #80482): a single failed GET (one 502
    // during a 12-minute advisor run — the 2026-10-18 gateway-restart class)
    // used to reject out of the loop and map to ADVISE_FAILED while the
    // server-side job completed fine. Same cap as the store's pollJob: up to
    // 60 consecutive misses (~2 min at this cadence) before giving up.
    let misses = 0;
    for (;;) {
      if (Date.now() > deadline) {
        // ADVISOR_TIMEOUT (#80805): the code lets the Lab's error path pick
        // the translated sentence; the English message stays as the fallback
        // for callers that render it verbatim. Same shape as the failed-doc
        // throw below (RECOMMEND_FAILED).
        const e = new Error(
          'The advisor is still running on the model host. Reopen the Lab later to see its result — nothing was lost.'
        );
        e.code = 'ADVISOR_TIMEOUT';
        throw e;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      let doc;
      try {
        doc = await this.getRecommendJob(repoId, started.job_key);
        misses = 0;
      } catch (err) {
        if (++misses >= 60) throw err;
        continue;
      }
      if (!doc || doc.status === 'running') continue;
      if (doc.status === 'failed') {
        const e = new Error((doc.error && doc.error.message) || 'Advisor failed');
        e.code = (doc.error && doc.error.code) || 'RECOMMEND_FAILED';
        throw e;
      }
      return doc.payload;
    }
  },

  /** The async advisor's poll: {status:'running'} | {status:'failed',
   * error} | the finished advice in `payload`. */
  async getRecommendJob(repoId, jobKey) {
    const res = await httpService.get(`/okf/repos/${rid(repoId)}/routing-advisor/jobs/${encodeURIComponent(jobKey)}`);
    return res && res.data ? res.data : null;
  }
};

export default headTestService;
