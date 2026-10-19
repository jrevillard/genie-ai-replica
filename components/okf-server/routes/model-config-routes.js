// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 8-7 — named remote-model configurations, mounted under
// /api/okf/model-configs by okf-routes.js (inherits authenticate + the
// router-wide read gate). Model configurations are PLATFORM-level — every
// route is tools-admin (same posture as repo creation, decision D4), because
// they carry deployment-wide API credentials and steer the judge.

const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/require-role');
const ctrl = require('../controllers/model-config-controller');

router.use(requireRole('tools-admin'));

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:key/models', ctrl.models);
router.patch('/:key', ctrl.update);
router.post('/:key/copy', ctrl.copy);
router.post('/:key/activate', ctrl.activate);
router.post('/:key/deactivate', ctrl.deactivate);
router.delete('/:key', ctrl.remove);

module.exports = router;
