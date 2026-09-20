// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 1.7 (ADR-okf-039 D3/D7) — retrieval-config HTTP surface.
// GET: read-scoped (the /api/okf router gate) — the chat path's service token
//      and the Studio card both read the same read-model. The SERVING VIEW is
//      per-caller (superadmin sees all; a scoped caller sees their
//      intersection; config posture stays global — governance, not scope data).
// PUT: tools-admin only — joi-validated at the boundary, revision-bumped,
//      optimistic-concurrency-guarded, audited before→after in the service.

const retrievalConfigService = require('../services/retrieval-config-service');
const { validateRetrievalConfigPatch } = require('../validators/retrieval-config-validator');
const { logger } = require('../shared-lib/logger');
const { actorFrom } = require('./actor-from');

/** GET /api/okf/retrieval-config — config + engagement gate + per-caller serving set. */
async function getRetrievalConfig(req, res, next) {
  try {
    const actor = actorFrom(req);
    const body = await retrievalConfigService.getRetrievalConfig({
      okfScopes: req.okfScopes,
      isSuperAdmin: req.okfIsSuperAdmin
    });
    logger.info('Retrieval config read', { sub: actor.sub });
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

/** PUT /api/okf/retrieval-config — governance write (admin-scoped). joi at the
 * controller boundary (house pattern, repository-controller.validate) — an
 * invalid payload 400s before the service is ever reached. */
async function putRetrievalConfig(req, res, next) {
  try {
    const actor = actorFrom(req);
    const patch = validateRetrievalConfigPatch(req.body);
    const config = await retrievalConfigService.putRetrievalConfig(patch, actor, req.ip);
    logger.info('Retrieval config PUT', { revision: config.revision, actor: actor.sub });
    res.status(200).json({ ok: true, config });
  } catch (err) {
    if (err && err.code === 'VALIDATION_ERROR') {
      return res.status(err.status || 400).json({ error: err.code, message: err.message, details: err.details });
    }
    next(err);
  }
}

module.exports = { getRetrievalConfig, putRetrievalConfig };
