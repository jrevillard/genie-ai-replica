// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6-1c — the OKF admin facility for per-repository access control.
//
// Routes (repos-routes.js, admin-scoped per repo):
//   GET  /:repo_id/access          → { restricted, required_scopes, holders, configured }
//   PUT  /:repo_id/access          → { restricted: bool } — toggle the gate
//   POST /:repo_id/access/grant    → { username, level: 'read'|'admin' }
//   POST /:repo_id/access/revoke   → { username }
//
// The toggle writes `acl.restricted` DIRECTLY on the repo doc (a serving
// maintenance write — repository-service.update() only accepts frontmatter
// patches while serving, and access restriction must work on LIVE repos;
// lifecycle transitions already write docs directly for the same reason).
// Grants/revokes write the user's `okf_scopes` attribute through Keycloak
// (keycloak-access-service); the realm's protocol mapper ships them in the
// user's next token, and access-control-service enforces on the read path.

const Joi = require('joi');
const keycloakAccess = require('../services/keycloak-access-service');
const { parseOkfScope } = require('../services/scope-authz-service');
const { writeAudit } = require('../services/audit-service');
const { logger } = require('../shared-lib/logger');
const dbService = require('../shared-lib/db-connection-service');

const toggleSchema = Joi.object({ restricted: Joi.boolean().required() });
const grantSchema = Joi.object({
  username: Joi.string().min(1).required(),
  level: Joi.string().valid('read', 'admin').required()
});
const revokeSchema = Joi.object({ username: Joi.string().min(1).required() });

class AccessError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function validate(schema, body) {
  const { value, error } = schema.validate(body || {});
  if (error) {
    throw new AccessError('VALIDATION_ERROR', error.details.map((d) => d.message).join('; '), 400);
  }
  return value;
}

async function loadRepo(repoId) {
  const db = await dbService.getConnection();
  let doc;
  try {
    doc = await db.collection('okf_repositories').document(repoId);
  } catch (err) {
    if (err && (err.code === 404 || err.errorNum === 1202)) {
      throw new AccessError('REPO_NOT_FOUND', `Repository ${repoId} not found`, 404);
    }
    throw err;
  }
  if (doc.deleted_at) {
    throw new AccessError('REPO_NOT_FOUND', `Repository ${repoId} not found`, 404);
  }
  return doc;
}

async function audit(action, req, repoId, details) {
  try {
    await writeAudit({
      action,
      actor: (req.user && req.user.sub) || null,
      actor_name: (req.user && (req.user.preferred_username || req.user.name)) || null,
      repo_id: repoId,
      details
    });
  } catch (err) {
    logger.warn('OKF access: audit write failed', { action, error: err.message });
  }
}

/** GET /:repo_id/access — the panel's read model. */
async function getAccess(req, res, next) {
  try {
    const repo = await loadRepo(req.params.repo_id);
    const configured = keycloakAccess.isConfigured();
    let holders = [];
    if (configured) {
      const users = await keycloakAccess.listUsersWithScopes();
      holders = users
        .map((u) => {
          const granted = keycloakAccess
            .userScopes(u)
            .map(parseOkfScope)
            .filter((p) => p && p.repo === repo.repo_id);
          return granted.length ? { user_id: u.id, username: u.username, levels: granted.map((g) => g.level) } : null;
        })
        .filter(Boolean);
    }
    res.status(200).json({
      repo_id: repo.repo_id,
      restricted: Boolean(repo.acl && repo.acl.restricted),
      required_scopes: (repo.acl && repo.acl.required_scopes) || [],
      holders,
      configured
    });
  } catch (err) {
    next(err);
  }
}

/** PUT /:repo_id/access — toggle the restriction gate (works while serving). */
async function putAccess(req, res, next) {
  try {
    const { restricted } = validate(toggleSchema, req.body);
    const repo = await loadRepo(req.params.repo_id);
    const db = await dbService.getConnection();
    const acl = { ...(repo.acl || {}), restricted };
    await db.collection('okf_repositories').update(repo.repo_id, { acl, updated_at: new Date().toISOString() });
    await audit('repo.access.restrict', req, repo.repo_id, { restricted });
    res.status(200).json({ ok: true, repo_id: repo.repo_id, restricted });
  } catch (err) {
    next(err);
  }
}

/** POST /:repo_id/access/grant — append this repo's scope to a user. */
async function grantAccess(req, res, next) {
  try {
    const { username, level } = validate(grantSchema, req.body);
    if (!keycloakAccess.isConfigured()) {
      throw new AccessError(
        'ACCESS_CONTROL_UNCONFIGURED',
        'Grant/revoke requires Keycloak credentials (KC_OKF_ACCESS_CLIENT_SECRET) on okf-server',
        503
      );
    }
    const repo = await loadRepo(req.params.repo_id);
    const user = await keycloakAccess.findUserByUsername(username);
    if (!user) throw new AccessError('USER_NOT_FOUND', `User "${username}" not found`, 404);
    const scope = `okf:t:${repo.repo_id}:${level}`;
    const next = [...keycloakAccess.userScopes(user), scope];
    await keycloakAccess.setUserScopes(user, next);
    await audit('repo.access.grant', req, repo.repo_id, { username, level, scope });
    res.status(200).json({ ok: true, username, scopes: [...new Set(next)] });
  } catch (err) {
    next(err);
  }
}

/** POST /:repo_id/access/revoke — strip this repo's scopes from a user. */
async function revokeAccess(req, res, next) {
  try {
    const { username } = validate(revokeSchema, req.body);
    if (!keycloakAccess.isConfigured()) {
      throw new AccessError(
        'ACCESS_CONTROL_UNCONFIGURED',
        'Grant/revoke requires Keycloak credentials (KC_OKF_ACCESS_CLIENT_SECRET) on okf-server',
        503
      );
    }
    const repo = await loadRepo(req.params.repo_id);
    const user = await keycloakAccess.findUserByUsername(username);
    if (!user) throw new AccessError('USER_NOT_FOUND', `User "${username}" not found`, 404);
    const kept = keycloakAccess.userScopes(user).filter((s) => {
      const p = parseOkfScope(s);
      return !(p && p.repo === repo.repo_id);
    });
    await keycloakAccess.setUserScopes(user, kept);
    await audit('repo.access.revoke', req, repo.repo_id, { username });
    res.status(200).json({ ok: true, username, scopes: kept });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAccess, putAccess, grantAccess, revokeAccess, AccessError };
