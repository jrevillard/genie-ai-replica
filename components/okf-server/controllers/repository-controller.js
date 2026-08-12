// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Repository CRUD controller — thin HTTP layer: joi validate → call service → shape
// snake_case response → next(err) on failure. No business logic.

const repoService = require('../services/repository-service');
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

module.exports = { createRepo, listRepos, getRepo, updateRepo, deleteRepo, ValidationError };
