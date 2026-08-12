// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Repository CRUD routes, mounted under /api/okf/repos (by okf-routes.js).
// `authenticate` is INHERITED from the parent okf-routes.js (do NOT re-mount here).
// `tools-admin` role is required for mutating routes (POST/PATCH/DELETE).

const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/require-role');
const ctrl = require('../controllers/repository-controller');

// List / Read — any authenticated caller (domain-filtered in the controller).
router.get('/', ctrl.listRepos);
router.get('/:repo_id', ctrl.getRepo);

// Mutations — require the tools-admin role.
router.post('/', requireRole('tools-admin'), ctrl.createRepo);
router.patch('/:repo_id', requireRole('tools-admin'), ctrl.updateRepo);
router.delete('/:repo_id', requireRole('tools-admin'), ctrl.deleteRepo);

module.exports = router;
