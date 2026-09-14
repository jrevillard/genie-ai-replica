/**
 * repoOkfService — read-mostly OKF repo CRUD client.
 *
 * Backed by the existing /api/okf/repos routes on okf-server. Some methods
 * (manifest, metrics, clone) reference routes already shipped; mintVersion
 * already exists (Story 2.9.7). Update + clone are server-live from 2.9.7
 * and 4.8.
 */

import httpService from './httpService';

function notReady(reason) {
  const err = new Error('NOT_READY');
  err.code = 'NOT_READY';
  err.message = reason;
  return err;
}

const repoOkfService = {
  async list({ stage = 'all' } = {}) {
    const res = await httpService.get(`/okf/repos?lifecycle=${encodeURIComponent(stage)}`);
    const body = res && res.data;
    // The list endpoint returns { items: [...], next_cursor } — unwrap it.
    // (Returning the raw body made the store call .forEach on an object,
    // which threw inside fetchRepos' try/catch and silently left the
    // dashboard lanes empty: "Repositories 0" no matter what existed.)
    if (body && Array.isArray(body.items)) return body.items;
    if (Array.isArray(body)) return body; // legacy array shape
    return [];
  },

  async get(repoId) {
    const res = await httpService.get(`/okf/repos/${encodeURIComponent(repoId)}`);
    return res && res.data ? res.data : null;
  },

  async create(body) {
    // silent: the create dialog owns the outcome display (e.g. a friendly
    // DUPLICATE_REPO message) — no global toast, no console.error.
    const res = await httpService.post('/okf/repos', body, { silent: true });
    return res && res.data ? res.data : null;
  },

  // Story 7.7 (David, 2026-09-14): multi-select doc-repo documents into ONE
  // OKF repository — whole-corpus linking/labeling; ingested sources allowed
  // (the repo's own ingest is gated downstream: SOURCES_NOT_RETRACTED).
  async importDocuments({ file_ids, name, domain, classification }) {
    // silent: the import dialog owns the outcome display.
    const res = await httpService.post(
      '/okf/repos/convert-from-documents',
      { file_ids, name, domain, classification },
      { silent: true }
    );
    return res && res.data ? res.data : null;
  },

  async update(repoId, patch) {
    const res = await httpService.patch(`/okf/repos/${encodeURIComponent(repoId)}`, patch);
    return res && res.data ? res.data : { ok: true };
  },

  async getManifest(repoId) {
    try {
      // silent: a fresh repo's bundle is NOT settled until the indexing worker
      // finishes — the 404 is an expected, handled outcome (the graph view
      // renders nodes without edges). No toast, no console noise.
      const res = await httpService.get(`/okf/repos/${encodeURIComponent(repoId)}/manifest`, {}, { silent: true });
      return res && res.data ? res.data : null;
    } catch (err) {
      if (err && (err.status === 404 || err.status === 501)) throw notReady('okf.repos.manifest.notReady');
      throw err;
    }
  },

  async getMetrics(repoId) {
    try {
      const res = await httpService.get(`/okf/repos/${encodeURIComponent(repoId)}/metrics`);
      return res && res.data ? res.data : null;
    } catch (err) {
      if (err && (err.status === 404 || err.status === 501)) return null;
      throw err;
    }
  },

  async getRepoLinks(repoId) {
    // Editor graph projection (David, 2026-09-04): the LIVE author-stated
    // edges from okf_concepts_meta — never the ArangoDB serving graph. Silent:
    // legacy backends without the route return 404 and the graph view falls
    // back to the settled manifest.
    try {
      const res = await httpService.get(`/okf/repos/${encodeURIComponent(repoId)}/links`, {}, { silent: true });
      return res && res.data ? res.data : null;
    } catch (err) {
      if (err && (err.status === 404 || err.status === 501)) return null;
      throw err;
    }
  },

  async mintVersion(repoId, body = {}, actor = {}) {
    const res = await httpService.post(`/okf/repos/${encodeURIComponent(repoId)}/versions`, body, {
      headers: actor && actor.sub ? { 'x-actor-sub': actor.sub } : {}
    });
    return res && res.data ? res.data : { ok: true };
  },

  async clone(sourceId, body = {}) {
    const res = await httpService.post(`/okf/repos/${encodeURIComponent(sourceId)}/clone`, body);
    return res && res.data ? res.data : null;
  },

  /**
   * Story #978 — Editor: PATCH a single concept's markdown (frontmatter +
   * body). Returns { ok, concept_id, content_hash, index_status, updated_at }.
   */
  async patchConcept(repoId, conceptId, markdown, actor = {}) {
    const res = await httpService.patch(
      `/okf/repos/${encodeURIComponent(repoId)}/concepts/${encodeURIComponent(conceptId)}`,
      { markdown },
      // The PATCH re-scans server-side (Presidio) — a big page legitimately
      // takes a while; a default client timeout would orphan the save and
      // re-arm the autosave loop (2026-09-09 lockup fix).
      { headers: actor && actor.sub ? { 'x-actor-sub': actor.sub } : {}, timeout: 180000 }
    );
    return res && res.data ? res.data : { ok: true };
  },

  /**
   * Story #978 — body-only PATCH (labels write-through, 2026-09-05): the
   * server replaces the body and keeps the STORED frontmatter, so the client
   * never round-trips a frontmatter snapshot (no stale-fm clobber of a
   * concurrent label write). Returns the same shape as patchConcept.
   */
  async patchConceptBody(repoId, conceptId, body, actor = {}) {
    const res = await httpService.patch(
      `/okf/repos/${encodeURIComponent(repoId)}/concepts/${encodeURIComponent(conceptId)}`,
      { body },
      { headers: actor && actor.sub ? { 'x-actor-sub': actor.sub } : {}, timeout: 180000 }
    );
    return res && res.data ? res.data : { ok: true };
  },

  /**
   * Story #978 — Editor: re-split the repo from its source file. mode
   * 'A' (mega) | 'B' (per `## Source:` page, default) | 'C' (LLM, 10.6).
   * Returns { ok, mode, total, parsed, created, rejected, enqueued }.
   */
  async resplit(repoId, mode, fileId, actor = {}) {
    const body = { mode };
    if (fileId) body.file_id = fileId;
    const res = await httpService.post(`/okf/repos/${encodeURIComponent(repoId)}/resplit`, body, {
      headers: actor && actor.sub ? { 'x-actor-sub': actor.sub } : {}
    });
    return res && res.data ? res.data : { ok: true };
  },

  /**
   * Story #978 — Editor: frontmatter-only autocorrect. dry_run=true (the
   * server default) proposes without applying; dry_run=false applies
   * atomically. D-L/D-B (coordinator, 8f46b3345): mode 'llm'|'hybrid'
   * returns curated proposals {ok, mode, dry_run, proposals:
   * [{concept_id, before, after, changes}], applied} (single-concept:
   * proposals is one object); 'heuristics' keeps the legacy
   * {ok, changes, warnings} path byte-for-byte.
   */
  async autocorrect(repoId, { dryRun = true, mode, conceptId } = {}, actor = {}) {
    const body = { dry_run: !!dryRun };
    if (mode) body.mode = mode;
    if (conceptId) body.concept_id = conceptId;
    const res = await httpService.post(`/okf/repos/${encodeURIComponent(repoId)}/autocorrect`, body, {
      headers: actor && actor.sub ? { 'x-actor-sub': actor.sub } : {}
    });
    return res && res.data ? res.data : { ok: true };
  },

  /**
   * Story #978 — IMPORT N concepts (also the primitive behind "create repo
   * from scratch" and "+ Add concept"). Same shape as the crawler path.
   * /import since David's 2026-09-04 vocabulary ruling (import ≠ RAG):
   * importing stores parsed meta rows — NOTHING is chunked pre-ingest.
   */
  async importConcepts(repoId, concepts, actor = {}, extras = {}) {
    const res = await httpService.post(
      `/okf/repos/${encodeURIComponent(repoId)}/import`,
      { concepts, ...extras },
      { headers: actor && actor.sub ? { 'x-actor-sub': actor.sub } : {} }
    );
    return res && res.data ? res.data : { ok: true };
  },

  /**
   * Story #978 — delete ONE concept (meta row + indexed chunks + graph).
   */
  async deleteConcept(repoId, conceptId, actor = {}) {
    const res = await httpService.delete(
      `/okf/repos/${encodeURIComponent(repoId)}/concepts/${encodeURIComponent(conceptId)}`,
      { headers: actor && actor.sub ? { 'x-actor-sub': actor.sub } : {} }
    );
    return res && res.data ? res.data : { ok: true };
  },

  /**
   * Story #978 lifecycle — apply ONE lifecycle transition (submit / approve /
   * publish / ingest / retract). publish mints the next version + exports the
   * bundle zip (<name>-v<N>.zip) to the document repository.
   */
  async lifecycle(repoId, action, actor = {}) {
    const res = await httpService.post(
      `/okf/repos/${encodeURIComponent(repoId)}/lifecycle`,
      { action },
      { headers: actor && actor.sub ? { 'x-actor-sub': actor.sub } : {} }
    );
    return res && res.data ? res.data : { ok: true };
  },

  /**
   * Story #978 — delete the whole repository (cascade: graph + meta rows +
   * bundle artifacts + manifests). Refused with INGESTED_DELETE_BLOCKED while
   * an ingested version is serving.
   */
  async deleteRepo(repoId) {
    const res = await httpService.delete(`/okf/repos/${encodeURIComponent(repoId)}`);
    return res && res.data ? res.data : { ok: true };
  },

  /**
   * Story #978 (David, 2026-08-30) — steward PII acknowledgement. Waives the
   * PII 'hit' publish gate for REVIEWED public entities (audited server-side).
   */
  async acknowledgePii(repoId, acknowledge = true, actor = {}) {
    const res = await httpService.post(
      `/okf/repos/${encodeURIComponent(repoId)}/pii-acknowledge`,
      { acknowledge },
      { headers: actor && actor.sub ? { 'x-actor-sub': actor.sub } : {} }
    );
    return res && res.data ? res.data : { ok: true };
  },

  /**
   * Story #978 — list the repo's version manifests (newest first). Shape:
   * { repo_id, versions: [{bundle_version, okf_tag, trigger, curator,
   * minted_at, concept_count}] }.
   */
  async listVersions(repoId) {
    const res = await httpService.get(`/okf/repos/${encodeURIComponent(repoId)}/versions`);
    return res && res.data && Array.isArray(res.data.versions) ? res.data.versions : [];
  },

  /**
   * Story #978 (David, 2026-08-31) — the repository's action/audit log
   * (okf_audit_logs, newest first). Shape: { repo_id, logs: [{ts, actor,
   * actor_name, action, description, details, concept_id?}] }.
   */
  async getRepoLogs(repoId) {
    const res = await httpService.get(`/okf/repos/${encodeURIComponent(repoId)}/logs`);
    return res && res.data && Array.isArray(res.data.logs) ? res.data.logs : [];
  },

  /**
   * PII REVIEW (David, 2026-09-09): a live Presidio scan of a concept's
   * CURRENT content returning per-occurrence {where, type, start, end, score}
   * so the editor can locate each flagged entity. Nothing persisted; flagged
   * VALUES never returned — the editor renders excerpts from content it has.
   */
  async inspectPii(repoId, conceptId, opts = {}) {
    // rescan (David, 2026-09-13): the explicit Re-scan button forces a live
    // Presidio scan; plain opens are served from the server's persisted
    // span cache when the content is unchanged.
    const res = await httpService.post(
      `/okf/repos/${encodeURIComponent(repoId)}/concepts/${encodeURIComponent(conceptId)}/pii-inspect`,
      { rescan: Boolean(opts.rescan) },
      { timeout: 120000 }
    );
    return res && res.data ? res.data : { ok: false, occurrences: [] };
  },

  /**
   * PII REMEDIATION (David, 2026-09-09): process one flagged issue IN PLACE —
   * action 'redact' | 'replace' | 'remove'; selection carries the panel's
   * occurrence (where/start/end/type/hit) and replacement is the user text
   * for 'replace'. The server splices its own scan offsets, records the
   * before/after resolution, re-scans, and returns the fresh payload
   * {ok, pii_state, occurrences, resolutions, frontmatter, body}.
   */
  async remediatePii(repoId, conceptId, selection) {
    const res = await httpService.post(
      `/okf/repos/${encodeURIComponent(repoId)}/concepts/${encodeURIComponent(conceptId)}/pii-remediate`,
      selection,
      { timeout: 120000 }
    );
    return res && res.data ? res.data : { ok: false };
  },

  /**
   * PII REMEDIATION — ACCEPT one occurrence: the text stays, the flag is
   * suppressed (reviewed decision; audited). SCAN-FREE server-side — state
   * derives arithmetically. Returns {ok, pii_state, counts_by_type, ...}.
   */
  async acceptPii(repoId, conceptId, selection) {
    const res = await httpService.post(
      `/okf/repos/${encodeURIComponent(repoId)}/concepts/${encodeURIComponent(conceptId)}/pii-accept`,
      selection,
      { timeout: 120000 }
    );
    return res && res.data ? res.data : { ok: false };
  },

  /**
   * PII WHOLE-FILE ACTION (David, 2026-09-09): redact | remove | accept for
   * the ENTIRE file. Occurrences ride the request (the panel's current scan)
   * so the server path is scan-free. Returns the standard action payload.
   */
  async fileActionPii(repoId, conceptId, payload) {
    const res = await httpService.post(
      `/okf/repos/${encodeURIComponent(repoId)}/concepts/${encodeURIComponent(conceptId)}/pii-file-action`,
      payload,
      { timeout: 120000 }
    );
    return res && res.data ? res.data : { ok: false };
  },

  /**
   * PII REMEDIATION — REDACT THE WHOLE FILE: the body is replaced with a
   * redaction notice (frontmatter identity preserved). Returns the same
   * payload shape as remediatePii.
   */
  async redactWholeFilePii(repoId, conceptId) {
    const res = await httpService.post(
      `/okf/repos/${encodeURIComponent(repoId)}/concepts/${encodeURIComponent(conceptId)}/pii-redact-file`,
      {},
      { timeout: 120000 }
    );
    return res && res.data ? res.data : { ok: false };
  },

  /**
   * PII REPO BULK ACTION (David, 2026-09-12): redact | remove | accept
   * applied to EVERY flagged concept of the repository in one decision
   * (Files-view header controls). Scan-free on the server; stamps the scan
   * marker so publish neither blocks nor re-scans. Returns
   * {ok, action, concepts_affected}.
   */
  async bulkPiiAction(repoId, action) {
    const res = await httpService.post(
      `/okf/repos/${encodeURIComponent(repoId)}/pii-bulk`,
      { action },
      { timeout: 120000 }
    );
    return res && res.data ? res.data : { ok: false };
  }
};

