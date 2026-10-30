// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6-1c — the per-repo restriction gate: unit matrix + integration with
// BOTH read views (resolveGraphSet and getRetrievalConfig must apply the gate
// identically — the carrier/engaged-gate invariant).

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
const { resolveGraphSet } = require('../services/authz-resolver-service');
const { callerMayTraverseRepo, filterServingByAcl, scopeSatisfies } = require('../services/access-control-service');
const { createSchema } = require('../validators/repository-validator');

const REPO = { repo_id: 'r-bali', acl: { restricted: true, required_scopes: ['okf:t:island-tourism:admin'] } };

describe('NEW repos default OPEN for all users (product rule, David 2026-10-16)', () => {
  test('createSchema accepts an acl WITHOUT restricted — the field is optional', () => {
    const { error, value } = createSchema.validate({
      name: 'Bali',
      domain: 'Island Tourism',
      acl: { required_scopes: ['okf:t:island-tourism:admin'] }
    });
    expect(error).toBeUndefined();
    expect(value.acl.restricted).toBeUndefined();
  });

  test('a freshly-created repo (stamp only, no restricted flag) is traversable by EVERYONE', () => {
    // repository-controller.create stamps required_scopes but never sets
    // `restricted` — the gate must be a no-op for exactly this shape.
    const freshRepo = { repo_id: 'r-new', acl: { required_scopes: ['okf:t:general:admin'] } };
    expect(callerMayTraverseRepo(freshRepo, [], false)).toBe(true); // scopeless, not privileged
    expect(callerMayTraverseRepo(freshRepo, [], true)).toBe(true); // privileged
  });
});

describe('callerMayTraverseRepo (unit matrix)', () => {
  test('no acl / not restricted → gate is a no-op (default-open untouched)', () => {
    expect(
      callerMayTraverseRepo({ repo_id: 'r-kenya', acl: { required_scopes: ['okf:t:general:admin'] } }, [], false)
    ).toBe(true);
    expect(callerMayTraverseRepo({ repo_id: 'r-kenya' }, [], false)).toBe(true);
  });

  test('restricted + unrestricted caller (superadmin/wildcard/open-mode scopeless) → allowed', () => {
    expect(callerMayTraverseRepo(REPO, [], true)).toBe(true);
  });

  test('restricted + scopeless non-unrestricted caller → DENIED (the whole point)', () => {
    expect(callerMayTraverseRepo(REPO, [], false)).toBe(false);
  });

  test('restricted + holder of a repo-scoped entry (read OR admin) → allowed', () => {
    expect(callerMayTraverseRepo(REPO, ['okf:itu:r-bali:read'], false)).toBe(true);
    expect(callerMayTraverseRepo(REPO, ['okf:itu:r-bali:admin'], false)).toBe(true);
  });

  test('restricted + holder scoped to a DIFFERENT repo → denied', () => {
    expect(callerMayTraverseRepo(REPO, ['okf:itu:r-other:admin'], false)).toBe(false);
  });

  test('restricted + wildcard admin → allowed', () => {
    expect(callerMayTraverseRepo(REPO, ['okf:itu:*:admin'], false)).toBe(true);
  });

  test('restricted + holder satisfying a declared required_scope (the hand-set path) → allowed', () => {
    expect(callerMayTraverseRepo(REPO, ['okf:t:island-tourism:admin'], false)).toBe(true);
    // read does NOT satisfy an admin requirement
    expect(callerMayTraverseRepo(REPO, ['okf:t:island-tourism:read'], false)).toBe(false);
  });

  test('restricted + malformed-only scopes → denied (restriction intended)', () => {
    expect(callerMayTraverseRepo(REPO, ['okf:only-three', 'okf:t:r-bali:write'], false)).toBe(false);
  });

  test('scopeSatisfies: wildcard covers any target at a satisfying level', () => {
    expect(scopeSatisfies({ repo: '*', level: 'admin' }, { repo: 'x', level: 'admin' })).toBe(true);
    expect(scopeSatisfies({ repo: '*', level: 'read' }, { repo: 'x', level: 'admin' })).toBe(false);
  });
});

