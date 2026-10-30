/**
 * Story 1-8g-p — whole-corpus topic-link authoring.
 *
 * The service is domain-agnostic by construction (no lexicon, no seed words),
 * so the tests assert the GENERIC contract with fixtures from three unrelated
 * subject matters — beans, asteroids and statute sections. If a future change
 * introduces a domain assumption, these fail.
 *
 * Only the pure functions are exercised here: the LLM call and the DB are
 * mocked out, exactly like the rest of the okf-server suite. The AQL and the
 * end-to-end behaviour are verified live against the deployment (unit mocks
 * never execute AQL — that is how the 1-8g-m2 500 shipped).
 */

jest.mock('../shared-lib/db-connection-service');
jest.mock('../shared-lib/tracing', () => ({
  withSpan: (name, fn) => fn({ setAttribute: () => {}, recordException: () => {} })
}));
jest.mock('axios');

const {
  buildNeighborIndex,
  reduceProposals,
  buildLinkMapPrompt,
  tokensFor,
  norm,
  LINK_TYPES,
  enabled,
  RUN_STATE_AQL,
  buildBatches,
  resolveHandle
} = require('../services/topic-link-authoring-service');

const concept = (id, title, extra = {}) => ({ concept_id: id, title, summary: '', links: [], ...extra });

describe('topic-link-authoring-service — genericity', () => {
  it('exposes a relation vocabulary that is meaningful for any subject matter', () => {
    // Every predicate must be domain-neutral: it has to make sense for an
    // asteroid AND for a bean variety. No agriculture/astronomy terms.
    for (const t of LINK_TYPES) expect(typeof t).toBe('string');
    expect(LINK_TYPES).toContain('related_to');
    expect(LINK_TYPES).toContain('is_a');
    expect(LINK_TYPES).toContain('compared_in');
    for (const t of LINK_TYPES) {
      expect(t).not.toMatch(/bean|maize|asteroid|orbit|crop|disease|frijol|tomato/i);
    }
  });

  it('tokenizes title + summary + labels + tags, dropping generic stopwords', () => {
    const toks = tokensFor({
      title: 'Frijol Francés',
      summary: 'A bean variety that is also a disease of the same crop.',
      labels: ['Agriculture'],
      tags: ['seed']
    });
    expect(toks.has('frijol')).toBe(true);
    expect(toks.has('bean')).toBe(true);
    expect(toks.has('that')).toBe(false); // stopword
    expect(toks.has('also')).toBe(false); // stopword
  });

  it('builds the SAME kind of neighbour index for an astronomy corpus', () => {
    const docs = [
      concept('ceres', 'Ceres (dwarf planet)', { summary: 'The largest object in the asteroid belt.' }),
      concept('vesta', 'Vesta (asteroid)', { summary: 'A large asteroid in the main belt.' }),
      concept('mars', 'Mars', { summary: 'The fourth planet from the Sun.' }),
      concept('banjo', 'Banjo (fish)', { summary: 'A species of fish.' })
    ];
    const idx = buildNeighborIndex(docs, 2);
    expect(idx.get('ceres')).toEqual(expect.arrayContaining(['vesta']));
    expect(idx.get('ceres')).not.toContain('ceres'); // no self
    expect(idx.get('vesta')).toContain('ceres'); // the pair is symmetric
    // The unrelated concept must not rank: the discriminator is the shared
    // token ("asteroid"/"belt") carrying the corpus.
    expect(idx.get('ceres').slice(0, 2)).not.toContain('banjo');
  });

  it('does not let a corpus-wide token make everything look related', () => {
    // 20 maize bulletins all say "maize": IDF must push the shared boilerplate
    // below the specific variety names. This is what makes the index behave
    // on templated corpora (the El Salvador bulletins) AND prose corpora.
    const docs = [];
    for (let i = 0; i < 20; i += 1) {
      docs.push(
        concept(`maize-${i}`, `Maize variety ${i}`, {
          summary: `Planting density and fertilization guidance for maize variety ${i}.`
        })
      );
    }
    docs.push(concept('beans', 'Beans', { summary: 'Planting density and fertilization guidance for beans.' }));
    const idx = buildNeighborIndex(docs, 5);
    // variety 0 is most similar to its immediate neighbours by number-token,
    // and must rank the beans doc BELOW the other maize docs on the shared
    // boilerplate alone.
    const neighbours = idx.get('maize-0');
    expect(neighbours).not.toContain('beans');
  });

  it('normalizes concept ids the way every other link consumer does', () => {
    expect(norm('concepts/funding')).toBe('funding');
    expect(norm('funding.md')).toBe('funding');
    expect(norm(undefined)).toBe('');
  });

  it('is enabled by default and disabled only by an explicit 0', () => {
    const prev = process.env.OKF_TOPIC_LINK_ENABLED;
    delete process.env.OKF_TOPIC_LINK_ENABLED;
    expect(enabled()).toBe(true);
    process.env.OKF_TOPIC_LINK_ENABLED = '0';
    expect(enabled()).toBe(false);
    process.env.OKF_TOPIC_LINK_ENABLED = '1';
    expect(enabled()).toBe(true);
    if (prev === undefined) delete process.env.OKF_TOPIC_LINK_ENABLED;
    else process.env.OKF_TOPIC_LINK_ENABLED = prev;
  });
});

