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
const accessCtrl = require('../controllers/access-controller');

// List / Read — scope-filtered in the controller (default-deny, G3).
router.get('/', ctrl.listRepos);
router.get('/:repo_id', ctrl.getRepo);

// Story 10.5 — the wizard's resumable curation draft. ALL THREE verbs live
// under `/:repo_id/draft`; the retired `/:repo_id/studio_drafts` path shape is
// never registered (the endpoint was never deployed, so no client depends on
// it — an alias would be dead code). Express `/:repo_id` matches exactly one
// segment, so it can never swallow this two-segment path; the only other
// parametrised two-segment routes (`/routing-testsuite/:suite_key`,
// `/concepts/:concept_id`) have literal prefixes that cannot collide.
// GET inherits the router-wide read gate + the controller's default-deny
// authz (same posture as GET /:repo_id itself); the mutations are admin-scoped.
router.get('/:repo_id/draft', ctrl.getStudioDraft);
router.put('/:repo_id/draft', requireRepoScope('repo_id', 'admin'), ctrl.putStudioDraft);
router.delete('/:repo_id/draft', requireRepoScope('repo_id', 'admin'), ctrl.deleteStudioDraft);

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

// Story 6-1c — per-repository access control (the admin facility). Read is
// repo-read-scoped; the toggle + grant/revoke are repo-admin-scoped. Grants
// write Keycloak (user attributes or group-assigned roles; 503
// ACCESS_CONTROL_UNCONFIGURED until KC_OKF_ACCESS_CLIENT_SECRET is set on
// okf-server); the toggle and the read-path ENFORCEMENT need no Keycloak.
router.get('/:repo_id/access', requireRepoScope('repo_id', 'read'), accessCtrl.getAccess);
router.put('/:repo_id/access', requireRepoScope('repo_id', 'admin'), accessCtrl.putAccess);
router.post('/:repo_id/access/grant', requireRepoScope('repo_id', 'admin'), accessCtrl.grantAccess);
router.post('/:repo_id/access/revoke', requireRepoScope('repo_id', 'admin'), accessCtrl.revokeAccess);
router.post('/:repo_id/access/grant-group', requireRepoScope('repo_id', 'admin'), accessCtrl.grantGroupAccess);
router.post('/:repo_id/access/revoke-group', requireRepoScope('repo_id', 'admin'), accessCtrl.revokeGroupAccess);

// PII scan (Story 2.8 — ADR-okf-004 rev): explicit concepts OR file discovery
// OR {"scope":"concepts"} — the ASYNC repo-wide CONCEPT rescan (202 + poll).
// That mode walks the okf_concepts_meta rows the publish gate actually reads,
// which is what clears a concept stuck in pii_state 'error'; the file modes
// scan `files` docs and can never reach a concept row.
router.post('/:repo_id/pii-scan', requireRepoScope('repo_id', 'admin'), ctrl.piiScan);
// The rescan's poll: {status:'running', progress} / {status:'failed', error} /
// the completed tally. Read scope (same as the suite-run poll). Declared right
// below the POST; the literal 'pii-scan' segment can never collide with a
// sibling :param route because pii-scan is not a path parameter anywhere.
router.get('/:repo_id/pii-scan/:scan_key', requireRepoScope('repo_id', 'read'), ctrl.getPiiConceptScan);

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

// Story 1-8 (2026-10-08) — Head Tester / Routing Lab. rebuild fixes a
// missing/stale okf_repositories.head (publish is warn-only on a TEI
// outage); routing-test is the two-leg simulation (head signalling
// works PRE-INGEST; chunk-probe replay for graph-bearing repos). Both
// admin-scoped — the test burns a TEI embed per query.
router.post('/:repo_id/head/rebuild', requireRepoScope('repo_id', 'admin'), ctrl.rebuildRepoHead);
router.post('/:repo_id/routing-test', requireRepoScope('repo_id', 'admin'), ctrl.routingTest);
// Story 1-8c — single-query gate explanation + forbidden-tag suggestion.
router.post('/:repo_id/routing-explain', requireRepoScope('repo_id', 'admin'), ctrl.routingExplain);
// Story 1-8d — frontmatter save history + revert (the Lab's undo).
router.get('/:repo_id/frontmatter/history', requireRepoScope('repo_id', 'read'), ctrl.frontmatterHistory);
router.post('/:repo_id/frontmatter/revert', requireRepoScope('repo_id', 'admin'), ctrl.revertFrontmatter);

