// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { withSpan } = require('../shared-lib/tracing');

// Auth on all OKF API routes (per-route via router.use, NOT global)
router.use(authenticate);

// Repository CRUD (Story 2.2) — inherits authenticate above.
router.use('/repos', require('./repos-routes'));

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
