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
// Server-side crawl→OKF conversion (David, 2026-09-02): 202 + background
// streaming job — NO long-running request through Kong. Registered BEFORE
// the :repo_id routes so 'convert-from-crawl' is never parsed as an id.
router.post('/convert-from-crawl', requireRole('tools-admin'), ctrl.convertFromCrawl);
// Story 7.7 (David, 2026-09-14): multi-select document-repository files into
// ONE OKF repository — whole-corpus linking/labeling; ingested sources allowed
// (the SOURCES_NOT_RETRACTED lifecycle gate guards the repo's own ingest).
// MUST stay above the :repo_id routes (same comment as convert-from-crawl).
router.post('/convert-from-documents', requireRole('tools-admin'), ctrl.convertFromDocuments);
router.patch('/:repo_id', requireRepoScope('repo_id', 'admin'), ctrl.updateRepo);
router.delete('/:repo_id', requireRepoScope('repo_id', 'admin'), ctrl.deleteRepo);

// PII scan (Story 2.8 — ADR-okf-004 rev): explicit concepts OR file discovery.
router.post('/:repo_id/pii-scan', requireRepoScope('repo_id', 'admin'), ctrl.piiScan);

// REPO BULK PII ACTION (David, 2026-09-12): Redact / Remove / Accept applied
// to EVERY flagged concept in one steward decision (Files-view header).
// Scan-free; stamps the scan marker so publish neither blocks nor re-scans.
router.post('/:repo_id/pii-bulk', requireRepoScope('repo_id', 'admin'), ctrl.repoBulkPii);

// Concept IMPORT (Story 2.9.1 — ADR-021; renamed from /ingest, David
// 2026-09-04: "import" is the creation word, "ingest" is the RAG word):
// parse→meta→conformance→PII→dedup per concept; 202 once stored. NOTHING is
// chunked here — parsed meta rows are the queue the Ingest transition drains.
router.post('/:repo_id/import', requireRepoScope('repo_id', 'admin'), ctrl.importRepoConcepts);

// RETIRED ROUTE (import ≠ RAG, David 2026-09-04): /ingest no longer accepts
// concept bodies — importing is POST /:repo_id/import; RAG ingestion is
// POST /:repo_id/lifecycle {"action":"ingest"}. 410 with the pointers.
router.post('/:repo_id/ingest', requireRepoScope('repo_id', 'admin'), ctrl.retiredIngestRoute);

// Version mint + manifests (Story 2.9.7 — ADR-031): mint is an admin mutation
// (publish/crawl/manual trigger); listing/reading versions is read-scope
// (backs 4.5's diff/list UI and version-pinned citation).
router.post('/:repo_id/versions', requireRepoScope('repo_id', 'admin'), ctrl.mintRepoVersion);
router.get('/:repo_id/versions', requireRepoScope('repo_id', 'read'), ctrl.listRepoVersions);
router.get('/:repo_id/versions/:bundle_version', requireRepoScope('repo_id', 'read'), ctrl.getRepoVersion);

// Story #978 lifecycle (David, 2026-08-28): submit/approve/publish/ingest/
// retract. publish = mint (the real gates) + bundle-zip export; ingest/
// retract set/clear the SERVING version. Admin scope on the repo.
router.post('/:repo_id/lifecycle', requireRepoScope('repo_id', 'admin'), ctrl.transitionLifecycle);

// Story #978 — EXPORT the repo as a zip bundle (download; any lifecycle
// state). Read scope; the zip is built on the fly from the current concepts.
router.get('/:repo_id/export', requireRepoScope('repo_id', 'read'), ctrl.exportRepoZip);

// Story #978 (David, 2026-08-31) — the repository's action/audit log
// (okf_audit_logs, linked by repo_id): every state transition and every
// modification, newest first. Read scope (same as the manifest/export).
router.get('/:repo_id/logs', requireRepoScope('repo_id', 'read'), ctrl.getRepoLogs);

// Story #978 — steward PII acknowledgement (David, 2026-08-30): waives the
// PII 'hit' publish gate for REVIEWED public entities (audited; a scanner
// 'error' still blocks). Admin scope on the repo.
router.post('/:repo_id/pii-acknowledge', requireRepoScope('repo_id', 'admin'), ctrl.acknowledgePii);

// Repository clone (Story 4.8 — D-V5): an ADMIN mutation on the SOURCE repo —
// the clone reads the source wholesale (registry + meta), so the source's admin
// scope gates it (mirrors ingest). getById pre-gate (404 foreign) in the controller.
router.post('/:source_id/clone', requireRepoScope('source_id', 'admin'), ctrl.cloneRepo);

