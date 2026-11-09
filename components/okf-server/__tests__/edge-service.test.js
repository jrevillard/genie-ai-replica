// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 2.9.3 T1 — the _LINKS_TO edge writer (G7/G22): post-index, within-repo
// validated, ENTITY nodes ensured, replace-on-reingest, cross-repo dropped.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({ createCounter: () => ({ add: jest.fn() }) })
}));
jest.mock('../services/audit-service', () => ({
  writeAudit: jest.fn().mockResolvedValue(null)
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const edgeService = require('../services/edge-service');
const { logger } = require('../shared-lib/logger');

const REPO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_REPO = 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const GRAPH = `OKF_${REPO}`;

/**
 * The service queries by AQL SHAPE, not by call order:
 *  - the concept's own meta read (RETURN KEEP(...)),
 *  - the within-repo boundary probe (the link targets only, on the
 *    (repo_id, concept_id) index — #1179: a whole-set read made an N-concept
 *    drain pay N x N row reads),
 *  - the outgoing-edge cleanup read (RETURN e._key).
 *
 * `repos` maps a repo id to the concept ids it stores. The boundary probe is
 * simulated FAITHFULLY: the stored rows are answered from the repo the query
 * filters on — and from EVERY repo when the query does not. The scope check is
 * the CONJUNCTION, not the presence of either condition: a probe that lost its
 * repo filter, or that turned the `AND` into an `OR`, answers with concepts of
 * other repositories, and the G22 test fails.
 */
function programQueries(metaRows, repos, options = {}) {
  const cleanupKeys = options.cleanupKeys || [];
  mockDb.query.mockImplementation(async (aql, bindVars = {}) => {
    if (aql.includes('RETURN KEEP(m,')) return { all: async () => metaRows };
    if (aql.includes('FOR c IN @candidates') && aql.includes('FOR m IN okf_concepts_meta FILTER')) {
      // The mock keys on the exact literals of the production probe: the
      // collection phrase (so a renamed collection does not get answered),
      // and exactly the conjunction the probe must keep — a weakened operator
      // or a dropped filter widens the answer to every repository.
      const repoScoped = aql.includes('m.repo_id == @repo_id AND m.concept_id == c');
      const repoIds = repoScoped ? [bindVars.repo_id] : Object.keys(repos);
      const stored = new Set();
      for (const id of repoIds) for (const cid of repos[id] || []) stored.add(cid);
      const candidates = bindVars.candidates || [];
      return { all: async () => candidates.filter((c) => stored.has(c)).map((c) => ({ concept_id: c })) };
    }
    // A whole-set read (every concept id of the repo) — the shape #1179 removed.
    if (aql.includes('RETURN m.concept_id')) return { all: async () => [] };
    if (aql.includes('RETURN e._key')) return { all: async () => cleanupKeys };
    return { all: async () => [] };
  });
}

/** The repo's stored concept ids, under the bare form. */
const inRepo = (...ids) => ({ [REPO]: ids });

function metaRow(overrides = {}) {
  return {
    repo_id: REPO,
    concept_id: 'service_directory',
    title: 'Service Directory',
    labels: [],
    links: [],
    ...overrides
  };
}

/** The boundary probe: the queries that look the link targets up. */
const probes = () =>
  mockDb.query.mock.calls.filter(
    ([aql]) => typeof aql === 'string' && aql.includes('FOR c IN @candidates') && aql.includes('okf_concepts_meta')
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockDb._reset();
});

describe('edgeService.writeRepoConceptEdges (Story 2.9.3)', () => {
  test('writes within-repo edges: source ENTITY ensured, edges carry label/file_id/repo_id/bundle_version', async () => {
    programQueries(
      [
        metaRow({
          links: [
            { to_concept_id: 'index', label: 'Index' },
            { to_concept_id: 'huduma_kenya', label: 'Huduma' }
          ]
        })
      ],
      inRepo('service_directory', 'index', 'huduma_kenya')
    );
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {
      file_id: 'file-1',
      bundle_version: 3
    });
    expect(result).toMatchObject({ repo_id: REPO, concept_id: 'service_directory', written: 2, dropped: [] });
    // Edges written into OKF_{repo}_LINKS_TO
    const edges = Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {});
    expect(edges).toHaveLength(2);
    for (const e of edges) {
      expect(e._from).toMatch(new RegExp(`${GRAPH}_ENTITY/c_[a-f0-9]+`));
      expect(e._to).toMatch(new RegExp(`${GRAPH}_ENTITY/c_[a-f0-9]+`));
      expect(e.repo_id).toBe(REPO);
      expect(e.file_id).toBe('file-1');
      expect(e.bundle_version).toBe(3);
      expect(typeof e.label).toBe('string');
    }
    // Source ENTITY vertex ensured
    const entities = Object.values(mockDb._stores[`${GRAPH}_ENTITY`] || {});
    expect(entities.length).toBeGreaterThan(0);
  });

  test('the bundle ROOT (is_index) is stamped on its ENTITY vertex (Story 4.8-amend)', async () => {
    programQueries(
      [metaRow({ concept_id: 'index', is_index: true, links: [{ to_concept_id: 'huduma_kenya', label: 'Huduma' }] })],
      inRepo('index', 'huduma_kenya')
    );
    await edgeService.writeRepoConceptEdges(REPO, 'index', { file_id: 'file-idx', bundle_version: 1 });
    const entities = Object.values(mockDb._stores[`${GRAPH}_ENTITY`] || {});
    const indexEntity = entities.find((e) => e.concept_id === 'index');
    expect(indexEntity).toBeTruthy();
    expect(indexEntity.is_index).toBe(true);
  });

  test('cross-repo / missing targets are DROPPED + logged (G22) — never materialized', async () => {
    programQueries(
      [
        metaRow({
          links: [
            { to_concept_id: 'other_repo_concept', label: 'Bad' },
            { to_concept_id: 'index', label: 'Ok' }
          ]
        })
      ],
      inRepo('service_directory', 'index') // 'other_repo_concept' NOT in the repo
    );
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result.written).toBe(1);
    expect(result.dropped).toEqual(['other_repo_concept']);
    expect(logger.info).toHaveBeenCalledWith(
      'Edge write: cross-repo/missing target dropped (G22)',
      expect.objectContaining({ from: 'service_directory', to: 'other_repo_concept' })
    );
    const edges = Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {});
    expect(edges).toHaveLength(1);
    expect(edges[0]._to).not.toMatch(/other_repo_concept/);
  });

  test("replace-on-reingest: the concept's OLD outgoing edges are removed before the new ones", async () => {
    // Pre-seed one existing edge from this concept (a link that was removed in v2).
    await mockDb.collection(`${GRAPH}_LINKS_TO`).save({
      _key: 'e_stale',
      _from: `${GRAPH}_ENTITY/c_source`,
      _to: `${GRAPH}_ENTITY/c_oldtarget`,
      label: 'Removed',
      repo_id: REPO
    });
    programQueries(
      [metaRow({ links: [{ to_concept_id: 'index', label: 'Current' }] })],
      inRepo('service_directory', 'index'),
      { cleanupKeys: ['e_stale'] }
    );
    await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    const edges = Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {});
    expect(edges).toHaveLength(1); // stale one gone
    expect(edges[0].label).toBe('Current');
  });

  test('no-links concept: no edges, but the ENTITY vertex is still ensured', async () => {
    programQueries([metaRow({ links: [] })], inRepo('service_directory'));
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result.written).toBe(0);
    expect(Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {})).toHaveLength(0);
    expect(Object.values(mockDb._stores[`${GRAPH}_ENTITY`] || {})).toHaveLength(1);
  });

  test('missing meta row → clean no-op (no crash into the ingest path)', async () => {
    programQueries([], inRepo('service_directory'));
    const result = await edgeService.writeRepoConceptEdges(REPO, 'ghost', {});
    expect(result).toMatchObject({ written: 0, dropped: [] });
  });

  test('repo concept-set read failure → drops all links (fail-closed, G22)', async () => {
    mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('RETURN KEEP(m,')) {
        return { all: async () => [metaRow({ links: [{ to_concept_id: 'x', label: 'X' }] })] };
      }
      // The boundary probe itself fails — the catch must drop every link.
      if (aql.includes('FOR c IN @candidates')) throw new Error('arango down');
      return { all: async () => [] };
    });
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result).toMatchObject({ written: 0, dropped: ['x'] });
    // The fail-closed path RETURNS — no edge cleanup, no ENTITY vertex ensure.
    // (Dropping the early return would still answer written:0 with every link
    // dropped, because the empty boundary set refuses them all; only the
    // skipped vertex/cleanup work tells the two apart.)
    expect(Object.values(mockDb._stores[`${GRAPH}_ENTITY`] || {})).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      'Edge write: repo concept-set read failed — dropping all links',
      expect.objectContaining({ repo_id: REPO, error: 'arango down' })
    );
  });
});

