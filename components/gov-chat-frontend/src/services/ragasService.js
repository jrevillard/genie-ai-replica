/**
 * ragasService — Story 8-6 (2026-10-17): the OKF RAGAS benchmarking client.
 * Thin wrapper over the okf-server endpoints (ADR-okf-043):
 *
 *   POST /okf/repos/:id/ragas-testsuite                       — generate (202+poll)
 *   GET  /okf/repos/:id/ragas-testsuite/:key                  — suite / generating envelope
 *   POST /okf/repos/:id/ragas-testsuite/:key/rows              — modify / flip / remove
 *   POST /okf/repos/:id/ragas-testsuite/:key/queries           — manual additions
 *   POST /okf/repos/:id/ragas-testsuite/:key/rename             — rename
 *   DELETE /okf/repos/:id/ragas-testsuite/:key                  — delete + runs
 *   POST /okf/repos/:id/ragas-testsuite/:key/run                — run (202+poll)
 *   GET  /okf/repos/:id/ragas-testsuite/:key/runs/:runKey       — run poll / load
 *   GET  /okf/repos/:id/ragas-testsuite/runs?kind=              — listing
 *   POST /okf/repos/:id/ragas-testsuite/:key/probe              — per-entry probe
 *   POST /okf/repos/:id/ragas-testsuite/:key/explain            — explain (202+poll)
 *   GET  /okf/repos/:id/ragas-testsuite/:key/explain/:runKey    — explain poll
 *   GET  /okf/repos/:id/ragas-testsuite/:key/export             — suite xlsx (his format)
 *   POST /okf/repos/:id/ragas-testsuite/import                  — suite xlsx upload
 *   POST /okf/repos/:id/ragas-testsuite/:key/results-export     — results xlsx
 *
 * Error surface: httpService rejections carry the server envelope in
 * err.data ({error, message}) — the store maps to {ok, code, message}.
 */

import httpService from './httpService';

function rid(repoId) {
  return encodeURIComponent(repoId);
}

function sk(suiteKey) {
  return encodeURIComponent(suiteKey);
}

const ragasService = {
  /** Generate a benchmark suite from 1..N repos. body: {repo_ids[],
   * testset_size, query_distribution, num_personas, name}. 202+poll. */
  async generateSuite(repoId, opts = {}) {
    const res = await httpService.post(`/okf/repos/${rid(repoId)}/ragas-testsuite`, opts);
    return res && res.data ? res.data : null;
  },

  /** Load one suite (or its generating/failed envelope). */
  async getSuite(repoId, suiteKey) {
    const res = await httpService.get(`/okf/repos/${rid(repoId)}/ragas-testsuite/${sk(suiteKey)}`);
    return res && res.data ? res.data : null;
  },

  /** Edit rows in place: modifications[{id, query?, reference_answer?,
   * reference_passages?, flip_oos?}] + remove_ids[]. */
  async updateSuiteRows(repoId, suiteKey, payload) {
    const res = await httpService.post(`/okf/repos/${rid(repoId)}/ragas-testsuite/${sk(suiteKey)}/rows`, payload);
    return res && res.data ? res.data : null;
  },

  /** Manual additions: {queries: [{query, reference_answer?, reference_passages?, oos?}]}. */
  async addQueries(repoId, suiteKey, queries) {
    const res = await httpService.post(`/okf/repos/${rid(repoId)}/ragas-testsuite/${sk(suiteKey)}/queries`, {
      queries
    });
    return res && res.data ? res.data : null;
  },

  async renameSuite(repoId, suiteKey, name) {
    const res = await httpService.post(`/okf/repos/${rid(repoId)}/ragas-testsuite/${sk(suiteKey)}/rename`, { name });
    return res && res.data ? res.data : null;
  },

  async deleteSuite(repoId, suiteKey) {
    const res = await httpService.delete(`/okf/repos/${rid(repoId)}/ragas-testsuite/${sk(suiteKey)}`);
    return res && res.data ? res.data : null;
  },

  /** Run the suite. body: {metrics?: [...]}. 202 {run_key, status:'running'}. */
  async runSuite(repoId, suiteKey, opts = {}) {
    const res = await httpService.post(`/okf/repos/${rid(repoId)}/ragas-testsuite/${sk(suiteKey)}/run`, opts);
    return res && res.data ? res.data : null;
  },

  /** Poll/load one run: keep-waiting envelope, terminal failure, or the doc. */
  async getRun(repoId, suiteKey, runKey) {
    const res = await httpService.get(
      `/okf/repos/${rid(repoId)}/ragas-testsuite/${sk(suiteKey)}/runs/${encodeURIComponent(runKey)}`
    );
    return res && res.data ? res.data : null;
  },

  /** Listing (kind: ragas_run | ragas_suite | all). */
  async listRuns(repoId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.kind) params.set('kind', opts.kind);
    const qs = params.toString();
    const res = await httpService.get(`/okf/repos/${rid(repoId)}/ragas-testsuite/runs${qs ? '?' + qs : ''}`);
    const body = res && res.data;
    return body && Array.isArray(body.runs) ? body.runs : [];
  },

  /** The click-test for one entry (retrieval leg only). body: {id}. */
  async probeEntry(repoId, suiteKey, id) {
    const res = await httpService.post(`/okf/repos/${rid(repoId)}/ragas-testsuite/${sk(suiteKey)}/probe`, { id });
    return res && res.data ? res.data : null;
  },

  /** Explain failures (202+poll). body: {run_key?}. */
  async explainFailures(repoId, suiteKey, opts = {}) {
    const res = await httpService.post(`/okf/repos/${rid(repoId)}/ragas-testsuite/${sk(suiteKey)}/explain`, opts);
    return res && res.data ? res.data : null;
  },

  async getExplain(repoId, suiteKey, runKey) {
    const res = await httpService.get(
      `/okf/repos/${rid(repoId)}/ragas-testsuite/${sk(suiteKey)}/explain/${encodeURIComponent(runKey)}`
    );
    return res && res.data ? res.data : null;
  },

  /** Suite xlsx download (his Test Dataset format) → Blob. */
  async exportSuite(repoId, suiteKey) {
    const res = await httpService.get(
      `/okf/repos/${rid(repoId)}/ragas-testsuite/${sk(suiteKey)}/export`,
      {},
      {
        responseType: 'arraybuffer'
      }
    );
    return res && res.data ? res.data : null;
  },

  /** Suite xlsx upload (his format) → the created suite doc. */
  async importSuite(repoId, arrayBuffer) {
    const res = await httpService.post(`/okf/repos/${rid(repoId)}/ragas-testsuite/import`, arrayBuffer, {
      headers: { 'Content-Type': 'application/octet-stream' }
    });
    return res && res.data ? res.data : null;
  },

  /** Results xlsx download (his v2 vocabulary). body: {suite_key, run_keys[]}. */
  async exportResults(repoId, payload) {
    const res = await httpService.post(
      `/okf/repos/${rid(repoId)}/ragas-testsuite/${sk(payload.suite_key)}/results-export`,
      payload,
      { responseType: 'arraybuffer' }
    );
    return res && res.data ? res.data : null;
  }
};

export default ragasService;
