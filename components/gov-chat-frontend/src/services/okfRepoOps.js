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
  const repo = await repoOkfService.create({
    name: name.trim(),
    domain: d,
    acl: { required_scopes: [`okf:t:${d}:admin`] },
    lifecycle_state: 'draft'
  });
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
