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
  // The real service resolves a principal reference by NAME first (the
  // reference may also be a uuid-shaped group id).
  findGroupByName: jest.fn(async (name) => {
    const known = {
      'g-a': 'g-a',
      'g-b': 'g-b',
      'g-fence-a': 'g-fence-a',
      'g-fence-b': 'g-fence-b',
      'g-wild': 'g-wild',
      'g-admin': 'g-admin',
      'g-none': 'g-none',
      'g-broken': 'g-broken'
    };
    return known[name] ? { id: known[name], name } : null;
  }),
  groupRealmRoles: jest.fn(async (groupId) => {
    // A Keycloak that cannot answer for a group it knows.
    if (groupId === 'g-broken') throw new Error('keycloak unreachable');
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

describe('#2061 E-1: a principal that CANNOT be read is refused, never widened', () => {
  beforeEach(() => {
    mockDb._reset();
    retrievalConfigService._resetServingCache();
    keycloakAccess.groupRealmRoles.mockClear();
    keycloakAccess.findGroupByName.mockClear();
    writeAudit.mockClear();
    delete process.env.OKF_SCOPE_MODE;
  });

  test('a group Keycloak cannot answer for REFUSES the context (422)', async () => {
    // The failure mode this closes: an unreadable principal resolved to an
    // EMPTY scope list, which in the default OPEN mode resolves to the WHOLE
    // public corpus — so a context that could not be measured the group
    // measured the deployment, silently, and the run was scored as if it had
    // measured the group.
    seedServing([servingRow({ repo_id: 'r-public' })]);
    await expect(
      evalCtx.createContext({ name: 'analysts', principal_refs: ['g-broken'] }, { actor: { user_id: 'admin-1' } })
    ).rejects.toThrow(/could not be read/i);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  test('a group that does not exist REFUSES the context (never the open corpus)', async () => {
    seedServing([servingRow({ repo_id: 'r-public' })]);
    await expect(
      evalCtx.createContext({ name: 'analysts', principal_refs: ['g-nope'] }, { actor: { user_id: 'admin-1' } })
    ).rejects.toThrow(/could not be read/i);
  });

  test('a refresh whose principal became unreadable FAILS and the snapshot stands', async () => {
    seedServing([servingRow({ repo_id: 'r-fence-a', acl: { restricted: true } })]);
    const created = await evalCtx.createContext(
      { name: 'analysts', principal_refs: ['g-fence-a'] },
      { actor: { user_id: 'admin-1' } }
    );
    keycloakAccess.groupRealmRoles.mockImplementationOnce(async () => {
      throw new Error('keycloak unreachable');
    });
    await expect(evalCtx.refreshContext(created._key, { actor: { user_id: 'admin-1' } })).rejects.toThrow(
      /could not be read/i
    );
    // The stored context still says what it resolved, at its own version.
    const stored = await evalCtx.getContext(created._key);
    expect(stored.version).toBe(1);
    expect(stored.resolved.graph_names).toEqual(['OKF_fence-a_v1']);
  });

  test('a group that resolves but carries NO scope says so out loud', async () => {
    // The truth here is the PUBLIC set (in open mode), which is a real
    // answer — but not the one an operator naming a "restricted" group
    // expects, so it is stated on the wire.
    seedServing([servingRow({ repo_id: 'r-public' })]);
    const ctx = await evalCtx.createContext(
      { name: 'analysts', principal_refs: ['g-none'] },
      { actor: { user_id: 'admin-1' } }
    );
    expect(ctx.warnings.join(' ')).toMatch(/no okf scope/i);
  });

  test('a scope string that is not a scope is REPORTED (the authority still ignores it)', async () => {
    seedServing([servingRow({ repo_id: 'r-a' })]);
    const ctx = await evalCtx.createContext(
      { name: 'analysts', scopes: ['okf:t:r-a:read', 'not-a-scope'] },
      { actor: { user_id: 'admin-1' } }
    );
    // The resolution is the authority's answer for the same list: the typo
    // grants nothing.
    expect(ctx.resolved.scopes).toEqual(['okf:t:r-a:read']);
    expect(ctx.warnings.join(' ')).toMatch(/not valid okf scope/i);
  });

  test('a filter the resolution does not apply is reported ON THE WIRE', async () => {
    seedServing([servingRow({ repo_id: 'r-a' })]);
    const ctx = await evalCtx.createContext(
      { name: 'analysts', scopes: ['okf:t:r-a:read'], filters: [{ field: 'domain', equals: 'x' }] },
      { actor: { user_id: 'admin-1' } }
    );
    expect(ctx.warnings.join(' ')).toMatch(/filter/i);
  });
});

describe('#2061 E-1/E-2: the carrier is narrowed to what the CALLER may traverse', () => {
  beforeEach(() => {
    mockDb._reset();
    retrievalConfigService._resetServingCache();
    writeAudit.mockClear();
    delete process.env.OKF_SCOPE_MODE;
  });

  test('a caller may not measure a repository it may not traverse', async () => {
    // The catalogue is superadmin-gated, but the CARRIER is read on the run
    // routes, which are repo-scoped-admin. Without this, naming a context
    // id was a way to have a restricted repository measured and persisted
    // into a record the caller can read.
    seedServing([servingRow({ repo_id: 'r-public' }), servingRow({ repo_id: 'r-fence-a', acl: { restricted: true } })]);
    const ctx = await evalCtx.createContext(
      { name: 'analysts', principal_refs: ['g-fence-a'] },
      { actor: { user_id: 'admin-1' } }
    );
    // A superadmin's carrier stands.
    const asAdmin = await evalCtx.carrierFor(ctx._key, { okfScopes: [], isSuperAdmin: true });
    expect(asAdmin.repo_ids).toEqual(expect.arrayContaining(['r-fence-a']));
    // A caller with no scope traverses the public set only — the fenced
    // repository is NOT in its carrier.
    const asReader = await evalCtx.carrierFor(ctx._key, { okfScopes: [], isSuperAdmin: false });
    expect(asReader.repo_ids).not.toContain('r-fence-a');
    expect(asReader.repo_ids).toContain('r-public');
  });

  test('a caller that may traverse nothing the context names is REFUSED (403)', async () => {
    seedServing([servingRow({ repo_id: 'r-fence-a', acl: { restricted: true } })]);
    const ctx = await evalCtx.createContext(
      { name: 'analysts', principal_refs: ['g-fence-a'] },
      { actor: { user_id: 'admin-1' } }
    );
    await expect(
      evalCtx.carrierFor(ctx._key, { okfScopes: ['okf:t:r-other:read'], isSuperAdmin: false })
    ).rejects.toThrow(/may traverse/i);
  });

  test('a WILDCARD-scope holder keeps the whole carrier (they are already unrestricted)', async () => {
    // The operator decision names BOTH privileged populations: the
    // `tools-admin` realm role and a wildcard `okf:*:*:admin` scope. A
    // wildcard scope is ALREADY unrestricted in deriveScopeAuthz, so the
    // narrowing is a no-op for them — the feature does not shrink.
    seedServing([
      servingRow({ repo_id: 'r-public', name: 'public' }),
      servingRow({ repo_id: 'r-fence-a', name: 'fencea', acl: { restricted: true } })
    ]);
    const ctx = await evalCtx.createContext(
      { name: 'analysts', principal_refs: ['g-fence-a'] },
      { actor: { user_id: 'admin-1' } }
    );
    const asWildcard = await evalCtx.carrierFor(ctx._key, {
      okfScopes: ['okf:*:*:admin'],
      isSuperAdmin: false
    });
    expect(asWildcard.repo_ids).toEqual(expect.arrayContaining(['r-fence-a']));
  });

  test('the carrier carries the MEASURED set hash beside the context hash', async () => {
    // The context hash is over its FULL frozen set; the measured hash is
    // over the repositories this caller may actually measure. After a
    // narrowing they are different populations, and the record must say
    // which is which.
    seedServing([
      servingRow({ repo_id: 'r-public', name: 'public' }),
      servingRow({ repo_id: 'r-fence-a', name: 'fencea', acl: { restricted: true } })
    ]);
    const ctx = await evalCtx.createContext(
      { name: 'analysts', principal_refs: ['g-fence-a'] },
      { actor: { user_id: 'admin-1' } }
    );
    const asAdmin = await evalCtx.carrierFor(ctx._key, { okfScopes: [], isSuperAdmin: true });
    const asReader = await evalCtx.carrierFor(ctx._key, { okfScopes: [], isSuperAdmin: false });
    expect(asAdmin.measured_hash).toEqual(expect.any(String));
    expect(asReader.measured_hash).toEqual(expect.any(String));
    // The two carriers measured different sets, so their measured hashes differ.
    expect(asAdmin.measured_hash).not.toBe(asReader.measured_hash);
    // The context's own hash is the SAME in both — it identifies the version.
    expect(asAdmin.context.hash).toBe(asReader.context.hash);
  });
});

describe('#2061 E-1/E-2: a STALE carrier is refused (the frozen graph name is gone)', () => {
  beforeEach(() => {
    mockDb._reset();
    retrievalConfigService._resetServingCache();
    writeAudit.mockClear();
    delete process.env.OKF_SCOPE_MODE;
  });

  test('a repository re-published after the freeze REFUSES the carrier (409)', async () => {
    // The snapshot froze the serving graph NAME. A re-publish renames the
    // serving graph (OKF_alpha_v1 -> OKF_alpha_v2), so the frozen name names
    // a corpus that no longer exists — the retriever answers a missing graph
    // with nothing, and a PARTLY stale carrier is the fail-open case.
    seedServing([servingRow({ repo_id: 'r-a', name: 'alpha', version: 1 })]);
    const ctx = await evalCtx.createContext(
      { name: 'analysts', principal_refs: [] },
      { actor: { user_id: 'admin-1' } }
    );
    expect(ctx.resolved.graph_names).toEqual(['OKF_alpha_v1']);

    seedServing([servingRow({ repo_id: 'r-a', name: 'alpha', version: 2 })]);
    let error = null;
    try {
      await evalCtx.carrierFor(ctx._key, { okfScopes: [], isSuperAdmin: true });
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error.code).toBe('EVAL_CONTEXT_STALE');
    expect(error.status).toBe(409);
    // The message names BOTH names and the remedy.
    expect(error.message).toContain('OKF_alpha_v1');
    expect(error.message).toContain('OKF_alpha_v2');
    expect(error.message).toMatch(/refresh/i);
  });

  test('a repository that no longer serves at all is stale too', async () => {
    seedServing([servingRow({ repo_id: 'r-a', name: 'alpha', version: 1 })]);
    const ctx = await evalCtx.createContext(
      { name: 'analysts', principal_refs: [] },
      { actor: { user_id: 'admin-1' } }
    );
    seedServing([]); // the repo was retracted
    await expect(evalCtx.carrierFor(ctx._key, { okfScopes: [], isSuperAdmin: true })).rejects.toThrow(
      /no longer current/i
    );
  });

  test('a carrier whose frozen names are still live is NOT refused', async () => {
    seedServing([servingRow({ repo_id: 'r-a', name: 'alpha', version: 1 })]);
    const ctx = await evalCtx.createContext(
      { name: 'analysts', principal_refs: [] },
      { actor: { user_id: 'admin-1' } }
    );
    seedServing([servingRow({ repo_id: 'r-a', name: 'alpha', version: 1 })]);
    const carrier = await evalCtx.carrierFor(ctx._key, { okfScopes: [], isSuperAdmin: true });
    expect(carrier.repo_ids).toEqual(['r-a']);
  });
});
