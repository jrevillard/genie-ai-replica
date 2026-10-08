/**
 * frontmatterService — Story 1.7 (2026-10-08) curator-tag UX wrapper.
 *
 * Story 1.7 (supersedes the Story 1.6 dedicated collection): the
 * per-repo frontmatter lives in `okf_repositories.frontmatter` (a new
 * doc field, additive) — the index.md YAML frontmatter block is the
 * curator-facing projection. The curator edits the index.md YAML
 * directly via the existing concept-meta PATCH (which writes through
 * to the doc field). This service is a thin wrapper over the
 * read-side endpoint the Publish step's gate uses, plus the
 * `suggestFrontmatter` POST the operator-migration script calls.
 *
 * Endpoints:
 *   getFrontmatter(repoId)         — GET  /api/okf/repos/:id (the doc
 *                                      field is included; expanded to
 *                                      per-row shape for the gate)
 *   suggestFrontmatter(repoId)     — POST /api/okf/repos/:id/frontmatter/suggest
 *                                      (kept for the operator migration
 *                                      script + the migration window)
 *   patchFrontmatter(repoId, fm)   — PATCH /api/okf/repos/:id
 *                                      (the new field lives on the
 *                                      repo doc; writes through the
 *                                      existing repo PATCH)
 *
 * The new design drops the dedicated okf_repo_frontmatter + summary
 * collections; this service is the migration-window shim.
 *
 * Path convention: httpService.baseURL is '/api', so calls here use
 * '/okf/...' without the leading '/api' (the convention used by
 * okfRepoOps.js / repoOkfService / conceptService).
 */
import httpService from './httpService';

function repoUrl(repoId) {
  return `/okf/repos/${encodeURIComponent(repoId)}`;
}

// Read the per-repo frontmatter rows for the Publish step's gate.
// Reads the repo doc (which includes the new frontmatter field) and
// expands the { topic, entity, ..., _approved } shape into the per-row
// { _key, field, value, approved_at } shape the gate consumes. The
// server-side `getFrontmatter` endpoint is removed; the canonical
// store is the doc field.
export async function getFrontmatter(repoId) {
  const res = await httpService.get(repoUrl(repoId));
  const repo = (res && res.data && res.data.data) || res.data || res;
  const fm = repo && repo.frontmatter;
  if (!fm) return { repo_id: repoId, frontmatter: [] };
  const approvedByValue = new Map();
  for (const a of Array.isArray(fm._approved) ? fm._approved : []) {
    if (a && a.field && a.value) {
      approvedByValue.set(`${a.field}::${a.value}`, a);
    }
  }
  const rows = [];
  for (const field of ['topic', 'entity', 'forbidden', 'keyword']) {
    const list = Array.isArray(fm[field]) ? fm[field] : [];
    for (const value of list) {
      const a = approvedByValue.get(`${field}::${value}`);
      rows.push({
        _key: `${field}:${value}`,
        repo_id: repoId,
        field,
        value,
        weight: 1.0,
        approved_at: a ? a.approved_at : null,
        approved_by: a ? a.approved_by : null,
        version: fm.version
      });
    }
  }
  for (const field of ['scope', 'summary']) {
    const v = fm[field];
    if (v) {
      const a = approvedByValue.get(`${field}::${v}`);
      rows.push({
        _key: `${field}:${v}`,
        repo_id: repoId,
        field,
        value: v,
        weight: 1.0,
        approved_at: a ? a.approved_at : null,
        approved_by: a ? a.approved_by : null,
        version: fm.version
      });
    }
  }
  return { repo_id: repoId, frontmatter: rows };
}

// Retained for migration-window compatibility (the operator
// republish-with-tags script + the wizard's auto-suggest may still
// call it). Reads come through the repo doc; the response shape is
// unchanged for back-compat.
export async function getFrontmatterSummary(repoId) {
  const res = await httpService.get(repoUrl(repoId));
  const repo = (res && res.data && res.data.data) || res.data || res;
  const fm = repo && repo.frontmatter;
  if (!fm) return null;
  return {
    _key: repoId,
    topic_count: Array.isArray(fm.topic) ? fm.topic.length : 0,
    entity_count: Array.isArray(fm.entity) ? fm.entity.length : 0,
    keyword_count: Array.isArray(fm.keyword) ? fm.keyword.length : 0,
    forbidden_count: Array.isArray(fm.forbidden) ? fm.forbidden.length : 0,
    summary: fm.summary || '',
    scope: fm.scope || '',
    version: fm.version,
    updated_at: fm.updated_at,
    updated_by: fm.updated_by
  };
}

/**
 * Trigger LLM auto-suggestion. Returns { repo_id, suggested: {topic, entity, scope,
 * forbidden, summary, keyword}, validation: { validated, inconsistencies } }.
 * Does NOT write — the curator must explicitly save (via PATCH on the repo
 * doc, or via the lifecycle publish hook which passes the suggested set
 * through to the server).
 *
 * The backend's suggestTags runs the AsyncOpenAI-equivalent via vLLM with
 * retry+backoff per reference_remote-llm-endpoint.md — a slow call (5-15s);
 * callers should show a "Curating…" indicator with no expected quick resolution.
 */
export async function suggestFrontmatter(repoId) {
  const res = await httpService.post(`/okf/repos/${encodeURIComponent(repoId)}/frontmatter/suggest`);
  return res.data;
}

/**
 * Curator save. Story 1.7: the canonical store is the repo doc
 * field; the PATCH writes through. The body's `frontmatter` key is
 * the same shape as the doc field (the validator accepts it and the
 * service updates the doc atomically).
 */
export async function patchFrontmatter(repoId, frontmatter) {
  const res = await httpService.patch(repoUrl(repoId), { frontmatter });
  return res.data;
}

/**
 * Frontmatter gate check (used by Publish.vue's gate). Returns true when the
 * repo has at least 3 topic tags AND at least 1 forbidden tag AND all rows are
 * approved (approved_at set). Used to enable/disable the Publish button.
 *
 * Computed locally from the frontmatter rows (cheap, no extra endpoint).
 */
export function isFrontmatterPublishReady(frontmatterRows = []) {
  if (!Array.isArray(frontmatterRows) || !frontmatterRows.length) return false;
  let topicCount = 0;
  let forbiddenCount = 0;
  for (const row of frontmatterRows) {
    if (!row.approved_at) return false; // an unapproved row blocks publish
    if (row.field === 'topic') topicCount += 1;
    else if (row.field === 'forbidden') forbiddenCount += 1;
  }
  return topicCount >= 3 && forbiddenCount >= 1;
}