describe('topic-link-authoring-service — reduce (the write-safety net)', () => {
  const concepts = [
    concept('a', 'A'),
    concept('b', 'B'),
    concept('c', 'C'),
    concept('d', 'D'),
    // 'e' already links to b
    concept('e', 'E', { links: [{ to_concept_id: 'b', label: 'existing' }] })
  ];

  it('drops self-loops', () => {
    const { plan, stats } = reduceProposals({ concepts, proposals: [{ from: 'a', to: 'a', type: 'is_a' }] });
    expect(plan.size).toBe(0);
    expect(stats.self_loops).toBe(1);
  });

  it('drops dangling targets (the LLM can invent an id)', () => {
    const { plan, stats } = reduceProposals({ concepts, proposals: [{ from: 'a', to: 'nonexistent' }] });
    expect(plan.size).toBe(0);
    expect(stats.dangling).toBe(1);
  });

  it('drops proposals from a concept that is not in the repo', () => {
    const { plan, stats } = reduceProposals({ concepts, proposals: [{ from: 'ghost', to: 'a' }] });
    expect(plan.size).toBe(0);
    expect(stats.unknown_from).toBe(1);
  });

  it('is IDEMPOTENT: a pair already present in links[] is never re-written', () => {
    const { plan, stats } = reduceProposals({ concepts, proposals: [{ from: 'e', to: 'b', label: 'again' }] });
    expect(plan.has('e')).toBe(false);
    expect(stats.already_linked).toBe(1);
  });

  it('collapses duplicate proposals for the same pair', () => {
    const { plan, stats } = reduceProposals({
      concepts,
      proposals: [
        { from: 'a', to: 'b', type: 'is_a', label: 'one' },
        { from: 'a', to: 'b', type: 'related_to', label: 'two' }
      ]
    });
    expect(plan.get('a')).toHaveLength(1);
    expect(stats.duplicates).toBe(1);
  });

  it('caps fan-out per source and reports what it dropped', () => {
    const many = [];
    for (let i = 0; i < 20; i += 1) many.push(concept(`t${i}`, `T${i}`));
    const src = concept('src', 'Src');
    const all = [src, ...many];
    const proposals = many.map((m) => ({ from: 'src', to: m.concept_id, type: 'related_to' }));
    const { plan, stats } = reduceProposals({ concepts: all, proposals, maxPerConcept: 6 });
    expect(plan.get('src')).toHaveLength(6);
    expect(stats.over_cap).toBe(14);
  });

  it('keeps the SPECIFIC relation when the cap bites (related_to is weakest)', () => {
    // 'd' is last alphabetically, so a naive cap on sort order would drop the
    // one genuinely-typed edge.
    const all = [concept('src', 'Src'), concept('a', 'A'), concept('b', 'B'), concept('c', 'C'), concept('d', 'D')];
    const proposals = [
      { from: 'src', to: 'a', type: 'related_to' },
      { from: 'src', to: 'b', type: 'related_to' },
      { from: 'src', to: 'c', type: 'related_to' },
      { from: 'src', to: 'd', type: 'caused_by', label: 'leads to' }
    ];
    const { plan } = reduceProposals({ concepts: all, proposals, maxPerConcept: 2 });
    expect(plan.get('src').map((l) => l.to_concept_id)).toContain('d');
  });

  it('caps deterministically — two runs of the same input agree', () => {
    const all = [concept('src', 'Src'), concept('a', 'A'), concept('b', 'B'), concept('c', 'C')];
    const proposals = [
      { from: 'src', to: 'a', type: 'related_to' },
      { from: 'src', to: 'b', type: 'related_to' },
      { from: 'src', to: 'c', type: 'is_a' }
    ];
    const r1 = reduceProposals({ concepts: all, proposals, maxPerConcept: 2 });
    const r2 = reduceProposals({ concepts: all, proposals, maxPerConcept: 2 });
    expect(r1.plan.get('src')).toEqual(r2.plan.get('src'));
  });

  it('falls back to a known type and a non-empty label', () => {
    const { plan } = reduceProposals({
      concepts: [concept('a', 'Alpha subject'), concept('b', 'Beta subject')],
      proposals: [{ from: 'a', to: 'b', type: 'invented_type', label: '   ' }]
    });
    expect(plan.get('a')[0].type).toBe('related_to');
    expect(plan.get('a')[0].label).toBe('Beta subject');
  });

  it('normalizes a prefixed/.md target before the dangling check', () => {
    const { plan, stats } = reduceProposals({
      concepts,
      proposals: [{ from: 'a', to: 'concepts/b.md', type: 'is_a' }]
    });
    expect(plan.get('a')[0].to_concept_id).toBe('b');
    expect(stats.dangling).toBe(0);
  });

  it('treats a frontmatter `target` link as already-linked (idempotency across shapes)', () => {
    // acceptConceptLink writes {target}; producer writes {to_concept_id}. A
    // re-run must not duplicate an edge just because the shape differs.
    const { plan, stats } = reduceProposals({
      concepts: [concept('a', 'A'), concept('b', 'B', { links: [{ target: 'a.md', label: 'x' }] })],
      proposals: [{ from: 'b', to: 'a' }]
    });
    expect(plan.has('b')).toBe(false);
    expect(stats.already_linked).toBe(1);
  });
});

