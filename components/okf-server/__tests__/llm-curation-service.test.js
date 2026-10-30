/**
 * D-B (#980) + D-L (#990) — llm-curation-service tests.
 * Mode gating, bounded KH labels, fail-soft fallback, authorial-type guard,
 * from-empty propose, and the drain-bound ingest_labels recomposition.
 */

jest.mock('axios');
jest.mock('../services/ingest-service', () => ({
  composeIngestLabels: jest.fn(() => ['t:demo', 'r:repo-1', 'd:demo', 'CURATED'])
}));
// 8-7 model configs — default: no override (env path, exactly pre-8-7).
jest.mock('../services/model-config-service', () => ({
  resolveModelOverride: jest.fn(async () => null)
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

function makeDb(rows, updates, opts = {}) {
  return {
    query: jest.fn(async (q) => ({
      all: async () => {
        if (q.includes('serviceCategories')) return AREAS;
        if (q.includes('FROM-CONCEPTS')) return rows;
        if (q.includes('FOR s IN services')) return opts.areaLabels === null ? [] : AREA_LABELS;
        // The terminal reconcile: ONE authoritative count of labelled
        // curatable concepts. `labelledCount` overrides it (another writer /
        // a stale in-memory count); otherwise it is computed from the rows,
        // which `update` mutates exactly like a real write would.
        if (q.includes('COLLECT WITH COUNT INTO labelled')) {
          const n =
            opts.labelledCount != null
              ? opts.labelledCount
              : rows.filter((r) => !r.is_index && Array.isArray(r.labels) && r.labels.length > 0).length;
          return [{ labelled: n }];
        }
        if (q.includes('okf_concepts_meta')) return rows;
        return [];
      }
    })),
    // The write is applied to the row itself — a real ArangoDB update mutates
    // the document and the terminal reconcile reads it back. Without this the
    // count query could only ever see the PRE-pass state.
    collection: jest.fn(() => ({
      update: jest.fn(async (k, patch) => {
        const row = rows.find((r) => r._key === k);
        if (row) Object.assign(row, patch);
        updates.push({ k, patch });
      })
    }))
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
    // curated counts concepts that CARRY LABELS, not concepts the pass walked
    // past: the unmatched row is still an honest gap (curated 1 of total 2).
    expect(stats).toMatchObject({ method: 'heuristics', total: 2, curated: 1, labeled: 1, described: 0 });
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
      total: 1, // the structural index row is NOT part of the denominator
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

  test('8-7 routing: an ACTIVE okf_curation model config takes the LLM call; env otherwise', async () => {
    const modelConfig = require('../services/model-config-service');
    const updates = [];
    mockDb = makeDb([metaRow()], updates);
    llmReply({ type: 'entity', label: 'Culture', summary: 's' });
    // an openai-wire active config checked for curation → the call follows it
    modelConfig.resolveModelOverride.mockResolvedValueOnce({
      provider: 'openai',
      base_url: 'https://frontier.example/v1',
      model: 'frontier-curator',
      api_key: 'fk-1',
      source: 'active',
      config_key: 'mc1',
      config_name: 'Frontier'
    });
    await service.curateRepoConcepts(REPO, { classification: 'llm' });
    expect(axios.post).toHaveBeenCalledWith(
      'https://frontier.example/v1/chat/completions',
      // BOTH no-think conventions ride the override-routed call — the
      // adaptive layer negotiates away whichever the endpoint rejects.
      expect.objectContaining({ model: 'frontier-curator', thinking: { type: 'disabled' }, enable_thinking: false }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer fk-1' }) })
    );
    // an anthropic-provider active config is NOT usable by this openai-wire
    // client — the call stays on env
    axios.post.mockClear();
    modelConfig.resolveModelOverride.mockResolvedValueOnce({
      provider: 'anthropic',
      base_url: 'https://api.anthropic.com',
      model: 'claude-x',
      api_key: 'ak',
      source: 'active',
      config_key: 'mc2',
      config_name: 'Ant'
    });
    await service.curateRepoConcepts(REPO, { classification: 'llm' });
    expect(axios.post).toHaveBeenCalledWith(
      'http://vllm:8000/v1/chat/completions',
      expect.objectContaining({ model: 'test-model' }),
      expect.anything()
    );
    // env path: NO thinking param — only override-routed calls ask for it
    const envCall = axios.post.mock.calls.find((c) => c[0] === 'http://vllm:8000/v1/chat/completions');
    expect(envCall[1].thinking).toBeUndefined();
    // and the service tag it resolved with
    expect(modelConfig.resolveModelOverride).toHaveBeenCalledWith({ service: 'okf_curation' });
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
    // The concept was TOUCHED but stays unlabelled — the bar must not count it.
    expect(stats.curated).toBe(0);
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

// ── THE CURATION BAR COUNTERS ─────────────────────────────────────────────
// The Studio "Curating" bar reads repo.curation, so the numerator and the
// denominator MUST describe the same population. Live 2026-10-12: a repo of
// 141 concepts (19 of them pre-labelled by the FR-42 tabular import path) froze
// at "61 of 141" because `curated` counted what THIS pass labelled while
// `total` counted what EXISTS — and the never-curated index row made the
// terminal state unreachable by construction. Every test below fails if the
// counter contract is reverted.
describe('progress counters: one population, reachable terminal state', () => {
  const indexRow = () => metaRow({ concept_id: 'index', is_index: true, type: 'index' });

  test('concepts that already carry labels are counted from the FIRST tick', async () => {
    const rows = [
      metaRow({ concept_id: 'a', labels: ['Culture'] }), // tabular import / prior pass
      metaRow({ concept_id: 'b' })
    ];
    mockDb = makeDb(rows, []);
    const progress = [];
    await service.curateRepoConcepts(REPO, { classification: 'heuristics', onProgress: (p) => progress.push(p) });
    expect(progress.length).toBeGreaterThan(0);
    // The baseline tick is emitted BEFORE any work lands — the curator's very
    // first sighting of the bar already includes the pre-labelled concept.
    expect(progress[0]).toMatchObject({ total: 2, curated: 1, done: 1, pre_labelled: 1 });
    expect(progress[0].curated).not.toBe(0);
  });

  test('a repo whose concepts are ALL pre-labelled reports its full count, not 0', async () => {
    const rows = [
      metaRow({ concept_id: 'a', labels: ['Culture'] }),
      metaRow({ concept_id: 'b', labels: ['History'] }),
      indexRow()
    ];
    mockDb = makeDb(rows, []);
    const progress = [];
    const stats = await service.curateRepoConcepts(REPO, {
      classification: 'heuristics',
      onProgress: (p) => progress.push(p)
    });
    const last = progress[progress.length - 1];
    expect(last).toMatchObject({ total: 2, curated: 2, final: true });
    expect(last.curated).toBe(last.total); // the bar reads COMPLETE, not untouched
    expect(stats).toMatchObject({ total: 2, curated: 2 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('the index row is excluded from total, so a completed pass satisfies curated === total', async () => {
    // Heuristics: the only curatable concept matches a KH L2 keyword.
    const rows = [metaRow({ concept_id: 'pol', title: 'Political Reform' }), indexRow()];
    mockDb = makeDb(rows, []);
    const progress = [];
    await service.curateRepoConcepts(REPO, { classification: 'heuristics', onProgress: (p) => progress.push(p) });
    const last = progress[progress.length - 1];
    expect(last.total).toBe(1); // was 2 with the index row in the denominator
    expect(last.curated).toBe(1);
    expect(last.curated).toBe(last.total); // reachable, not merely closer

    // llm mode over the same shape — two labelled concepts plus the index root.
    const rows2 = [metaRow({ concept_id: 'x' }), metaRow({ concept_id: 'y' }), indexRow()];
    mockDb = makeDb(rows2, []);
    llmReply({ type: 'entity', label: 'Culture', summary: 's' });
    const progress2 = [];
    await service.curateRepoConcepts(REPO, { classification: 'llm', lanes: 1, onProgress: (p) => progress2.push(p) });
    const last2 = progress2[progress2.length - 1];
    expect(last2.total).toBe(2);
    expect(last2.curated).toBe(2);
    expect(last2.curated).toBe(last2.total);
  });

  test('the final tick equals an authoritative DATABASE count of labelled concepts', async () => {
    // Six curatable concepts; the database says four carry labels (another
    // writer, a retry, a partially applied pass). The terminal tick must report
    // the database's number, not the pass's own tally.
    const rows = Array.from({ length: 6 }, (_, i) => metaRow({ concept_id: 'c' + i }));
    mockDb = makeDb(rows, [], { labelledCount: 4 });
    const progress = [];
    await service.curateRepoConcepts(REPO, { classification: 'heuristics', onProgress: (p) => progress.push(p) });
    const last = progress[progress.length - 1];
    expect(last.final).toBe(true);
    expect(last.curated).toBe(4);
    expect(Math.max(...progress.map((p) => p.curated))).toBe(4); // nothing ever exceeded it
  });

  test('the terminal count can never exceed the denominator it divides by', async () => {
    const rows = [metaRow({ concept_id: 'a' }), metaRow({ concept_id: 'b' })];
    mockDb = makeDb(rows, [], { labelledCount: 99 }); // rows added mid-pass
    const progress = [];
    await service.curateRepoConcepts(REPO, { classification: 'heuristics', onProgress: (p) => progress.push(p) });
    const last = progress[progress.length - 1];
    expect(last.curated).toBe(2);
    expect(last.curated).toBeLessThanOrEqual(last.total);
  });

  test('the number never decreases across ticks', async () => {
    const rows = [
      metaRow({ concept_id: 'a' }),
      metaRow({ concept_id: 'b', labels: ['Culture'] }), // pre-labelled
      metaRow({ concept_id: 'c' }),
      metaRow({ concept_id: 'd' })
    ];
    mockDb = makeDb(rows, []);
    // Deterministic order (lanes 1) and a verdict mix: a label, no_label, a
    // label, then an unparseable response. Only labels LAND count.
    axios.post
      .mockResolvedValueOnce({
        data: { choices: [{ message: { content: JSON.stringify({ label: 'History', summary: 's' }) } }] }
      })
      .mockResolvedValueOnce({
        data: { choices: [{ message: { content: JSON.stringify({ label: 'no_label', summary: 's' }) } }] }
      })
      .mockResolvedValueOnce({
        data: { choices: [{ message: { content: JSON.stringify({ label: 'Culture', summary: 's' }) } }] }
      })
      .mockResolvedValue({ data: { choices: [{ message: { content: 'not json' } }] } });
    const progress = [];
    const stats = await service.curateRepoConcepts(REPO, {
      classification: 'llm',
      lanes: 1,
      onProgress: (p) => progress.push(p)
    });
    const series = progress.map((p) => p.curated);
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i]).toBeGreaterThanOrEqual(series[i - 1]);
    }
    // 1 pre-labelled + 2 labels landed on previously unlabelled concepts; the
    // pre-labelled concept's own re-verdict and the unparseable one add
    // nothing, because neither produced a NEW label for an unlabelled concept.
    expect(series[0]).toBe(1);
    expect(stats.curated).toBe(3);
    expect(stats.total).toBe(4);
  });

  test('the early-return paths report the honest count, as a TERMINAL tick', async () => {
    // (a) Subject Area with no KH L2 labels -> heuristics skips the work, but
    //     the repo's pre-labelled concepts still count.
    const rows = [metaRow({ concept_id: 'a', labels: ['Culture'] }), metaRow({ concept_id: 'b' })];
    mockDb = makeDb(rows, [], { areaLabels: null });
    const progress = [];
    const stats = await service.curateRepoConcepts(REPO, {
      classification: 'heuristics',
      onProgress: (p) => progress.push(p)
    });
    const last = progress[progress.length - 1];
    expect(last).toMatchObject({ total: 2, curated: 1, final: true });
    expect(stats.curated).toBe(1);

    // (b) No parsed rows at all -> a real terminal state, not a stalled pass.
    mockDb = makeDb([], []);
    const progress2 = [];
    await service.curateRepoConcepts(REPO, { classification: 'heuristics', onProgress: (p) => progress2.push(p) });
    expect(progress2[progress2.length - 1]).toMatchObject({ total: 0, curated: 0, final: true });
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

  test('repo-wide CURATED propose over the cap is refused, not hung (gov-uk 997-concept regression)', async () => {
    mockDb = makeDb(
      Array.from({ length: 26 }, (_, i) => metaRow({ concept_id: 'c' + i })),
      []
    );
    await expect(service.proposeFrontmatter(REPO, null, { classification: 'llm' })).rejects.toMatchObject({
      code: 'CURATED_PROPOSE_TOO_BROAD',
      status: 409
    });
    // Zero LLM calls — the refusal happens before any curation work.
    expect(axios.post).not.toHaveBeenCalled();
    // Heuristics over the same rows stays unbounded (pure planning).
    mockDb = makeDb(
      Array.from({ length: 26 }, (_, i) => metaRow({ concept_id: 'c' + i })),
      []
    );
    const out = await service.proposeFrontmatter(REPO, null, { classification: 'heuristics' });
    expect(Array.isArray(out) ? out.length : 1).toBeGreaterThan(0);
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

// #1041 — taxonomy-typo guard. The LLM is bounded to the area's KH L2 list,
// so a misspelled label in the source-of-truth taxonomy propagates verbatim
// onto every curated concept. This guard fails the build if any service's
// nameEN looks like a typo of a known-good spelling — same idea as the
// concept-editor's "common typos" reject (a typo needs to be caught at the
// source, not at every concept that inherits it).
describe('taxonomy spelling — services.nameEN vs the bounded list the LLM uses (#1041)', () => {
  // The typo the LLM silently propagated was 'Intervantions' (missing 'e').
  // Pin the known misspellings here; the guard fails on a hit.
  const KNOWN_BAD_SPELLINGS = ['Intervantions'];

  // A "looks-like-X" edit-distance: a 1-letter diff where the result is a
  // real word in our list is a typo; a totally different word is not.
  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const d = Array.from({ length: m + 1 }, () => new Array(n + 1));
    for (let i = 0; i <= m; i += 1) d[i][0] = i;
    for (let j = 0; j <= n; j += 1) d[0][j] = j;
    for (let i = 1; i <= m; i += 1) {
      for (let j = 1; j <= n; j += 1) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[m][n];
  }

  test('every services.nameEN matches its canonical spelling (edit-distance <= 1 vs a "close" peer is rejected)', async () => {
    const dbService = require('../shared-lib/db-connection-service');
    const db = await dbService.getConnection('default');
    const services = await (await db.query('FOR s IN services RETURN s.nameEN')).all();
    expect(services.length).toBeGreaterThan(0);

    const failures = [];
    for (const name of services.map((r) => r.nameEN)) {
      if (KNOWN_BAD_SPELLINGS.includes(name)) {
        failures.push(name + ' is a known typo');
        continue;
      }
      // No comparator list here — we only fail on the known-bad pin AND on
      // 1-char-diff matches vs OTHER names in the same collection (catches
      // a NEW typo introduced by a future admin edit). A brand-new correctly
      // spelled entry is fine.
      for (const peer of services) {
        if (peer.nameEN === name) continue;
        if (Math.abs(peer.nameEN.length - name.length) > 1) continue;
        const d = levenshtein(name.toLowerCase(), peer.nameEN.toLowerCase());
        if (d === 1) failures.push(name + ' is edit-distance 1 from ' + peer.nameEN);
      }
    }
    expect(failures).toEqual([]);
  });
});

// #1181 — model-id resolution follows the !631 discovery policy: env pin >
// /v1/models discovery > loud failure. The dead `config?.llm` reads are gone;
// with the pin unset the call names the model the endpoint actually serves.
// The model-id policy of the curation client (!631, #1181): the pin wins,
// else the model is discovered from the endpoint, and the probe and the
// chat call carry the SAME credential.
describe('curation callVllm — model-id resolution (!631 policy)', () => {
  const cache = require('../services/vllm-model-cache');
  const ENV_KEYS = ['VLLM_MODEL_ID', 'VLLM_API_KEY', 'VLLM_LLM_API_KEY'];
  let saved = {};

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    cache.clearModelCache();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    cache.clearModelCache();
  });

  test('no pin: the call carries the model discovered from the endpoint', async () => {
    delete process.env.VLLM_MODEL_ID;
    mockDb = makeDb([metaRow()], []);
    axios.get.mockReset();
    axios.get.mockResolvedValue({ data: { data: [{ id: 'served/curator-8b' }] } });
    llmReply({ type: 'entity', label: 'Culture', summary: 's' });
    const stats = await service.curateRepoConcepts(REPO, { classification: 'llm' });
    expect(stats.method).toBe('llm');
    expect(axios.get).toHaveBeenCalledWith('http://vllm:8000/v1/models', expect.anything());
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ model: 'served/curator-8b' }),
      expect.anything()
    );
  });

  test('no pin and nothing discoverable: loud resolution failure degrades to llm-error — no fabricated name is sent', async () => {
    delete process.env.VLLM_MODEL_ID;
    mockDb = makeDb([metaRow()], []);
    axios.get.mockReset();
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const stats = await service.curateRepoConcepts(REPO, { classification: 'llm' });
    expect(stats.fallbacks).toBe(1);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('a modelless named-config base resolves its OWN served model (the pin never names a foreign endpoint)', async () => {
    const modelConfig = require('../services/model-config-service');
    mockDb = makeDb([metaRow()], []);
    modelConfig.resolveModelOverride.mockResolvedValueOnce({
      provider: 'openai',
      base_url: 'https://frontier.example/v1',
      model: null,
      api_key: 'fk-9',
      source: 'active',
      config_key: 'mc9',
      config_name: 'Frontier (modelless)'
    });
    axios.get.mockReset();
    axios.get.mockResolvedValue({ data: { data: [{ id: 'frontier/served' }] } });
    llmReply({ type: 'entity', label: 'Culture', summary: 's' });
    await service.curateRepoConcepts(REPO, { classification: 'llm' });
    expect(axios.get).toHaveBeenCalledWith('https://frontier.example/v1/models', expect.anything());
    expect(axios.post).toHaveBeenCalledWith(
      'https://frontier.example/v1/chat/completions',
      expect.objectContaining({ model: 'frontier/served' }),
      expect.anything()
    );
  });

  it('VLLM_LLM_API_KEY only: the chat call authenticates like the probe', async () => {
    delete process.env.VLLM_MODEL_ID;
    delete process.env.VLLM_API_KEY;
    process.env.VLLM_LLM_API_KEY = 'llm-spelled-key';
    cache.clearModelCache();
    mockDb = makeDb([metaRow()], []);
    axios.get.mockReset();
    axios.get.mockResolvedValue({ data: { data: [{ id: 'served/curator-8b' }] } });
    axios.post.mockReset();
    llmReply({ type: 'entity', label: 'Culture', summary: 's' });
    await service.curateRepoConcepts(REPO, { classification: 'llm' });
    expect(axios.get.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer llm-spelled-key' });
    const [, , cfg] = axios.post.mock.calls[0];
    expect(cfg.headers.Authorization).toBe('Bearer llm-spelled-key');
  });
});
