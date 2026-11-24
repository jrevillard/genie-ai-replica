// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 4 (E-5) — the composer's backend.
//
// The Evaluation Context is a dummy principal: a NAME plus the group
// memberships it holds. The operator composes those memberships in the
// Lab, and the composer's backend is these three contracts:
//
//   1. listGroups() — the deployment's groups, each with the GRANTS it
//      carries and the MEMBERS it holds. This is what the composer shows.
//   2. previewContext() — the resolution a create WOULD freeze, WITHOUT
//      writing anything: a context is immutable and has no delete route,
//      so the union must be visible BEFORE it is committed.
//   3. the superadmin gate on both reads — a group is a deployment-wide
//      principal; its membership is not a per-repo fact.
//
// The resolution stays the ONE authority's answer: the preview and the
// created context cannot disagree, because both call the same resolve.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
// The router pulls the auth middleware in, and that pulls jose (ESM-only
// under Jest) — the same mock the other route suites use.
jest.mock('../shared-lib/keycloak-auth-service', () => ({ verifyToken: jest.fn() }));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }));

jest.mock('../services/keycloak-access-service', () => ({
  isConfigured: jest.fn(() => true),
  searchGroups: jest.fn(async (term) => {
    const all = [
      { id: 'g-a', name: 'group-a' },
      { id: 'g-b', name: 'group-b' },
      { id: 'g-none', name: 'group-none' },
      { id: 'g-admin', name: 'group-admin' }
    ];
    const q = String(term || '').trim();
    return q ? all.filter((g) => g.name.includes(q)) : all;
  }),
  findGroupByName: jest.fn(async (name) => {
    const known = { 'group-a': 'g-a', 'group-b': 'g-b', 'group-none': 'g-none' };
    return known[name] ? { id: known[name], name } : null;
  }),
  groupRealmRoles: jest.fn(async (groupId) => {
    const groups = {
      'g-a': [{ id: 'r1', name: 'okf:t:r-a:read' }],
      'g-b': [{ id: 'r2', name: 'okf:t:r-b:read' }],
      'g-none': [],
      'g-admin': [{ id: 'r4', name: 'tools-admin' }]
    };
    return groups[groupId] || [];
  }),
  groupMembers: jest.fn(async (groupId) => {
    const members = {
      'g-a': [{ id: 'u1', username: 'alice' }],
      'g-b': [{ id: 'u2', username: 'bob' }],
      'g-none': [],
      'g-admin': [{ id: 'u3', username: 'root' }]
    };
    return { members: members[groupId] || [], truncated: false };
  })
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const retrievalConfigService = require('../services/retrieval-config-service');
const keycloakAccess = require('../services/keycloak-access-service');
const evalCtx = require('../services/evaluation-context-service');
const evalCtxController = require('../controllers/evaluation-context-controller');

function servingRow(overrides = {}) {
  const row = Object.assign(
    {
      repo_id: 'r-a',
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

describe("#2061 E-5: the composer's source — the deployment's groups", () => {
  beforeEach(() => {
    mockDb._reset();
    retrievalConfigService._resetServingCache();
    keycloakAccess.searchGroups.mockClear();
    keycloakAccess.groupRealmRoles.mockClear();
    keycloakAccess.groupMembers.mockClear();
  });

  test('a group carries its GRANTS and its MEMBERS — the composer shows both', async () => {
    const groups = await evalCtx.listGroups('');

    const a = groups.find((g) => g.name === 'group-a');
    expect(a).toBeTruthy();
    // The grants are the scope-carrying realm roles, and ONLY those: the
    // tools-admin marker is not a scope, it is the privileged flag.
    expect(a.grants).toEqual(['okf:t:r-a:read']);
    expect(a.privileged).toBe(false);
    // The members are the people the membership stands for.
    expect(a.members).toEqual(['alice']);
  });

  test('a group that carries tools-admin is marked privileged, and the role is not a grant', async () => {
    const groups = await evalCtx.listGroups('');
    const admin = groups.find((g) => g.name === 'group-admin');
    expect(admin.privileged).toBe(true);
    expect(admin.grants).toEqual([]);
  });

  test('the search narrows the list', async () => {
    const groups = await evalCtx.listGroups('group-b');
    expect(groups.map((g) => g.name)).toEqual(['group-b']);
    expect(keycloakAccess.searchGroups).toHaveBeenCalledWith('group-b', 100);
  });

  test('a truncated membership is MARKED, never shown as the whole population', async () => {
    // The paged read reports truncation — the composer must say "there is
    // more", not render 200 as if it were everyone.
    keycloakAccess.groupMembers.mockImplementation(async (groupId) =>
      groupId === 'g-a'
        ? { members: [{ id: 'u1', username: 'alice' }], truncated: true }
        : { members: [], truncated: false }
    );
    const groups = await evalCtx.listGroups('');
    const a = groups.find((g) => g.name === 'group-a');
    expect(a.members_truncated).toBe(true);
    expect(a.members).toEqual(['alice']);
    const b = groups.find((g) => g.name === 'group-b');
    expect(b.members_truncated).toBe(false);
  });
});

describe("#2061 E-5: the composer's preview — the resolution BEFORE it is committed", () => {
  beforeEach(() => {
    mockDb._reset();
    retrievalConfigService._resetServingCache();
  });

  test('the preview resolves the union of the memberships and writes NOTHING', async () => {
    seedServing([servingRow({ repo_id: 'r-a' }), servingRow({ repo_id: 'r-b' })]);

    const preview = await evalCtx.previewContext({ principal_refs: ['group-a', 'group-b'] });

    // The union — the same reduction a multi-group token gets.
    expect(preview.resolved.scopes).toEqual(['okf:t:r-a:read', 'okf:t:r-b:read']);
    expect(preview.resolved.repos.map((r) => r.repo_id).sort()).toEqual(['r-a', 'r-b']);
    // And NOTHING was written: a context is immutable, so the preview must
    // not leave a document behind.
    expect(mockDb.collection).not.toHaveBeenCalledWith('okf_evaluation_contexts');
  });

  test('the preview does not need a name — an operator composes BEFORE naming', async () => {
    seedServing([servingRow({ repo_id: 'r-a' })]);
    const preview = await evalCtx.previewContext({ principal_refs: ['group-a'] });
    expect(preview.name).toBe('');
    expect(preview.resolved.repos).toHaveLength(1);
  });

  test('a membership that cannot be read is REPORTED, not silently widened', async () => {
    seedServing([servingRow({ repo_id: 'r-a' })]);
    const preview = await evalCtx.previewContext({ principal_refs: ['group-a', 'no-such-group'] });
    expect(preview.unreadable).toEqual(['no-such-group']);
    expect(preview.warnings.join(' ')).toMatch(/no-such-group/);
  });
});

describe("#2061 E-5: the composer's reads are deployment-wide powers", () => {
  const call = (handler, req) => {
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      }
    };
    const next = jest.fn();
    // A middleware (requireSuperadmin) returns undefined; a handler returns
    // a promise. Promise.resolve() covers both.
    return Promise.resolve(handler(req, res, next)).then(() => ({ res, next }));
  };

  test('a non-superadmin is refused at the gate', async () => {
    const { res, next } = await call(evalCtxController.requireSuperadmin, {
      okfScopes: ['okf:t:r-a:read'],
      okfIsSuperAdmin: false
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN_SCOPE');
    expect(next).not.toHaveBeenCalled();
  });

  test('a repo-scoped admin is NOT superadmin for the composer', async () => {
    const { res, next } = await call(evalCtxController.requireSuperadmin, {
      okfScopes: ['okf:t:r-a:admin'],
      okfIsSuperAdmin: false
    });
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('the wildcard admin scope IS superadmin for the composer', async () => {
    const { res, next } = await call(evalCtxController.requireSuperadmin, {
      okfScopes: ['okf:*:*:admin'],
      okfIsSuperAdmin: false
    });
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  test("the composer's routes carry the gate — and the LITERAL routes come before /:id", () => {
    // The ORDER is the contract: `/eval-contexts/groups` parsed by
    // `/eval-contexts/:id` would answer "context not found" for the
    // deployment\'s group list, and the composer would show nothing.
    const router = require('../routes/okf-routes');
    const layers = router.stack
      .filter((l) => l.route)
      .map((l) => ({
        path: l.route.path,
        methods: l.route.methods,
        handlers: l.route.stack.map((h) => h.name)
      }));
    const groups = layers.find((l) => l.path === '/eval-contexts/groups');
    const preview = layers.find((l) => l.path === '/eval-contexts/preview');
    const byId = layers.find((l) => l.path === '/eval-contexts/:id');
    expect(groups).toBeTruthy();
    expect(preview).toBeTruthy();
    expect(groups.handlers).toContain('requireSuperadmin');
    expect(preview.handlers).toContain('requireSuperadmin');
    expect(layers.indexOf(groups)).toBeLessThan(layers.indexOf(byId));
    expect(layers.indexOf(preview)).toBeLessThan(layers.indexOf(byId));
  });

  // The handlers are thin pass-throughs whose only own behavior is the
  // catch → next(err) handoff: a failing read must reach the error
  // middleware (the envelope), never crash the request mid-air.
  test('a failing service call is handed to the error middleware, not swallowed', async () => {
    const boom = Object.assign(new Error('the realm is unreachable'), { code: 'REALM_UNREACHABLE' });
    const spies = {
      listGroups: jest.spyOn(evalCtx, 'listGroups').mockRejectedValue(boom),
      previewContext: jest.spyOn(evalCtx, 'previewContext').mockRejectedValue(boom),
      refreshContext: jest.spyOn(evalCtx, 'refreshContext').mockRejectedValue(boom),
      getContext: jest.spyOn(evalCtx, 'getContext').mockRejectedValue(boom)
    };
    try {
      const base = { okfScopes: [], okfIsSuperAdmin: true };
      const groups = await call(evalCtxController.listGroups, { ...base, query: { q: '' } });
      expect(groups.next).toHaveBeenCalledWith(boom);

      const preview = await call(evalCtxController.previewContext, { ...base, body: {} });
      expect(preview.next).toHaveBeenCalledWith(boom);

      const refreshed = await call(evalCtxController.refreshContext, { ...base, params: { id: 'ec-1' } });
      expect(refreshed.next).toHaveBeenCalledWith(boom);

      const one = await call(evalCtxController.getContext, { ...base, params: { id: 'ec-1' } });
      expect(one.next).toHaveBeenCalledWith(boom);

      // The guards degrade, not crash: a request with NO query object and
      // NO body still reaches the service with '' and {}.
      spies.listGroups.mockRejectedValueOnce(boom);
      const noQuery = await call(evalCtxController.listGroups, { ...base });
      expect(noQuery.next).toHaveBeenCalledWith(boom);
      const noBody = await call(evalCtxController.previewContext, { ...base });
      expect(noBody.next).toHaveBeenCalledWith(boom);
    } finally {
      Object.values(spies).forEach((s) => s.mockRestore());
    }
  });
});
