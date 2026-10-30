// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Coverage for the Story 1.7a vectorized-head surface of frontmatter-service:
// embedAllTags (TEI shape + dim guard), averageVectors via buildVectorizedHead,
// writeFrontmatterToRepoDoc normalization, the head text projection and the
// canonical reader. suggestTags' LLM seam is covered by frontmatter-service.test.js.

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
jest.mock('axios');
jest.mock('../services/model-config-service', () => ({
  resolveModelOverride: jest.fn(async () => null)
}));

const svc = require('../services/frontmatter-service');
const axios = require('axios');
const { __mockDb } = require('../shared-lib/db-connection-service');

const DIM = parseInt(process.env.EMBEDDING_DIM || '1024', 10);
const vec = (fill) => new Array(DIM).fill(fill);
/** TEI /embed response for a list of vectors (the batched {data:[[...]]} shape). */
const teiOk = (vectors) => ({ data: { data: vectors } });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('embedAllTags', () => {
  it('embeds every VALID_FIELD, normalizing scalars to one-element lists', async () => {
    // teiEmbed runs PER FIELD — one call for topic, one for entity; empty
    // keyword makes no call at all.
    axios.post
      .mockResolvedValueOnce(teiOk([vec(1), vec(2)])) // topic
      .mockResolvedValueOnce(teiOk([vec(3)])); // entity
    const out = await svc.embedAllTags({
      topic: ['agri', 'water'],
      entity: 'moship', // scalar — normalized to ['moship']
      keyword: [] // empty list stays empty, no embed call for it
    });
    expect(out.topic).toEqual([
      { value: 'agri', vector: vec(1) },
      { value: 'water', vector: vec(2) }
    ]);
    expect(out.entity).toEqual([{ value: 'moship', vector: vec(3) }]);
    expect(out.keyword).toEqual([]);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('rejects a wrong-dimension vector with EMBED_DIM', async () => {
    axios.post.mockResolvedValueOnce(teiOk([[0.1, 0.2]]));
    await expect(svc.embedAllTags({ topic: ['x'] })).rejects.toMatchObject({ code: 'EMBED_DIM_MISMATCH' });
  });

  it('a TEI shape it cannot decode is EMBED_BAD_SHAPE', async () => {
    axios.post.mockResolvedValueOnce({ data: { unexpected: true } });
    await expect(svc.embedAllTags({ topic: ['x'] })).rejects.toMatchObject({ code: 'EMBED_BAD_SHAPE' });
  });
});

describe('buildVectorizedHead', () => {
  it('averages per field, carries per-tag forbidden vectors and writes the head doc', async () => {
    await __mockDb.collection('okf_repositories').save({ repo_id: 'r1', name: 'R' });
    axios.post
      .mockResolvedValueOnce(teiOk([vec(1), vec(3)])) // topic a,b → avg 2
      .mockResolvedValueOnce(teiOk([vec(9)])); // forbidden politics
    const head = await svc.buildVectorizedHead('r1', { topic: ['a', 'b'], forbidden: ['politics'] });
    expect(head.dim).toBe(DIM);
    expect(head.per_field.topic).toEqual(vec(2)); // weighted average of the field
    expect(head.per_field.forbidden_vectors).toEqual([{ tag: 'politics', vector: vec(9) }]);
    expect(head.text).toContain('Topics: a, b.');
    expect(head.text).toContain('Not about: politics.');
    expect(__mockDb.collection('okf_repositories').update).toHaveBeenCalledWith('r1', { head });
  });

  it('projects every frontmatter field into the head text', async () => {
    expect(
      svc.frontmatterToHeadText({
        topic: ['t1'],
        entity: ['e1'],
        scope: 'national',
        forbidden: ['f1'],
        summary: 'the summary',
        keyword: ['k1']
      })
    ).toBe('Topics: t1. Entities: e1. Scope: national. Not about: f1. Summary: the summary. Keywords: k1.');
    expect(svc.frontmatterToHeadText({})).toBe('');
    // non-string scope / falsy tag entries are dropped, never rendered
    expect(svc.frontmatterToHeadText({ scope: 42, topic: ['a', null] })).toBe('Topics: a.');
  });

  it('empty frontmatter → EMPTY; no embeddable fields → VALIDATION', async () => {
    await expect(svc.buildVectorizedHead('r1', null)).rejects.toMatchObject({ code: 'EMPTY' });
    await expect(svc.buildVectorizedHead('r1', {})).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('writeFrontmatterToRepoDoc', () => {
  it('normalizes the payload, stamps version/actor and updates the canonical doc', async () => {
    await __mockDb.collection('okf_repositories').save({ repo_id: 'r1', name: 'R' });
    const fm = await svc.writeFrontmatterToRepoDoc(
      'r1',
      { topic: 'scalar-dropped', entity: [1, 2], scope: 7 },
      { version: '55', actor: { user_id: 'u9' } }
    );
    expect(fm).toMatchObject({
      topic: [], // a non-array topic is dropped, not normalized — arrays only
      entity: [1, 2],
      scope: '',
      forbidden: [],
      summary: '',
      keyword: [],
      _approved: [],
      version: 55,
      updated_by: 'u9'
    });
    expect(__mockDb.collection('okf_repositories').update).toHaveBeenCalledWith('r1', { frontmatter: fm });
  });

  it('defaults the actor to auto-publish when absent', async () => {
    await __mockDb.collection('okf_repositories').save({ repo_id: 'r1', name: 'R' });
    const fm = await svc.writeFrontmatterToRepoDoc('r1', {});
    expect(fm.updated_by).toBe('auto-publish');
    expect(fm.version).toEqual(expect.any(Number));
  });
});

describe('readFrontmatterFromRepoDoc', () => {
  it('returns the doc field, or null when the repo never had frontmatter', async () => {
    __mockDb.query.mockResolvedValueOnce({ all: async () => [{ topic: ['t'] }] });
    await expect(svc.readFrontmatterFromRepoDoc('r1')).resolves.toEqual({ topic: ['t'] });
    __mockDb.query.mockResolvedValueOnce({ all: async () => [] });
    await expect(svc.readFrontmatterFromRepoDoc('ghost')).resolves.toBeNull();
  });
});
