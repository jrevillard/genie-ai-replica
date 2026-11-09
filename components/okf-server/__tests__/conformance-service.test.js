// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Tests for conformance-service. validateConcept is pure; persistConformanceIssues
// + getRepoMetrics use the mocked db-connection-service (arango-mock pattern).

jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});

const dbService = require('../shared-lib/db-connection-service');
const {
  validateConcept,
  persistConformanceIssues,
  getRepoMetrics,
  getDebtByRepos
} = require('../services/conformance-service');

const db = dbService.__mockDb;

function parsedConcept(overrides = {}) {
  return {
    concept_id: 'c1',
    repo_id: 'r1',
    frontmatter: { type: 'Policy' },
    status: undefined,
    generated: undefined,
    verified: undefined,
    stale_after: undefined,
    sources: undefined,
    links: [],
    ...overrides
  };
}

describe('conformance-service — validateConcept (pure)', () => {
  test('valid concept → no issues, valid: true', () => {
    const { issues, valid } = validateConcept(parsedConcept());
    expect(issues).toEqual([]);
    expect(valid).toBe(true);
  });

  test('MISSING_TYPE — type absent', () => {
    const { issues } = validateConcept(parsedConcept({ frontmatter: {} }));
    expect(issues.some((i) => i.code === 'MISSING_TYPE')).toBe(true);
    expect(issues[0].field_path).toBe('frontmatter.type');
  });

  test('MISSING_TYPE — type empty string', () => {
    const { issues } = validateConcept(parsedConcept({ frontmatter: { type: '  ' } }));
    expect(issues.some((i) => i.code === 'MISSING_TYPE')).toBe(true);
  });

  test('INVALID_STATUS_ENUM — bad status', () => {
    const { issues } = validateConcept(parsedConcept({ status: 'published' }));
    expect(issues.some((i) => i.code === 'INVALID_STATUS_ENUM')).toBe(true);
  });

  test('INVALID_STATUS_ENUM — valid statuses pass', () => {
    for (const s of ['draft', 'stable', 'deprecated']) {
      expect(validateConcept(parsedConcept({ status: s })).issues).toEqual([]);
    }
  });

  test('BAD_ACTOR_PREFIX — generated.by with bad prefix', () => {
    const { issues } = validateConcept(parsedConcept({ generated: { by: 'unknown-actor', at: '2026-01-01' } }));
    expect(issues.some((i) => i.code === 'BAD_ACTOR_PREFIX')).toBe(true);
  });

  test('BAD_ACTOR_PREFIX — accepts agent/ and agent: and human: and process:', () => {
    for (const by of ['agent/llm', 'agent:okf-producer', 'human:alice', 'process:batch']) {
      expect(validateConcept(parsedConcept({ generated: { by } })).issues).toEqual([]);
    }
  });

  test('BAD_ACTOR_PREFIX — checks verified[].by too', () => {
    const { issues } = validateConcept(parsedConcept({ verified: [{ by: 'badbot' }] }));
    expect(issues.some((i) => i.code === 'BAD_ACTOR_PREFIX')).toBe(true);
    expect(issues[0].field_path).toContain('verified');
  });

  test('UNPARSEABLE_STALE_AFTER — bad date format', () => {
    const { issues } = validateConcept(parsedConcept({ stale_after: 'not-a-date' }));
    expect(issues.some((i) => i.code === 'UNPARSEABLE_STALE_AFTER')).toBe(true);
  });

  test('UNPARSEABLE_STALE_AFTER — valid YYYY-MM-DD passes', () => {
    expect(validateConcept(parsedConcept({ stale_after: '2026-12-31' })).issues).toEqual([]);
  });

  test('SOURCE_MISSING_RESOURCE — source without resource', () => {
    const { issues } = validateConcept(parsedConcept({ sources: [{ author: 'X' }] }));
    expect(issues.some((i) => i.code === 'SOURCE_MISSING_RESOURCE')).toBe(true);
  });

  test('SOURCE_MISSING_RESOURCE — source with resource passes', () => {
    expect(validateConcept(parsedConcept({ sources: [{ resource: 'https://x.com' }] })).issues).toEqual([]);
  });

  test('multiple issues collected, no throw — with a hard/warning severity split', () => {
    const parsed = parsedConcept({
      frontmatter: {}, // MISSING_TYPE (hard)
      status: 'bad', // INVALID_STATUS_ENUM (warning)
      stale_after: 'nope', // UNPARSEABLE_STALE_AFTER (warning)
      sources: [{ author: 'X' }], // SOURCE_MISSING_RESOURCE (warning)
      generated: { by: 'robot:unknown' } // BAD_ACTOR_PREFIX (hard)
    });
    const result = validateConcept(parsed);
    expect(result.issues.length).toBe(5);
    expect(result.valid).toBe(false);
    // hardErrors = the structural integrity violations; the rest are warnings.
    expect(result.hardErrors.map((i) => i.code).sort()).toEqual(['BAD_ACTOR_PREFIX', 'MISSING_TYPE']);
    expect(result.hardErrors.every((i) => i.severity === 'error')).toBe(true);
    const warnings = result.issues.filter((i) => i.severity === 'warning');
    expect(warnings.map((i) => i.code).sort()).toEqual([
      'INVALID_STATUS_ENUM',
      'SOURCE_MISSING_RESOURCE',
      'UNPARSEABLE_STALE_AFTER'
    ]);
  });

  test('hardErrors empty for a conformant concept', () => {
    const { issues, hardErrors, valid } = validateConcept(parsedConcept());
    expect(issues).toEqual([]);
    expect(hardErrors).toEqual([]);
    expect(valid).toBe(true);
  });

  test('empty/null parsed → only MISSING_TYPE (no crash)', () => {
    const { issues } = validateConcept({});
    expect(issues.some((i) => i.code === 'MISSING_TYPE')).toBe(true);
    expect(issues.length).toBe(1);
  });
});

