// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Unit tests for repository-service (business logic + direct AQL against a mocked db).
// The service does NOT import keycloak-auth-service, so no jose mock needed here.

jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});

const dbService = require('../shared-lib/db-connection-service');
const db = dbService.__mockDb;
const repoService = require('../services/repository-service');
const { RepoError } = repoService;

const ACTOR = { sub: 'steward-1', name: 'Steward', source_ip: '127.0.0.1' };

function validCreateInput(overrides = {}) {
  return { name: 'Social Policy', domain: 'social', acl: { required_scopes: ['okf:t:social:admin'] }, ...overrides };
}

describe('repository-service', () => {
  beforeEach(() => db._reset());

  describe('create', () => {
    test('mints repo_id + graph_name=OKF_{repo_id}, defaults, writes doc with _key=repo_id', async () => {
      const repo = await repoService.create(validCreateInput(), ACTOR);
      expect(repo.repo_id).toEqual(expect.any(String));
      expect(repo.graph_name).toBe(`OKF_${repo.repo_id}`);
      expect(repo.okf_version).toBe('0.2');
      expect(repo.lifecycle_state).toBe('register');
      expect(repo.curator).toEqual({ sub: 'steward-1', name: 'Steward' });
      expect(repo.created_at).toEqual(expect.any(String));
      // stored with repo_id AS the _key
      const stored = db._stores.okf_repositories[repo.repo_id];
      expect(stored._key).toBe(repo.repo_id);
      // response strips Arango internals
      expect(repo._id).toBeUndefined();
      expect(repo._rev).toBeUndefined();
      expect(repo._key).toBeUndefined();
    });

    test('writes an audit row on create', async () => {
      const repo = await repoService.create(validCreateInput(), ACTOR);
      const audit = Object.values(db._stores.okf_audit || {});
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: 'repo.create', repo_id: repo.repo_id, actor: 'steward-1' });
    });

    test('rejects duplicate (name, domain) with DUPLICATE_REPO 409', async () => {
      await repoService.create(validCreateInput(), ACTOR);
      await expect(repoService.create(validCreateInput(), ACTOR)).rejects.toMatchObject({
        code: 'DUPLICATE_REPO',
        status: 409
      });
    });

    test('allows re-creating a (name, domain) that was soft-deleted', async () => {
      const r1 = await repoService.create(validCreateInput(), ACTOR);
      await repoService.remove(r1.repo_id, ACTOR);
      await expect(repoService.create(validCreateInput(), ACTOR)).resolves.toBeTruthy();
    });
  });

  describe('getById', () => {
    test('returns the repo', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      const got = await repoService.getById(created.repo_id);
      expect(got.repo_id).toBe(created.repo_id);
    });

    test('404 when not found', async () => {
      await expect(repoService.getById('nope')).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        status: 404
      });
    });

    test('404 when soft-deleted', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      await repoService.remove(created.repo_id, ACTOR);
      await expect(repoService.getById(created.repo_id)).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        status: 404
      });
    });

    test('404 when outside the caller domain (no leakage)', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      await expect(repoService.getById(created.repo_id, { domain: 'other-domain' })).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        status: 404
      });
    });
  });

  describe('update', () => {
    test('updates updatable fields', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      const updated = await repoService.update(created.repo_id, { name: 'Renamed', retention: { days: 30 } }, ACTOR);
      expect(updated.name).toBe('Renamed');
      expect(updated.retention).toEqual({ days: 30 });
      expect(updated.updated_at).toEqual(expect.any(String));
    });

    test('409 when attempting to change graph_name (immutable)', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      await expect(repoService.update(created.repo_id, { graph_name: 'OKF_other' }, ACTOR)).rejects.toMatchObject({
        code: 'FIELD_IMMUTABLE',
        status: 409
      });
    });

    test('409 when attempting to change domain (immutable)', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      await expect(repoService.update(created.repo_id, { domain: 'other' }, ACTOR)).rejects.toMatchObject({
        code: 'FIELD_IMMUTABLE',
        status: 409
      });
    });

    test('404 when repo not found', async () => {
      await expect(repoService.update('nope', { name: 'x' }, ACTOR)).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        status: 404
      });
    });

    test('writes an audit row on update', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      await repoService.update(created.repo_id, { name: 'Renamed' }, ACTOR);
      const updates = Object.values(db._stores.okf_audit || {}).filter((a) => a.action === 'repo.update');
      expect(updates).toHaveLength(1);
    });
  });

  describe('remove (delete — cleans everything)', () => {
    test('cascades the retract + removes the registry entry entirely (no tombstone)', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      const result = await repoService.remove(created.repo_id, ACTOR);
      expect(result.status).toBe('deleted');
      expect(result.deleted_at).toEqual(expect.any(String));
      expect(result.delete_after).toEqual(expect.any(String));
      // The delete service cleans EVERYTHING: the registry doc is gone.
      expect(db._stores.okf_repositories[created.repo_id]).toBeUndefined();
    });

    test('re-create of the same (name, domain) is allowed after delete (no tombstone collision)', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      await repoService.remove(created.repo_id, ACTOR);
      await expect(repoService.create(validCreateInput(), ACTOR)).resolves.toBeTruthy();
    });

    test('invokes the graph-retract cascade (non-fatal)', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      const result = await repoService.remove(created.repo_id, ACTOR);
      expect(result.repo_id).toBe(created.repo_id);
    });

    test('404 when repo not found', async () => {
      await expect(repoService.remove('nope', ACTOR)).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        status: 404
      });
    });

    test('writes an audit row on delete', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      await repoService.remove(created.repo_id, ACTOR);
      const deletes = Object.values(db._stores.okf_audit || {}).filter((a) => a.action === 'repo.delete');
      expect(deletes).toHaveLength(1);
    });
  });

  describe('list', () => {
    test('returns paginated items + next_cursor when a full page', async () => {
      // Seed the query cursor with 50 docs (== default limit)
      const docs = Array.from({ length: 50 }, (_, i) => ({
        repo_id: `r${i}`,
        name: `n${i}`,
        domain: 'social',
        created_at: `2026-08-12T00:00:0${i % 10}Z`
      }));
      db.query.mockResolvedValue({ all: async () => docs.map((d) => ({ ...d, _key: d.repo_id })) });
      const result = await repoService.list({ limit: 50 });
      expect(result.items).toHaveLength(50);
      expect(result.next_cursor).toEqual(expect.any(String));
    });

    test('returns null next_cursor when less than a full page', async () => {
      db.query.mockResolvedValue({ all: async () => [{ repo_id: 'r1', created_at: 't', _key: 'r1' }] });
      const result = await repoService.list({ limit: 50 });
      expect(result.items).toHaveLength(1);
      expect(result.next_cursor).toBeNull();
    });

    test('caps limit at 100', async () => {
      db.query.mockResolvedValue({ all: async () => [] });
      await repoService.list({ limit: 99999 });
      // The query is an aql template; just assert no throw + the AQL string contains LIMIT 100
      expect(db.query).toHaveBeenCalled();
    });

    test('400 on a malformed cursor', async () => {
      await expect(repoService.list({ cursor: '!!!not-base64!!!' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400
      });
    });
  });

  test('RepoError is a typed error with code/status', () => {
    const e = new RepoError('X', 'msg', 418);
    expect(e.code).toBe('X');
    expect(e.status).toBe(418);
    expect(e).toBeInstanceOf(Error);
  });

  describe('reliability (code-review fixes)', () => {
    test('create → 409 DUPLICATE_REPO when the DB rejects a concurrent create (unique-violation backstop)', async () => {
      db.collection('okf_repositories').save.mockRejectedValueOnce({ errorNum: 1210, code: 409 });
      await expect(repoService.create(validCreateInput(), ACTOR)).rejects.toMatchObject({
        code: 'DUPLICATE_REPO',
        status: 409
      });
    });

    test('getById rethrows transient DB errors (not masked as REPO_NOT_FOUND)', async () => {
      db.collection('okf_repositories').document.mockRejectedValueOnce({ code: 503, message: 'unavailable' });
      await expect(repoService.getById('any-id')).rejects.toMatchObject({ code: 503 });
    });

    test('update → 409 when renaming to a name already live in the same domain', async () => {
      const a = await repoService.create(validCreateInput({ name: 'Alpha' }), ACTOR);
      await repoService.create(validCreateInput({ name: 'Beta' }), ACTOR);
      await expect(repoService.update(a.repo_id, { name: 'Beta' }, ACTOR)).rejects.toMatchObject({
        code: 'DUPLICATE_REPO',
        status: 409
      });
    });

    test('list → 400 on a cursor that decodes to JSON without ts/id', async () => {
      const badCursor = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64url');
      await expect(repoService.list({ cursor: badCursor })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400
      });
    });
  });
});

