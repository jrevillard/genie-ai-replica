/**
 * okfRepoOps — shared OKF repository operations library (Story #978).
 *
 * The ONE client-side implementation of repo/concept file operations, used by
 * BOTH UI approaches (Studio wizard steps and the Studio editor) so they have
 * equal features:
 *   createRepo        — empty repo + index.md skeleton (type: index)
 *   createConcept     — "+ Add concept": frontmatter-normalized paste, auto
 *                       append to the index body's `## Contents` TOC
 *   deleteConcept     — one-concept retraction (meta + chunks + edges)
 *   applyLabel        — Knowledge-Hierarchy label write for one concept
 *   splitModeConcepts — crawler split modes (re-exported for reuse)
 *
 * Pure orchestration over the service layer — no Vuex, no components — so
 * any UI can drive it.
 */

import repoOkfService from './repoOkfService';
import conceptService from './conceptService';
import httpService from './httpService';
import serviceTreeService from './serviceTreeService';
import matter from 'gray-matter';

/** Slug for new concept paths (same rules as crawlerToOkfService.slugify). */
export function slugifyConcept(input) {
  if (!input) return 'concept';
  return (
    String(input)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'concept'
  );
}

/**
 * Subject-area options from the Knowledge Hierarchy CATEGORY level — the
 * same curated tree the editor's label picker uses (serviceTreeService.
 * getAdminCategories; David, 2026-09-04: dashboard Subject Areas follow the
 * Knowledge Hierarchy Categories, never a hard-coded list).
 *   - 'general' is the fallback ONLY when the hierarchy is unreachable or
 *     empty — never a listed option when the tree loads.
 *   - `repoDomains` (distinct live-repo domains) missing from the KH list
 *     are appended as "X (legacy)" so filters never orphan existing repos.
 */
export async function loadSubjectAreaOptions(repoDomains = []) {
  let cats;
  try {
    cats = (await serviceTreeService.getAdminCategories('en')) || [];
  } catch {
    cats = [];
  }
  const opts = [];
  for (const cat of cats) {
    const name = cat && (cat.name || cat.nameEN);
    if (name) opts.push({ value: String(name), label: String(name) });
  }
  if (!opts.length) return [{ value: 'general', label: 'General' }];
  const known = new Set(opts.map((o) => o.value));
  for (const d of new Set((repoDomains || []).filter(Boolean).map((d) => String(d)))) {
    if (!known.has(d)) opts.push({ value: d, label: d + ' (legacy)' });
  }
  return opts;
}

/**
 * Scope-segment slug for ACL `required_scopes`: lowercase [a-z0-9-] only —
 * the scope parser shreds on whitespace, and Subject Areas are KH display
 * names ('Water Supply') since the hierarchy-driven wave (defense-in-depth;
 * server-side normalization lands separately). Empty input falls back to
 * 'general' so a scope segment is never blank.
 */