describe('filterServingByAcl', () => {
  const rows = [
    { repo_id: 'r-open', graph_name: 'G_OPEN' }, // never restricted
    { repo_id: 'r-bali', graph_name: 'G_BALI', acl: { restricted: true } }
  ];
  test('keeps unrestricted rows, drops restricted rows for a scopeless caller', () => {
    const out = filterServingByAcl(rows, [], false);
    expect(out.map((r) => r.repo_id)).toEqual(['r-open']);
  });
  test('keeps everything for an unrestricted caller', () => {
    expect(filterServingByAcl(rows, [], true)).toHaveLength(2);
  });
});

describe('integration: BOTH read views apply the gate identically', () => {
  function servingRow(overrides) {
    return Object.assign(
      {
        repo_id: 'r-bali',
        name: 'Bali',
        domain: 'island-tourism',
        version: 1,
        lifecycle_state: 'publish',
        ingested_at: '2026-10-16T00:00:00Z',
        acl: { restricted: true, required_scopes: ['okf:t:island-tourism:admin'] }
      },
      overrides
    );
  }
  function seedServing(rows) {
    mockDb.query.mockResolvedValueOnce({ all: async () => rows });
  }

  beforeEach(() => {
    mockDb._reset();
    retrievalConfigService._resetServingCache();
    mockDb.collection('okf_system_config').save({ _key: 'retrieval', mode: 'hybrid' });
  });
  afterEach(() => {
    delete process.env.OKF_SCOPE_MODE;
  });

  test('DEFAULT-OPEN scopeless caller: restricted repo EXCLUDED, unrestricted repo included', async () => {
    seedServing([servingRow(), servingRow({ repo_id: 'r-open', name: 'Open', acl: null })]);
    const out = await resolveGraphSet({ okfScopes: [], isSuperAdmin: false });
    expect(out.graph_names).toEqual(['OKF_open_v1']); // bali gated out
    const view = await retrievalConfigService.getRetrievalConfig({ okfScopes: [], isSuperAdmin: false });
    expect(view.serving_repo_ids).toEqual(['r-open']); // same verdict — the invariant
  });

  test('granted holder reaches the restricted repo ON TOP of the public set (David rule 3)', async () => {
    seedServing([servingRow(), servingRow({ repo_id: 'r-open', name: 'Open', acl: null })]);
    // Open mode: the base is the PUBLIC set for every caller; the grant adds
    // the restricted repo ON TOP. A grant must NEVER strip public access
    // (the first cut's exact-list rule did exactly that — caught in review
    // against the product model).
    const out = await resolveGraphSet({ okfScopes: ['okf:itu:r-bali:read'], isSuperAdmin: false });
    expect(out.graph_names.sort()).toEqual(['OKF_bali_v1', 'OKF_open_v1'].sort());
    const view = await retrievalConfigService.getRetrievalConfig({
      okfScopes: ['okf:itu:r-bali:read'],
      isSuperAdmin: false
    });
    expect(view.serving_repo_ids.sort()).toEqual(['r-bali', 'r-open'].sort());
  });

  test('superadmin bypasses the restriction gate entirely', async () => {
    seedServing([servingRow()]);
    const out = await resolveGraphSet({ okfScopes: [], isSuperAdmin: true });
    expect(out.graph_names).toEqual(['OKF_bali_v1']);
  });

  test('closed mode + scopeless: restriction changes nothing (already empty)', async () => {
    process.env.OKF_SCOPE_MODE = 'closed';
    seedServing([servingRow()]);
    const out = await resolveGraphSet({ okfScopes: [], isSuperAdmin: false });
    expect(out.graph_names).toEqual([]);
  });
});
