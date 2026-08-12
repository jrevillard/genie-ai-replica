// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Tests for conformance-service. validateConcept is pure; persistConformanceIssues
// + getRepoMetrics use the mocked db-connection-service (arango-mock pattern).

jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});

const dbService = require('../shared-lib/db-connection-service');
const { validateConcept, persistConformanceIssues, getRepoMetrics } = require('../services/conformance-service');

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

  test('non-blocking — multiple issues collected, no throw', () => {
    const parsed = parsedConcept({
      frontmatter: {},
      status: 'bad',
      stale_after: 'nope',
      sources: [{ author: 'X' }]
    });
    const result = validateConcept(parsed);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
    expect(result.valid).toBe(false);
    // All issues are warnings
    expect(result.issues.every((i) => i.severity === 'warning')).toBe(true);
  });

  test('empty/null parsed → only MISSING_TYPE (no crash)', () => {
    const { issues } = validateConcept({});
    expect(issues.some((i) => i.code === 'MISSING_TYPE')).toBe(true);
    expect(issues.length).toBe(1);
  });
});

describe('conformance-service — persistConformanceIssues (DB)', () => {
  beforeEach(() => db._reset());

  test('calls db.query to update okf_concepts_meta', async () => {
    // Seed a concept doc
    db.collection('okf_concepts_meta').save({ _key: 'r1::c1', repo_id: 'r1', concept_id: 'c1', frontmatter: {} });
    const issues = [{ code: 'MISSING_TYPE', severity: 'warning', message: 'test', field_path: 'frontmatter.type' }];
    await persistConformanceIssues('r1', 'c1', issues);
    // The AQL update ran via db.query — verify it was called
    expect(db.query).toHaveBeenCalled();
  });
});

describe('conformance-service — getRepoMetrics (DB)', () => {
  beforeEach(() => db._reset());

  test('returns metrics from AQL query result', async () => {
    db.query.mockResolvedValue({
      all: async () => [
        {
          concept_count: 5,
          conformance_issue_count: 3,
          stale_concept_count: 1,
          has_reserved_index: true,
          broken_link_count: 0,
          pii_hit_count: 0
        }
      ]
    });
    const metrics = await getRepoMetrics('r1');
    expect(metrics.concept_count).toBe(5);
    expect(metrics.conformance_issue_count).toBe(3);
    expect(metrics.stale_concept_count).toBe(1);
    expect(metrics.has_reserved_index).toBe(true);
    expect(metrics.broken_link_count).toBe(0);
    expect(metrics.pii_hit_count).toBe(0);
  });

  test('handles empty repo (no concepts)', async () => {
    db.query.mockResolvedValue({ all: async () => [] });
    const metrics = await getRepoMetrics('empty-repo');
    expect(metrics.concept_count).toBe(0);
    expect(metrics.has_reserved_index).toBe(false);
  });
});
