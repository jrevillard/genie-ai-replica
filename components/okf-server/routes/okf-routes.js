// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireScope } = require('../middleware/require-scope');
const { requireRole } = require('../middleware/require-role');
const retrievalConfigController = require('../controllers/retrieval-config-controller');
const authzResolverController = require('../controllers/authz-resolver-controller');
const { withSpan } = require('../shared-lib/tracing');

// Auth on all OKF API routes (per-route via router.use, NOT global):
// authenticate (verifyToken + scope/super-admin resolution), then the
// default-deny router gate — a caller with no okf scope (and not the
// tools-admin bootstrap super-role) gets 403 before any handler (Story 6.1).
router.use(authenticate);
router.use(requireScope('read'));

// Repository CRUD (Story 2.2) — inherits authenticate above.
router.use('/repos', require('./repos-routes'));

// Retrieval mode governance (Story 1.7, ADR-okf-039 D3): the read-model is
// read-scoped (chat path service token + Studio card); the governance write
// is tools-admin only and audited before→after in the service.
router.get('/retrieval-config', retrievalConfigController.getRetrievalConfig);
router.put('/retrieval-config', requireRole('tools-admin'), retrievalConfigController.putRetrievalConfig);

// Authz resolver read side (Story 6.1b): token scopes → the caller's serving
// graph set (zero-hit by construction). Read-scoped by the router gate.
router.get('/authz/graphs', authzResolverController.getGraphs);

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
router.post('/repos/:id/frontmatter/suggest', requireScope('admin'), async (req, res, next) => {
  try {
    const suggested = await frontmatterService.suggestTags(req.params.id, { sampleN: 20 });
    let validation = { validated: true, inconsistencies: [] };
    try {
      validation = await frontmatterService.validateFrontmatter(req.params.id, suggested);
    } catch (e) {
      // The /suggest route returns the proposed set regardless; the
      // Publish gate catches validation failures server-side. We
      // surface the validation error so the caller can decide.
      validation = { validated: false, inconsistencies: [{ reason: 'validation_error', message: e.message }] };
    }
    res.status(200).json({ repo_id: req.params.id, suggested, validation });
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