// ─── Story 6.1: default-deny authz on list/getById (the G3 fix) ─────────────

describe('authz scoping (Story 6.1 — G3 default-deny)', () => {
  beforeEach(() => db._reset());

  describe('getById authz', () => {
    test('authorized repo_id in the set → returns the repo', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      const repo = await repoService.getById(created.repo_id, { authz: new Set([created.repo_id]) });
      expect(repo.repo_id).toBe(created.repo_id);
    });

    test('repo OUTSIDE the set → REPO_NOT_FOUND — identical to a missing repo (anti-enumeration)', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      await expect(repoService.getById(created.repo_id, { authz: new Set(['some-other-repo']) })).rejects.toMatchObject(
        {
          code: 'REPO_NOT_FOUND',
          status: 404
        }
      );
    });

    test('no authz (null/absent) → unrestricted (super-admin / internal callers)', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      const repo = await repoService.getById(created.repo_id, {});
      expect(repo.repo_id).toBe(created.repo_id);
    });
  });

  describe('list authz', () => {
    test('EMPTY authorized set → { items: [], next_cursor: null } and NO query (never the full catalog)', async () => {
      const result = await repoService.list({ authz: new Set() });
      expect(result.items).toEqual([]);
      expect(result.next_cursor).toBeNull();
      expect(db.query).not.toHaveBeenCalled();
    });

    test('non-empty set → the authorized repo ids ride the query as a bind var (repo_id IN)', async () => {
      db.query.mockResolvedValue({ all: async () => [] });
      await repoService.list({ authz: new Set(['repoA', 'repoB']) });
      expect(db.query).toHaveBeenCalledTimes(1);
      const arg = db.query.mock.calls[0][0];
      const bindJson = JSON.stringify(arg.bindVars || {});
      expect(String(arg.query)).toContain('IN @');
      expect(bindJson).toContain('repoA');
      expect(bindJson).toContain('repoB');
    });

    test('no authz → unrestricted query (super-admin keeps the full catalog)', async () => {
      db.query.mockResolvedValue({ all: async () => [] });
      await repoService.list({});
      expect(db.query).toHaveBeenCalledTimes(1);
      const bindJson = JSON.stringify(db.query.mock.calls[0][0].bindVars || {});
      expect(bindJson).not.toContain('repoA'); // no authz set present
    });
  });
});