// Bundle manifest (Story B+C — the bundle IS a graph): read the settled
// bundle's self-description (concepts, author links, root, stats). Read-scope
// on the repo (it is the repo's discovery record, not a mutation).
// ?summary=1 lazily generates + caches the LLM summary on first read.
router.get('/:repo_id/manifest', requireRepoScope('repo_id', 'read'), ctrl.getRepoManifest);

// Editor graph projection (David, 2026-09-04): the LIVE author-stated edges
// (okf_concepts_meta.links[]) — the editor's graph view renders this, NEVER
// the ArangoDB serving graph. Available from the first import (no settle).
router.get('/:repo_id/links', requireRepoScope('repo_id', 'read'), ctrl.getRepoLinks);

// Repo METRICS (David's wizard-idempotency directive, 2026-09-04): the
// dashboard popups / wizard aggregate block — concept + conformance counters,
// index-status breakdown, lifecycle mirrors. Read scope on the repo.
router.get('/:repo_id/metrics', requireRepoScope('repo_id', 'read'), ctrl.getRepoMetrics);

// Multi-domain discovery (Story E — tier 1 of the retrieval fan-out): score
// every settled bundle manifest against the query (label overlap + name/domain
// token match) and return the top-K candidate repos. Read-scope (it reads
// manifest metadata only; per-repo drills stay behind their own scopes).
router.post('/discovery', requireRole('tools-admin'), ctrl.discoverFromManifests);

// Story #978 — Editor surface (Wizard | Editor sub-tabs).
// Read paths: the frontend conceptService already targets these URLs.
// NO route-level scope middleware — these mirror getRepo: the controller's
// getById pre-gate enforces authz and returns 404 for foreign repos
// (anti-enumeration, AC7) instead of leaking existence with a 403.
// List keeps UI fields only (errors-first sort in the service); the per-concept
// GET returns the full meta row (frontmatter + body) for editor round-trip.
router.get('/:repo_id/concepts', ctrl.listConcepts);
router.get('/:repo_id/concepts/:concept_id', ctrl.getConcept);

// PII REVIEW (David, 2026-09-09): a LIVE Presidio scan of the concept's
// CURRENT content returning per-occurrence {where, type, start, end, score}
// so the editor locates each flagged entity. Nothing persisted; values are
// never returned — the editor renders excerpts from content it already has.
router.post('/:repo_id/concepts/:concept_id/pii-inspect', ctrl.inspectPii);

// PII REMEDIATION (David, 2026-09-09): process a flagged issue IN PLACE —
// Redact (→"REDACTED") / Replace (→ user text) / Remove, plus the Accept
// decision (flag suppressed, audited) and the whole-file redaction for
// PII-dominated documents. Admin-scope mutations; each action re-scans via
// Presidio, records a before/after resolution, and writes the audit log.
router.post('/:repo_id/concepts/:concept_id/pii-remediate', requireRepoScope('repo_id', 'admin'), ctrl.remediatePii);
router.post('/:repo_id/concepts/:concept_id/pii-accept', requireRepoScope('repo_id', 'admin'), ctrl.acceptPii);
// WHOLE-FILE action (redact | remove | accept) — scan-free; occurrences ride
// the request from the panel's current scan.
router.post('/:repo_id/concepts/:concept_id/pii-file-action', requireRepoScope('repo_id', 'admin'), ctrl.fileActionPii);
router.post(
  '/:repo_id/concepts/:concept_id/pii-redact-file',
  requireRepoScope('repo_id', 'admin'),
  ctrl.redactWholeFilePii
);

// PATCH a single concept (frontmatter + body markdown). Admin-scope — this is
// a mutation. The body is the full markdown (frontmatter + body); the server
// splits it via gray-matter (parser-service).
router.patch('/:repo_id/concepts/:concept_id', requireRepoScope('repo_id', 'admin'), ctrl.patchConcept);

// Story #978 — delete ONE concept (meta row + indexed chunks + graph edges).
// Admin-scope mutation; 404 when the concept isn't in this repo.
router.delete('/:repo_id/concepts/:concept_id', requireRepoScope('repo_id', 'admin'), ctrl.deleteConcept);

// Story #978 — Editor "Re-split from source" action. Deletes all concepts for
// this repo + clears the per-repo graph collections + re-ingests from the
// linked doc-repo file. Admin-scope. Returns the same shape as /import.
router.post('/:repo_id/resplit', requireRepoScope('repo_id', 'admin'), ctrl.resplitRepo);

// Story #978 — Editor "Autocorrect" action. Scans all concepts and applies
// frontmatter-only autocorrect rules. Admin-scope. dry_run=true returns the
// planned changes without applying; dry_run=false applies atomically.
router.post('/:repo_id/autocorrect', requireRepoScope('repo_id', 'admin'), ctrl.autocorrectRepo);

module.exports = router;
