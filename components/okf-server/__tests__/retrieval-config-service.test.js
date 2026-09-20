// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 1.7 (ADR-okf-039 D1-D3) — retrieval mode governance pins:
// env-defaults → DB overlay, engagement gate (D2), serving-graph resolution
// through the workingGraphName authority, PUT validation + revision bump +
// before→after audit.

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
const auditService = require('../services/audit-service');
const svc = require('../services/retrieval-config-service');
const validator = require('../validators/retrieval-config-validator');

function repoRow(overrides) {
  return Object.assign(
    {
      repo_id: 'r-kenya',
      name: 'Kenya Gov',
      domain: 'government',
      version: 3,
      lifecycle_state: 'publish',
      ingested_at: '2026-09-20T00:00:00Z',
      deleted_at: null
    },
    overrides || {}
  );
}

function seedServing(rows) {
  mockDb.query.mockResolvedValueOnce({ all: async () => rows });
}

describe('retrieval-config-service (Story 1.7, ADR-okf-039)', () => {
  beforeEach(() => {
    mockDb._reset();
    svc._resetServingCache(); // the serving-set memo is shared with the authz resolver
    auditService.writeAudit.mockClear();
  });

  describe('getEffectiveConfig', () => {
    test('no governed row → sanitized env defaults, source env-defaults', async () => {
      const { config, source } = await svc.getEffectiveConfig();
      expect(source).toBe('env-defaults');
      expect(config.mode).toBe('legacy'); // the safe boot default
      expect(config.revision).toBe(0);
      expect(config.max_fanout_graphs).toBeGreaterThanOrEqual(1);
    });

    test('stored doc overrides field-by-field; missing fields fall back to env', async () => {
      mockDb.collection('okf_system_config').save({ _key: 'retrieval', mode: 'hybrid' });
      const { config, source } = await svc.getEffectiveConfig();
      expect(source).toBe('database');
      expect(config.mode).toBe('hybrid');
      // every other field still resolved (env default), never undefined
      expect(config.max_fanout_graphs).toBeDefined();
      expect(config.candidate_cap_global).toBeDefined();
    });

    test('sanitizeConfigShape: garbage from ANY source degrades to safe defaults', () => {
      // read-path sanitizer (code-review fix): a hand-edited doc or garbled
      // env var can never produce an out-of-band config value.
      const out = validator.sanitizeConfigShape({
        mode: 'turbo', // invalid → 'legacy'
        max_fanout_graphs: 9999, // out of range → default 5
        spine_max_hops: 'x', // non-integer → default 2
        extracted_hop_cap: NaN, // → default 1
        candidate_cap_per_graph: 0, // below min → default 50
        candidate_cap_global: 200 // valid → preserved
      });
      expect(out).toEqual({
        mode: 'legacy',
        max_fanout_graphs: 5,
        spine_max_hops: 2,
        extracted_hop_cap: 1,
        candidate_cap_per_graph: 50,
        candidate_cap_global: 200
      });
    });

    test('sanitizeConfigShape: null/undefined raw → pure defaults; unknown fields dropped', () => {
      expect(validator.sanitizeConfigShape(null)).toEqual(validator.DEFAULTS);
      const out = validator.sanitizeConfigShape({ mode: 'okf_only', hacker_field: true });
      expect(out.mode).toBe('okf_only');
      expect(out.hacker_field).toBeUndefined();
    });

    test('storage failure (non-404) surfaces — no silent env fallback', async () => {
      mockDb.collection('okf_system_config').document.mockRejectedValueOnce(new Error('cluster down'));
      await expect(svc.getEffectiveConfig()).rejects.toThrow('cluster down');
    });
  });

  describe('servingRepos + engagement gate', () => {
    test('only publish+ingested+not-deleted repos, graph names via workingGraphName', async () => {
      seedServing([
        repoRow(),
        repoRow({ repo_id: 'r-health', name: 'Health Services', domain: 'health', version: 1, ingested_version: 1 })
      ]);
      const serving = await svc.servingRepos({ fresh: true });
      expect(serving.map((s) => s.graph_name)).toEqual([
        'OKF_kenya-gov_v3', // serving = the ingested version, NOT v4
        'OKF_health-services_v1'
      ]);
    });

    test('engaged=false in legacy mode even with serving graphs; okf_only+zero serving warns', async () => {
      seedServing([repoRow()]);
      const legacy = await svc.getRetrievalConfig({ okfScopes: [], isSuperAdmin: true });
      expect(legacy.config.mode).toBe('legacy');
      expect(legacy.engaged).toBe(false); // D2: legacy NEVER engages the fan-out
      expect(legacy.serving_graph_count).toBe(1);
      expect(legacy.warnings).toHaveLength(0);

      // flip to okf_only with an EMPTY serving set (fresh read — the memo
      // would otherwise serve the cached 1-row set from the legacy check)
      mockDb._reset();
      svc._resetServingCache();
      mockDb.collection('okf_system_config').save({ _key: 'retrieval', mode: 'okf_only' });
      seedServing([]);
      const okfOnlyEmpty = await svc.getRetrievalConfig({ okfScopes: [], isSuperAdmin: true });
      expect(okfOnlyEmpty.engaged).toBe(false);
      expect(okfOnlyEmpty.warnings).toHaveLength(1); // structured warning, never silent fallback
    });

    test('INVALID mode value never engages (whitelist, not negation)', async () => {
      // a hand-edited/corrupt stored doc with an unknown mode must NOT switch
      // the fan-out on — the read-path sanitizer degrades it to 'legacy'
      mockDb.collection('okf_system_config').save({ _key: 'retrieval', mode: 'turbo' });
      seedServing([repoRow()]);
      const out = await svc.getRetrievalConfig({ okfScopes: [], isSuperAdmin: true });
      expect(out.config.mode).toBe('legacy'); // sanitized
      expect(out.engaged).toBe(false);
    });

    test('engaged=true only when mode≠legacy AND ≥1 serving graph', async () => {
      mockDb.collection('okf_system_config').save({ _key: 'retrieval', mode: 'okf_only' });
      seedServing([repoRow()]);
      const out = await svc.getRetrievalConfig({ okfScopes: [], isSuperAdmin: true });
      expect(out.engaged).toBe(true);
      expect(out.serving_graphs[0]).toMatchObject({ repo_id: 'r-kenya', graph_name: 'OKF_kenya-gov_v3' });
    });

    test('SERVING VIEW IS PER-CALLER (code-review fix): scoped caller sees only their intersection', async () => {
      mockDb.collection('okf_system_config').save({ _key: 'retrieval', mode: 'hybrid' });
      seedServing([repoRow(), repoRow({ repo_id: 'r-health', name: 'Health Services', version: 1 })]);
      // config posture stays global, but a caller scoped to r-health sees only
      // r-health — a zero-scoped tenant sees an EMPTY serving set.
      const scoped = await svc.getRetrievalConfig({ okfScopes: ['okf:itu:r-health:read'], isSuperAdmin: false });
      expect(scoped.config.mode).toBe('hybrid'); // global posture
      expect(scoped.serving_repo_ids).toEqual(['r-health']); // per-caller view
      const nobody = await svc.getRetrievalConfig({ okfScopes: [], isSuperAdmin: false });
      expect(nobody.serving_graph_count).toBe(0);
      expect(nobody.engaged).toBe(false);
    });

    test('serving-set memo: repeat calls reuse the cache; TTL EXPIRY re-queries', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-20T12:00:00Z'));
      try {
        seedServing([repoRow()]);
        const first = await svc.servingRepos({ fresh: true });
        // within the TTL: served from the memo even though the programmed reply changed
        seedServing([repoRow({ repo_id: 'r-new', name: 'New Repo', version: 1 })]);
        const second = await svc.servingRepos();
        expect(second.map((r) => r.graph_name)).toEqual(first.map((r) => r.graph_name));
        expect(mockDb.query).toHaveBeenCalledTimes(1);
        // advance past the ≤30s bound: the memo is stale → re-query
        jest.setSystemTime(new Date('2026-09-20T12:00:31Z'));
        const third = await svc.servingRepos();
        expect(third.map((r) => r.graph_name)).toEqual(['OKF_new-repo_v1']);
        expect(mockDb.query).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('putRetrievalConfig', () => {
    test('valid PUT persists, bumps revision, audits before→after', async () => {
      const actor = { sub: 'steward-1', name: 'Steward' };
      const next = await svc.putRetrievalConfig({ mode: 'hybrid', max_fanout_graphs: 8 }, actor, '10.0.0.9');
      expect(next.mode).toBe('hybrid');
      expect(next.max_fanout_graphs).toBe(8);
      expect(next.revision).toBe(1);
      expect(next.updated_by).toBe('steward-1');
      const stored = await mockDb.collection('okf_system_config').document('retrieval');
      expect(stored.mode).toBe('hybrid');
      expect(auditService.writeAudit).toHaveBeenCalledTimes(1);
      const audit = auditService.writeAudit.mock.calls[0][0];
      expect(audit).toMatchObject({
        action: 'system.retrieval_config.update',
        repo_id: '_system',
        actor: 'steward-1',
        source_ip: '10.0.0.9'
      });
      expect(audit.details.after.mode).toBe('hybrid');
      expect(audit.details.before.mode).toBe('legacy');
      // audit fidelity (code-review fix): the raw prior STORED row + its
      // source ride alongside the effective before→after
      expect(audit.details.before_source).toBe('env-defaults');
      expect(audit.details.before_stored).toBeNull();
      expect(audit.description).toContain('mode: "legacy" → "hybrid"');
    });

    test('second PUT bumps revision to 2 (read-modify-write over governed row)', async () => {
      const actor = { sub: 'steward-1' };
      await svc.putRetrievalConfig({ mode: 'okf_only' }, actor);
      const next = await svc.putRetrievalConfig({ spine_max_hops: 3 }, actor);
      expect(next.revision).toBe(2);
      expect(next.mode).toBe('okf_only'); // unchanged field persists
      expect(next.spine_max_hops).toBe(3);
    });

    test('CONCURRENT PUT conflict: retry-once re-reads and wins (no lost write)', async () => {
      const col = mockDb.collection('okf_system_config');
      const actor = { sub: 'steward-1' };
      await svc.putRetrievalConfig({ mode: 'okf_only' }, actor); // revision 1 exists
      auditService.writeAudit.mockClear();
      // simulate a concurrent steward write between our read and update:
      // first update rejects with the arango conflict shape, second succeeds
      const conflict = Object.assign(new Error('conflict'), { errorNum: 1200 });
      col.update.mockImplementationOnce(async () => {
        throw conflict;
      });
      const next = await svc.putRetrievalConfig({ max_fanout_graphs: 7 }, actor);
      expect(next.revision).toBe(2); // re-read after conflict → correct revision
      expect(next.max_fanout_graphs).toBe(7);
      expect(auditService.writeAudit).toHaveBeenCalledTimes(1);
    });

    test.each([
      [{ mode: 'turbo' }, /mode" must be one of/],
      [{ max_fanout_graphs: 0 }, /greater than or equal to 1/],
      [{ max_fanout_graphs: 21 }, /less than or equal to 20/],
      [{ spine_max_hops: 1.5 }, /must be an integer/],
      [{ repo_id: 'hack' }, /is not allowed/],
      [{}, /at least 1 key/],
      [null, /must be of type object/]
    ])('invalid payload %j → VALIDATION_ERROR (joi, house error shape)', (payload, re) => {
      // joi validation lives in the validator (called at the top of the async
      // service PUT and in the controller) — test it directly. Direct
      // try/catch (toThrow(objectContaining) compares message by equality in
      // this jest version and does not recurse into matchers).
      try {
        validator.validateRetrievalConfigPatch(payload);
        throw new Error('expected validateRetrievalConfigPatch to throw');
      } catch (err) {
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.status).toBe(400);
        expect(Array.isArray(err.details)).toBe(true); // real Error + details
        expect(err.message + ' ' + err.details.join(' ')).toMatch(re);
      }
    });

    test('validation throws REAL Errors (stack preserved)', () => {
      try {
        validator.validateRetrievalConfigPatch({ mode: 'nope' });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect(err.stack).toBeTruthy();
      }
    });
  });
});
