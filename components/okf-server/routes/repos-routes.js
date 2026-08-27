// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Repository CRUD routes, mounted under /api/okf/repos (by okf-routes.js).
// `authenticate` + the router-wide `requireScope('okf:read')` gate are INHERITED
// from the parent okf-routes.js (do NOT re-mount here).
// Authorization (Story 6.1, ADR-okf-025): per-repo mutations require
// requireRepoScope(repo_id, 'admin') — an `okf:{tenant}:{repo}:admin` scope (or
// wildcard / the tools-admin bootstrap super-role). Repo CREATION stays on the
// tools-admin role (platform-level act, no repo_id to scope — decision D4).

const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/require-role');
const { requireRepoScope } = require('../middleware/require-scope');
const ctrl = require('../controllers/repository-controller');

// List / Read — scope-filtered in the controller (default-deny, G3).
router.get('/', ctrl.listRepos);
router.get('/:repo_id', ctrl.getRepo);

// Mutations.
router.post('/', requireRole('tools-admin'), ctrl.createRepo);
router.patch('/:repo_id', requireRepoScope('repo_id', 'admin'), ctrl.updateRepo);
router.delete('/:repo_id', requireRepoScope('repo_id', 'admin'), ctrl.deleteRepo);

// PII scan (Story 2.8 — ADR-okf-004 rev): explicit concepts OR file discovery.
router.post('/:repo_id/pii-scan', requireRepoScope('repo_id', 'admin'), ctrl.piiScan);

// Write-side ingest trigger (Story 2.9.1 — ADR-021): parse→meta→conformance→
// PII→dedup→enqueue per concept; 202 once enqueued (never blocks on dataprep).
router.post('/:repo_id/ingest', requireRepoScope('repo_id', 'admin'), ctrl.ingestRepo);

// Version mint + manifests (Story 2.9.7 — ADR-031): mint is an admin mutation
// (publish/crawl/manual trigger); listing/reading versions is read-scope
// (backs 4.5's diff/list UI and version-pinned citation).
router.post('/:repo_id/versions', requireRepoScope('repo_id', 'admin'), ctrl.mintRepoVersion);
router.get('/:repo_id/versions', requireRepoScope('repo_id', 'read'), ctrl.listRepoVersions);
router.get('/:repo_id/versions/:bundle_version', requireRepoScope('repo_id', 'read'), ctrl.getRepoVersion);

// Repository clone (Story 4.8 — D-V5): an ADMIN mutation on the SOURCE repo —
// the clone reads the source wholesale (registry + meta), so the source's admin
// scope gates it (mirrors ingest). getById pre-gate (404 foreign) in the controller.
router.post('/:source_id/clone', requireRepoScope('source_id', 'admin'), ctrl.cloneRepo);

// Bundle manifest (Story B+C — the bundle IS a graph): read the settled
// bundle's self-description (concepts, author links, root, stats). Read-scope
// on the repo (it is the repo's discovery record, not a mutation).
// ?summary=1 lazily generates + caches the LLM summary on first read.
router.get('/:repo_id/manifest', requireRepoScope('repo_id', 'read'), ctrl.getRepoManifest);

// Multi-domain discovery (Story E — tier 1 of the retrieval fan-out): score
// every settled bundle manifest against the query (label overlap + name/domain
// token match) and return the top-K candidate repos. Read-scope (it reads
// manifest metadata only; per-repo drills stay behind their own scopes).
router.post('/discovery', requireRole('tools-admin'), ctrl.discoverFromManifests);

// Story #978 — Editor surface (Wizard | Editor sub-tabs).
// PATCH a single concept (frontmatter + body markdown). Admin-scope — this is
// a mutation. The body is the full markdown (frontmatter + body); the server
// splits it via gray-matter (parser-service).
router.patch(
  '/:repo_id/concepts/:concept_id',
  requireRepoScope('repo_id', 'admin'),
  ctrl.patchConcept
);

// Story #978 — Editor "Re-split from source" action. Deletes all concepts for
// this repo + clears the per-repo graph collections + re-ingests from the
// linked doc-repo file. Admin-scope. Returns the same shape as ingestRepo.
router.post(
  '/:repo_id/resplit',
  requireRepoScope('repo_id', 'admin'),
  ctrl.resplitRepo
);

// Story #978 — Editor "Autocorrect" action. Scans all concepts and applies
// frontmatter-only autocorrect rules. Admin-scope. dry_run=true returns the
// planned changes without applying; dry_run=false applies atomically.
router.post(
  '/:repo_id/autocorrect',
  requireRepoScope('repo_id', 'admin'),
  ctrl.autocorrectRepo
);

module.exports = router;
