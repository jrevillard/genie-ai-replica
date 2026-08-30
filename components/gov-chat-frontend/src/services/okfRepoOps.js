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
      acl: { required_scopes: [`okf:t:${d}:admin`] },
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
  await repoOkfService.ingest(repo.repo_id, [
    {
      path: 'index.md',
      frontmatter: { type: 'index', title: name.trim(), sources: [] },
      body: `# ${name.trim()}\n\n## Contents\n\n`
    }
  ]);
  return repo;
}

/**
 * Build the ingest-ready concept payload for a NEW concept file. Pasted
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
 * Append a TOC line to the index concept's body and PATCH it. Best-effort:
 * a missing/failed index update never fails the concept creation.
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
    const markdown = matter.stringify(nextBody, row.frontmatter || { type: 'index', title: indexRow.title });
    await repoOkfService.patchConcept(repoId, indexRow.concept_id, markdown);
    return true;
  } catch {
    return false;
  }
}

/**
 * Add a concept file end-to-end: build payload → ingest → auto-append the
 * index TOC. Returns { concept_id, index_updated }.
 */
export async function addConcept({ repoId, title, type, body, existingIds = [], indexRow = null }) {
  const payload = buildConceptPayload({ title, type, body, existingIds });
  await repoOkfService.ingest(repoId, [payload]);
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
// file name. Import: a zip bundle creates a draft repo + ingests its concepts
// (the server's 2.9.5 unzip path) — the zip's file doc carries repo_id +
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
 * Import a zip bundle as a NEW draft repository: create + ingest the zip.
 * The server unzips it (one concept per .md entry) and stores the zip itself
 * as the repo's bundle artifact (is_bundle).
 */
export async function importRepoZip({ file, name, domain }) {
  if (!file) throw Object.assign(new Error('zip file is required'), { code: 'VALIDATION_ERROR' });
  if (!name || !String(name).trim()) throw Object.assign(new Error('name is required'), { code: 'VALIDATION_ERROR' });
  const b64 = await fileToBase64(file);
  const repo = await createRepo({ name: String(name).trim(), domain });
  try {
    await repoOkfService.ingest(repo.repo_id, [], null, { zip: b64, bundle_name: file.name });
  } catch (err) {
    err.repo = repo; // the repo exists — the caller can still open it in the editor
    throw err;
  }
  return repo;
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
export function friendlyLifecycleError(code, message) {
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
  return message || 'Action failed';
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
  friendlyLifecycleError,
  acknowledgePii
};
