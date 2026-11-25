// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireScope, requireRepoScope } = require('../middleware/require-scope');
const { requireRole } = require('../middleware/require-role');
const retrievalConfigController = require('../controllers/retrieval-config-controller');
const authzResolverController = require('../controllers/authz-resolver-controller');
const { withSpan } = require('../shared-lib/tracing');

// Auth on all OKF API routes (per-route via router.use, NOT global):
// authenticate (verifyToken + scope/super-admin resolution), then the
// default-deny router gate — a caller with no okf scope (and not the
// tools-admin bootstrap super-role) gets 403 before any handler (Story 6.1).
router.use(authenticate);

// DEFAULT-OPEN serving reads (product decision 2026-10-16): the chat-path
// read endpoints live on a dedicated sub-router whose gate carries
// allowScopelessWhenOpen — while OKF_SCOPE_MODE is open (the default), a
// caller holding no okf scopes may read them, which is the whole point of
// default-open: every regular user's query resolves the serving graph set.
// In closed mode the option is inert and the historical gate applies. The
// sub-router is the ONLY surface a scopeless caller reaches: every other
// route, including all repo management and mutations, stays behind the
// strict router gate + per-repo scopes below. Registering a route HERE is
// the single structural marker for "default-open serving read" — no
// ordering-plus-option pair to keep in sync.
const servingReads = express.Router();
servingReads.use(requireScope('read', { allowScopelessWhenOpen: true }));
/**
 * #1939 (mobile OKF parity): the NAMED schemas behind the three citizen
 * serving reads annotated below. They exist so the client-generation spec
 * (scripts/build-openapi-spec.js scans this file) emits TYPED Dart models
 * for the mobile app — the citizen shapes, never the steward variants.
 * swagger-jsdoc merges annotation-contributed components into the generated
 * spec; the backend's runtime docs never scan this file, so these schemas
 * surface only in the client-generation contract the api-client drift gate
 * pins.
 * @swagger
 * components:
 *   schemas:
 *     ConceptTreePage:
 *       type: object
 *       description: >-
 *         One page of the paginated concept-tree index (W9). An
 *         out-of-range offset yields an empty concepts array with total
 *         still true.
 *       required: [total, offset, limit, concepts]
 *       properties:
 *         total:
 *           type: integer
 *           description: Total concept count, independent of paging.
 *         offset:
 *           type: integer
 *         limit:
 *           type: integer
 *         concepts:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ConceptTreeRow'
 *     ConceptTreeRow:
 *       type: object
 *       description: >-
 *         One row of the tree index — outgoing AUTHOR links only; the
 *         parser-derived structure rides the concept card.
 *       required: [concept_id]
 *       properties:
 *         concept_id:
 *           type: string
 *         title:
 *           type: string
 *           nullable: true
 *         is_index:
 *           type: boolean
 *           nullable: true
 *           description: Index/root marker for the tree's bold rows.
 *         index_status:
 *           type: string
 *           nullable: true
 *           description: Graph drain status the status dot renders.
 *         links:
 *           type: array
 *           description: Outgoing author links, as concept ids.
 *           items:
 *             type: string
 *     ConceptCard:
 *       type: object
 *       description: >-
 *         The CAP-2 CITIZEN projection of a concept. The steward read
 *         returns the full meta row plus max_doc_chars server-side; citizen
 *         callers (and the mobile app) consume THIS shape only. A field the
 *         concept lacks is absent from the response.
 *       required: [repo_id, concept_id, title]
 *       properties:
 *         repo_id:
 *           type: string
 *         concept_id:
 *           type: string
 *         graph_name:
 *           type: string
 *           nullable: true
 *         bundle_version:
 *           type: string
 *           nullable: true
 *         title:
 *           type: string
 *         labels:
 *           type: array
 *           items:
 *             type: string
 *         summary:
 *           type: string
 *           nullable: true
 *         body:
 *           type: string
 *           description: The concept document body — markdown, never raw HTML.
 *         links:
 *           type: array
 *           description: >-
 *             Outgoing author links as SERVED — the meta row's field copied
 *             verbatim, so rows carry the author-link OBJECT shape
 *             ({to_concept_id, label}; legacy rows may carry {target, label}
 *             with a .md path). NOT a bare-string array: the 2026-11-19
 *             mobile crash was exactly this lie (the generated Dart client
 *             cast the object row to String and threw mid-render).
 *           items:
 *             $ref: '#/components/schemas/ConceptCardLink'
 *         sources:
 *           type: array
 *           description: CAP-4 originating-document identities.
 *           items:
 *             $ref: '#/components/schemas/ConceptCardSource'
 *     ConceptCardLink:
 *       type: object
 *       description: >-
 *         One outgoing author link on the concept card. to_concept_id is
 *         the graph edge identity; target is the legacy frontmatter path
 *         (ends .md) some rows still carry — readers take to_concept_id
 *         first, then target, and strip a trailing .md / concepts/ prefix
 *         (the Vue browser's contract). A field the row lacks is absent.
 *       properties:
 *         to_concept_id:
 *           type: string
 *         target:
 *           type: string
 *         label:
 *           type: string
 *     ConceptCardSource:
 *       type: object
 *       description: >-
 *         CAP-4 narrowed originating-document identity. An entry carrying
 *         NEITHER file_id nor resource is dropped server-side. missing is
 *         true when doc-repo answers 404 for the origin (a dangling
 *         reference the UI says is not in the document repository).
 *       properties:
 *         kind:
 *           type: string
 *           nullable: true
 *         file_id:
 *           type: string
 *           nullable: true
 *         file_name:
 *           type: string
 *           nullable: true
 *         resource:
 *           type: string
 *           nullable: true
 *         missing:
 *           type: boolean
 *           nullable: true
 *     ResolveRepoResponse:
 *       type: object
 *       description: >-
 *         The CAP-1 identity the saved-conversation restore resolver
 *         rebuilds for a pre-CAP-1 citation row.
 *       required: [repo_id]
 *       properties:
 *         repo_id:
 *           type: string
 *         bundle_version:
 *           type: string
 *           nullable: true
 */
