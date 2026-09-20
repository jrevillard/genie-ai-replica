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

const { parseOkfScope } = require('../middleware/require-scope');

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

module.exports = { deriveScopeAuthz };
