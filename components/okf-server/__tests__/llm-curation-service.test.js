/**
 * D-B (#980) + D-L (#990) — llm-curation-service tests.
 * Mode gating, bounded KH labels, fail-soft fallback, authorial-type guard,
 * from-empty propose, and the drain-bound ingest_labels recomposition.
 */

jest.mock('axios');
jest.mock('../services/ingest-service', () => ({
  composeIngestLabels: jest.fn(() => ['t:demo', 'r:repo-1', 'd:demo', 'CURATED'])
}));

const axios = require('axios');
const service = require('../services/llm-curation-service');

const REPO = {
  repo_id: 'repo-1',
  domain: 'Indonesia',
  acl: { required_scopes: ['okf:t:indonesia:admin'] }
};

const AREAS = [{ key: 'cat-9', name: 'Indonesia' }];
const AREA_LABELS = ['History', 'Culture', 'Politics', 'Emergence'];

function metaRow(over = {}) {
  return {
    _key: 'k-' + (over.concept_id || 'c1'),
    repo_id: 'repo-1',
    concept_id: over.concept_id || 'c1',
    title: over.title || 'Borobudur',
    type: over.type === undefined ? 'topic' : over.type,
    body: over.body || '# Borobudur\n\nA 9th-century Mahayana Buddhist temple in Central Java.',
    frontmatter: over.frontmatter || {},
    is_index: over.is_index || false,
    index_status: 'parsed',
    labels: [],
    ingest_labels: ['t:demo', 'r:repo-1', 'd:demo'],
    ...over
  };
}

function makeDb(rows, updates) {
  return {
    query: jest.fn(async (q) => ({
      all: async () => {
        if (q.includes('serviceCategories')) return AREAS;
        if (q.includes('FROM-CONCEPTS')) return rows;
        if (q.includes('FOR s IN services')) return AREA_LABELS;
        if (q.includes('okf_concepts_meta')) return rows;
        return [];
      }
    })),
    collection: jest.fn(() => ({ update: jest.fn(async (k, patch) => updates.push({ k, patch })) }))
  };
}

// Route the service's getConnection to our fake db per test.
let mockDb;
jest.mock('../shared-lib/db-connection-service', () => ({
  getConnection: jest.fn(async () => mockDb)
}));

function llmReply(obj) {
  axios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
}

beforeAll(() => {
  process.env.VLLM_ENDPOINT = 'http://vllm:8000/v1';
  process.env.VLLM_MODEL_ID = 'test-model';
  process.env.VLLM_API_KEY = 'k';
});

beforeEach(() => {
  axios.post.mockReset();
  jest.clearAllMocks();
});

describe('curateRepoConcepts (#980)', () => {
  test('heuristics mode: keyword-matched labels, ZERO LLM calls (David 2026-09-08)', async () => {
    const rows = [
      metaRow({ concept_id: 'pol-reform', title: 'Political Reform' }),
      metaRow({ concept_id: 'plain', title: 'Unrelated Topic' })
    ];
    const updates = [];
    mockDb = makeDb(rows, updates);
    const stats = await service.curateRepoConcepts(REPO, { classification: 'heuristics' });
    expect(axios.post).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ method: 'heuristics', total: 2, curated: 2, labeled: 1, described: 0 });
    const kwUpdate = updates.find((u) => JSON.stringify(u.patch).includes('keyword-match'));
    expect(kwUpdate).toBeTruthy(); // the decision's origin is persisted (D-G)
    expect(updates).toHaveLength(1); // the unmatched row is left honestly unlabeled
  });

  test('llm mode: placeholder type upgraded, bounded label + summary written, ingest_labels recomposed', async () => {
    const rows = [
      metaRow({ concept_id: 'borobudur' }),
      metaRow({ concept_id: 'index', is_index: true, type: 'index' })
    ];
    const updates = [];
    mockDb = makeDb(rows, updates);
    llmReply({ type: 'entity', label: 'Culture', summary: 'A 9th century temple.' });
    const progress = [];
    const stats = await service.curateRepoConcepts(REPO, {
      classification: 'llm',
      onProgress: (p) => progress.push(p)
    });
    expect(stats).toMatchObject({
      method: 'llm',
      total: 2,
      curated: 1,
      labeled: 1,
      described: 1,
      typed: 1,
      fallbacks: 0
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toMatchObject({
      type: 'entity',
      labels: ['Culture'],
      summary: 'A 9th century temple.',
      curation: { method: 'llm', resolved_by: 'llm', label_source: 'llm' }
    });
    expect(updates[0].patch.ingest_labels).toContain('CURATED');
    expect(progress[progress.length - 1]).toMatchObject({ curated: 1, labeled: 1 });
  });

  test('bounded growth: an invented label is DROPPED — never written', async () => {
    const updates = [];
    mockDb = makeDb([metaRow()], updates);
    llmReply({ type: 'entity', label: 'MadeUpLabel', summary: 'x' });
    const stats = await service.curateRepoConcepts(REPO, { classification: 'llm' });
    expect(stats.labeled).toBe(0);
    expect(updates[0].patch.labels).toBeUndefined();
    expect(updates[0].patch.curation.label_source).toBe('none');
  });

  test('authorial types are REPLACED by the taxonomy verdict in llm mode (David 2026-09-08)', async () => {
    const updates = [];
    mockDb = makeDb([metaRow({ type: 'Subsidiary' })], updates);
    llmReply({ type: 'entity', label: 'History', summary: 's' });
    await service.curateRepoConcepts(REPO, { classification: 'llm' });
    expect(updates[0].patch.type).toBe('entity'); // the taxonomy verdict lands
    expect(updates[0].patch.labels).toEqual(['History']);
  });

  test("the structural 'index' row is out of curation scope entirely", async () => {
    const updates = [];
    mockDb = makeDb([metaRow({ concept_id: 'index', type: 'index', is_index: true })], updates);
    llmReply({ type: 'topic', label: 'History', summary: 's' });
    await service.curateRepoConcepts(REPO, { classification: 'llm' });
    expect(updates).toHaveLength(0); // never curated, never re-typed
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('fail-soft: LLM error degrades to llm-error and never throws', async () => {
    const updates = [];
    mockDb = makeDb([metaRow()], updates);
    axios.post.mockRejectedValue(new Error('connection refused'));
    const stats = await service.curateRepoConcepts(REPO, { classification: 'llm' });
    expect(stats.fallbacks).toBe(1);
    expect(stats.curated).toBe(1);
    expect(updates[0].patch.curation.resolved_by).toBe('llm-error');
    expect(updates[0].patch.labels).toBeUndefined();
  });

  test('hybrid: labels+describes via LLM; placeholder type reviewed; unparseable response degrades safely', async () => {
    const updates = [];
    mockDb = makeDb([metaRow({ concept_id: 'a' }), metaRow({ concept_id: 'b' })], updates);
    axios.post
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'not json at all' } }] } })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: JSON.stringify({ type: 'entity', label: 'History', summary: 'S' }) } }]
        }
      });
    const stats = await service.curateRepoConcepts(REPO, { classification: 'hybrid' });
    expect(stats.method).toBe('hybrid');
    expect(stats.fallbacks).toBe(1);
    expect(stats.labeled).toBe(1);
  });
});

