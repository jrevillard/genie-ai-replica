/**
 * headTestService — Story 1-8 (2026-10-08): the OKF Head Tester / Routing
 * Lab client. Thin wrapper over the okf-server endpoints:
 *
 *   POST /okf/repos/:id/head/rebuild            — re-run the vectorized head
 *   POST /okf/repos/:id/routing-test            — two-leg single-query test
 *   POST /okf/repos/:id/routing-testsuite       — LLM suite generation
 *   POST /okf/repos/:id/routing-testsuite/:key/queries — curator additions
 *   POST /okf/repos/:id/routing-testsuite/:key/run     — run-all + summary
 *   GET  /okf/repos/:id/routing-testsuite/runs         — analytics history
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

  /** Execute every suite query, aggregate pass rates / margins / steals. */
  async runSuite(repoId, suiteKey) {
    const res = await httpService.post(
      `/okf/repos/${rid(repoId)}/routing-testsuite/${encodeURIComponent(suiteKey)}/run`
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
  }
};

export default headTestService;
