// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6.1b (G8) — authz resolver pins: shared scope authority (the exact
// semantics the write-side callerAuthz enforces), serving ∩ authorized graph
// sets, per-graph label seam shape, and the ≤30s serving-set memo.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const retrievalConfigService = require('../services/retrieval-config-service');
const { deriveScopeAuthz, resolveGraphSet } = require('../services/authz-resolver-service');

function servingRow(overrides) {
  // Model what servingRepos() returns AND what workingGraphName needs: the
  // rows carry lifecycle_state='publish' + ingested_at (the serving truth the
  // AQL filters on AND projects — the projection contract with
  // workingGraphName is pinned in retrieval-config-service's module header).
  // INVARIANT (lifecycle-service.js:405-462): publish is BLOCKED while a
  // drain is pending and publish nulls ingested_at until the drain settles —
  // so any row in the serving set has version === the promoted serving
  // version, and workingGraphName reading `version` is exactly the promoted
  // name. A future mint-without-retract flow would silently break this —
  // these fixtures would need a cross-check then.
  return Object.assign(
    {
      repo_id: 'r-kenya',
      name: 'Kenya Gov',
      domain: 'government',
      version: 3,
      lifecycle_state: 'publish',
      ingested_at: '2026-09-20T00:00:00Z'
    },
    overrides || {}
  );
}

function seedServing(rows) {
  mockDb.query.mockResolvedValueOnce({ all: async () => rows });
}

describe('deriveScopeAuthz (shared with write-side callerAuthz)', () => {
  test('super-admin role → unrestricted', () => {
    expect(deriveScopeAuthz([], true)).toEqual({ isSuperAdmin: true, authorizedRepoIds: null });
  });

  test('repo wildcard scope → unrestricted (even at read level)', () => {
    expect(deriveScopeAuthz(['okf:itu:*:read'], false)).toEqual({ isSuperAdmin: true, authorizedRepoIds: null });
  });

  test('typo level grants NOTHING — not a wildcard, not in the set', () => {
    const out = deriveScopeAuthz(['okf:itu:*:write', 'okf:itu:repoB:write'], false);
    expect(out.isSuperAdmin).toBe(false);
    expect(out.authorizedRepoIds.size).toBe(0);
  });

  test('exact repo segments accumulate across tenants; admin implies read', () => {
    const out = deriveScopeAuthz(['okf:itu:repoA:read', 'okf:other:repoB:admin'], false);
    expect(out.isSuperAdmin).toBe(false);
    expect([...out.authorizedRepoIds].sort()).toEqual(['repoA', 'repoB']);
  });

  test('malformed scopes (wrong segment count / prefix) are ignored', () => {
    const out = deriveScopeAuthz(['okf:only:three', 'nofx:itu:repoC:read', 'okf:itu:repoD:read:extra'], false);
    expect(out.authorizedRepoIds.size).toBe(0);
  });

  test('no scopes at all → empty set (default deny, G3)', () => {
    const out = deriveScopeAuthz(undefined, false);
    expect(out.isSuperAdmin).toBe(false);
    expect(out.authorizedRepoIds.size).toBe(0);
  });
});

describe('resolveGraphSet (serving ∩ authorized)', () => {
  beforeEach(() => {
    mockDb._reset();
    retrievalConfigService._resetServingCache();
  });

  test('superadmin → ALL serving graphs, per-graph shape complete', async () => {
    seedServing([
      servingRow(),
      servingRow({ repo_id: 'r-health', name: 'Health Services', domain: 'health', version: 1, ingested_version: 1 })
    ]);
    const out = await resolveGraphSet({ okfScopes: [], isSuperAdmin: true });
    expect(out.superadmin).toBe(true);
    expect(out.graph_names).toEqual(['OKF_kenya-gov_v3', 'OKF_health-services_v1']);
    expect(out.per_graph_labels).toEqual({
      'OKF_kenya-gov_v3': null, // G8 seam: shape today, values null
      'OKF_health-services_v1': null
    });
    expect(out.domains['OKF_kenya-gov_v3']).toBe('government');
    expect(out.repos).toHaveLength(2);
    expect(out.ttl_seconds).toBe(30);
    expect(out.generated_at).toBeTruthy();
  });

  test('scoped caller → intersection only (isolation: repo A never sees repo B)', async () => {
    seedServing([servingRow(), servingRow({ repo_id: 'r-health', name: 'Health Services', version: 1 })]);
    const out = await resolveGraphSet({ okfScopes: ['okf:itu:r-kenya:read'], isSuperAdmin: false });
    expect(out.graph_names).toEqual(['OKF_kenya-gov_v3']); // r-health ABSENT
    expect(out.repos.map((r) => r.repo_id)).toEqual(['r-kenya']);
    expect(out.superadmin).toBe(false);
  });

  test('zero overlap → empty sets (zero-hit by construction)', async () => {
    seedServing([servingRow()]);
    const out = await resolveGraphSet({ okfScopes: ['okf:itu:r-other:read'], isSuperAdmin: false });
    expect(out.graph_names).toEqual([]);
    expect(out.per_graph_labels).toEqual({});
    expect(out.repos).toEqual([]);
  });

  test('authorized but NOT serving (draft/retracted) → excluded', async () => {
    // The serving query returns only publish+ingested rows; a draft repo the
    // caller holds a scope for simply never appears in the rows.
    seedServing([]); // nothing serving
    const out = await resolveGraphSet({ okfScopes: ['okf:itu:r-draft:admin'], isSuperAdmin: false });
    expect(out.graph_names).toEqual([]);
  });

  test('serving-set memo: repeat calls reuse the cache until reset', async () => {
    seedServing([servingRow()]);
    const first = await resolveGraphSet({ okfScopes: [], isSuperAdmin: true });
    // The serving query resolves ONCE — the second call is served from the memo
    // even though the programmed query reply changed.
    seedServing([servingRow({ repo_id: 'r-new', name: 'New Repo', version: 1 })]);
    const second = await resolveGraphSet({ okfScopes: [], isSuperAdmin: true });
    expect(second.graph_names).toEqual(first.graph_names);
    expect(mockDb.query).toHaveBeenCalledTimes(1);

    retrievalConfigService._resetServingCache();
    const third = await resolveGraphSet({ okfScopes: [], isSuperAdmin: true });
    expect(third.graph_names).toEqual(['OKF_new-repo_v1']);
    expect(mockDb.query).toHaveBeenCalledTimes(2);
  });
});