servingReads.get('/retrieval-config', retrievalConfigController.getRetrievalConfig);
servingReads.get('/authz/graphs', authzResolverController.getGraphs);
// CAP-2 (chat-source resolution, 2026-11-04): the concept CONTENT read is a
// serving read — the citizen's citation card opens what the answer grounded
// on, under the same default-open posture as retrieval. Registering it HERE
// (allowScopelessWhenOpen) is the structural marker per this file's own rule;
// RESTRICTED repos stay fenced INSIDE the handler by the 6-1c per-repo gate
// (assertRepoReadableByCaller) in BOTH modes, so the fence — not the scope
// gate — is what keeps restricted content unreachable. Repo management and
// mutations stay behind the strict router gate below; this shadows only the
// single-concept GET (same handler the /repos sub-router registers, so
// scoped callers behave identically).
/**
 * @swagger
 * "/api/okf/repos/{repo_id}/concepts/{concept_id}":
 *   get:
 *     summary: Fetch a concept's citizen card
 *     description: >-
 *       CAP-2 serving read: the concept document a chat citation grounded
 *       on — the body as markdown, author links and CAP-4 origin sources
 *       (an origin the document repository answers 404 for is stamped
 *       missing: true). Serves while OKF_SCOPE_MODE is open even without
 *       an okf scope (allowScopelessWhenOpen); closed mode keeps the
 *       read-scope gate. The per-repo fence and publication gate apply
 *       inside: a restricted or non-serving repo answers 404
 *       REPO_NOT_FOUND — foreign and fenced are indistinguishable
 *       (anti-enumeration). The steward variant (full meta row plus
 *       max_doc_chars) exists server-side; citizen callers receive the
 *       ConceptCard projection only.
 *     tags: [Okf]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: repo_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Repository id.
 *       - in: path
 *         name: concept_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Concept id.
 *     responses:
 *       '200':
 *         description: The citizen concept card.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ConceptCard'
 *       '401':
 *         description: Unauthorized - invalid or missing authentication token.
 *       '404':
 *         description: >-
 *           Not found - error code REPO_NOT_FOUND (foreign, fenced or
 *           non-serving repo, anti-enumeration) or CONCEPT_NOT_FOUND.
 *           Body: {error, message}.
 */
