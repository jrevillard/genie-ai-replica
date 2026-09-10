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
// BOTH methods: dataprep's _update_doc_status issues a PATCH (mirroring the
// doc-repo status API it was cloned from) — a POST-only route let the PATCH
// fall through to the authenticated /api/okf router and die with
// FORBIDDEN_SCOPE (live-caught 2026-08-21: every concept callback 403'd,
// meta rows never transitioned, the worker retry-looped forever).
router.post('/concepts/:concept_id/status', ctrl.conceptStatus);
router.patch('/concepts/:concept_id/status', ctrl.conceptStatus);

module.exports = router;
