// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 8-7 — named remote-model configurations, mounted under
// /api/okf/model-configs by okf-routes.js (inherits authenticate + the
// router-wide read gate).
//
// THE READ IS NOT ROLE-GATED (David, 2026-10-25).
//
// Model configurations are PLATFORM-level: they carry deployment-wide API
// credentials and they steer the judge, so every WRITE and every
// credential-bearing probe is tools-admin (same posture as repo creation,
// decision D4). The READ was tools-admin too — and that silently deleted
// the model selection from the RAGAS surfaces for every operator without
// the role: the panel's judge dropdown is rendered only when the named
// configuration list is non-empty, and the list 403'd, so the dropdown
// vanished — including the "System default (environment)" option, i.e.
// the .env-configured judge became UNREACHABLE for a curator. The judge
// could not be chosen at all, and the panel could not even say which one
// was in use.
//
// The read envelope carries no secret: `mask()` strips the key and the
// non-admin read omits the key HINT as well (the hint is only useful in
// the admin Models tab). So:
//
//   GET  /                     — read scope (any OKF user): the masked list
//                                plus the env judge's base_url + model.
//   POST /                     — tools-admin
//   POST /models-preview       — tools-admin (carries credentials)
//   POST /test                 — tools-admin (carries credentials)
//   GET  /:key/models          — tools-admin (calls the provider)
//   PATCH|DELETE /:key         — tools-admin
//   POST /:key/copy|activate|deactivate — tools-admin

const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/require-role');
const ctrl = require('../controllers/model-config-controller');

// Every mutating or credential-bearing route is tools-admin. The LIST below
// is deliberately NOT behind this gate — see the header.
const toolsAdmin = requireRole('tools-admin');

router.get('/', ctrl.list);
router.post('/', toolsAdmin, ctrl.create);
// Credential-carrying probes — declared BEFORE the /:key params so the
// literal segments win. Both are tools-admin like everything else here.
router.post('/models-preview', toolsAdmin, ctrl.modelsPreview);
router.post('/test', toolsAdmin, ctrl.test);
router.get('/:key/models', toolsAdmin, ctrl.models);
router.patch('/:key', toolsAdmin, ctrl.update);
router.post('/:key/copy', toolsAdmin, ctrl.copy);
router.post('/:key/activate', toolsAdmin, ctrl.activate);
router.post('/:key/deactivate', toolsAdmin, ctrl.deactivate);
router.delete('/:key', toolsAdmin, ctrl.remove);

module.exports = router;