describe('edgeService — review fixes (2026-08-17)', () => {
  const { writeAudit } = require('../services/audit-service');

  test('P1: canonicalizes concepts/-prefixed link targets against a prefixed stored set (no silent edge loss)', async () => {
    // Stored concept ids are `concepts/`-prefixed (subdirectory bundle); link
    // targets are bare (parser strips ./ from the href). Both must normalize.
    programQueries([metaRow({ links: [{ to_concept_id: 'index', label: 'Index' }] })], {
      [REPO]: ['concepts/service_directory', 'concepts/index']
    });
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result.written).toBe(1);
    expect(result.dropped).toEqual([]);
    // target ENTITY node written with the NORMALIZED concept_id
    const entities = Object.values(mockDb._stores[`${GRAPH}_ENTITY`] || {});
    expect(entities.some((v) => v.concept_id === 'index')).toBe(true);
  });

  test('P2: N→0 replace — removing the last link deletes the stale edge', async () => {
    await mockDb.collection(`${GRAPH}_LINKS_TO`).save({
      _key: 'e_stale',
      _from: `${GRAPH}_ENTITY/c_source`,
      _to: `${GRAPH}_ENTITY/c_target`,
      label: 'Old',
      repo_id: REPO
    });
    programQueries([metaRow({ links: [] })], inRepo('service_directory'), { cleanupKeys: ['e_stale'] });
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result.written).toBe(0);
    expect(Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {})).toHaveLength(0); // stale edge gone
  });

  test('P3+P4: ensures TARGET entity vertices + writes the audit row', async () => {
    programQueries(
      [metaRow({ links: [{ to_concept_id: 'index', label: 'I' }] })],
      inRepo('service_directory', 'index')
    );
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', { file_id: 'f1' });
    expect(result.written).toBe(1);
    const entities = Object.values(mockDb._stores[`${GRAPH}_ENTITY`] || {});
    expect(entities.some((v) => v.concept_id === 'service_directory')).toBe(true); // source
    expect(entities.some((v) => v.concept_id === 'index')).toBe(true); // target (P3)
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'repo.edges_written', actor: 'okf-worker', repo_id: REPO })
    );
  });

  test('P5: duplicate link targets collapse to ONE edge and an accurate written count', async () => {
    programQueries(
      [
        metaRow({
          links: [
            { to_concept_id: 'index', label: 'First' },
            { to_concept_id: 'index', label: 'Second' }
          ]
        })
      ],
      inRepo('service_directory', 'index')
    );
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result.written).toBe(1);
    expect(Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {})).toHaveLength(1);
  });

  test('P6: idempotent ENTITY upsert — a second write keeps ONE source vertex (same _key)', async () => {
    programQueries([metaRow({ links: [] })], inRepo('service_directory'));
    await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    const keys = Object.keys(mockDb._stores[`${GRAPH}_ENTITY`] || {});
    expect(keys).toHaveLength(1);
    const before = keys[0];
    // second write (same concept) — still one vertex, same key
    programQueries([metaRow({ links: [] })], inRepo('service_directory'));
    mockDb.query.mockImplementationOnce(async () => ({ all: async () => [] }));
    await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    const keys2 = Object.keys(mockDb._stores[`${GRAPH}_ENTITY`] || {});
    expect(keys2).toEqual([before]);
  });
});

