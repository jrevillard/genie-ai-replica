// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 2 — E-1, the Evaluation Context object.
//
// An Evaluation Context is a NAMED, VERSIONED, SNAPSHOT-RESOLVED authorization
// principal: the union of the scopes its referenced Keycloak groups carry,
// resolved through the ONE authority (resolveGraphSet) and frozen into the
// context doc. The tests below pin the three things the epic names:
//
//   1. the resolution is byte-identical to resolveGraphSet for the same scope
//      list (no second authority);
//   2. the union of several group memberships is the union — the same
//      reduction a multi-group token gets;
//   3. the OPEN context is first-class: empty scopes + empty principal refs
//      resolve as the deployment's default posture, and CLOSED mode is an
//      empty carrier WITH a loud warning, never a silent one.
//
// And the one thing the epic forbids: a context can never carry a hand-listed
// graph set. The only inputs are scopes and group refs.

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

// The Keycloak side is the only external dependency of a resolution: the
// realm roles each referenced group carries. The mock answers per group id.
jest.mock('../services/keycloak-access-service', () => ({
  isConfigured: jest.fn(() => true),
  groupRealmRoles: jest.fn(async (groupId) => {
    const groups = {
      'g-a': [{ id: 'r1', name: 'okf:t:r-a:read' }],
      'g-b': [{ id: 'r2', name: 'okf:t:r-b:read' }],
      'g-fence-a': [{ id: 'r5', name: 'okf:t:r-fence-a:read' }],
      'g-fence-b': [{ id: 'r6', name: 'okf:t:r-fence-b:read' }],
      'g-wild': [{ id: 'r3', name: 'okf:*:*:admin' }],
      'g-admin': [{ id: 'r4', name: 'tools-admin' }],
      'g-none': []
    };
    return groups[groupId] || [];
  })
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const retrievalConfigService = require('../services/retrieval-config-service');
const { resolveGraphSet } = require('../services/authz-resolver-service');
const keycloakAccess = require('../services/keycloak-access-service');
const { writeAudit } = require('../services/audit-service');
const evalCtx = require('../services/evaluation-context-service');

/** A serving row, in the shape retrieval-config-service.servingRepos reads.
 *  The graph name is minted from the row's NAME and version
 *  (workingGraphName), so the name follows the repo_id unless overridden. */
function servingRow(overrides = {}) {
  const row = Object.assign(
    {
      repo_id: 'r-open',
      name: null,
      domain: 'general',
      version: 1,
      lifecycle_state: 'publish',
      ingested_at: '2026-11-01T00:00:00Z',
      acl: null
    },
    overrides
  );
  if (!row.name) row.name = row.repo_id.replace(/^r-/, '');
  return row;
}

function seedServing(rows) {
  mockDb.query.mockResolvedValueOnce({ all: async () => rows });
  retrievalConfigService._resetServingCache();
}

describe('#2061 E-1: the Evaluation Context resolves through the ONE authority', () => {
  beforeEach(() => {
    mockDb._reset();
    retrievalConfigService._resetServingCache();
    keycloakAccess.groupRealmRoles.mockClear();
    writeAudit.mockClear();
    delete process.env.OKF_SCOPE_MODE;
  });

  test('the resolution is BYTE-IDENTICAL to resolveGraphSet for the same scope list', async () => {
    // The epic's acceptance criterion: "Resolution output byte-identical to
    // resolveGraphSet for the same scope list". The context must not
    // recompose the rule — it must CALL it.
    seedServing([servingRow({ repo_id: 'r-a' }), servingRow({ repo_id: 'r-b' })]);
    const scopes = ['okf:t:r-a:read', 'okf:t:r-b:read'];

    const resolved = await evalCtx.resolveContext({ scopes, principal_refs: [] });
    const direct = await resolveGraphSet({ okfScopes: scopes, isSuperAdmin: false });

    expect(resolved.graph_names).toEqual(direct.graph_names);
    expect(resolved.repos).toEqual(direct.repos);
    expect(resolved.scope_mode).toBe(direct.scope_mode);
  });

  test('the union of TWO groups is the union of their scopes (a multi-group token)', async () => {
    // The deployment's PUBLIC set (unrestricted) is in every carrier — the
    // product rule: in open mode a grant is ADDITIVE over the public set.
    // The difference between two principals is the FENCED repositories they
    // are granted, and the union is exactly the two of them.
    seedServing([
      servingRow({ repo_id: 'r-public' }),
      servingRow({ repo_id: 'r-fence-a', acl: { restricted: true } }),
      servingRow({ repo_id: 'r-fence-b', acl: { restricted: true } })
    ]);
    const onlyA = await evalCtx.resolveContext({ scopes: [], principal_refs: ['g-fence-a'] });
    const onlyB = await evalCtx.resolveContext({ scopes: [], principal_refs: ['g-fence-b'] });
    const both = await evalCtx.resolveContext({ scopes: [], principal_refs: ['g-fence-a', 'g-fence-b'] });

    expect(onlyA.scopes).toEqual(['okf:t:r-fence-a:read']);
    expect(onlyA.graph_names.sort()).toEqual(['OKF_fence-a_v1', 'OKF_public_v1']);
    expect(onlyB.graph_names.sort()).toEqual(['OKF_fence-b_v1', 'OKF_public_v1']);
    // THE union: both fenced repositories, and the public one.
    expect(both.scopes.sort()).toEqual(['okf:t:r-fence-a:read', 'okf:t:r-fence-b:read']);
    expect(both.graph_names.sort()).toEqual(['OKF_fence-a_v1', 'OKF_fence-b_v1', 'OKF_public_v1']);
  });

  test('a group holding a WILDCARD scope is privileged (wildcard-in-any-group)', async () => {
    seedServing([servingRow({ repo_id: 'r-a' }), servingRow({ repo_id: 'r-b' })]);
    const resolved = await evalCtx.resolveContext({ scopes: [], principal_refs: ['g-wild'] });
    expect(resolved.scopes).toEqual(['okf:*:*:admin']);
    expect(resolved.graph_names).toHaveLength(2);
  });

  test('a group holding the tools-admin realm role is privileged (the token reduction)', async () => {
    // A multi-group token carries `tools-admin` in realm_access.roles, and the
    // middleware reads it from there. The context must reduce the same way.
    seedServing([servingRow({ repo_id: 'r-a' })]);
    const resolved = await evalCtx.resolveContext({ scopes: [], principal_refs: ['g-admin'] });
    expect(resolved.graph_names).toHaveLength(1);
  });

  test('a group with NO scope role grants nothing', async () => {
    seedServing([servingRow({ repo_id: 'r-a' })]);
    const resolved = await evalCtx.resolveContext({ scopes: [], principal_refs: ['g-none'] });
    expect(resolved.scopes).toEqual([]);
  });

  test("the explicit scopes and the groups' scopes are UNIONED (never intersected)", async () => {
    seedServing([servingRow({ repo_id: 'r-a' }), servingRow({ repo_id: 'r-b' })]);
    const resolved = await evalCtx.resolveContext({
      scopes: ['okf:t:r-a:read'],
      principal_refs: ['g-b']
    });
    expect(resolved.scopes.sort()).toEqual(['okf:t:r-a:read', 'okf:t:r-b:read']);
  });
});

describe('#2061 E-1: the OPEN context is first-class', () => {
  beforeEach(() => {
    mockDb._reset();
    retrievalConfigService._resetServingCache();
    delete process.env.OKF_SCOPE_MODE;
  });

  test('OPEN context in OPEN mode = every UNRESTRICTED serving repo (restricted still fenced)', async () => {
    seedServing([servingRow({ repo_id: 'r-open' }), servingRow({ repo_id: 'r-fenced', acl: { restricted: true } })]);
    const resolved = await evalCtx.resolveContext({ scopes: [], principal_refs: [] });
    expect(resolved.graph_names).toEqual(['OKF_open_v1']);
    expect(resolved.warnings).toEqual([]);
  });

  test('OPEN context in CLOSED mode = an EMPTY carrier WITH a loud warning', async () => {
    process.env.OKF_SCOPE_MODE = 'closed';
    seedServing([servingRow({ repo_id: 'r-open' })]);
    const resolved = await evalCtx.resolveContext({ scopes: [], principal_refs: [] });
    expect(resolved.graph_names).toEqual([]);
    expect(resolved.warnings.length).toBeGreaterThan(0);
    expect(String(resolved.warnings[0]).toLowerCase()).toContain('closed');
  });
});

describe('#2061 E-1: the context is a named, versioned, immutable object', () => {
  beforeEach(() => {
    mockDb._reset();
    retrievalConfigService._resetServingCache();
    keycloakAccess.groupRealmRoles.mockClear();
    writeAudit.mockClear();
    delete process.env.OKF_SCOPE_MODE;
  });

  test('create resolves, stores the SNAPSHOT, and audits', async () => {
    seedServing([servingRow({ repo_id: 'r-a' })]);
    const ctx = await evalCtx.createContext(
      { name: 'analysts', scopes: ['okf:t:r-a:read'], principal_refs: [] },
      { actor: { user_id: 'admin-1', name: 'Admin' } }
    );
    expect(ctx.name).toBe('analysts');
    expect(ctx.version).toBe(1);
    expect(ctx.resolved.graph_names).toEqual(['OKF_a_v1']);
    expect(ctx.resolved.hash).toEqual(expect.any(String));
    expect(ctx.created_by).toBe('admin-1');
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'eval_context.create' }));
  });

  test('the doc carries NO hand-listed graph set — only scopes and group refs', async () => {
    seedServing([servingRow({ repo_id: 'r-a' })]);
    const ctx = await evalCtx.createContext(
      { name: 'analysts', scopes: ['okf:t:r-a:read'], principal_refs: [] },
      { actor: { user_id: 'admin-1' } }
    );
    // The resolved snapshot IS a graph list — but it is a SNAPSHOT, not an
    // input: nothing the caller passed can inject a graph name.
    expect(ctx.resolved.graph_names).toEqual(['OKF_a_v1']);
    expect(ctx.graph_names).toBeUndefined();
    expect(ctx.scopes).toEqual(['okf:t:r-a:read']);
  });

  test('refresh re-resolves and BUMPS the version (the snapshot is never stale-silent)', async () => {
    seedServing([servingRow({ repo_id: 'r-a' })]);
    const created = await evalCtx.createContext(
      { name: 'analysts', scopes: ['okf:t:r-a:read'], principal_refs: [] },
      { actor: { user_id: 'admin-1' } }
    );
    seedServing([servingRow({ repo_id: 'r-a' }), servingRow({ repo_id: 'r-b' })]);
    const refreshed = await evalCtx.refreshContext(created._key, { actor: { user_id: 'admin-1' } });
    expect(refreshed.version).toBe(2);
    expect(refreshed.resolved.graph_names).toHaveLength(2);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'eval_context.refresh' }));
  });

  test('a context with no name is REFUSED (an unnamed principal is not a context)', async () => {
    seedServing([servingRow({ repo_id: 'r-a' })]);
    await expect(evalCtx.createContext({ scopes: [] }, { actor: { user_id: 'admin-1' } })).rejects.toThrow(/name/i);
  });

  test('an unknown context id is REFUSED (never a silently empty carrier)', async () => {
    await expect(evalCtx.getContext('no-such-context')).rejects.toThrow(/not found/i);
  });

  test('the LIST issues a query ArangoDB can resolve (the engine refuses a wrong bind key)', async () => {
    // Measured live on 2026-11-22: the list endpoint answered HTTP 500 —
    // "no value specified for declared bind parameter '@collection'". A
    // `@@collection` placeholder is a COLLECTION-NAME bind parameter and
    // the engine reads its value under the key `@collection`; the key
    // `collection` leaves the placeholder empty and the engine refuses the
    // whole query. The mock refuses it the same way, so the defect cannot
    // be green in the unit suite and red in production.
    seedServing([servingRow({ repo_id: 'r-a' })]);
    await evalCtx.createContext(
      { name: 'analysts', scopes: ['okf:t:r-a:read'], principal_refs: [] },
      { actor: { user_id: 'admin-1' } }
    );
    const items = await evalCtx.listContexts();
    expect(items.map((c) => c.name)).toEqual(['analysts']);
    const [text, bindVars] = mockDb.query.mock.calls[mockDb.query.mock.calls.length - 1];
    expect(text).toContain('@@collection');
    expect(Object.keys(bindVars)).toEqual(['@collection']);
  });

  test('the snapshot records the EFFECTIVE scopes it resolved from (not only the inputs)', async () => {
    // The input scopes are what the operator typed; the EFFECTIVE scopes are
    // what the groups contributed — the union that was actually resolved.
    // A context that names only groups and stores an empty scope list
    // under-reports its own principal, and the audit row counts zero.
    seedServing([servingRow({ repo_id: 'r-fence-a', acl: { restricted: true } })]);
    const ctx = await evalCtx.createContext(
      { name: 'analysts', scopes: [], principal_refs: ['g-fence-a'] },
      { actor: { user_id: 'admin-1' } }
    );
    expect(ctx.scopes).toEqual([]); // the INPUT is empty — that is the input
    expect(ctx.resolved.scopes).toEqual(['okf:t:r-fence-a:read']); // the EFFECTIVE set
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ scopes: 1 }) })
    );
  });
});
