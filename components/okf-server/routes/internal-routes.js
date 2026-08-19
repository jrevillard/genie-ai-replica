// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// INTERNAL cross-service routes (Story 4.8-amend) — dataprep → okf-server
// callbacks for OKF concepts (content-only chunking). Mounted at
// /api/okf/internal BEFORE the authenticated /api/okf router — this surface is
// guarded by a shared internal secret (fail-closed), NOT the Keycloak scope
// middleware (the dataprep service account holds no okf scopes).

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/internal-controller');

// Dataprep completion callback for a concept (indexed|failed + edges).
router.post('/concepts/:concept_id/status', ctrl.conceptStatus);

module.exports = router;
