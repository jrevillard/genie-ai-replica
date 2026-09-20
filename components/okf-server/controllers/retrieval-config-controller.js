// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 1.7 (ADR-okf-039 D3/D7) — retrieval-config HTTP surface.
// GET: read-scoped (the /api/okf router gate) — the chat path's service token
//      and the Studio card both read the same read-model.
// PUT: tools-admin only — validated, revision-bumped, audited before→after.

const retrievalConfigService = require('../services/retrieval-config-service');
const { logger } = require('../shared-lib/logger');

function actorFrom(req) {
  const u = req.user || {};
  return { sub: u.sub, name: u.name || u.preferred_username };
}

/** GET /api/okf/retrieval-config — config + engagement gate + serving set. */
async function getRetrievalConfig(req, res, next) {
  try {
    const body = await retrievalConfigService.getRetrievalConfig();
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

/** PUT /api/okf/retrieval-config — governance write (admin-scoped). */
async function putRetrievalConfig(req, res, next) {
  try {
    const actor = actorFrom(req);
    const config = await retrievalConfigService.putRetrievalConfig(req.body, actor, req.ip);
    logger.info('Retrieval config PUT', { revision: config.revision, actor: actor.sub });
    res.status(200).json({ ok: true, config });
  } catch (err) {
    if (err && err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: err.message });
    }
    next(err);
  }
}

module.exports = { getRetrievalConfig, putRetrievalConfig };
