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
// Grammar + read verdict come from the SINGLE scope authority. Top-level is
// safe: scope-authz-service imports nothing from THIS module (the grammar
// lives there), so there is no cycle.
const { parseOkfScope, LEVEL_SATISFIES, deriveReadAuthz } = require('../services/scope-authz-service');

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
 * @param {{allowScopelessWhenOpen?: boolean}} [opts] — when true, a caller
 *        with ZERO effective okf scopes is admitted while OKF_SCOPE_MODE is
 *        open (the default — DEFAULT-OPEN, product decision 2026-10-16).
 *        Only the two chat-serving read routes mount this variant; the
 *        router-wide gate and every per-repo gate keep the strict semantics,
 *        so scopeless callers reach exactly the serving-graph reads and
 *        nothing else. requireRepoScope NEVER accepts the option.
 */
// Default-open admission logging: the fact ("open mode is on") is a
// deployment-level constant, so log it ONCE per process — a per-request row
// on every chat query would only double hot-path log volume (the handlers
// already log scope_mode on every resolve). Not audited: /authz/graphs runs
// per chat query and the audit table would fill with one row per question.
let _admittedScopelessLogged = false;

function requireScope(requiredLevel = 'read', opts = {}) {
  assertLevel(requiredLevel);
  const satisfies = LEVEL_SATISFIES[requiredLevel];
  return (req, res, next) => {
    const scopes = Array.isArray(req.okfScopes) ? req.okfScopes : [];
    const has = scopes.some((s) => {
      const p = parseOkfScope(s);
      return !!p && satisfies(p.level);
    });
    if (has || req.okfIsSuperAdmin) return next();
    if (opts.allowScopelessWhenOpen) {
      // The admission test is the authority's single read verdict
      // (deriveReadAuthz) — never a local recomposition of the rule. For
      // every caller reaching this branch (no grammar-valid scope, no
      // super-role) it reduces to "open mode && RAW claim list empty": a
      // token whose okf entries are all malformed counts as "scoped" and
      // stays denied, matching the resolver's DEFAULT-OPEN rule exactly.
      if (deriveReadAuthz(req.okfScopes, req.okfIsSuperAdmin).unrestricted) {
        if (!_admittedScopelessLogged) {
          _admittedScopelessLogged = true;
          logger.info('OKF scope gate: default-open admits scopeless callers (OKF_SCOPE_MODE=open)', {
            path: req.path
          });
        }
        return next();
      }
    }
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

module.exports = { requireScope, requireRepoScope };
