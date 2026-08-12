// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { withSpan } = require('../shared-lib/tracing');

// Auth on all OKF API routes (per-route via router.use, NOT global)
router.use(authenticate);

// Skeleton root — confirms the service + auth are wired. CRUD lands in Story 2.2.
router.get('/', async (req, res, next) => {
  try {
    const body = await withSpan('okf.api.root', async (span) => {
      span.setAttribute('okf.operation', 'root');
      span.setAttribute('okf.user', req.user ? req.user.sub : 'anonymous');
      return {
        service: 'okf-server',
        version: '0.1.0',
        status: 'skeleton',
        user: req.user ? req.user.sub : null,
        endpoints: ['/api/okf/repos (Story 2.2)']
      };
    });
    res.json(body);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
