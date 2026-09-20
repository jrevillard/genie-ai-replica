// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireScope } = require('../middleware/require-scope');
const { requireRole } = require('../middleware/require-role');
const retrievalConfigController = require('../controllers/retrieval-config-controller');
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