servingReads.get('/repos/:repo_id/concepts/:concept_id', require('../controllers/repository-controller').getConcept);
// W9 (concept tree browse, 2026-11-08): the paginated tree INDEX is a
// serving read like the concept GET above — the citizen's browser walks
// the repo a citation grounded on, under the same default-open posture.
// Registering it HERE is the structural marker per this file's own rule;
// the per-repo fence + publication gate live INSIDE getConceptTree (the
// same readAuthzForService + assertRepoReadableByCaller + serving-predicate
// composition), so restricted and draft/retracted repos are unreachable
// from the index too. The payload stays bounded (offset/limit, clamp
// 1..500) — the full corpus never ships in one response.
/**
 * @swagger
 * "/api/okf/repos/{repo_id}/concept-tree":
 *   get:
 *     summary: Browse the repository's paginated concept-tree index
 *     description: >-
 *       W9 serving read: every concept of the repository as a paginated
 *       index for the citizen's browser. The page size defaults to 200 and
 *       clamps to 1..500; offset clamps to >= 0; an out-of-range offset
 *       yields an empty page with total still true. Serves while
 *       OKF_SCOPE_MODE is open even without an okf scope
 *       (allowScopelessWhenOpen); closed mode keeps the read-scope gate.
 *       The per-repo fence and publication gate apply inside: a restricted
 *       or non-serving repo answers 404 REPO_NOT_FOUND — foreign and
 *       fenced are indistinguishable (anti-enumeration).
 *     tags: [Okf]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: repo_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Repository id.
 *       - in: query
 *         name: offset
 *         required: false
 *         schema:
 *           type: integer
 *           default: 0
 *           minimum: 0
 *         description: Page start (0-based).
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 200
 *           minimum: 1
 *           maximum: 500
 *         description: Page size (clamped to 1..500).
 *     responses:
 *       '200':
 *         description: One page of the concept tree.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ConceptTreePage'
 *       '401':
 *         description: Unauthorized - invalid or missing authentication token.
 *       '404':
 *         description: >-
 *           Not found - REPO_NOT_FOUND: foreign, fenced or non-serving
 *           repository, anti-enumeration. Body: {error, message}.
 */
servingReads.get('/repos/:repo_id/concept-tree', require('../controllers/repository-controller').getConceptTree);
// #1817 (saved-conversation OKF restore, 2026-11-13): the PRE-CAP-1 citation
// resolver is a serving read like the two above — a restored conversation
// repairs a legacy row's lost repo identity under the same default-open
// posture as the concept GET it enables. Registered HERE per this file's own
// rule; the per-candidate fences (6-1c restricted + publication + meta-row
// existence) live INSIDE resolveConceptRepo with getConcept's composition, so
// a restricted or non-serving twin never resolves for a citizen, and no
// candidate surviving every gate answers 404 (foreign and fenced
// indistinguishable).
/**
 * @swagger
 * "/api/okf/concepts/resolve-repo":
 *   get:
 *     summary: Resolve the serving repository holding a concept
 *     description: >-
 *       Saved-conversation restore resolver (#1817): one concept_id in,
 *       the caller-visible serving repository out — repo_id plus
 *       bundle_version carry the CAP-1 identity a pre-CAP-1 persisted
 *       citation row lost. Restricted or non-serving twin repositories are
 *       skipped, not returned; a concept_id no visible serving repo holds
 *       answers 404 CONCEPT_NOT_FOUND (foreign and fenced
 *       indistinguishable, anti-enumeration). Serves while OKF_SCOPE_MODE
 *       is open even without an okf scope (allowScopelessWhenOpen); closed
 *       mode keeps the read-scope gate.
 *     tags: [Okf]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: concept_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The concept id to resolve.
 *     responses:
 *       '200':
 *         description: The serving repository holding the concept.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResolveRepoResponse'
 *       '400':
 *         description: >-
 *           Bad request - CONCEPT_ID_REQUIRED. Body: {error, message}.
 *       '401':
 *         description: Unauthorized - invalid or missing authentication token.
 *       '404':
 *         description: >-
 *           Not found - CONCEPT_NOT_FOUND: no candidate survives every
 *           gate, foreign and fenced indistinguishable.
 */