// Story 1-8 MR-B (2026-10-08) — test suites + run analytics. The
// generator is ONE guided-JSON vLLM call (admin — LLM-burning, 5-15s);
// a run executes every suite query (one TEI embed each) and persists
// pass rates / margins / steals to okf_head_test_runs. Curator
// free-text queries join a suite via POST .../:suite_key/queries. The
// runs listing is read-scope (analytics history across tag cycles) and
// MUST stay above any /:suite_key route so 'runs' is never parsed as a key.
router.get('/:repo_id/routing-testsuite/runs', requireRepoScope('repo_id', 'read'), ctrl.listTestSuiteRuns);
// Story 1-8f — load ONE saved suite (full rows) back into the Lab; edit
// its rows in place (kind flips + removes). GET is read-scope (same as
// the runs listing); the rows PATCH is an admin mutation like /queries.
// 'runs' above must stay first so it is never parsed as a suite key.
router.get('/:repo_id/routing-testsuite/:suite_key', requireRepoScope('repo_id', 'read'), ctrl.getTestSuite);
router.post('/:repo_id/routing-testsuite', requireRepoScope('repo_id', 'admin'), ctrl.generateTestSuite);
router.post('/:repo_id/routing-testsuite/:suite_key/run', requireRepoScope('repo_id', 'admin'), ctrl.runTestSuite);
// 1-8g-v — poll/load ONE run: the async run's keep-waiting envelope
// ({status:'running'}), its terminal failure, or the full run doc. Read
// scope (same as the runs listing). Must sit ABOVE /:suite_key so the
// 'runs' segment is never parsed as a suite key.
router.get(
  '/:repo_id/routing-testsuite/:suite_key/runs/:run_key',
  requireRepoScope('repo_id', 'read'),
  ctrl.getTestSuiteRun
);
router.post(
  '/:repo_id/routing-testsuite/:suite_key/rows',
  requireRepoScope('repo_id', 'admin'),
  ctrl.updateTestSuiteRows
);
// Story 1-8f — name/rename a suite (admin mutation).
router.post(
  '/:repo_id/routing-testsuite/:suite_key/rename',
  requireRepoScope('repo_id', 'admin'),
  ctrl.renameTestSuite
);
// Story 1-8g — delete a suite from the Saved list (admin; removes the
// suite doc + its run docs).
router.delete('/:repo_id/routing-testsuite/:suite_key', requireRepoScope('repo_id', 'admin'), ctrl.deleteTestSuite);
// Story 1-8g — the click-test: one query against the LIVE corpus (embed →
// top-K → the pipeline's TEI rerank → coverage verdict), persisted on the
// matching suite rows (admin mutation — it writes lastProbe).
router.post(
  '/:repo_id/routing-testsuite/:suite_key/probe',
  requireRepoScope('repo_id', 'admin'),
  ctrl.probeTestSuiteQuery
);
// Story 1-8c — batch advice for a suite run's failing negatives.
// 1-8g-y: the POST now answers 202 + poll (the work fans out over the shared
// remote GPU node and outran the gateway). The poll below is read scope,
// matching the runs listing and the load-one-run path.
router.post(
  '/:repo_id/routing-testsuite/:suite_key/explain',
  requireRepoScope('repo_id', 'admin'),
  ctrl.explainTestSuiteFailures
);
router.get(
  '/:repo_id/routing-testsuite/:suite_key/explain/:run_key',
  requireRepoScope('repo_id', 'read'),
  ctrl.getExplainFailures
);
// Story 1-8d — the COMPREHENSIVE advisor: aggregates recent runs (all
// classes), simulates tag-set changes against the gate, recommends the
// globally-optimal add/remove set under a zero-positive-harm constraint.
router.post('/:repo_id/routing-advisor', requireRepoScope('repo_id', 'admin'), ctrl.recommendTagSet);
router.post(
  '/:repo_id/routing-testsuite/:suite_key/queries',
  requireRepoScope('repo_id', 'admin'),
  ctrl.addTestSuiteQueries
);

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