describe('edgeService.writeRepoConceptEdges — within-repo boundary read (#1179)', () => {
  test('the repo concept set is NEVER fetched whole — the boundary is probed for the link targets only', async () => {
    const links = Array.from({ length: 12 }, (_, i) => ({ to_concept_id: `concept_${i}`, label: `L${i}` }));
    programQueries([metaRow({ links })], inRepo('service_directory', ...links.map((l) => l.to_concept_id)));

    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});

    expect(result.written).toBe(12);
    // The whole-set read — one query returning EVERY concept id of the repo —
    // is what made an N-concept drain pay N x N row reads. It must be gone.
    const wholeSetReads = mockDb.query.mock.calls.filter(
      ([aql]) =>
        typeof aql === 'string' &&
        aql.includes('okf_concepts_meta') &&
        aql.includes('RETURN m.concept_id') &&
        !aql.includes('FOR c IN @candidates')
    );
    expect(wholeSetReads).toHaveLength(0);
    // One probe query for all the targets: a nested FOR over the candidate
    // list, each candidate a seek on the unique index, so the row reads scale
    // with the links and the round trips stay at one per concept.
    const found = probes();
    expect(found).toHaveLength(1);
    const [aql, bindVars] = found[0];
    expect(aql).toContain('FOR c IN @candidates FOR m IN okf_concepts_meta');
    // The conjunction IS the boundary: an OR (or a dropped filter) lets a
    // concept of another repository answer the probe — the mock then answers
    // unscoped and the G22 test fails.
    expect(aql).toContain('m.repo_id == @repo_id AND m.concept_id == c');
    expect(bindVars.repo_id).toBe(REPO);
    expect(bindVars.candidates).toEqual(links.flatMap((l) => [l.to_concept_id, `concepts/${l.to_concept_id}`]));
  });

  test('a link target OUTSIDE the repo is still dropped — the probe never widens the boundary', async () => {
    programQueries(
      [
        metaRow({
          links: [
            { to_concept_id: 'in_repo', label: 'In' },
            { to_concept_id: 'other_repo', label: 'Out' }
          ]
        })
      ],
      // 'other_repo' is a concept of ANOTHER repository: the probe filters on
      // the repo, so it must not be found.
      { ...inRepo('service_directory', 'in_repo'), [OTHER_REPO]: ['other_repo'] }
    );
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result.written).toBe(1);
    expect(result.dropped).toEqual(['other_repo']);
    const edges = Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {});
    expect(edges).toHaveLength(1);
  });

  test('a duplicate link target is probed ONCE (the candidate list holds no duplicate)', async () => {
    programQueries(
      [
        metaRow({
          links: [
            { to_concept_id: 'index', label: 'First' },
            { to_concept_id: 'index', label: 'Second' }
          ]
        })
      ],
      inRepo('service_directory', 'index')
    );
    await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    const found = probes();
    expect(found).toHaveLength(1);
    expect(found[0][1].candidates).toEqual(['index', 'concepts/index']);
  });
});