servingReads.get('/concepts/resolve-repo', require('../controllers/repository-controller').resolveConceptRepo);
router.use(servingReads);

router.use(requireScope('read'));

// Repository CRUD (Story 2.2) — inherits authenticate above.
router.use('/repos', require('./repos-routes'));

// Story 8-7 — named remote-model configurations (LiteLLM gateway or direct
// provider APIs). Platform-level: tools-admin inside the sub-router.
router.use('/model-configs', require('./model-config-routes'));

// #2061 phase 2 — E-1, the Evaluation Context catalogue: named, versioned,
// snapshot-resolved authorization principals. Superadmin-gated on BOTH
// populations (the tools-admin realm role OR a wildcard okf:*:*:admin scope)
// — a context may name ANY repository, so writing one is a deployment-wide
// power. The READ surface carries the same gate: a context names the
// repositories a PRINCIPAL traverses, which is exactly the information a
// non-superadmin caller has no business reading. The consumers are the
// operator surfaces (the Studio editor, the Lab), which are admin-gated.
const evalContextController = require('../controllers/evaluation-context-controller');
router.post('/eval-contexts', evalContextController.requireSuperadmin, evalContextController.createContext);
router.get('/eval-contexts', evalContextController.requireSuperadmin, evalContextController.listContexts);
// #2061 phase 4 (E-5) — the composer's two reads. THE LITERAL ROUTES COME
// FIRST: `/eval-contexts/groups` would otherwise be parsed as
// `/eval-contexts/:id` and answered with a context-not-found.
router.get('/eval-contexts/groups', evalContextController.requireSuperadmin, evalContextController.listGroups);
router.post('/eval-contexts/preview', evalContextController.requireSuperadmin, evalContextController.previewContext);
router.get('/eval-contexts/:id', evalContextController.requireSuperadmin, evalContextController.getContext);
router.post(
  '/eval-contexts/:id/refresh',
  evalContextController.requireSuperadmin,
  evalContextController.refreshContext
);
// #2061 phase-4 amendment (David, 2026-11-25): contexts are MANAGEABLE —
// rename/add/remove memberships (update) and delete, with the in-use guard
// answering 409 CONTEXT_IN_USE naming the bound suites.
router.post('/eval-contexts/:id/update', evalContextController.requireSuperadmin, evalContextController.updateContext);
router.delete('/eval-contexts/:id', evalContextController.requireSuperadmin, evalContextController.deleteContext);

// Retrieval mode governance (Story 1.7, ADR-okf-039 D3): the governance
// write is tools-admin only and audited before→after in the service.
router.put('/retrieval-config', requireRole('tools-admin'), retrievalConfigController.putRetrievalConfig);
// Story 10.7 (#995): the governance AUDIT TRAIL read for the Studio card.
// The config's own audit rows live in okf_audit_logs under the '_system'
// pseudo-repo (AUDIT_REPO) — unreachable through the per-repo logs route
// (it pre-gates on a real repo). Tools-admin only: it names WHO changed the
// global posture and WHEN.
router.get('/retrieval-config/audit', requireRole('tools-admin'), retrievalConfigController.getRetrievalConfigAudit);
// #1205: the concept-document CEILING in effect right now, and WHY it is
// that number — the ceiling is derived from the serving-model window, so
// the number alone no longer says which lever moves it. Tools-admin only
// (platform-level, like the governance reads above). The smoke harness
// reads this to assert against the LIVE effective ceiling.
router.get('/admin/ceiling', requireRole('tools-admin'), require('../controllers/ceiling-controller').getCeiling);