describe('topic-link-authoring-service — the run-state AQL (a live-probe catch)', () => {
  // Unit mocks never execute AQL, so the first draft of the progress channel
  // bound the repo id to BOTH slots of DOCUMENT() and shipped: ArangoDB reads
  // the FIRST as the collection name, matched nothing and returned 0 documents
  // — no error, the run state simply never landed, and the editor's poll would
  // have seen a null state forever. This pins the two-slot invariant.
  it('DOCUMENT() binds a collection identifier and a key, never the same value twice', () => {
    const args = RUN_STATE_AQL.match(/DOCUMENT\(([^)]*)\)/)[1]
      .split(',')
      .map((s) => s.trim());
    expect(args).toHaveLength(2);
    expect(args[0]).toMatch(/^@\w+$/);
    expect(args[1]).toMatch(/^@\w+$/);
    expect(args[0]).not.toBe(args[1]);
  });

  it('every @bind in the query text is supplied (ArangoDB rejects declared-but-unused)', () => {
    const declared = [...RUN_STATE_AQL.matchAll(/@(\w+)/g)].map((m) => m[1]);
    expect(new Set(declared)).toEqual(new Set(['collection', 'repo_id', 'patch']));
  });
});

describe('topic-link-authoring-service — the detached run reaches a DURABLE terminal state', () => {
  // Live catch (2026-10-11): the run wrote 472 links and reported status
  // 'failed' with "the run was interrupted before it finished". The progress
  // writes were fire-and-forget and `inflight` was cleared in a finally, so a
  // poll landing between "pass finished" and "terminal state written" read
  // running-with-no-worker and the guard called it an interruption. These pin
  // the ordering that closes the window.
  let svc;
  let db;
  let written;

  beforeEach(() => {
    jest.resetModules();
    for (const k of ['VLLM_ENDPOINT', 'VLLM_MODEL_ID']) process.env[k] = 'http://vllm.test:8000/v1';
    process.env.VLLM_MODEL_ID = 'test-model';
    svc = require('../services/topic-link-authoring-service');
    db = require('../shared-lib/db-connection-service');
    const http = require('axios');
    const rows = [
      concept('a', 'Alpha subject', { summary: 'alpha' }),
      concept('b', 'Beta subject', { summary: 'beta' })
    ];
    written = [];
    db.getConnection.mockResolvedValue({
      query: jest.fn((q, bind) => {
        if (String(q).includes('okf_concepts_meta')) return { all: async () => rows };
        // Every state write is recorded; the LAST one is what a poll would read.
        if (bind && bind.patch) written.push({ ...bind.patch });
        return { all: async () => [] };
      })
    });
    http.post.mockResolvedValue({
      data: {
        choices: [
          { message: { content: JSON.stringify({ links: [{ from: 'D1', to: 'P1', type: 'is_a', label: 'x' }] }) } }
        ]
      }
    });
  });

  afterEach(() => {
    delete process.env.VLLM_ENDPOINT;
    delete process.env.VLLM_MODEL_ID;
  });

  it('writes a terminal status of done, and it is the LAST state written', async () => {
    const { status } = await svc.startTopicLinkRun({ repo_id: 'r1' });
    expect(status).toBe('running'); // the 202 payload
    // Let the detached runner finish.
    for (let i = 0; i < 20 && !written.some((w) => w.status === 'done'); i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(written.length).toBeGreaterThan(1);
    expect(written[written.length - 1].status).toBe('done');
    expect(written[written.length - 1].finished_at).toBeTruthy();
    // The state a poll would read is terminal — never the mid-run 'running'.
    const polled = await svc.getTopicLinkRunState({ repo_id: 'r1', topic_links: written[written.length - 1] });
    expect(polled.status).toBe('done');
  });

  it('never leaves a non-terminal state once the runner has settled', async () => {
    await svc.startTopicLinkRun({ repo_id: 'r1' });
    for (let i = 0; i < 20 && !written.some((w) => w.status === 'done'); i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 40));
    const tail = written[written.length - 1];
    expect(['done', 'failed']).toContain(tail.status);
  });
});

