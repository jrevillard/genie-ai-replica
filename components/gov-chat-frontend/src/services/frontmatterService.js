/**
 * frontmatterService — Story 1.6 (2026-10-07) curator-tag + vectorize UX.
 *
 * Thin client-side wrapper over the three new okf-server endpoints
 * (mounted at /api/okf/repos/:id/frontmatter* in components/okf-server/routes/okf-routes.js):
 *   getFrontmatter(repoId)         — GET    /api/okf/repos/:id/frontmatter
 *   getFrontmatterSummary(repoId)  — GET    /api/okf/repos/:id/frontmatter/summary
 *   suggestFrontmatter(repoId)     — POST   /api/okf/repos/:id/frontmatter/suggest  (returns the proposed set without writing)
 *   patchFrontmatter(repoId, fm)   — PATCH  /api/okf/repos/:id/frontmatter  (curator edit; re-embeds via TEI)
 *
 * Mirrors the existing okfRepoOps.js style: pure orchestration over
 * httpService — no Vuex, no components. Both the Studio wizard steps and
 * the Studio editor drive this.
 *
 * Path convention: httpService.baseURL is '/api' (see services/httpService.js
 * + config/runtime baseURL setup), so calls here must use the route path
 * WITHOUT a leading '/api' — the existing okfRepoOps.js / repoOkfService /
 * conceptService all use '/okf/...' for the same reason. The first version
 * of this service shipped with '/api/okf/...' which produced 404s at
 * /api/api/okf/.../frontmatter in production (rebuild 2026-10-07).
 *
 * The Studio editor's RepoEditor.vue pane is wired in a separate MR
 * (deferred — server-side API contract is in place; UI surface for the
 * persistent editor ships as a follow-up).
 */
import httpService from './httpService';

function url(repoId, suffix = '') {
  return `/okf/repos/${encodeURIComponent(repoId)}/frontmatter${suffix}`;
}

/**
 * Read the full per-tag frontmatter rows. Returns { repo_id, frontmatter: [...] }
 * where each row is { _key, field, value, weight, vector, generated_at,
 * generated_by, approved_at, approved_by, version }.
 *
 * Used by the wizard Curate step's "Tags" sub-card for read-only display,
 * and by the editor pane for the editable list.
 */
export async function getFrontmatter(repoId) {
  const res = await httpService.get(url(repoId));
  return res.data;
}

/**
 * Read the denormalized hot-path summary row that the retriever uses.
 * Returns the 6 precomputed combination vectors + per-field counts + version.
 * Used by operator-facing "publish-gate is green" indicators.
 */
export async function getFrontmatterSummary(repoId) {
  const res = await httpService.get(url(repoId, '/summary'));
  return res.data;
}

/**
 * Trigger LLM auto-suggestion. Returns { repo_id, suggested: {topic, entity, scope,
 * forbidden, summary, keyword}, validation: { validated, inconsistencies } }.
 * Does NOT write — the curator must explicitly save via patchFrontmatter (or via
 * the lifecycle publish hook in the wizard's Publish step, which passes the
 * suggested set through to the server).
 *
 * The backend's suggestTags runs the AsyncOpenAI-equivalent via vLLM with
 * retry+backoff per reference_remote-llm-endpoint.md — a slow call (5-15s);
 * callers should show a "Curating…" indicator with no expected quick resolution.
 */
export async function suggestFrontmatter(repoId) {
  const res = await httpService.post(url(repoId, '/suggest'));
  return res.data;
}

/**
 * Curator edit endpoint. The body shape mirrors the lifecycle `frontmatter`
 * payload documented in validators/repository-validator.js (topic 3-30 values,
 * entity 0-10, scope 1 word, forbidden 2-6, summary 1 sentence, keyword 0-10,
 * comprehensive boolean for "no forbidden list because the repo is meant to be
 * comprehensive").
 *
 * The server re-embeds via TEI and re-writes both collections atomically.
 */
export async function patchFrontmatter(repoId, frontmatter) {
  const res = await httpService.patch(url(repoId), frontmatter);
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
