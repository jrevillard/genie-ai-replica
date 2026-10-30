// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6.1b — the SINGLE okf-scope authority. One pure function, three
// consumers: the read-side graph-set resolver (authz-resolver-service), the
// retrieval-config per-caller serving view, and the write-side callerAuthz
// (repository-controller). Lives in its own module so the resolver and the
// retrieval-config service can both import it without a require cycle.
// The scope GRAMMAR (parseOkfScope + levels) lives HERE too — require-scope
// imports it from this module, so the dependency points one way
// (middleware → authority); until the 2026-10-16 review the grammar lived in
// the middleware, forcing a load-order-dependent lazy require the other way.
//
// Semantics (byte-identical to the original inline callerAuthz, 2026-08-16
// review hardening preserved): `tools-admin` ⇒ unrestricted; a grammar-valid
// scope whose repo segment is `*` ⇒ unrestricted; exact repo segments
// accumulate; the LEVEL must be grammar-valid ('read'|'admin') — typo levels
// grant nothing; the tenant segment is currently ignored (6.1 consistency).
//
// DEFAULT-OPEN (product decision 2026-10-16, David): OKF_SCOPE_MODE governs
// the READ side only — 'open' (the default when unset) means a caller whose
// scopes grant NOTHING (no wildcard, no exact repo parsed) is authorized for
// ALL serving repos: once a repo is ingested and published, every regular
// user's query can reach it. 'closed' restores the Story-6.1 ADR-okf-025
// default-deny behavior (nothing granted = nothing authorized). Any
// successfully-granted scope remains authoritative — scopes RESTRICT, their
// absence no longer disables. The WRITE side (repository-controller
// callerAuthz + requireRepoScope) is NEVER opened by this flag: write access
// is always the closed scope list. The okf_scopes claim MAPPER already ships
// (configs/keycloak/genie-realm.yaml — user-attribute protocol mapper on the
// genie-app + okf-server clients; the admin wildcard is provisioned through
// it, and a hand-set okf_scopes user attribute lands in tokens today); what
// does NOT exist yet is the grant/revoke FACILITY, so in practice every
// non-superadmin user is scopeless and open (tracked as sprint item
// 6-1c-repo-access-control-admin-keycloak).

const { logger } = require('../shared-lib/logger');

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

// Garbage-value warning memo: warn once per DISTINCT bad value, so the
// per-call env read cannot flood the log, and an operator who fixes one typo
// and introduces another gets a fresh warning rather than silence.
let _lastGarbageMode;

/**
 * The effective scope mode, re-read per call so tests can flip the env and
 * operators change it with a container recreate (no rebuild). Only the
 * ABSENCE of the variable means the open default — a PRESENT value that is
 * empty, whitespace-only or unrecognized is EXPLICIT garbage and degrades to
 * 'closed' with a warning: a misconfigured attempt to pin the deployment
 * must not silently fail open.
 * @returns {'open'|'closed'}
 */
function currentScopeMode() {
  const raw = (process.env.OKF_SCOPE_MODE ?? 'open').trim().toLowerCase();
  if (raw === 'open' || raw === 'closed') return raw;
  if (raw !== _lastGarbageMode) {
    _lastGarbageMode = raw;
    logger.warn(
      `OKF_SCOPE_MODE is ${JSON.stringify(process.env.OKF_SCOPE_MODE)} — expected 'open' or 'closed'. ` +
        "Degrading to 'closed' (default-deny): scopeless users lose OKF fan-out until the value is fixed."
    );
  }
  return 'closed'; // explicit garbage — restrictive, never silent-open
}

/**
 * @param {string[]} okfScopes
 * @param {boolean} isSuperAdmin
 * @returns {{isSuperAdmin: boolean, authorizedRepoIds: Set<string>|null}} null = unrestricted
 */
function deriveScopeAuthz(okfScopes, isSuperAdmin) {
  if (isSuperAdmin) return { isSuperAdmin: true, authorizedRepoIds: null };
  const scopes = Array.isArray(okfScopes) ? okfScopes : [];
  const repos = new Set();
  let wildcard = false;
  for (const scope of scopes) {
    const p = parseOkfScope(scope);
    if (!p) continue; // malformed or typo level — grants nothing
    if (p.repo === '*') wildcard = true;
    else if (p.repo) repos.add(p.repo);
  }
  if (wildcard) return { isSuperAdmin: true, authorizedRepoIds: null };
  return { isSuperAdmin: false, authorizedRepoIds: repos };
}

/**
 * The DEFAULT-OPEN test for the read side: does this caller hold ANY okf
 * scope entry in its token? Tested against the RAW claim list, never the
 * derived set — a caller scoped to a repo that is not currently serving has
 * a non-empty derived set and must NOT fall open, and a token whose okf
 * entries are all MALFORMED counts as "scoped" (the operator intended a
 * restriction; closed is its visible symptom, not a silent fall-open).
 * @param {string[]} okfScopes
 */
function hasAnyScopeEntry(okfScopes) {
  return Array.isArray(okfScopes) && okfScopes.length > 0;
}

/**
 * THE single read-side verdict (2026-10-16 review: this rule was previously
 * hand-mirrored in resolveGraphSet, getRetrievalConfig and the scope gate —
 * three copies that could drift; it lives only here now).
 *
 * `unrestricted` answers "may this caller traverse ALL serving repos?":
 * super-role or wildcard scope (deriveScopeAuthz's authorizedRepoIds ===
 * null), or — open mode only — a token carrying NO okf scope entry at all
 * (the RAW claim list, see hasAnyScopeEntry). `scopeMode` is parsed ONCE and
 * returned with the verdict so every caller reports the same mode value it
 * decided on.
 * @param {string[]} okfScopes
 * @param {boolean} isSuperAdmin
 * @returns {{isSuperAdmin: boolean, authorizedRepoIds: Set<string>|null, scopeMode: 'open'|'closed', unrestricted: boolean}}
 */
function deriveReadAuthz(okfScopes, isSuperAdmin) {
  const derived = deriveScopeAuthz(okfScopes, isSuperAdmin);
  const scopeMode = currentScopeMode();
  const unrestricted = derived.authorizedRepoIds === null || (scopeMode === 'open' && !hasAnyScopeEntry(okfScopes));
  return { isSuperAdmin: derived.isSuperAdmin, authorizedRepoIds: derived.authorizedRepoIds, scopeMode, unrestricted };
}

module.exports = {
  parseOkfScope,
  LEVELS,
  LEVEL_SATISFIES,
  deriveScopeAuthz,
  deriveReadAuthz,
  currentScopeMode,
  hasAnyScopeEntry
};