// STEP-7 VALIDATION REPORT (#1030 + #1036, David 2026-10-02): the unified
// issue list — per-concept conformance, orphaned concepts, near-duplicate
// groups, unlinked citations — each with severity + remedy. Read scope.
router.get('/:repo_id/validation', requireRepoScope('repo_id', 'read'), ctrl.getRepoValidation);

// CITATION HUB WIRING (#1036): create the Sources page when missing (from the
// citing pages' own metadata) and link every citing page to it — frontmatter
// links[], born right, feeding the graph at ingest. Admin-scope mutation.
router.post('/:repo_id/citations/wire', requireRepoScope('repo_id', 'admin'), ctrl.wireRepoCitations);

// WHOLE-CORPUS TOPIC-LINK AUTHORING (Story 1-8g-p): the SAME pass the wizard
// runs at import time, re-runnable on demand from the editor. Generic — no
// domain lexicon; it works for any subject matter. Detached (202 + poll)
// because a large repo costs minutes of LLM time and the gateway caps a
// request at 60s. Read-scope for the state, admin-scope to start a run.
router.post('/:repo_id/topic-links', requireRepoScope('repo_id', 'admin'), ctrl.startTopicLinks);
router.get('/:repo_id/topic-links', requireRepoScope('repo_id', 'read'), ctrl.getTopicLinks);

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

// LINK SUGGESTIONS (#1036 Class A): the LLM proposes which existing concepts
// an orphaned page references. Read-only (nothing written until the steward
// accepts via POST .../links); admin-scope because it burns one LLM call.
router.post(
  '/:repo_id/concepts/:concept_id/link-suggestions',
  requireRepoScope('repo_id', 'admin'),
  ctrl.suggestConceptLinks
);

// ACCEPT one link (steward-approved suggestion or hand entry): frontmatter
// links[] append through the field-scoped patch — born right, survives body
// saves, feeds the editor projection AND the ingest graph. Admin-scope.
router.post('/:repo_id/concepts/:concept_id/links', requireRepoScope('repo_id', 'admin'), ctrl.acceptConceptLink);

// Story #978 — Editor "Re-split from source" action. Deletes all concepts for
// this repo + clears the per-repo graph collections + re-ingests from the
// linked doc-repo file. Admin-scope. Returns the same shape as /import.
router.post('/:repo_id/resplit', requireRepoScope('repo_id', 'admin'), ctrl.resplitRepo);

// Story #978 — Editor "Autocorrect" action. Scans all concepts and applies
// frontmatter-only autocorrect rules. Admin-scope. dry_run=true returns the
// planned changes without applying; dry_run=false applies atomically.
router.post('/:repo_id/autocorrect', requireRepoScope('repo_id', 'admin'), ctrl.autocorrectRepo);

// RE-INGEST FAILED CONCEPTS (David, 2026-10-14). The recovery path the drain's
// dead-letter text already promised ("recovery = re-ingest"). Admin-scope.
// Repos only: 409 NOT_INGESTED before ingestion, 409 DRAIN_IN_PROGRESS while a
// drain is in flight. Registered AFTER the concepts/:concept_id family so the
// literal segment is never swallowed by a parametrised sibling.
router.post('/:repo_id/reingest-failed', requireRepoScope('repo_id', 'admin'), ctrl.reingestFailed);
router.post('/:repo_id/concepts/:concept_id/reingest', requireRepoScope('repo_id', 'admin'), ctrl.reingestFailed);

module.exports = router;