describe('topic-link-authoring-service — map prompt', () => {
  it('states the domain is arbitrary and pins the response shape + vocabulary', () => {
    const { messages } = buildLinkMapPrompt(
      [concept('m1', 'Ceres', { body: 'text' })],
      [{ concept_id: 'm2', title: 'Vesta' }]
    );
    const system = messages[0].content;
    expect(system).toContain('subject domain is arbitrary');
    expect(system).toContain('STRICT JSON');
    for (const t of LINK_TYPES) expect(system).toContain(t);
    expect(messages[1].content).toContain('D1: Ceres');
    expect(messages[1].content).toContain('P1: Vesta');
  });

  it('NEVER puts a raw concept id in the prompt (live: long slugs ate the whole completion budget)', () => {
    // The first live run returned finish_reason=length with the JSON truncated
    // mid-string, because every link repeated two ~20-token slugs. Handles keep
    // the ids in the process; the prompt carries titles only.
    const longId = '122-manejo-agroecologico-del-gusano-cogollero-del-maiz-en-me-sec1';
    const { messages, handles } = buildLinkMapPrompt(
      [concept(longId, 'Fall Armyworm management', { body: 'x' })],
      [{ concept_id: `${longId}-peer`, title: 'Fall Armyworm in maize' }]
    );
    const prompt = messages.map((m) => m.content).join('\n');
    expect(prompt).not.toContain(longId);
    expect(prompt).toContain('Fall Armyworm management');
    expect(handles.get('D1')).toBe(longId);
    expect(handles.get('P1')).toBe(`${longId}-peer`);
  });

  it('resolves a handle back to the real id, and tolerates a raw id the model echoed', () => {
    const { handles } = buildLinkMapPrompt([concept('a1', 'A')], [{ concept_id: 'b1', title: 'B' }]);
    expect(resolveHandle('D1', handles)).toBe('a1');
    expect(resolveHandle('P1', handles)).toBe('b1');
    expect(resolveHandle('a1', handles)).toBe('a1'); // echoed back verbatim
    expect(resolveHandle('concepts/a1.md', handles)).toBe('a1'); // decorated echo
    expect(resolveHandle('P99', handles)).toBeNull(); // hallucinated handle
    expect(resolveHandle(undefined, handles)).toBeNull();
  });
});

