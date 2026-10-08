// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 1.6 (2026-10-07) — frontmatter HTTP surface.
//
// GET   /api/okf/repos/:id/frontmatter          — read the per-tag rows
// PATCH /api/okf/repos/:id/frontmatter          — curator edit (overrides LLM-suggested tags)
// POST  /api/okf/repos/:id/frontmatter/suggest  — LLM auto-suggest (returns without writing)
// GET   /api/okf/repos/:id/frontmatter/summary  — denormalized hot-path read (retriever-side)
//
// All endpoints inherit the /api/okf router's authenticate + read-scope gate
// (the curator flows require write scope — handled at the route level).

const Joi = require('joi');
const frontmatterService = require('../services/frontmatter-service');
const { logger } = require('../shared-lib/logger');
const { actorFrom } = require('./actor-from');

// House helper (mirrors the same pattern in repository-controller.js:77) —
// joi-validated at the boundary so the service is only reached with a
// valid body. Throws ValidationError on failure.
class ValidationError extends Error {
  constructor(details) {
    super(Array.isArray(details) ? details.join('; ') : String(details));
    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
    this.status = 400;
  }
}
function validate(schema, body) {
  const { value, error } = schema.validate(body);
  if (error) throw new ValidationError(error.details.map((d) => d.message));
  return value;
}

// PATCH schema: a curator MAY override any per-tag value. The service
// re-embeds via TEI when values change and re-writes both collections.
// PATCH schema: a curator MAY override any per-tag value. The service
// re-embeds via TEI when values change and re-writes both collections.
//
// Per David 2026-10-08: tags must be SUFFICIENT to semantically describe
// what is in the OKF repository — the entity and keyword caps in
// particular must NOT be a quality constraint disguised as a schema
// limit. A real Alphabet/Google concept set returned 16 entities and
// 0 keywords on the first live call (the LLM's honest answer, the 10-
// entity cap was an arbitrary old-code bound). Bumped the entity cap
// to 20 (any more is just list-padding) and the keyword cap to 20.
// The topic and forbidden caps stay tight (3-8 and 2-6) because those
// are the routing decisions: too many topics collapses sibling-repo
// distinction, too many forbidden expands the misroute surface.
const patchSchema = Joi.object({
  topic: Joi.array().items(Joi.string().min(1).max(64)).min(3).max(8),
  entity: Joi.array().items(Joi.string().min(1).max(64)).max(20),
  scope: Joi.string().allow('').max(64),
  forbidden: Joi.array().items(Joi.string().min(1).max(64)).min(2).max(6),
  summary: Joi.string().allow('').max(1024),
  keyword: Joi.array().items(Joi.string().min(1).max(64)).max(20),
  comprehensive: Joi.boolean()
}).min(1);

async function getFrontmatter(req, res, next) {
  try {
    const repoId = req.params.id;
    const rows = await frontmatterService.getFrontmatter(repoId);
    res.status(200).json({ repo_id: repoId, frontmatter: rows });
  } catch (err) {
    next(err);
  }
}

async function patchFrontmatter(req, res, next) {
  try {
    const repoId = req.params.id;
    const fm = validate(patchSchema, req.body || {});
    const actor = actorFrom(req);
    logger.info('Frontmatter patch', { repo_id: repoId, actor: actor.sub });
    const summary = await frontmatterService.publishFrontmatter(repoId, fm, { actor, version: Date.now() });
    res.status(200).json({
      repo_id: repoId,
      ok: true,
      summary: {
        _key: summary._key,
        topic_count: summary.topic_count,
        entity_count: summary.entity_count,
        keyword_count: summary.keyword_count,
        forbidden_count: summary.forbidden_count,
        updated_at: summary.updated_at,
        version: summary.version
      }
    });
  } catch (err) {
    if (err && err.code === 'VALIDATION_ERROR') {
      return res.status(err.status || 400).json({ error: err.code, message: err.message });
    }
    next(err);
  }
}

async function suggestFrontmatter(req, res, next) {
  try {
    const repoId = req.params.id;
    const actor = actorFrom(req);
    logger.info('Frontmatter suggest', { repo_id: repoId, actor: actor.sub });
    const suggested = await frontmatterService.suggestTags(repoId, { sampleN: 50 });
    // Auto-run validation too — the curator wants to see consistency before approving.
    let validation = null;
    try {
      validation = await frontmatterService.validateFrontmatter(repoId, suggested);
    } catch (e) {
      logger.warn('Frontmatter suggest: validation failed', { repo_id: repoId, err: e.message });
      validation = { validated: false, inconsistencies: [{ reason: 'validation_error', message: e.message }] };
    }
    res.status(200).json({ repo_id: repoId, suggested, validation });
  } catch (err) {
    next(err);
  }
}

async function getFrontmatterSummary(req, res, next) {
  try {
    const repoId = req.params.id;
    const doc = await frontmatterService.getFrontmatterSummary(repoId);
    if (!doc) return res.status(404).json({ error: 'NO_FRONTMATTER', repo_id: repoId });
    res.status(200).json(doc);
  } catch (err) {
    next(err);
  }
}

module.exports = { getFrontmatter, patchFrontmatter, suggestFrontmatter, getFrontmatterSummary };