function slugScopeDomain(input) {
  return (
    String(input || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'general'
  );
}

/**
 * LABELS BOUNDED TO SUBJECT AREA (David's curation rule, 2026-09-05): the
 * label picker offers ONLY the services UNDER the repo's Subject Area —
 * getAdminCategories → the category matching `domain` → its children
 * (services level). A domain with no KH match (legacy repo) falls back to
 * the FULL tree so curation is never blocked, with `bounded: false` so the
 * UI can surface a hint. Pure function — single-sourced for the editor rail,
 * the tree label chips, and any future picker.
 *
 * @param {Array} categories  serviceTreeService.getAdminCategories('en') tree
 * @param {string} domain     the repo's Subject Area (KH category name)
 * @returns {{options: Array<{value,label}>, bounded: boolean}}
 */
export function labelOptionsForDomain(categories, domain) {
  const cats = Array.isArray(categories) ? categories : [];
  const toOption = (svc) => {
    const name = svc && (svc.name || svc.nameEN || svc.serviceKey || svc._key);
    return name ? { value: String(name), label: String(name) } : null;
  };
  const cat = cats.find((c) => c && (c.name || c.nameEN) === domain);
  if (cat) {
    const options = (cat.children || []).map(toOption).filter(Boolean);
    if (options.length) return { options, bounded: true };
    // Category exists but carries no services — full tree, still unbounded.
  }
  const options = [];
  for (const c of cats) {
    for (const svc of (c && c.children) || []) {
      const opt = toOption(svc);
      if (opt) options.push(opt);
    }
  }
  return { options, bounded: false };
}

/**
 * Create an empty draft repo with an index.md skeleton (bundle root).
 * Returns the created repo doc.
 */
export async function createRepo({ name, domain }) {
  if (!name || typeof name !== 'string') {
    const err = new Error('name is required');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const d = domain || 'general';
  let repo;
  try {
    repo = await repoOkfService.create({
      name: name.trim(),
      domain: d,
      acl: { required_scopes: [`okf:t:${slugScopeDomain(d)}:admin`] },
      lifecycle_state: 'draft'
    });
  } catch (err) {
    // 409 DUPLICATE_REPO is a HANDLED, user-facing outcome (the create dialog
    // tells the steward to pick another name) — surface it as its own code,
    // not a generic CREATE_FAILED.
    if (err && (err.status === 409 || (err.data && err.data.error === 'DUPLICATE_REPO'))) {
      err.code = 'DUPLICATE_REPO';
    }
    throw err;
  }
  if (!repo || !repo.repo_id) {
    const err = new Error('repo creation returned no repo_id');
    err.code = 'CREATE_FAILED';
    throw err;
  }
  await repoOkfService.importConcepts(repo.repo_id, [
    {
      path: 'index.md',
      frontmatter: { type: 'index', title: name.trim(), sources: [] },
      body: `# ${name.trim()}\n\n## Contents\n\n`
    }
  ]);
  return repo;
}

/**
 * Build the import-ready concept payload for a NEW concept file. Pasted
 * markdown is NORMALIZED to the OKF standard: frontmatter parsed + merged
 * over conformant defaults (paste wins per-field). Pure function.
 */
export function buildConceptPayload({ title, type = 'topic', body = '', existingIds = [] }) {
  const base = slugifyConcept(title);
  let slug = base;
  let n = 2;
  const taken = new Set(existingIds);
  while (taken.has(slug)) slug = `${base}-${n++}`;

  let pasteFm = {};
  let pasteBody = body || '';
  try {
    const parsed = matter(pasteBody || '');
    pasteFm = parsed.data || {};
    pasteBody = parsed.content || '';
  } catch {
    /* no/invalid frontmatter — treat as raw body */
  }
  const frontmatter = {
    type: pasteFm.type || type,
    title: pasteFm.title || String(title).trim(),
    sources: Array.isArray(pasteFm.sources) ? pasteFm.sources : []
  };
  if (Array.isArray(pasteFm.tags) && pasteFm.tags.length) frontmatter.tags = pasteFm.tags;
  if (pasteFm.description) frontmatter.description = pasteFm.description;
  return { path: `${slug}.md`, frontmatter, body: pasteBody.trim(), concept_id: slug };
}

/**
 * Append a TOC line to the index concept's body and PATCH it. BODY-ONLY
 * (labels write-through, 2026-09-05): the server keeps the STORED
 * frontmatter, so the append can no longer round-trip a stale fm snapshot
 * and clobber a just-written label on the index concept. Best-effort: a
 * missing/failed index update never fails the concept creation.
 */
export async function appendToIndexToc(repoId, indexRow, conceptTitle, conceptSlug) {
  try {
    const got = await conceptService.get(repoId, indexRow.concept_id);
    const row = got && typeof got === 'object' && got.concept_id ? got : null;
    if (!row) return false;
    const bodyText = row.body || '';
    const line = `- [${conceptTitle}](concepts/${conceptSlug}.md)`;
    const nextBody = /(^|\n)## Contents\s*\n/.test(bodyText)
      ? `${bodyText.replace(/\s*$/, '')}\n${line}\n`
      : `${bodyText.replace(/\s*$/, '')}\n\n## Contents\n\n${line}\n`;
    await repoOkfService.patchConceptBody(repoId, indexRow.concept_id, nextBody);
    return true;
  } catch {
    return false;
  }
}

/**
 * Add a concept file end-to-end: build payload → import → auto-append the
 * index TOC. Returns { concept_id, index_updated }.
 */
export async function addConcept({ repoId, title, type, body, existingIds = [], indexRow = null }) {
  const payload = buildConceptPayload({ title, type, body, existingIds });
  await repoOkfService.importConcepts(repoId, [payload]);
  let indexUpdated = false;
  if (indexRow) {
    indexUpdated = await appendToIndexToc(repoId, indexRow, payload.frontmatter.title, payload.concept_id);
  }
  return { concept_id: payload.concept_id, title: payload.frontmatter.title, index_updated: indexUpdated };
}

/**
 * Knowledge-Hierarchy label write for one concept (used by BOTH the editor
 * right rail / tree label chips and the wizard Curate step).
 */
export async function applyLabel(repoId, conceptId, labels) {
  return conceptService.update(repoId, conceptId, { labels });
}

/**
 * Delete one concept (meta + chunks + graph edges) via the okf-server.
 */
export async function deleteConcept(repoId, conceptId) {
  return repoOkfService.deleteConcept(repoId, conceptId);
}

// ─── BUILDING GATE (David, 2026-09-02; import/RAG boundary 2026-09-04) ──────
// A repo whose source file is still converting is NOT reviewable content
// yet: the workflow pins it to Import and refuses lifecycle moves. Since
// the import/RAG boundary, RAG indexing does NOT exist before the lifecycle
// ingest transition — the drain arms at ingest (repo.rag_drain_active +
// repo.rag_ingestion), parsed counts never gate anything pre-ingest, and
// publish is gated by CONTENT only (conformance + PII; the mint refuses an
// ACTIVE drain with DRAIN_IN_PROGRESS). This mirrors the server's
// buildingBlocker for the UI. Terminal vocabulary is
// single-sourced with the crawl-conversion contract: terminal =
// 'done' | 'failed' ONLY (missing conversion = not building).

/** True while the repo is being built: an import conversion is active, or
 * the RAG drain is running (rag_ingestion.status === 'draining', armed by
 * the lifecycle ingest transition). Parsed rows accumulating at import are
 * NORMAL now — they wait, undrained, until ingest arms — so indexing_pending
 * alone is NOT "building". */
export function isBuilding(repo) {
  if (!repo) return false;
  // P0-UI (David's re-test, 2026-09-08): 'publish' is NEVER building —
  // serving truth wins (ingested_at set), and a post-publish re-drain is a
  // REBUILD (shown as the Re-draining chip), not an import-phase state.
  // This kills the stale-drain-flag projection that rendered serving repos
  // as Building/Import.
  if (repo.lifecycle_state === 'publish') return false;
  const conv = repo.conversion;
  if (conv && !['done', 'failed'].includes(conv.status)) return true;
  return !!(repo.rag_ingestion && repo.rag_ingestion.status === 'draining');
}

/** P0-UI: a publish-state repo whose RAG drain is genuinely running —
 * covers BOTH the serving re-drain AND the between-state after a
 * re-ingest click (publish, drain armed, settle not yet completed). Keys
 * on the drain flags, NOT on ingested_at. */
export function isRedraining(repo) {
  if (!repo) return false;
  if (repo.lifecycle_state !== 'publish') return false;
  if (repo.rag_drain_active === true) return true;
  return !!(repo.rag_ingestion && repo.rag_ingestion.status === 'draining');
}

// ─── Lifecycle (David, 2026-08-28) ───────────────────────────────────────────
// The full publish lifecycle is shared by BOTH UI approaches (wizard Step 9
// and the editor shell / dashboard cards) via these thin wrappers — one
// implementation, equal features.

/** draft/register/validate → review. */
export function submitForReview(repoId, actor = {}) {
  return repoOkfService.lifecycle(repoId, 'submit', actor);
}

/** review → approve. */
export function approve(repoId, actor = {}) {
  return repoOkfService.lifecycle(repoId, 'approve', actor);
}

/**
 * approve|publish → publish: mints the next version (the server's publish
 * gates run: PII-complete, all-indexed, conformance-clean) and exports the
 * bundle zip `<name>-v<N>.zip` to the document repository. The previous
 * version's zip is superseded (deleted); history stays in the version ledger.
 * The new version is NOT serving until ingest() is called.
 */
export function publish(repoId, actor = {}) {
  return repoOkfService.lifecycle(repoId, 'publish', actor);
}

/** publish → serving: declares the current version ingested (the Ingested lane). */
export function ingest(repoId, actor = {}) {
  return repoOkfService.lifecycle(repoId, 'ingest', actor);
}

/** publish → not serving: retract the ingested version (Ingested → Published). */
export function retract(repoId, actor = {}) {
  return repoOkfService.lifecycle(repoId, 'retract', actor);
}

/** Delete the whole repository (refused while an ingested version serves). */
export function deleteRepo(repoId) {
  return repoOkfService.deleteRepo(repoId);
}

/** List the repo's version manifests (newest first) for the versions panel. */
export function listVersions(repoId) {
  return repoOkfService.listVersions(repoId);
}

// ─── Zip export / import (David, 2026-08-28) ────────────────────────────────
// Export: any repo, any state — the okf-server builds the zip on the fly
// (GET /okf/repos/:id/export) and the browser saves it under the repo+version
// file name. Import: a zip bundle creates a draft repo + imports its
// concepts (the server's 2.9.5 unzip path) — the zip's file doc carries repo_id +
// is_bundle, so the artifact linkage exists from the first minute.

/** Trigger a browser download of the repo's zip bundle. */
export async function exportRepoZip(repo) {
  if (!repo || !repo.repo_id) throw new Error('repo is required');
  const res = await httpService.get(
    `/okf/repos/${encodeURIComponent(repo.repo_id)}/export`,
    {},
    { responseType: 'blob' }
  );
  const headerName = (() => {
    const cd = (res && res.headers && res.headers['content-disposition']) || '';
    const m = /filename="?([^";]+)"?/.exec(cd);
    return m ? m[1] : null;
  })();
  const fallback = `${slugifyConcept(repo.name || repo.repo_id)}-v${repo.version || 0}.zip`;
  const blob = new Blob([res && res.data], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = headerName || fallback;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return headerName || fallback;
}

/** Read a File as base64 (no data: prefix). */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',').pop());
    reader.onerror = () => reject(new Error('failed to read the selected file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Import a zip bundle as a NEW draft repository: create + import the zip.
 * The server unzips it (one concept per .md entry) and stores the zip itself
 * as the repo's bundle artifact (is_bundle). `classification` (heuristics |
 * llm | hybrid, David 2026-09-05) rides the import payload — the backend
 * converter wires the parameter (field name provisional until 65 announces).
 */
export async function importRepoZip({ file, name, domain, classification }) {
  if (!file) throw Object.assign(new Error('zip file is required'), { code: 'VALIDATION_ERROR' });
  if (!name || !String(name).trim()) throw Object.assign(new Error('name is required'), { code: 'VALIDATION_ERROR' });
  const repo = await createRepo({ name: String(name).trim(), domain });
  try {
    await importZipIntoRepo({ repoId: repo.repo_id, file, classification });
  } catch (err) {
    err.repo = repo; // the repo exists — the caller can still open it in the editor
    throw err;
  }
  return repo;
}

/**
 * Import a zip bundle INTO AN EXISTING repository (P0-UX, David,
 * 2026-09-08: create first, navigate to the dashboard, THEN run the zip
 * import in the background — the import must never block navigation).
 * Returns the import response; throws on failure (the caller owns the
 * error surface).
 */
export async function importZipIntoRepo({ repoId, file, classification }) {
  if (!repoId) throw Object.assign(new Error('repoId is required'), { code: 'VALIDATION_ERROR' });
  if (!file) throw Object.assign(new Error('zip file is required'), { code: 'VALIDATION_ERROR' });
  const b64 = await fileToBase64(file);
  return repoOkfService.importConcepts(repoId, [], null, {
    zip: b64,
    bundle_name: file.name,
    classification: classification || 'heuristics'
  });
}

/** Mint the next version WITHOUT publishing (manual trigger). */
export function createVersion(repoId, actor = {}) {
  return repoOkfService.mintVersion(repoId, { trigger: 'manual' }, actor);
}

/**
 * Human-readable, ACTIONABLE text for lifecycle gate failures (David,
 * 2026-08-30: "retry after the worker drains" is not a user-facing sentence).
 * The raw server message stays available for the generic case.
 */
export function friendlyLifecycleError(code, message, fallback) {
  if (code === 'DRAIN_IN_PROGRESS') {
    return 'Some files are still being processed (indexed). Open this repository in the editor — the file list shows which ones, and ingestion retries automatically. Try publishing again once every file shows indexed.';
  }
  if (code === 'PUBLISH_GATE_BLOCKED') {
    return (
      message ||
      'The repository is not ready to publish — all files must be indexed, conformance-clean and PII-scanned.'
    );
  }
  if (code === 'PUBLISH_EMPTY') {
    return 'This repository has no content yet — add concepts before publishing.';
  }
  if (code === 'INVALID_TRANSITION') {
    return message || 'That action is not allowed from the current state.';
  }
  if (code === 'REPO_READ_ONLY') {
    return 'This repository is currently serving (ingested) and is READ ONLY — retract it if you want to change it.';
  }
  if (code === 'GRAPH_NAME_CONFLICT') {
    return 'Another repository with the same name and version already owns the serving graph name — rename one of them and retry.';
  }
  return message || fallback || 'Action failed';
}

/** Steward PII acknowledgement (audited server-side; waives the PII hit gate). */
export function acknowledgePii(repoId, acknowledge = true, actor = {}) {
  return repoOkfService.acknowledgePii(repoId, acknowledge, actor);
}

/** Generic lifecycle dispatcher — the single entry point for the store's
 * lifecycleTransition action (wizard + editor + dashboard all route here). */
export function lifecycle(repoId, action, actor = {}) {
  return repoOkfService.lifecycle(repoId, action, actor);
}

/** Default export: the same surface, importable either way (RepoEditor.vue
 * imports the default binding; tests import named members). */
export default {
  slugifyConcept,
  loadSubjectAreaOptions,
  labelOptionsForDomain,
  isBuilding,
  isRedraining,
  buildConceptPayload,
  addConcept,
  appendToIndexToc,
  applyLabel,
  deleteConcept,
  createRepo,
  submitForReview,
  approve,
  publish,
  ingest,
  retract,
  deleteRepo,
  listVersions,
  createVersion,
  lifecycle,
  exportRepoZip,
  importRepoZip,
  importZipIntoRepo,
  friendlyLifecycleError,
  acknowledgePii
};
