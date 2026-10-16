// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6-1c — per-repository access restriction, the READ-side second gate.
//
// The repo doc carries `acl.required_scopes` (stamped at creation with a
// domain-admin scope) and — as of this story — `acl.restricted` (boolean,
// absent/false on every historical repo). Only a RESTRICTED repo consults the
// scope gate on the read path; an unrestricted repo follows the deployment's
// OKF_SCOPE_MODE rule untouched (default-open keeps working for every repo
// that was never explicitly restricted — enforcing the stamped scopes blindly
// would have locked scopeless users out of ALL repos, since every repo doc
// carries the stamp).
//
// A caller may traverse a RESTRICTED repo when they are privileged
// (superadmin / wildcard) OR hold ANY grammar-valid
// scope naming this repo (read level is enough to read) OR hold a scope that
// satisfies one of the repo's declared required_scopes (the hand-set path —
// an operator who stamped okf:t:{domain}:admin on a user's attribute).
//
// Grant/REVOKe (the admin facility) lives in keycloak-access-service: it
// writes okf:{tenant}:{repo_id}:{level} entries into a user's okf_scopes
// attribute, which the realm's existing protocol mapper ships in their JWT.

const { parseOkfScope, LEVEL_SATISFIES } = require('./scope-authz-service');

/**
 * Does a holder scope satisfy a required scope? Tenant segment ignored
 * (consistent with the rest of the 6.1 surface); `*` repo covers any target.
 */
function scopeSatisfies(holder, required) {
  if (!holder) return false;
  if (holder.repo === '*') return LEVEL_SATISFIES[required.level || 'read'](holder.level);
  return holder.repo === required.repo && LEVEL_SATISFIES[required.level || 'read'](holder.level);
}

/**
 * THE per-repo read gate.
 * @param {{repo_id: string, acl?: {restricted?: boolean, required_scopes?: string[]}}} repo
 *        a SERVING row (lifecycle already verified by the caller).
 * @param {string[]} okfScopes the RAW claim list from the caller's token.
 * @param {boolean} privileged DERIVED privilege only — the tools-admin role
 *        or a wildcard scope (deriveReadAuthz's authorizedRepoIds === null).
 *        NOT the open-mode "unrestricted" verdict: a default-open scopeless
 *        caller reaches every UNRESTRICTED repo but is fenced OUT of
 *        restricted ones until granted — that is the entire purpose of this
 *        facility. Confusing the two flags was caught by the integration
 *        test (a scopeless caller traversed a restricted repo).
 * @returns {boolean} may this caller traverse this repo?
 */
function callerMayTraverseRepo(repo, okfScopes, privileged) {
  const acl = repo && repo.acl;
  if (!acl || !acl.restricted) return true; // never restricted → no second gate
  if (privileged) return true; // superadmin / wildcard
  const holders = (Array.isArray(okfScopes) ? okfScopes : []).map(parseOkfScope).filter(Boolean);
  if (holders.some((h) => h.repo === '*' || h.repo === repo.repo_id)) return true;
  const required = (Array.isArray(acl.required_scopes) ? acl.required_scopes : []).map(parseOkfScope).filter(Boolean);
  return holders.some((h) => required.some((r) => scopeSatisfies(h, r)));
}

/**
 * Filter a serving set through the per-repo gate. Applied AFTER the
 * mode/scope-list filter in resolveGraphSet and getRetrievalConfig — the two
 * read views must apply it identically or the carrier and the engaged gate
 * diverge (same invariant as the mode rule itself).
 */
function filterServingByAcl(servingRows, okfScopes, privileged) {
  return servingRows.filter((r) => callerMayTraverseRepo(r, okfScopes, privileged));
}

module.exports = { callerMayTraverseRepo, filterServingByAcl, scopeSatisfies };