describe('proposeFrontmatter (#990 D-L)', () => {
  test('repo-wide propose declares ONLY the binds its query uses (live 500 regression)', async () => {
    // Live 2026-09-12: the repo-wide pass bound {r, c: null} while its filter
    // omitted @c — ArangoDB rejects undeclared binds and the Autocorrect
    // scan 500'd. The mocks never execute AQL, so assert the CONTRACT here:
    // every @name in the query text must be present in the bind vars.
    mockDb = makeDb([metaRow(), metaRow({ concept_id: 'c2' })], []);
    await service.proposeFrontmatter(REPO, null, { classification: 'heuristics' });
    const call = mockDb.query.mock.calls.find((c) => String(c[0]).includes('okf_concepts_meta'));
    expect(call).toBeDefined();
    const [query, binds] = call;
    const used = (String(query).match(/@([a-zA-Z_]+)/g) || []).map((s) => s.slice(1));
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) {
      expect(binds).toMatchObject({ [name]: expect.anything() });
    }
    expect(used).not.toContain('c'); // repo-wide pass must not reference @c
  });

  test('single-concept propose declares the @c bind it filters on', async () => {
    mockDb = makeDb([metaRow()], []);
    await service.proposeFrontmatter(REPO, 'c1', { classification: 'heuristics' });
    const call = mockDb.query.mock.calls.find((c) => String(c[0]).includes('okf_concepts_meta'));
    const [query, binds] = call;
    expect(String(query)).toContain('@c');
    expect(binds).toMatchObject({ r: REPO.repo_id, c: 'c1' });
  });

  test('from-empty: blank frontmatter proposes the FULL correct frontmatter', async () => {
    mockDb = makeDb([metaRow({ frontmatter: {} })], []);
    llmReply({ type: 'entity', label: 'Culture', summary: 'Temple summary.' });
    const out = await service.proposeFrontmatter(REPO, 'c1', { classification: 'llm' });
    expect(out.before).toEqual({});
    expect(out.after).toMatchObject({ type: 'entity', labels: ['Culture'], summary: 'Temple summary.', sources: [] });
    const fields = out.changes.map((c) => c.field);
    expect(fields).toEqual(expect.arrayContaining(['type', 'labels', 'summary', 'sources']));
    expect(out.changes.find((c) => c.field === 'labels').reason).toBe('CURATED_LABEL');
  });

  test('heuristics propose: mechanical only — no curated fields, zero LLM calls', async () => {
    mockDb = makeDb([metaRow({ frontmatter: {} })], []);
    const out = await service.proposeFrontmatter(REPO, 'c1', { classification: 'heuristics' });
    expect(axios.post).not.toHaveBeenCalled();
    expect(out.after.type).toBe('topic');
    expect(out.after.labels).toBeUndefined();
    expect(out.after.summary).toBeUndefined();
  });

  test('no change -> no change row; unknown concept -> null', async () => {
    mockDb = makeDb(
      [metaRow({ frontmatter: { type: 'entity', title: 'T', sources: [], labels: ['History'], summary: 'S' } })],
      []
    );
    llmReply({ type: 'entity', label: 'History', summary: 'S' });
    const out = await service.proposeFrontmatter(REPO, 'c1', { classification: 'llm' });
    expect(out.changes.filter((c) => c.reason.startsWith('CURATED'))).toHaveLength(0);
    mockDb = makeDb([], []);
    expect(await service.proposeFrontmatter(REPO, 'ghost', { classification: 'llm' })).toBeNull();
  });
});