describe('topic-link-authoring-service — batching spans source documents', () => {
  it('does not deal seven sections of ONE document into the same batch', () => {
    // Live: sorting by concept_id put `…-sec1` … `…-sec7` in batch 1, spending
    // the pass on intra-document edges instead of cross-document linking.
    const concepts = [
      ...Array.from({ length: 7 }, (_, i) => concept(`bulletin-a-sec${i + 1}`, `A${i + 1}`)),
      ...Array.from({ length: 3 }, (_, i) => concept(`bulletin-b-sec${i + 1}`, `B${i + 1}`)),
      ...Array.from({ length: 3 }, (_, i) => concept(`bulletin-c-sec${i + 1}`, `C${i + 1}`))
    ];
    const batches = buildBatches(concepts, 6);
    const sources = batches[0].map((c) => c.concept_id.replace(/-sec\d+$/, ''));
    expect(new Set(sources).size).toBeGreaterThan(1);
  });

  it('loses nothing: every concept appears in exactly one batch', () => {
    const concepts = [
      ...Array.from({ length: 40 }, (_, i) => concept(`big-doc-sec${i + 1}`, `T${i + 1}`)),
      ...Array.from({ length: 5 }, (_, i) => concept(`other-${i}`, `O${i}`))
    ];
    const batches = buildBatches(concepts, 8);
    const flat = batches.flat().map((c) => c.concept_id);
    expect(flat).toHaveLength(concepts.length);
    expect(new Set(flat).size).toBe(concepts.length);
  });

  it('is deterministic — a re-run batches identically (the cap is order-sensitive)', () => {
    const concepts = Array.from({ length: 30 }, (_, i) => concept(`d${i % 6}-sec${i}`, `T${i}`));
    expect(buildBatches(concepts, 7)).toEqual(buildBatches(concepts, 7));
  });
});