describe('conformance-service — persistConformanceIssues (DB)', () => {
  beforeEach(() => db._reset());

  test('persists issues onto the concept doc via the UPSERT writer (G9 — creates the doc)', async () => {
    // Story 2.9.2 (G9): the previous filter-and-UPDATE wrote ZERO rows when no
    // doc existed. The writer now CREATES the doc + merges conformance_issues.
    const issues = [{ code: 'MISSING_TYPE', severity: 'warning', message: 'test', field_path: 'frontmatter.type' }];
    await persistConformanceIssues('r1', 'c1', issues);
    const docs = Object.values(db._stores.okf_concepts_meta);
    expect(docs.length).toBe(1); // CREATED — not a silent no-op
    expect(docs[0].concept_id).toBe('c1');
    expect(docs[0].conformance_issues).toEqual(issues);
  });
});

describe('conformance-service — getRepoMetrics (DB)', () => {
  beforeEach(() => db._reset());

  // #1647 ride-along: the metrics read must run against the repo_id
  // persistent index (it measured 0.43-4.3 s on a 1112-concept repo without
  // it). This test is deliberately FIRST in the describe — the module's
  // per-process ensure cache makes every later call a no-op, so only the
  // first getRepoMetrics invocation can observe the ensure.
  test('the metrics read ensures the repo_id persistent index', async () => {
    db.query.mockResolvedValue({ all: async () => [{ concept_count: 0 }] });
    await getRepoMetrics('r1');
    const col = db.collection('okf_concepts_meta');
    expect(col.ensureIndex).toHaveBeenCalledWith({ type: 'persistent', fields: ['repo_id'] });
  });

  // NOTE: there is deliberately NO mock-echo test here — a fixture supplying
  // the five metric values with assertions reading them back proves only
  // rows[0] passthrough and cannot detect a wrong query, discriminator, or a
  // hardcoded metric. The AQL-text specs below own the real contract (the
  // identical echo was also removed from concept-meta-service.test.js).

  // The mock above supplies the answer, so it CANNOT catch a hardcoded metric —
  // which is exactly how pii_hit_count stayed literally 0 while Bali reported
  // 1113 concepts carrying findings. These assert on the QUERY TEXT, which is
  // the only thing the mock does not supply for us.
  test('pii_hit_count is COMPUTED from findings minus resolutions, not a literal', async () => {
    db.query.mockResolvedValue({ all: async () => [{ concept_count: 0 }] });
    await getRepoMetrics('r1');
    const arg = db.query.mock.calls[0][0];
    const aql = typeof arg === 'string' ? arg : String(arg.query);
    expect(aql).toMatch(/pii_hit_count:\s*SUM\(/);
    // The discriminator must be the resolution record: pii_state reads 'clean'
    // both before and after a bulk accept, so filtering on it is meaningless.
    // The findings side reads the OCCURRENCES array — pii-service persists a
    // pii_findings OBJECT for every scan (clean ones included) and ArangoDB's
    // LENGTH of an OBJECT counts its keys, so LENGTH(pii_findings) counted
    // scanned-clean concepts as debt (#948 review, found live).
    expect(aql).toMatch(/LENGTH\(d\.pii_findings\.occurrences\s*\|\|\s*\[\]\)\s*>\s*0/);
    expect(aql).toMatch(/LENGTH\(d\.pii_resolutions\s*\|\|\s*\[\]\)\s*==\s*0/);
  });

  test('no metric is hardcoded to a literal zero', async () => {
    db.query.mockResolvedValue({ all: async () => [{ concept_count: 0 }] });
    await getRepoMetrics('r1');
    const arg = db.query.mock.calls[0][0];
    const aql = typeof arg === 'string' ? arg : String(arg.query);
    // Guards the whole class, not just this field.
    expect(aql).not.toMatch(/\b\w+_count:\s*0\b/);
    expect(aql).not.toMatch(/\bpii_hit_count:\s*0\b/);
  });

  test('broken_link_count is gone — the product defines no such concept', async () => {
    db.query.mockResolvedValue({
      all: async () => [{ concept_count: 1, pii_hit_count: 0 }]
    });
    const metrics = await getRepoMetrics('r1');
    expect(metrics).not.toHaveProperty('broken_link_count');
    const arg = db.query.mock.calls[0][0];
    expect(typeof arg === 'string' ? arg : String(arg.query)).not.toMatch(/broken_link_count/);
  });

  test('handles empty repo (no concepts)', async () => {
    db.query.mockResolvedValue({ all: async () => [] });
    const metrics = await getRepoMetrics('empty-repo');
    expect(metrics.concept_count).toBe(0);
    expect(metrics.has_reserved_index).toBe(false);
  });
});

// ── #948 (narrowed disposition): cross-repo conformance-debt aggregation ──
describe('conformance-service — getDebtByRepos (#948)', () => {
  beforeEach(() => db._reset());

  test('empty/absent repo list answers [] without touching the DB', async () => {
    expect(await getDebtByRepos([])).toEqual([]);
    expect(await getDebtByRepos(null)).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('the aggregation AQL projects per-row fields and mirrors the per-repo metric names', async () => {
    const row = {
      repo_id: 'ra',
      concept_count: 12,
      conformance_issue_count: 4,
      stale_concept_count: 1,
      pii_hit_count: 0,
      has_reserved_index: true
    };
    db.query.mockResolvedValue({ all: async () => [row] });
    const rows = await getDebtByRepos(['ra', 'rb']);
    expect(rows).toHaveLength(1);
    // The row is the query's answer VERBATIM — the service adds nothing and
    // drops nothing (the panel renders exactly what the aggregation computed).
    expect(rows[0]).toEqual(row);
    const arg = db.query.mock.calls[0][0];
    const aqlText = typeof arg === 'string' ? arg : String(arg.query);
    // The readable-repo IN-list rides the repo_id index (the lazy ensure ran
    // ahead of the read — the same call the per-repo metrics path makes).
    expect(aqlText).toContain('FILTER d.repo_id IN ids');
    // COLLECT-INTO projection: the aggregation NEVER materializes full meta
    // docs (the #1648 lesson, applied first-class on the new query).
    expect(aqlText).toContain('COLLECT repo = d.repo_id INTO g = {');
    // The five metric names mirror the per-repo getRepoMetrics EXACTLY, so
    // the Studio panel's numbers agree with the wizard's per-repo block.
    expect(aqlText).toContain('concept_count: LENGTH(g)');
    expect(aqlText).toContain('conformance_issue_count: SUM(g[*].ci)');
    expect(aqlText).toContain('stale_concept_count: SUM(g[*].stale)');
    expect(aqlText).toContain('pii_hit_count: SUM(g[*].pii)');
    expect(aqlText).toContain('has_reserved_index');
    // The PII discriminator reads the OCCURRENCES array, never the findings
    // OBJECT (ArangoDB LENGTH of an object counts keys; pii-service persists
    // a findings object for every scan — the text is the SEMANTICS here, and
    // the live smoke [2.6] leg owns the numeric proof on a clean repo).
    expect(aqlText).toContain('LENGTH(d.pii_findings.occurrences || []) > 0');
  });
});
