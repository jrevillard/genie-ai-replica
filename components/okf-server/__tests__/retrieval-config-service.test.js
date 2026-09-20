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

function repoRow(overrides) {
  return Object.assign(
    {
      repo_id: 'r-kenya',
      name: 'Kenya Gov',
      domain: 'government',
      version: 3,
      ingested_version: 3,
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
    auditService.writeAudit.mockClear();
  });

  describe('getEffectiveConfig', () => {
    test('no governed row → env defaults, source env-defaults', async () => {
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
      const serving = await svc.servingRepos();
      expect(serving.map((s) => s.graph_name)).toEqual([
        'OKF_kenya-gov_v3', // serving = the ingested version, NOT v4
        'OKF_health-services_v1'
      ]);
    });

    test('engaged=false in legacy mode even with serving graphs; okf_only+zero serving warns', async () => {
      seedServing([repoRow()]);
      const legacy = await svc.getRetrievalConfig();
      expect(legacy.config.mode).toBe('legacy');
      expect(legacy.engaged).toBe(false); // D2: legacy NEVER engages the fan-out
      expect(legacy.serving_graph_count).toBe(1);
      expect(legacy.warnings).toHaveLength(0);

      // flip to okf_only with an EMPTY serving set
      mockDb._reset();
      mockDb.collection('okf_system_config').save({ _key: 'retrieval', mode: 'okf_only' });
      seedServing([]);
      const okfOnlyEmpty = await svc.getRetrievalConfig();
      expect(okfOnlyEmpty.engaged).toBe(false);
      expect(okfOnlyEmpty.warnings).toHaveLength(1); // structured warning, never silent fallback
    });

    test('engaged=true only when mode≠legacy AND ≥1 serving graph', async () => {
      mockDb.collection('okf_system_config').save({ _key: 'retrieval', mode: 'okf_only' });
      seedServing([repoRow()]);
      const out = await svc.getRetrievalConfig();
      expect(out.engaged).toBe(true);
      expect(out.serving_graphs[0]).toMatchObject({ repo_id: 'r-kenya', graph_name: 'OKF_kenya-gov_v3' });
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

    test.each([
      [{ mode: 'turbo' }, /mode must be one of/],
      [{ max_fanout_graphs: 0 }, /max_fanout_graphs must be an integer in \[1, 20\]/],
      [{ max_fanout_graphs: 21 }, /max_fanout_graphs must be an integer in \[1, 20\]/],
      [{ spine_max_hops: 1.5 }, /spine_max_hops must be an integer/],
      [{ repo_id: 'hack' }, /unknown field\(s\): repo_id/],
      [{}, /no configurable fields/],
      [null, /body must be a JSON object/]
    ])('invalid payload %j → VALIDATION_ERROR', (payload, re) => {
      // Direct try/catch (toThrow(objectContaining) compares message by
      // equality in this jest version and does not recurse into matchers).
      try {
        svc.validatePatch(payload);
        throw new Error('expected validatePatch to throw');
      } catch (err) {
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.message).toMatch(re);
      }
    });
  });
});