describe('topic-link-authoring-service — fail-soft end to end', () => {
  const loadRows = (rows) => ({
    all: async () => rows
  });

  // resetModules gives the SERVICE a fresh module registry, so the dbService +
  // axios handles the service sees are DIFFERENT instances from the ones the
  // test file captured at require time. Both must be re-required per test.
  let svc;
  let db;
  let http;
  const savedEnv = {};

  beforeEach(() => {
    jest.resetModules();
    // callVllm refuses to dial a missing endpoint ("llm-not-configured") — the
    // same guard the curation pass uses. Give it an endpoint so the mocked
    // axios is actually reached.
    for (const k of ['VLLM_ENDPOINT', 'VLLM_MODEL_ID']) {
      savedEnv[k] = process.env[k];
      process.env[k] = 'http://vllm.test:8000/v1';
    }
    process.env.VLLM_MODEL_ID = 'test-model';
    svc = require('../services/topic-link-authoring-service');
    db = require('../shared-lib/db-connection-service');
    http = require('axios');
    db.getConnection.mockResolvedValue({ query: jest.fn(() => loadRows([])) });
    http.post.mockResolvedValue({ data: { choices: [{ message: { content: '{"links":[]}' } }] } });
  });

  afterEach(() => {
    for (const k of ['VLLM_ENDPOINT', 'VLLM_MODEL_ID']) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('returns an honest zero rather than throwing when the LLM is down', async () => {
    db.getConnection.mockResolvedValue({
      query: jest.fn(() =>
        loadRows([concept('a', 'Alpha', { summary: 'alpha text' }), concept('b', 'Beta', { summary: 'beta text' })])
      )
    });
    http.post.mockRejectedValue(new Error('connection refused'));
    const res = await svc.authorRepoTopicLinks({ repo_id: 'r1' });
    expect(res.written).toBe(0);
    expect(res.failures).toBeGreaterThan(0);
  });

  it('writes nothing for a repo with fewer than two subjects', async () => {
    db.getConnection.mockResolvedValue({ query: jest.fn(() => loadRows([concept('only', 'Only')])) });
    const res = await svc.authorRepoTopicLinks({ repo_id: 'r1' });
    expect(res.skipped).toBe('TOO_FEW_SUBJECTS');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('dry_run proposes without writing', async () => {
    const rows = [
      concept('a', 'Anthracnose in maize', { summary: 'a fungal disease of maize' }),
      concept('b', 'Common rust in maize', { summary: 'another fungal disease of maize' }),
      concept('c', 'Tomato early blight', { summary: 'a disease of tomato' })
    ];
    db.getConnection.mockResolvedValue({ query: jest.fn(() => loadRows(rows)) });
    http.post.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                links: [{ from: 'a', to: 'b', type: 'compared_in', label: 'both maize diseases' }]
              })
            }
          }
        ]
      }
    });
    const res = await svc.authorRepoTopicLinks({ repo_id: 'r1' }, { dryRun: true });
    expect(res.dry_run).toBe(true);
    expect(res.kept).toBe(1);
    expect(res.written).toBe(0);
    expect(res.plan.a[0]).toMatchObject({ to_concept_id: 'b', type: 'compared_in' });
  });

  it('survives an unparseable batch (one bad response never fails the pass)', async () => {
    const rows = [
      concept('a', 'Alpha subject', { summary: 'alpha' }),
      concept('b', 'Beta subject', { summary: 'beta' })
    ];
    db.getConnection.mockResolvedValue({ query: jest.fn(() => loadRows(rows)) });
    http.post.mockResolvedValue({ data: { choices: [{ message: { content: 'not json at all' } }] } });
    const res = await svc.authorRepoTopicLinks({ repo_id: 'r1' });
    expect(res.failures).toBe(1);
    expect(res.kept).toBe(0);
  });

  it('excludes the bundle index from the authoring surface', async () => {
    // The index is the discovery root, not a topic — linking it to everything
    // would paint a star that carries no information.
    const rows = [
      concept('index', 'Imported knowledge base', { is_index: true, summary: 'table of contents' }),
      concept('a', 'Alpha subject', { summary: 'alpha' }),
      concept('b', 'Beta subject', { summary: 'beta' })
    ];
    db.getConnection.mockResolvedValue({ query: jest.fn(() => loadRows(rows)) });
    const res = await svc.authorRepoTopicLinks({ repo_id: 'r1' }, { dryRun: true });
    expect(res.total).toBe(2);
    expect(res.plan.index).toBeUndefined();
  });
});