export default repoOkfService;

/**
 * PII REVIEW (David, 2026-09-09): a live Presidio scan of a concept's CURRENT
 * content returning per-occurrence {where, type, start, end, score} so the
 * editor can locate each flagged entity. Nothing is persisted; flagged VALUES
 * are never returned — the editor renders excerpts from the content it has.
 */
export async function inspectPii(repoId, conceptId) {
  const res = await httpService.post(
    `/okf/repos/${encodeURIComponent(repoId)}/concepts/${encodeURIComponent(conceptId)}/pii-inspect`,
    {},
    { timeout: 120000 }
  );
  return res && res.data ? res.data : { ok: false, occurrences: [] };
}

/** PII REMEDIATION (David, 2026-09-09): named export twin of the class
 * method — in-place Redact/Replace/Remove on one occurrence. */
export async function remediatePii(repoId, conceptId, selection) {
  return repoOkfService.remediatePii(repoId, conceptId, selection);
}

/** PII REMEDIATION: named export twin — Accept one occurrence (audited). */
export async function acceptPii(repoId, conceptId, selection) {
  return repoOkfService.acceptPii(repoId, conceptId, selection);
}

/** PII WHOLE-FILE ACTION: named export twin — redact | remove | accept. */
export async function fileActionPii(repoId, conceptId, payload) {
  return repoOkfService.fileActionPii(repoId, conceptId, payload);
}

/** PII REMEDIATION: named export twin — redact the whole file body. */
export async function redactWholeFilePii(repoId, conceptId) {
  return repoOkfService.redactWholeFilePii(repoId, conceptId);
}