// Frontmatter (Story 1.6, 2026-10-07): read-by-default for the BFF/retriever
// hot path; the write paths (PATCH / GET suggest) require write scope, which
// the route-level requireScope gate upgrades when a curator's session is
// active. The summary endpoint is hot-path read by retriever pod (TTL cached
// at the BFF; sub-millisecond cost at the row level).
// Story 1.7 (2026-10-08, supersedes the Story 1.6 dedicated routes):
// the per-repo frontmatter lives in `okf_repositories.frontmatter`
// (a new doc field, additive). Reads come through the existing
// `GET /api/okf/repos/:id` (the doc field is included in the
// response). Writes come through the existing `PATCH /api/okf/repos/:id`
// (the validator accepts the `frontmatter` payload and the repo
// service writes through to the doc field). The dedicated frontmatter
// read/write routes are removed; the per-repo frontmatter is part
// of the repo resource, not a separate resource.
//
// The /suggest route STAYS — it's the LLM auto-suggest endpoint, the
// only piece of the dedicated controller that has no equivalent on
// the repo resource. Thin shim: reads concept-meta, calls vLLM,
// returns the proposed set. The curator's primary write path is the
// index.md YAML (via the existing concept-meta PATCH); this route
// is the operator-script + migration-window backstop.
const frontmatterService = require('../services/frontmatter-service');
// Async job (David 2026-10-20: "let the fucking thing think… do the
// processing async if needed"): a reasoning-required model can take
// minutes and can never fit a synchronous request — the gateway cuts the
// browser long before any server-side timeout. 202 + poll, like every
// other long-running Lab operation.
// PER-REPO authz (round 21): these are repo-scoped operations under a
// `/repos/:id/...` path — the round-20 global `requireScope('admin')` let
// any admin-scoped caller into RESTRICTED repositories, unlike every other
// per-repo route (repos-routes uses requireRepoScope). The param here is
// `id`, not `repo_id`.
router.post('/repos/:id/frontmatter/suggest', requireRepoScope('id', 'admin'), async (req, res, next) => {
  try {
    const job = frontmatterService.startSuggestTags(req.params.id, {});
    res.status(202).json({ repo_id: req.params.id, job_id: job.job_id, status: job.status });
  } catch (err) {
    next(err);
  }
});
router.get('/repos/:id/frontmatter/suggest/jobs/:jobId', requireRepoScope('id', 'admin'), async (req, res, next) => {
  try {
    const job = frontmatterService.getSuggestJob(req.params.jobId);
    if (!job || job.repo_id !== req.params.id) {
      return res.status(404).json({ error: 'SUGGEST_JOB_NOT_FOUND', message: `no suggest job ${req.params.jobId}` });
    }
    // The done payload matches the old synchronous response shape
    // ({repo_id, suggested, validation}) so callers read one contract.
    res.status(200).json({
      repo_id: job.repo_id,
      job_id: job.job_id,
      status: job.status,
      ...(job.status === 'done' ? { suggested: job.suggested, validation: job.validation } : {}),
      ...(job.status === 'failed' ? { error: job.error } : {})
    });
  } catch (err) {
    next(err);
  }
});

// Service root — confirms the service + auth are wired.
router.get('/', async (req, res, next) => {
  try {
    const body = await withSpan('okf.api.root', async (span) => {
      span.setAttribute('okf.operation', 'root');
      span.setAttribute('okf.user', req.user ? req.user.sub : 'anonymous');
      return {
        service: 'okf-server',
        version: '0.2.0',
        status: 'ok',
        user: req.user ? req.user.sub : null,
        endpoints: ['GET/POST /api/okf/repos', 'GET/PATCH/DELETE /api/okf/repos/:repo_id']
      };
    });
    res.json(body);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
