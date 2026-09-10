// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// OKF scope enforcement (Story 6.1, ADR-okf-025 §4 default-deny). Scope
// grammar: okf:{tenant}:{repo}:{read|admin} with `*` wildcards. Two factories:
//  - requireScope('read') — ANY okf read-or-admin scope (or wildcard, or the
//    tools-admin bootstrap super-role) must be present. Router-wide gate.
//  - requireRepoScope('repo_id', 'admin') — the caller must hold admin on
//    THAT repo (exact match or wildcard, or super-role) for per-repo
//    mutations. Replaces the global tools-admin role check (G15).
// STRICTNESS (2026-08-16 review fixes): levels are the keys 'read'|'admin' —
// an unknown level THROWS at wiring time (no silent fail-open fallback), and
// a missing repo param DENIES (never authorizes against the literal arg).
// Denials are 403 FORBIDDEN_SCOPE + a best-effort okf_audit row (never fails
// the request — same semantics as audit-service.writeAudit). The audit `actor`
// is the principal's sub STRING (matches every other okf_audit writer).

const { logger } = require('../shared-lib/logger');
const { writeAudit } = require('../services/audit-service');

const LEVELS = ['read', 'admin'];

/** Parse `okf:{tenant}:{repo}:{read|admin}` → {tenant, repo, level} | null.
 * Level MUST be a grammar level — anything else (typos like 'write') is not a
 * scope and grants nothing. */
function parseOkfScope(scope) {
  if (typeof scope !== 'string') return null;
  const parts = scope.split(':');
  if (parts.length !== 4 || parts[0] !== 'okf') return null;
  if (!LEVELS.includes(parts[3])) return null;
  return { tenant: parts[1], repo: parts[2], level: parts[3] };
}

const LEVEL_SATISFIES = {
  read: (level) => level === 'read' || level === 'admin',
  admin: (level) => level === 'admin'
};

function assertLevel(level) {
  if (!LEVEL_SATISFIES[level]) {
    throw new Error(`require-scope: unknown level '${level}' — use 'read' or 'admin' (no silent fallback)`);
  }
}

/** Best-effort denial audit — writeAudit never throws; guard anyway.
 * Actor is the sub STRING (uniform with repo.create/update/delete rows). */
function auditDenial(action, req, repoId) {
  const u = (req && req.user) || {};
  Promise.resolve(
    writeAudit({ action, actor: u.sub || null, repo_id: repoId || null, source_ip: req && req.ip })
  ).catch(() => {
    /* never fail the request on audit */
  });
}

function deny(res, message) {
  return res.status(403).json({ error: 'FORBIDDEN_SCOPE', message });
}

/**
 * Router-wide gate: the caller holds ANY okf scope at read-or-admin level
 * (exact or wildcard), or is the tools-admin bootstrap super-role.
 * @param {string} requiredLevel — 'read' (the only router-gate level today).
 */
function requireScope(requiredLevel = 'read') {
  assertLevel(requiredLevel);
  const satisfies = LEVEL_SATISFIES[requiredLevel];
  return (req, res, next) => {
    const scopes = Array.isArray(req.okfScopes) ? req.okfScopes : [];
    const has = scopes.some((s) => {
      const p = parseOkfScope(s);
      return !!p && satisfies(p.level);
    });
    if (has || req.okfIsSuperAdmin) return next();
    logger.warn('OKF authz denied: no okf scope', { sub: req.user && req.user.sub, path: req.path });
    auditDenial('authz.denied.scope', req);
    return deny(res, `This operation requires an okf ${requiredLevel} scope`);
  };
}

/**
 * Per-repo gate: the caller holds `admin` (or the requested level) on THIS
 * repo (exact match or wildcard), or is the bootstrap super-role.
 * @param {string} repoParam — the req.params key carrying the repo_id
 *        (default 'repo_id'). A missing/unset param DENIES — the middleware
 *        never authorizes against the literal argument.
 * @param {string} level — 'admin' (default) or 'read'.
 */
function requireRepoScope(repoParam = 'repo_id', level = 'admin') {
  assertLevel(level);
  const satisfies = LEVEL_SATISFIES[level];
  return (req, res, next) => {
    const repoId = req.params ? req.params[repoParam] : undefined;
    if (!repoId) {
      logger.warn('OKF authz denied: repo param missing', { param: repoParam, path: req.path });
      auditDenial('authz.denied.repo', req, null);
      return deny(res, `This operation requires an okf ${level} scope but the repository id is missing`);
    }
    const scopes = Array.isArray(req.okfScopes) ? req.okfScopes : [];
    const has = scopes.some((s) => {
      const p = parseOkfScope(s);
      return !!p && satisfies(p.level) && (p.repo === '*' || p.repo === repoId);
    });
    if (has || req.okfIsSuperAdmin) return next();
    logger.warn('OKF authz denied: missing repo scope', {
      sub: req.user && req.user.sub,
      repo_id: repoId,
      path: req.path
    });
    auditDenial('authz.denied.repo', req, repoId);
    return deny(res, `This operation requires an okf ${level} scope for repository ${repoId}`);
  };
}

module.exports = { requireScope, requireRepoScope, parseOkfScope };
