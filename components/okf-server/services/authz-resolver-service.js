// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6.1b (G8) — the READ-side authz resolver: a verified token's okf
// scopes → the exact set of serving OKF graphs the caller may traverse.
//
// SINGLE SCOPE AUTHORITY: the scope-parsing semantics below are the SAME
// implementation the write-side callerAuthz uses (repository-controller now
// delegates here) — super-role ⇒ unrestricted; grammar-valid scopes with a
// `*` repo segment ⇒ unrestricted; exact repo segments ⇒ the authorized set;
// typo levels grant nothing; the tenant segment is currently ignored (6.1
// consistency — the write side ignores it too).
//
// The graph set is SERVING ∩ AUTHORIZED (zero-hit guarantee by construction):
// serving truth comes from retrieval-config-service.servingRepos (publish +
// ingested_at + not tombstoned, ≤30s memo shared with retrieval-config), and
// every graph name is resolved through the workingGraphName authority —
// versioned OKF_<slug>_v<N> from the repo doc. Never a static OKF_{repo_id},
// never the manifest's stamped version (course-correction §1.3 Trap 2).
//
// PER-GRAPH LABEL MAP (G8): the shape ships, values are null today — no
// label-ACL source exists yet. Consumers treat null as "no label restriction
// beyond the caller's own search_start filter_labels". The map is the contract
// that survives a future label-ACL source (Keycloak attribute or repo field).

const { DateTime } = require('luxon');
const { servingRepos, SERVING_TTL_MS } = require('./retrieval-config-service');
const { deriveScopeAuthz, deriveReadAuthz } = require('./scope-authz-service');
const { filterServingByAcl } = require('./access-control-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');

/**
 * Resolve the caller's traversable graph set.
 * @param {{okfScopes: string[], isSuperAdmin: boolean}} caller
 * @returns {Promise<{superadmin: boolean, scope_mode: string, graph_names: string[], per_graph_labels: Object<string,null>, domains: Object<string,string|null>, repos: Array<{repo_id,name,domain,graph_name}>, generated_at: string, ttl_seconds: number}>}
 */
async function resolveGraphSet(caller) {
  return withSpan('okf.authz.resolve_graph_set', async (span) => {
    const { isSuperAdmin, authorizedRepoIds, scopeMode } = deriveReadAuthz(caller.okfScopes, caller.isSuperAdmin);
    const serving = await servingRepos();
    // BASE SET (David's rule, 2026-10-16: "the user's ACL list determines what
    // they have access to ON TOP of the repos that are open for public
    // access"):
    //   - OPEN mode: the base is ALL serving repos (the public set). Grants
    //     are ADDITIVE — a granted user never loses the public repos; the
    //     per-repo restriction gate below is what decides the restricted
    //     ones. (The first cut applied the Story-6.1 exact-list rule in open
    //     mode too, which made a single grant strip a user of every open
    //     repo — caught in review against the product model.)
    //   - CLOSED mode: the historical exact list (scopes = the whole
    //     universe a caller may reach). Privileged callers (role/wildcard —
    //     authorizedRepoIds === null) get everything in both modes.
    // STORY 6-1c then applies the per-repo restriction gate IDENTICALLY in
    // both modes: a RESTRICTED repo needs privilege or a grant regardless.
    // This view, the retrieval-config serving view and the scope gate share
    // the single scope authority, so they can never drift apart. The WRITE
    // side never sees these rules — repository-controller callerAuthz keeps
    // the closed list.
    const privileged = authorizedRepoIds === null;
    const base = scopeMode === 'open' || privileged ? serving : serving.filter((r) => authorizedRepoIds.has(r.repo_id));
    const allowed = filterServingByAcl(base, caller.okfScopes, privileged);
    const graph_names = allowed.map((r) => r.graph_name);
    const per_graph_labels = {};
    const domains = {};
    for (const r of allowed) {
      per_graph_labels[r.graph_name] = null; // G8 seam — no label-ACL source yet
      // `domains` is the O(1) keyed lookup for the Graph Router's hot path;
      // `repos[]` is the human-readable join. Deliberate duplication
      // (code-review 2026-09-20): two access patterns, one payload.
      domains[r.graph_name] = r.domain || null;
    }
    span.setAttribute('okf.authz.superadmin', isSuperAdmin);
    span.setAttribute('okf.authz.scope_mode', scopeMode);
    span.setAttribute('okf.authz.privileged', authorizedRepoIds === null);
    span.setAttribute('okf.authz.serving_count', serving.length);
    span.setAttribute('okf.authz.authorized_graphs', graph_names.length);
    logger.info('Graph set resolved', {
      superadmin: isSuperAdmin,
      scope_mode: scopeMode,
      privileged: authorizedRepoIds === null,
      serving: serving.length,
      authorized: graph_names.length
    });
    return {
      superadmin: isSuperAdmin,
      scope_mode: scopeMode,
      graph_names,
      per_graph_labels,
      domains,
      repos: allowed.map((r) => ({
        repo_id: r.repo_id,
        name: r.name,
        domain: r.domain || null,
        graph_name: r.graph_name
      })),
      generated_at: DateTime.now().toUTC().toISO(),
      // CACHE CONTRACT (consumers — chatqna/retriever, Story 1.2): this ttl is
      // the ADR-bounded serving-set skew window, NOT an authorization-decision
      // cache lifetime. A consumer that caches this response extends graph
      // access up to 30s past token revocation; key any consumer cache on the
      // TOKEN/SESSION and drop it on logout, never on a fixed timer alone.
      ttl_seconds: Math.round(SERVING_TTL_MS / 1000)
    };
  });
}

// deriveScopeAuthz is re-exported for backward compatibility (the resolver was
// its original home; the single authority now lives in scope-authz-service).
module.exports = { deriveScopeAuthz, resolveGraphSet };