// #1181 — the topic-link client's model-id policy (!631): the pin wins,
// else the model is discovered from the endpoint, and the probe shares
// the call budget.
describe('callVllm — model-id resolution (!631 policy)', () => {
  // The service is required INSIDE each test after a resetModules (this file
  // resets the registry in another describe) — the cache handle must come
  // from the SAME registry, or the test clears an instance the service never
  // reads.
  let cache;
  // Two concepts, so the LLM pass actually fires.
  const rows = [
    { concept_id: 'a', title: 'Alpha subject', summary: 'alpha', links: [] },
    { concept_id: 'b', title: 'Beta subject', summary: 'beta', links: [] }
  ];
  const loadAll = () => ({ all: async () => rows });
  const { isolateVllmEnv } = require('./vllm-env-helper');
  const ENV_KEYS = ['VLLM_MODEL_ID', 'VLLM_LLM_MODEL_ID', 'VLLM_ENDPOINT'];

  isolateVllmEnv(ENV_KEYS);

  beforeEach(() => {
    jest.resetModules();
    cache = require('../services/vllm-model-cache');
    cache.clearModelCache();
    // The axios mock is shared across this file's tests — start clean.
    require('axios').get.mockReset();
    require('axios').post.mockReset();
    // The deployment endpoint (the client resolves against it).
    process.env.VLLM_ENDPOINT = 'http://vllm.test:8000/v1';
  });

  afterEach(() => {
    cache.clearModelCache();
  });

  it('no pin: the chat body carries the model discovered from the endpoint', async () => {
    const svc2 = require('../services/topic-link-authoring-service');
    const db2 = require('../shared-lib/db-connection-service');
    const http2 = require('axios');
    db2.getConnection.mockResolvedValue({ query: jest.fn(() => loadAll()) });
    http2.get.mockResolvedValue({ data: { data: [{ id: 'served/linker-8b' }] } });
    http2.post.mockResolvedValue({
      data: { choices: [{ message: { content: JSON.stringify({ links: [] }) } }] }
    });
    await svc2.authorRepoTopicLinks({ repo_id: 'r1' });
    expect(http2.get).toHaveBeenCalledWith('http://vllm.test:8000/v1/models', expect.anything());
    const call = http2.post.mock.calls.find((c) => String(c[0]).includes('/chat/completions'));
    expect(call[1].model).toBe('served/linker-8b');
  });

  it('no pin and nothing discoverable: zero links, no call under a fabricated name', async () => {
    const svc2 = require('../services/topic-link-authoring-service');
    const db2 = require('../shared-lib/db-connection-service');
    const http2 = require('axios');
    db2.getConnection.mockResolvedValue({ query: jest.fn(() => loadAll()) });
    http2.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await svc2.authorRepoTopicLinks({ repo_id: 'r1' });
    expect(res.written).toBe(0);
    expect(res.failures).toBeGreaterThan(0);
    expect(http2.post.mock.calls.filter((c) => String(c[0]).includes('/chat/completions'))).toHaveLength(0);
  });

  it('r4: the discovery probe is bounded by the call budget', async () => {
    const svc2 = require('../services/topic-link-authoring-service');
    const db2 = require('../shared-lib/db-connection-service');
    const http2 = require('axios');
    const conceptRows = [
      { concept_id: 'a', title: 'Alpha subject', summary: 'alpha', links: [] },
      { concept_id: 'b', title: 'Beta subject', summary: 'beta', links: [] }
    ];
    db2.getConnection.mockResolvedValue({
      query: jest.fn(() => ({ all: async () => conceptRows }))
    });
    http2.get.mockResolvedValue({ data: { data: [{ id: 'served/linker-8b' }] } });
    http2.post.mockResolvedValue({
      data: { choices: [{ message: { content: JSON.stringify({ links: [] }) } }] }
    });
    await svc2.authorRepoTopicLinks({ repo_id: 'r1' });
    // This scenario's own probe (the mock is fresh here).
    expect(http2.get).toHaveBeenCalledTimes(1);
    const probeTimeout = http2.get.mock.calls[0][1].timeout;
    expect(probeTimeout).toBeLessThanOrEqual(10000); // the env ceiling
    expect(probeTimeout).toBeGreaterThan(0);
  });
});
