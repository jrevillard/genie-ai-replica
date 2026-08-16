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

module.exports = router;
