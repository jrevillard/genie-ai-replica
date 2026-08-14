// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Repository CRUD controller — thin HTTP layer: joi validate → call service → shape
// snake_case response → next(err) on failure. No business logic.

const repoService = require('../services/repository-service');
const piiService = require('../services/pii-service');
const { createSchema, updateSchema } = require('../validators/repository-validator');
const { logger } = require('../shared-lib/logger');

class ValidationError extends Error {
  constructor(details) {
    super('Request validation failed');
    this.code = 'VALIDATION_ERROR';
    this.status = 400;
    this.details = details;
  }
}

/** Extract the acting principal + request IP for audit/metadata. */
function actorFrom(req) {
  const u = req.user || {};
  return { sub: u.sub, name: u.name || u.preferred_username, source_ip: req.ip };
}

/**
 * Basic domain filter (full per-tenant/repo/domain RBAC is Story 6.1).
 * Reads an optional 'okf_domain' claim; if absent, returns undefined (all repos).
 */
function callerDomain(req) {
  const d = req.user && req.user.okf_domain;
  if (!d) {
    logger.debug('No okf_domain claim on token — returning all visible repos (full RBAC deferred to Story 6.1)');
  }
  return d || undefined;
}

function validate(schema, body) {
  const { value, error } = schema.validate(body);
  if (error) throw new ValidationError(error.details.map((d) => d.message));
  return value;
}

async function createRepo(req, res, next) {
  try {
    const input = validate(createSchema, req.body);
    const repo = await repoService.create(input, actorFrom(req));
    res.status(201).json(repo);
  } catch (err) {
    next(err);
  }
}

async function listRepos(req, res, next) {
  try {
    const { cursor, limit } = req.query;
    const result = await repoService.list({
      domain: callerDomain(req),
      cursor,
      limit: parseInt(limit, 10)
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function getRepo(req, res, next) {
  try {
    const repo = await repoService.getById(req.params.repo_id, { domain: callerDomain(req) });
    res.status(200).json(repo);
  } catch (err) {
    next(err);
  }
}

async function updateRepo(req, res, next) {
  try {
    const patch = validate(updateSchema, req.body);
    const repo = await repoService.update(req.params.repo_id, patch, actorFrom(req));
    res.status(200).json(repo);
  } catch (err) {
    next(err);
  }
}

async function deleteRepo(req, res, next) {
  try {
    const result = await repoService.remove(req.params.repo_id, actorFrom(req));
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Story 2.8 — PII scan. Two modes (AC 9):
 *  - {concepts: [{concept_id, frontmatter, body}]} — explicit (2.9.1/7.2 call
 *    the service directly in production; the endpoint exists for steward use).
 *  - {file_ids: [...]} or {discover: true} — scan the repo's uploaded
 *    plain-.md files (found via the okf_repo_id stamp from Story 2.5).
 * On success with file input, records the FR-3 ingest version.
 */
async function piiScan(req, res, next) {
  try {
    const { repo_id } = req.params;
    const { concepts, file_ids, discover } = req.body || {};

    // Repo-existence + domain gate (mirrors every other mutating route) —
    // fail BEFORE writing any meta docs (code-review fix #7).
    await repoService.getById(repo_id, { domain: callerDomain(req) });

    let inputs = [];
    let sourceFileIds = [];
    if (Array.isArray(concepts) && concepts.length > 0) {
      inputs = concepts;
    } else if (Array.isArray(file_ids) && file_ids.length > 0) {
      sourceFileIds = file_ids;
      inputs = (await piiService.discoverRepoFiles(repo_id)).filter((c) => file_ids.includes(c.file_id));
    } else if (discover) {
      inputs = await piiService.discoverRepoFiles(repo_id);
      sourceFileIds = inputs.map((c) => c.file_id);
    } else {
      throw new ValidationError(['body must contain concepts[], file_ids[], or discover:true']);
    }

    const results = [];
    for (const c of inputs) {
      results.push(await piiService.scanConcept(repo_id, c.concept_id, c.frontmatter, c.body));
    }

    // FR-3: record the ingest version on the latest file (discovery sorts DESC).
    let version = null;
    if (sourceFileIds.length > 0) {
      version = await piiService.recordIngestVersion(repo_id, {
        file_id: sourceFileIds[0],
        curator: { sub: actorFrom(req).sub, name: actorFrom(req).name } // no source_ip
      });
    }

    // Mark the repo PII-scanned (unscanned content blocks publish — gate #3).
    await piiService.markRepoPiiScanned(repo_id);

    const gate = await piiService.assertPiiClean(repo_id);
    res.status(200).json({
      repo_id,
      scanned: results.length,
      results: results.map((r) => ({
        concept_id: r.concept_id,
        pii_state: r.pii_state,
        pii_hits_summary: r.pii_hits_summary
      })),
      gate,
      ...(version ? { version } : {})
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { createRepo, listRepos, getRepo, updateRepo, deleteRepo, piiScan, ValidationError };
