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
servingReads.get('/retrieval-config', retrievalConfigController.getRetrievalConfig);
servingReads.get('/authz/graphs', authzResolverController.getGraphs);
router.use(servingReads);

router.use(requireScope('read'));

// Repository CRUD (Story 2.2) — inherits authenticate above.
router.use('/repos', require('./repos-routes'));

// Story 8-7 — named remote-model configurations (LiteLLM gateway or direct
// provider APIs). Platform-level: tools-admin inside the sub-router.
router.use('/model-configs', require('./model-config-routes'));

// Retrieval mode governance (Story 1.7, ADR-okf-039 D3): the governance
// write is tools-admin only and audited before→after in the service.
router.put('/retrieval-config', requireRole('tools-admin'), retrievalConfigController.putRetrievalConfig);

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
