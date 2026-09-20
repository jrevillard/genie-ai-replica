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
const { deriveScopeAuthz } = require('./scope-authz-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');

/**
 * Resolve the caller's traversable graph set.
 * @param {{okfScopes: string[], isSuperAdmin: boolean}} caller
 * @returns {Promise<{superadmin: boolean, graph_names: string[], per_graph_labels: Object<string,null>, domains: Object<string,string|null>, repos: Array<{repo_id,name,domain,graph_name}>, generated_at: string, ttl_seconds: number}>}
 */
async function resolveGraphSet(caller) {
  return withSpan('okf.authz.resolve_graph_set', async (span) => {
    const { isSuperAdmin, authorizedRepoIds } = deriveScopeAuthz(caller.okfScopes, caller.isSuperAdmin);
    const serving = await servingRepos();
    // The intersection IS the zero-hit guarantee: only serving rows whose
    // repo_id the caller is authorized for survive — unauthorized (or
    // draft/retracted) repos never enter the response at all.
    const allowed = isSuperAdmin ? serving : serving.filter((r) => authorizedRepoIds.has(r.repo_id));
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
    span.setAttribute('okf.authz.serving_count', serving.length);
    span.setAttribute('okf.authz.authorized_graphs', graph_names.length);
    logger.info('Graph set resolved', {
      superadmin: isSuperAdmin,
      serving: serving.length,
      authorized: graph_names.length
    });
    return {
      superadmin: isSuperAdmin,
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

module.exports = { deriveScopeAuthz, resolveGraphSet };
