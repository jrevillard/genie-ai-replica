// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Initial-tag generation unit tests — frontmatterService.suggestTags, the
// single LLM proposal point for a repo's FIRST frontmatter tag set (the
// /frontmatter/suggest route + the lifecycle publish hook both call it).
// Routing-gate contract (2026-10-09): the proposed forbidden set must come
// back flagged as suggestions — forbidden_suggestions: [{value, suggested:
// true}] — so the curator UI renders accept/dismiss chips and the boundary
// is born declared. vLLM (axios) + ArangoDB are mocked; the parsing and
// normalization contract is asserted directly.

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

const svc = require('../services/frontmatter-service');
const axios = require('axios');
const { __mockDb } = require('../shared-lib/db-connection-service');

const REPO_ID = 'repo-ncd';

const REPO_ROW = { _key: REPO_ID, repo_id: REPO_ID, name: 'NCD corpus', domain: 'Health' };

const CONCEPT_ROWS = [
  {
    concept_id: 'c1',
    title: 'Diabetes care',
    type: 'topic',
    tags: ['diabetes', 'ncd'],
    labels: ['Health'],
    summary: 'NCD management at primary care'
  },
  {
    concept_id: 'c2',
    title: 'Hypertension screening',
    type: 'topic',
    tags: ['hypertension'],
    labels: [],
    summary: 'Blood pressure protocol'
  }
];

function seedDb({ concepts = CONCEPT_ROWS } = {}) {
  __mockDb.query.mockImplementation((q) => {
    const text = typeof q === 'string' ? q : q && q.query ? q.query : '';
    if (text.includes('okf_repositories')) {
      return Promise.resolve({ all: async () => [REPO_ROW] });
    }
    if (text.includes('okf_concepts_meta')) {
      return Promise.resolve({ all: async () => concepts });
    }
    return Promise.resolve({ all: async () => [] });
  });
}

function vllmResponse(content) {
  return {
    data: { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { total_tokens: 42 } }
  };
}

beforeEach(() => {
  __mockDb.query.mockReset();
  axios.post.mockReset();
});

describe('frontmatterService.suggestTags — forbidden suggestion contract', () => {
  test('flags every proposed forbidden tag as a suggestion (value + suggested: true)', async () => {
    seedDb();
    axios.post.mockResolvedValue(
      vllmResponse(
        JSON.stringify({
          topic: ['diabetes', 'hypertension', 'ncd-care'],
          entity: [],
          scope: 'health',
          forbidden: ['communicable-disease', 'mental-health'],
          summary: 'Non-communicable disease guidance.',
          keyword: []
        })
      )
    );
    const out = await svc.suggestTags(REPO_ID);
    expect(out.forbidden).toEqual(['communicable-disease', 'mental-health']);
    expect(out.forbidden_suggestions).toEqual([
      { value: 'communicable-disease', suggested: true },
      { value: 'mental-health', suggested: true }
    ]);
    // The positive surface is untouched by the contract addition.
    expect(out.topic).toEqual(['diabetes', 'hypertension', 'ncd-care']);
    expect(out.summary).toBe('Non-communicable disease guidance.');
  });

  test('normalizes alias + non-kebab forbidden values before flagging', async () => {
    seedDb();
    axios.post.mockResolvedValue(
      vllmResponse(
        JSON.stringify({
          topic: ['a', 'b', 'c'],
          forbidden_topics: ['Communicable Disease', 'MENTAL HEALTH!', ''],
          entity: [],
          scope: '',
          summary: '',
          keyword: []
        })
      )
    );
    const out = await svc.suggestTags(REPO_ID);
    // normalizeTag lowercases, hyphenates and strips non-[a-z0-9-]; the
    // empty row is dropped. flagged rows mirror the normalized set.
    expect(out.forbidden).toEqual(['communicable-disease', 'mental-health']);
    expect(out.forbidden_suggestions).toEqual([
      { value: 'communicable-disease', suggested: true },
      { value: 'mental-health', suggested: true }
    ]);
  });

  test('an empty forbidden proposal yields empty suggestions (no fabricated chips)', async () => {
    seedDb();
    axios.post.mockResolvedValue(vllmResponse(JSON.stringify({ topic: ['a', 'b', 'c'], forbidden: [], summary: '' })));
    const out = await svc.suggestTags(REPO_ID);
    expect(out.forbidden).toEqual([]);
    expect(out.forbidden_suggestions).toEqual([]);
  });

  test('the prompt demands adjacent-domain forbidden candidates (3-6, kebab)', async () => {
    seedDb();
    axios.post.mockResolvedValue(vllmResponse(JSON.stringify({ topic: ['a', 'b', 'c'], forbidden: [] })));
    await svc.suggestTags(REPO_ID);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const body = axios.post.mock.calls[0][1];
    const prompt = body.messages[0].content;
    expect(prompt).toMatch(/FORBIDDEN/);
    expect(prompt).toMatch(/ADJACENT DOMAINS/);
    expect(prompt).toMatch(/3-6/);
  });

  test('NO_CONCEPTS when the repo has no concept-meta rows (tags originate from concepts)', async () => {
    seedDb({ concepts: [] });
    await expect(svc.suggestTags(REPO_ID)).rejects.toMatchObject({ code: 'NO_CONCEPTS', status: 400 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('LLM_PARSE when the model returns unparseable content', async () => {
    seedDb();
    axios.post.mockResolvedValue(vllmResponse('not json at all'));
    await expect(svc.suggestTags(REPO_ID)).rejects.toMatchObject({ code: 'LLM_PARSE', status: 502 });
  });
});
