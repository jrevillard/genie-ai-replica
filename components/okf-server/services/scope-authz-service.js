// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6.1b — the SINGLE okf-scope authority. One pure function, three
// consumers: the read-side graph-set resolver (authz-resolver-service), the
// retrieval-config per-caller serving view, and the write-side callerAuthz
// (repository-controller). Lives in its own module so the resolver and the
// retrieval-config service can both import it without a require cycle.
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
// is always the closed scope list. There is no granting mechanism yet (no
// Keycloak scope mappers ship — tracked as the okf-repo-access-control
// sprint item), so today every non-superadmin user is scopeless and open.

const { parseOkfScope } = require('../middleware/require-scope');

/**
 * The effective scope mode, re-read per call so tests can flip the env and
 * operators change it with a container recreate (no rebuild).
 * @returns {'open'|'closed'}
 */
function currentScopeMode() {
  return (process.env.OKF_SCOPE_MODE || 'open').trim().toLowerCase() === 'closed' ? 'closed' : 'open';
}

/** True when the read side authorizes zero-effective-scope callers for all serving repos. */
function isScopeModeOpen() {
  return currentScopeMode() === 'open';
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

module.exports = { deriveScopeAuthz, currentScopeMode, isScopeModeOpen };