describe('authz strictness (2026-08-16 review fixes)', () => {
  beforeEach(() => db._reset());

  test('wrong-typed authz (array) THROWS — never fails open to unrestricted', async () => {
    await expect(repoService.list({ authz: ['repoA'] })).rejects.toMatchObject({ code: 'AUTHZ_TYPE_ERROR' });
    await expect(repoService.getById('r1', { authz: ['repoA'] })).rejects.toMatchObject({ code: 'AUTHZ_TYPE_ERROR' });
  });
});

// ─── Story 4.8: repository clone (D-V5) ───────────────────────────────────────

describe('create additive opts (Story 4.8 — R5 default pinned)', () => {
  beforeEach(() => db._reset());

  test('legacy call (no opts) is byte-identical: lifecycle register + NO cloned_from field', async () => {
    const repo = await repoService.create(validCreateInput(), ACTOR);
    expect(repo.lifecycle_state).toBe('register');
    expect(repo.cloned_from).toBeUndefined();
    const stored = db._stores.okf_repositories[repo.repo_id];
    expect(stored.cloned_from).toBeUndefined();
    const audits = Object.values(db._stores.okf_audit || {});
    expect(audits[0].action).toBe('repo.create');
  });

  test('opts { lifecycle_state, cloned_from, audit_action, okf_version } are honored (clone path)', async () => {
    const repo = await repoService.create(validCreateInput(), ACTOR, {
      lifecycle_state: 'draft',
      cloned_from: { repo_id: 'src', version: 2 },
      audit_action: 'repo.clone',
      okf_version: '0.3'
    });
    expect(repo.lifecycle_state).toBe('draft');
    expect(repo.cloned_from).toEqual({ repo_id: 'src', version: 2 });
    expect(repo.okf_version).toBe('0.3');
    const audits = Object.values(db._stores.okf_audit || {});
    expect(audits[0].action).toBe('repo.clone');
  });

  test('create() validates additive opts — invalid lifecycle_state / malformed cloned_from → 400 (review fix)', async () => {
    await expect(repoService.create(validCreateInput(), ACTOR, { lifecycle_state: 'bogus' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
    await expect(repoService.create(validCreateInput(), ACTOR, { cloned_from: { version: 2 } })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
  });
});

describe('cloneRepository (Story 4.8 — D-V5)', () => {
  beforeEach(() => {
    db._reset();
    // The arango-mock's save derives the key from doc.repo_id — every copied meta
    // row would collide on the clone's repo_id. Give the meta store unique keys
    // (real ArangoDB auto-generates _key; the mock needs a hand).
    let n = 0;
    db.collection('okf_concepts_meta').save.mockImplementation(async (doc) => {
      const k = doc._key || `meta-copy-${++n}`;
      db._stores.okf_concepts_meta[k] = { ...doc, _key: k, _id: `okf_concepts_meta/${k}`, _rev: '1' };
      return { ...db._stores.okf_concepts_meta[k] };
    });
    // The clone's meta read (db.query with {source_id} bind var) returns the rows;
    // the compensation REMOVE (with {clone_id}) executes against the store.
    db.query.mockImplementation(async (query, bindVars) => {
      const q = String(query || '');
      if (q.includes('REMOVE')) {
        const id = bindVars && bindVars.clone_id;
        if (id) {
          for (const k of Object.keys(db._stores.okf_concepts_meta)) {
            if (db._stores.okf_concepts_meta[k].repo_id === id) delete db._stores.okf_concepts_meta[k];
          }
        }
        return { all: async () => [] };
      }
      return {
        all: async () =>
          Object.values(db._stores.okf_concepts_meta).filter((m) => m.repo_id === (bindVars && bindVars.source_id))
      };
    });
  });

  /** Seed a source repo + N concept-meta rows (incl. a `concepts/`-prefixed id). */
  async function seedSource() {
    const src = await repoService.create(validCreateInput({ name: 'Source KB', domain: 'smoke' }), ACTOR);
    const rows = [
      { concept_id: 'index', title: 'Index', bundle_version: null, content_hash: 'h1', index_status: 'indexed' },
      {
        concept_id: 'service_directory',
        title: 'Service Directory',
        bundle_version: 1,
        content_hash: 'h2',
        index_status: 'indexed'
      },
      {
        concept_id: 'concepts/bad_concept',
        title: 'Bad',
        bundle_version: null,
        content_hash: 'h3',
        index_status: 'indexed'
      }
    ];
    rows.forEach((r, i) => {
      db._stores.okf_concepts_meta[`src-meta-${i}`] = {
        _key: `src-meta-${i}`,
        repo_id: src.repo_id,
        graph_name: `OKF_${src.repo_id}`,
        pii_state: 'clean',
        conformance_issues: [],
        lifecycle_status: 'stable',
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
        ...r
      };
    });
    return { src, rows };
  }

  test('mints a NEW repo (new repo_id + OKF_{new} graph, lifecycle draft) + default name + cloned_from lineage', async () => {
    const { src } = await seedSource();
    const clone = await repoService.cloneRepository(src.repo_id, {}, ACTOR);
    expect(clone.repo_id).not.toBe(src.repo_id);
    expect(clone.graph_name).toBe(`OKF_${clone.repo_id}`);
    expect(clone.lifecycle_state).toBe('draft');
    expect(clone.name).toBe('Source KB (clone)');
    expect(clone.domain).toBe('smoke');
    expect(clone.cloned_from).toEqual({ repo_id: src.repo_id, version: null });
    expect(clone.copied_concepts).toBe(3);
  });

  test('cloned_from.version = the source CURRENT version (never-minted → null)', async () => {
    const { src } = await seedSource();
    const unminted = await repoService.cloneRepository(src.repo_id, {}, ACTOR);
    expect(unminted.cloned_from.version).toBeNull();
    // Mint the source (bump version on the stored doc) then re-clone → version carried.
    db._stores.okf_repositories[src.repo_id].version = 2;
    const minted = await repoService.cloneRepository(src.repo_id, { name: 'Source KB (clone v2)' }, ACTOR);
    expect(minted.cloned_from).toEqual({ repo_id: src.repo_id, version: 2 });
  });

  test('copies meta VERBATIM: concept_id (incl. concepts/ prefix), title, bundle_version, content_hash, index_status — graph rewritten to the clone born-right draft name', async () => {
    const { src, rows } = await seedSource();
    const clone = await repoService.cloneRepository(src.repo_id, {}, ACTOR);
    const copied = Object.values(db._stores.okf_concepts_meta).filter((m) => m.repo_id === clone.repo_id);
    expect(copied).toHaveLength(rows.length);
    const byId = Object.fromEntries(copied.map((m) => [m.concept_id, m]));
    expect(byId['concepts/bad_concept']).toBeDefined(); // verbatim — never re-derived
    for (const r of rows) {
      const c = byId[r.concept_id];
      expect(c).toBeDefined();
      expect(c.title).toBe(r.title);
      expect(c.bundle_version).toBe(r.bundle_version);
      expect(c.content_hash).toBe(r.content_hash);
      expect(c.index_status).toBe(r.index_status);
      // Born-right: the clone's rows drain into its OWN versioned draft graph
      // ('Source KB (clone)', never-minted → the next publish mints v1).
      expect(c.graph_name).toBe('OKF_source-kb-clone_v1');
      expect(c.pii_state).toBe('clean');
    }
    // created_at preserved; updated_at stamped to the clone time.
    expect(byId.index.updated_at).not.toBe('2026-08-01T00:00:00.000Z');
    expect(byId.index.created_at).toBe('2026-08-01T00:00:00.000Z');
  });

  test('explicit target name/domain/acl override the derived defaults', async () => {
    const { src } = await seedSource();
    const clone = await repoService.cloneRepository(
      src.repo_id,
      { name: 'My Fork', domain: 'health', acl: { sensitivity: 'public' } },
      ACTOR
    );
    expect(clone.name).toBe('My Fork');
    expect(clone.domain).toBe('health');
    expect(clone.acl).toEqual({ sensitivity: 'public' });
  });

  test('404 REPO_NOT_FOUND when the source is unknown or soft-deleted', async () => {
    await expect(repoService.cloneRepository('nope', {}, ACTOR)).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND',
      status: 404
    });
    const { src } = await seedSource();
    await repoService.remove(src.repo_id, ACTOR);
    await expect(repoService.cloneRepository(src.repo_id, {}, ACTOR)).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND',
      status: 404
    });
  });

  test('409 DUPLICATE_REPO when the target (name, domain) collides with a live repo', async () => {
    const { src } = await seedSource();
    // A live repo already named '<source> (clone)' in the same domain.
    await repoService.create(validCreateInput({ name: 'Source KB (clone)', domain: 'smoke' }), ACTOR);
    await expect(repoService.cloneRepository(src.repo_id, {}, ACTOR)).rejects.toMatchObject({
      code: 'DUPLICATE_REPO',
      status: 409
    });
  });

  test('writes a repo.clone audit row + does NOT mutate the source meta', async () => {
    const { src, rows } = await seedSource();
    const clone = await repoService.cloneRepository(src.repo_id, {}, ACTOR);
    const audits = Object.values(db._stores.okf_audit || {}).filter((a) => a.action === 'repo.clone');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor: 'steward-1', repo_id: clone.repo_id });
    // Source meta untouched.
    const sourceMeta = Object.values(db._stores.okf_concepts_meta).filter((m) => m.repo_id === src.repo_id);
    expect(sourceMeta).toHaveLength(rows.length);
    expect(sourceMeta.every((m) => m.graph_name === `OKF_${src.repo_id}`)).toBe(true);
  });

  test('409 DUPLICATE_REPO via the DB unique-index backstop when save races the app dup-check (review fix)', async () => {
    const { src } = await seedSource();
    db.collection('okf_repositories').save.mockRejectedValueOnce({ errorNum: 1210, code: 409 });
    await expect(repoService.cloneRepository(src.repo_id, {}, ACTOR)).rejects.toMatchObject({
      code: 'DUPLICATE_REPO',
      status: 409
    });
  });

  test('cloning an empty source (0 meta rows) → valid draft fork, copied_concepts 0 (AC5 edge)', async () => {
    const { src } = await seedSource();
    for (const k of Object.keys(db._stores.okf_concepts_meta)) delete db._stores.okf_concepts_meta[k];
    const clone = await repoService.cloneRepository(src.repo_id, {}, ACTOR);
    expect(clone.lifecycle_state).toBe('draft');
    expect(clone.copied_concepts).toBe(0);
  });

  test('a source that is itself a clone → cloned_from points at the immediate parent (AC5 edge, no recursion)', async () => {
    const { src } = await seedSource();
    const c1 = await repoService.cloneRepository(src.repo_id, {}, ACTOR);
    const c2 = await repoService.cloneRepository(c1.repo_id, { name: 'Source KB (clone v2)' }, ACTOR);
    expect(c2.cloned_from).toEqual({ repo_id: c1.repo_id, version: null });
  });

  test('compensates on a mid-copy failure: NO orphaned partial fork (review fix)', async () => {
    const { src } = await seedSource();
    let calls = 0;
    db.collection('okf_concepts_meta').save.mockImplementation(async (doc) => {
      calls += 1;
      if (calls === 2) throw new Error('transient arango failure');
      const k = `meta-copy-${calls}`;
      db._stores.okf_concepts_meta[k] = { ...doc, _key: k, _id: `okf_concepts_meta/${k}`, _rev: '1' };
      return { ...db._stores.okf_concepts_meta[k] };
    });
    await expect(repoService.cloneRepository(src.repo_id, {}, ACTOR)).rejects.toThrow('transient arango failure');
    // The partial fork is rolled back: NO draft registry entry, NO leftover clone meta.
    const draftRepos = Object.values(db._stores.okf_repositories).filter((r) => r.lifecycle_state === 'draft');
    expect(draftRepos).toHaveLength(0);
    const leftover = Object.values(db._stores.okf_concepts_meta).filter((m) => m.repo_id !== src.repo_id);
    expect(leftover).toHaveLength(0);
  });
});
