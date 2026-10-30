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
// 8-7 model configs — default: no override (env path, exactly pre-8-7).
jest.mock('../services/model-config-service', () => ({
  resolveModelOverride: jest.fn(async () => null)
}));

const svc = require('../services/frontmatter-service');
const axios = require('axios');
const { __mockDb } = require('../shared-lib/db-connection-service');
const { updateSchema, TAG_LIMITS } = require('../validators/repository-validator');

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

// 1-8g-m: the concept query now returns GROUPS (one per primary label) —
// {label, total, sample[]} — so the sampler sees the complete label
// distribution AND a bounded per-label sample in one pass. This mirrors the
// AQL: FOR m ... LET lab = m.labels[0] ... COLLECT lab = lab INTO rows = m
//       LET s = (FOR x IN (FOR r2 IN rows SORT r2._key LIMIT @perLabel) RETURN {...})
function groupConcepts(concepts) {
  const byLabel = new Map();
  for (const c of concepts) {
    const label = (Array.isArray(c.labels) && c.labels.length && c.labels[0]) || '(unlabeled)';
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(c);
  }
  return [...byLabel.entries()].map(([label, rows]) => ({ label, total: rows.length, sample: rows }));
}

function seedDb({ concepts = CONCEPT_ROWS } = {}) {
  __mockDb.query.mockImplementation((q) => {
    const text = typeof q === 'string' ? q : q && q.query ? q.query : '';
    if (text.includes('okf_repositories')) {
      return Promise.resolve({ all: async () => [REPO_ROW] });
    }
    if (text.includes('okf_concepts_meta')) {
      return Promise.resolve({ all: async () => groupConcepts(concepts) });
    }
    return Promise.resolve({ all: async () => [] });
  });
}

function vllmResponse(content, finishReason = 'stop') {
  return {
    data: { choices: [{ message: { content }, finish_reason: finishReason }], usage: { total_tokens: 42 } }
  };
}

beforeEach(() => {
  __mockDb.query.mockReset();
  axios.post.mockReset();
  // Discovery probe default (see the #1181 describe at the bottom for the
  // dedicated resolution tests): every legacy test flows through the
  // /v1/models probe unless it pins or overrides the model.
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: { data: [{ id: 'test/served-model' }] } });
  delete process.env.VLLM_LLM_MODEL_ID;
  delete process.env.VLLM_MODEL_ID;
  require('../services/vllm-model-cache').clearModelCache();
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

  // 2026-10-11 live incident (repo da894635, 586 concepts): granite looped on
  // "centa-cpc" inside the entity array, spent all 1000 max_tokens and was cut
  // off mid-string — finish_reason "length", no closing brace. The 8 complete
  // topics were discarded with the malformed tail and the curator got a bare
  // "LLM returned unparseable JSON" 502. A cut-off run must degrade to the
  // values it did finish, never lose them.
  test('a run cut off at the token cap is salvaged, not 502-ed (centa-cpc incident)', async () => {
    seedDb();
    const truncated =
      '{"topic": ["maize", "beans", "tomato", "disease control", "pest control", ' +
      '"fertilization", "field trials", "agronomic characteristics"],' +
      ' "entity": ["centa chaparrastique", "centa-cpc", "centa-cpc", "centa-c';
    axios.post.mockResolvedValue(vllmResponse(truncated, 'length'));
    const out = await svc.suggestTags(REPO_ID);
    expect(out.topic).toEqual([
      'maize',
      'beans',
      'tomato',
      'disease-control',
      'pest-control',
      'fertilization',
      'field-trials',
      'agronomic-characteristics'
    ]);
    // the salvaged entities still pass through the existing dedup
    expect(out.entity).toEqual(['centa-chaparrastique', 'centa-cpc']);
  });

  test('the partial trailing value is DROPPED, never guessed at', async () => {
    seedDb();
    axios.post.mockResolvedValue(
      vllmResponse('{"topic": ["maize", "beans"], "summary": "Covers maize and bea', 'length')
    );
    const out = await svc.suggestTags(REPO_ID);
    expect(out.topic).toEqual(['maize', 'beans']);
    expect(out.summary).toBeNull(); // half-written sentence is not a sentence
  });

  test('repair only engages on finish_reason length — a clean stop stays clean', async () => {
    seedDb();
    // Same truncated bytes, but the model claims it stopped on its own: that
    // is a genuine parse failure and must still surface as LLM_PARSE.
    axios.post.mockResolvedValue(vllmResponse('{"topic": ["maize", "beans'));
    await expect(svc.suggestTags(REPO_ID)).rejects.toMatchObject({ code: 'LLM_PARSE', status: 502 });
  });

  test('the prompt forbids duplicate values (the loop that caused the incident)', async () => {
    seedDb();
    axios.post.mockResolvedValue(vllmResponse(JSON.stringify({ topic: ['a', 'b', 'c'] })));
    await svc.suggestTags(REPO_ID);
    const prompt = axios.post.mock.calls[0][1].messages[0].content;
    expect(prompt).toMatch(/EACH VALUE EXACTLY ONCE/);
    expect(prompt).toMatch(/HARD\s+STOP/);
  });

  test('the token budget leaves headroom above the documented array ranges', async () => {
    seedDb();
    axios.post.mockResolvedValue(vllmResponse(JSON.stringify({ topic: ['a', 'b', 'c'] })));
    await svc.suggestTags(REPO_ID);
    expect(axios.post.mock.calls[0][1].max_tokens).toBe(1500);
  });

  test('dedups repeated LLM values (the 2026-10-09 mental-health x5 incident)', async () => {
    seedDb();
    // Verbatim shape of the granite response that poisoned the live NCD
    // frontmatter: the model repeated "mental-health" inside ONE array.
    axios.post.mockResolvedValue(
      vllmResponse(
        JSON.stringify({
          topic: ['cancer-screening', 'cardiovascular-disease', 'chronic-respiratory', 'risk-assessment'],
          entity: ['breast-cancer', 'asthma', 'asthma'],
          scope: 'healthcare',
          forbidden: [
            'mental-health',
            'communicable-diseases',
            'mental-health',
            'mental-health',
            'mental-health',
            'mental-health'
          ],
          summary: 'NCD corpus.',
          keyword: ['who', 'who']
        })
      )
    );
    const out = await svc.suggestTags(REPO_ID);
    // First occurrence wins, order preserved, per-array only.
    expect(out.forbidden).toEqual(['mental-health', 'communicable-diseases']);
    expect(out.entity).toEqual(['breast-cancer', 'asthma']);
    expect(out.keyword).toEqual(['who']);
    expect(out.forbidden_suggestions).toEqual([
      { value: 'mental-health', suggested: true },
      { value: 'communicable-diseases', suggested: true }
    ]);
  });

  // !1082 — the suggester returned 22 entities against a ceiling of 20 and Joi
  // rejects the WHOLE request body, so a curator accepting that suggestion lost
  // the topics and every accepted entity too. The schema was always right; the
  // producer must cap its own output. Asserted HERE at the producer boundary
  // (an over-limit LLM payload comes back within TAG_LIMITS and schema-writable)
  // — the old spec-side copy re-implemented cap()/clean() and validated its own
  // output, which stayed green if the producer ever stopped capping.
  test('an over-limit LLM payload is capped at the producer boundary (Bali !1082)', async () => {
    seedDb();
    axios.post.mockResolvedValue(
      vllmResponse(
        JSON.stringify({
          topic: Array.from({ length: 22 }, (_, i) => `topic-${i}`),
          entity: Array.from({ length: 22 }, (_, i) => `entity-${i}`),
          forbidden: Array.from({ length: 30 }, (_, i) => `forbidden-${i}`),
          keyword: Array.from({ length: 40 }, (_, i) => `keyword-${i}`),
          scope: 'health',
          summary: 'Over-limit payload.'
        })
      )
    );
    const out = await svc.suggestTags(REPO_ID);
    expect(out.topic).toHaveLength(TAG_LIMITS.topic);
    expect(out.entity).toHaveLength(TAG_LIMITS.entity);
    expect(out.keyword).toHaveLength(TAG_LIMITS.keyword);
    // forbidden additionally passes the mechanical label guard, which may
    // legitimately drop rows — the ceiling still bounds it from above.
    expect(out.forbidden.length).toBeLessThanOrEqual(TAG_LIMITS.forbidden);
    // And the whole result is writable: the schema accepts every field.
    const { error } = updateSchema.validate({
      frontmatter: {
        topic: out.topic,
        entity: out.entity,
        forbidden: out.forbidden,
        keyword: out.keyword,
        scope: out.scope,
        summary: out.summary
      }
    });
    expect(error).toBeUndefined();
  });
});
// ─── 1-8g-m: label-grounded suggestions ─────────────────────────────────────
// Live 2026-10-11 (Indonesia History, 999 concepts): the sampler took the
// FIRST 20 by auto-key, so the prompt saw History(14)+Prehistory(5) while the
// real surface was History 513 / Politics 133 / Culture 99 / Economics 68 /
// Religion 29 — and the LLM then suggested FORBIDDEN "modern-politics" and
// "contemporary-culture" for a corpus holding 133 politics + 99 culture
// concepts (a live hard-veto trap). Two fixes: label-stratified sampling with
// the complete histogram, and a mechanical forbidden guard.

describe('1-8g-m — label-stratified sampling', () => {
  const { buildSuggestContext } = svc._internals;

  // A miniature of the live Indonesia shape: one dominant label and a tail
  // that an alphabetical slice would have missed entirely.
  const GROUPS = [
    {
      label: 'History',
      total: 513,
      sample: [
        { concept_id: 'h1', title: 'H1' },
        { concept_id: 'h2', title: 'H2' }
      ]
    },
    { label: 'Politics', total: 133, sample: [{ concept_id: 'p1', title: 'P1' }] },
    { label: 'Culture', total: 99, sample: [{ concept_id: 'c1', title: 'C1' }] },
    { label: 'Economics', total: 68, sample: [{ concept_id: 'e1', title: 'E1' }] },
    { label: 'Religion', total: 29, sample: [{ concept_id: 'r1', title: 'R1' }] },
    { label: 'Kingdoms', total: 1, sample: [{ concept_id: 'k1', title: 'K1' }] }
  ];

  test('the histogram counts EVERY concept, not the sample', () => {
    const { histogram } = buildSuggestContext(GROUPS, 20);
    expect(histogram[0]).toEqual({ label: 'History', count: 513 });
    expect(histogram.map((h) => h.count)).toEqual([513, 133, 99, 68, 29, 1]);
    expect(histogram.reduce((s, h) => s + h.count, 0)).toBe(843);
  });

  test('a small sample still represents EVERY label — the tail is not sampled away', () => {
    // The legacy sampler returned History-only rows for a 20-row budget.
    const { concepts } = buildSuggestContext(GROUPS, 6);
    const labels = [...new Set(concepts.map((c) => c._sample_label))];
    for (const l of ['History', 'Politics', 'Culture', 'Economics', 'Religion', 'Kingdoms']) {
      expect(labels).toContain(l);
    }
  });

  test('coverage reports what the curator was actually shown', () => {
    const { coverage } = buildSuggestContext(GROUPS, 20);
    expect(coverage.concepts_total).toBe(843);
    expect(coverage.concepts_sampled).toBeGreaterThan(0);
    expect(coverage.concepts_sampled).toBeLessThanOrEqual(20);
    expect(coverage.label_count).toBe(6);
    expect(coverage.histogram[0]).toEqual({ label: 'History', count: 513 });
  });

  test('an unlabeled-only repo still samples (the (unlabeled) bucket)', () => {
    const { concepts, histogram } = buildSuggestContext(
      [{ label: '(unlabeled)', total: 3, sample: [{ concept_id: 'x1' }, { concept_id: 'x2' }] }],
      20
    );
    expect(histogram).toEqual([{ label: '(unlabeled)', count: 3 }]);
    expect(concepts.length).toBeGreaterThan(0);
  });

  test('empty groups yield an empty context (NO_CONCEPTS path stays reachable)', () => {
    const ctx = buildSuggestContext([], 20);
    expect(ctx.concepts).toEqual([]);
    expect(ctx.histogram).toEqual([]);
    expect(ctx.coverage.concepts_total).toBe(0);
  });
});

describe('1-8g-m — mechanical forbidden guard', () => {
  const { screenForbiddenAgainstCorpus } = svc._internals;

  // The live histogram: the corpus DEMONSTRABLY contains politics and culture.
  const HIST = [
    { label: 'History', count: 513 },
    { label: 'Politics', count: 133 },
    { label: 'Culture', count: 99 },
    { label: 'Religion', count: 29 },
    { label: 'Kingdoms', count: 1 }
  ];

  test('the live failure is caught: modern-politics and contemporary-culture are rejected', () => {
    const { kept, rejected } = screenForbiddenAgainstCorpus(
      ['modern-politics', 'contemporary-culture', 'tourism'],
      HIST
    );
    expect(kept).toEqual(['tourism']);
    expect(rejected.map((r) => r.value)).toEqual(['modern-politics', 'contemporary-culture']);
    // the reason is traceable back to the corpus evidence
    expect(rejected[0]).toMatchObject({ value: 'modern-politics', label: 'Politics', label_count: 133 });
  });

  test('a genuinely absent domain is kept (the guard never over-rejects)', () => {
    const { kept, rejected } = screenForbiddenAgainstCorpus(['sports', 'modern-sports'], HIST);
    expect(kept).toEqual(['sports', 'modern-sports']);
    expect(rejected).toEqual([]);
  });

  test('a label below the count floor is not evidence enough to reject', () => {
    // Kingdoms has exactly 1 concept — far too thin to forbid a whole domain.
    const { kept } = screenForbiddenAgainstCorpus(['kingdoms'], HIST);
    expect(kept).toEqual(['kingdoms']);
  });

  test('exact and partial matches both collide', () => {
    expect(screenForbiddenAgainstCorpus(['politics'], HIST).rejected).toHaveLength(1);
    expect(screenForbiddenAgainstCorpus(['indonesian-politics'], HIST).rejected).toHaveLength(1);
    expect(screenForbiddenAgainstCorpus(['religion'], HIST).rejected).toHaveLength(1);
    // a near-miss word shares no token with any label — not a collision
    expect(screenForbiddenAgainstCorpus(['archaeology'], HIST).rejected).toEqual([]);
  });
});

describe('1-8g-m2 — the concept-sampling AQL is syntactically legal', () => {
  // The arango mock returns canned rows whatever the AQL says, so the jest
  // suite is structurally blind to AQL syntax. This pins the two rules the
  // live 500 broke on; a real parse check runs against the build's database.
  test('no variable is bound twice (LET x … COLLECT x = x is rejected by ArangoDB)', async () => {
    seedDb();
    axios.post.mockResolvedValue(vllmResponse(JSON.stringify({ topic: ['x'], forbidden: [], summary: '' })));
    await svc.suggestTags(REPO_ID);
    const aql = __mockDb.query.mock.calls.map((c) => (typeof c[0] === 'string' ? c[0] : '')).join('\n');
    const conceptsQuery = aql.split('okf_concepts_meta')[1] || '';
    // every `LET name` must not reappear as the COLLECT group key
    const lets = [...conceptsQuery.matchAll(/LET\s+(\w+)\s*=/g)].map((m) => m[1]);
    const collectKeys = [...conceptsQuery.matchAll(/COLLECT\s+(\w+)\s*=/g)].map((m) => m[1]);
    for (const key of collectKeys) {
      expect(lets).not.toContain(key);
    }
  });

  test('the group key is returned under `label` (buildSuggestContext reads g.label)', async () => {
    seedDb();
    axios.post.mockResolvedValue(vllmResponse(JSON.stringify({ topic: ['x'], forbidden: [], summary: '' })));
    await svc.suggestTags(REPO_ID);
    const aql = __mockDb.query.mock.calls.map((c) => (typeof c[0] === 'string' ? c[0] : '')).join('\n');
    expect(aql).toMatch(/RETURN\s*\{\s*label:\s*label/);
  });
});

describe('1-8g-m — suggestTags integration', () => {
  test('a forbidden tag the corpus contains is dropped and REPORTED, not silently swallowed', async () => {
    // The verbatim live response that poisoned the Indonesia head.
    // The corpus guard needs MIN_FORBIDDEN_LABEL_COUNT (5) concepts behind a
    // label before it treats it as evidence — seed past the floor, as the
    // live Indonesia repo did (133 Politics).
    seedDb({
      concepts: [
        ...Array.from({ length: 6 }, (_, i) => ({
          concept_id: `p${i}`,
          title: `P${i}`,
          labels: ['Politics'],
          type: 'topic',
          tags: [],
          summary: ''
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          concept_id: `c${i}`,
          title: `C${i}`,
          labels: ['Culture'],
          type: 'topic',
          tags: [],
          summary: ''
        }))
      ]
    });
    axios.post.mockResolvedValue(
      vllmResponse(
        JSON.stringify({
          topic: ['indonesian-politics'],
          entity: [],
          scope: 'historical',
          forbidden: ['modern-politics', 'contemporary-culture', 'tourism'],
          summary: 'x',
          keyword: []
        })
      )
    );
    const out = await svc.suggestTags(REPO_ID);
    expect(out.forbidden).toEqual(['tourism']);
    expect(out.forbidden_suggestions).toEqual([{ value: 'tourism', suggested: true }]);
    // the curator sees WHY the other two vanished and can re-add deliberately
    expect(out.forbidden_rejected).toHaveLength(2);
    expect(out.forbidden_rejected[0]).toMatchObject({
      value: 'modern-politics',
      corpus_label: 'Politics',
      corpus_label_count: 6
    });
    expect(out.forbidden_rejected[0].reason).toMatch(/Politics/);
  });

  test('the prompt carries the complete distribution AND the never-forbid-what-you-contain rule', async () => {
    seedDb({
      concepts: [
        { concept_id: 'a', title: 'A', labels: ['History'], type: 'topic', tags: [], summary: '' },
        { concept_id: 'b', title: 'B', labels: ['Religion'], type: 'topic', tags: [], summary: '' }
      ]
    });
    axios.post.mockResolvedValue(vllmResponse(JSON.stringify({ topic: ['x'], forbidden: [], summary: '' })));
    await svc.suggestTags(REPO_ID);
    const prompt = axios.post.mock.calls[0][1].messages[0].content;
    expect(prompt).toContain('COMPLETE SUBJECT DISTRIBUTION');
    expect(prompt).toMatch(/History: 1 concept/);
    expect(prompt).toMatch(/Religion: 1 concept/);
    expect(prompt).toContain('NEVER forbid a subject the corpus demonstrably CONTAINS');
    expect(prompt).toContain('COVERAGE IS A HARD REQUIREMENT');
  });

  test('coverage rides the response so the UI can state the sample honestly', async () => {
    seedDb();
    axios.post.mockResolvedValue(vllmResponse(JSON.stringify({ topic: ['x'], forbidden: [], summary: '' })));
    const out = await svc.suggestTags(REPO_ID);
    expect(out.coverage).toBeDefined();
    expect(out.coverage.concepts_total).toBe(2);
    expect(out.coverage.label_count).toBe(2); // Health + (unlabeled)
    expect(Array.isArray(out.forbidden_rejected)).toBe(true);
  });

  test('8-7 routing: an ACTIVE okf_tagging model config (openai wire) takes the LLM call', async () => {
    const modelConfig = require('../services/model-config-service');
    seedDb();
    axios.post.mockResolvedValue(vllmResponse(JSON.stringify({ topic: ['x'], forbidden: [], summary: '' })));
    modelConfig.resolveModelOverride.mockResolvedValueOnce({
      provider: 'openai',
      base_url: 'https://frontier.example',
      model: 'frontier-tagger',
      api_key: 'fk-2',
      source: 'active',
      config_key: 'mc1',
      config_name: 'Frontier'
    });
    await svc.suggestTags(REPO_ID);
    expect(axios.post).toHaveBeenCalledWith(
      'https://frontier.example/v1/chat/completions',
      expect.objectContaining({ model: 'frontier-tagger', thinking: { type: 'disabled' }, enable_thinking: false }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer fk-2' }) })
    );
    expect(modelConfig.resolveModelOverride).toHaveBeenCalledWith({ service: 'okf_tagging' });
  });

  // Regression (2026-10-21, live): an active z.ai config (…/paas/v4) had
  // /v1/chat/completions FORCE-APPENDED → /paas/v4/v1/chat/completions →
  // 404 on every benchmark answer row (all metrics 0) while the sidecar's
  // SDK-built URL on the same base returned 200. A versioned base keeps its
  // segment; /chat/completions is appended directly.
  test('8-7 routing: a VERSIONED config base (z.ai …/paas/v4) is called at {base}/chat/completions — no /v1 forced', async () => {
    const modelConfig = require('../services/model-config-service');
    seedDb();
    axios.post.mockResolvedValue(vllmResponse(JSON.stringify({ topic: ['x'], forbidden: [], summary: '' })));
    modelConfig.resolveModelOverride.mockResolvedValueOnce({
      provider: 'openai',
      base_url: 'https://api.z.ai/api/coding/paas/v4',
      model: 'glm-5.3',
      api_key: 'zk-1',
      source: 'active',
      config_key: 'mc2',
      config_name: 'GLM-5.3 ITU - OpenAI'
    });
    await svc.suggestTags(REPO_ID);
    expect(axios.post).toHaveBeenCalledWith(
      'https://api.z.ai/api/coding/paas/v4/chat/completions',
      expect.objectContaining({ model: 'glm-5.3' }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer zk-1' }) })
    );
  });

  test('async suggest job (David 2026-10-20: let thinking models think): 202-style lifecycle with the old response shape', async () => {
    seedDb();
    axios.post.mockResolvedValue(
      vllmResponse(
        JSON.stringify({ topic: ['t1'], entity: [], scope: 's', forbidden: ['f1'], summary: 'sum', keyword: [] })
      )
    );
    const job = svc.startSuggestTags(REPO_ID);
    expect(job.status).toBe('running');
    expect(job.job_id).toMatch(/^sg/);
    // poll until the fire-and-forget worker lands
    let final = null;
    for (let i = 0; i < 100; i += 1) {
      final = svc.getSuggestJob(job.job_id);
      if (final.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(final.status).toBe('done');
    expect(final.suggested.topic).toEqual(['t1']);
    expect(final.validation).toBeDefined(); // the route payload shape, on the job
    expect(svc.getSuggestJob('sg-nope')).toBeNull();
  });

  test('a failed suggest LLM call fails the JOB (honest message), never the process', async () => {
    seedDb();
    axios.post.mockRejectedValue(new Error('boom'));
    const job = svc.startSuggestTags(REPO_ID);
    let final = null;
    for (let i = 0; i < 100; i += 1) {
      final = svc.getSuggestJob(job.job_id);
      if (final.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(final.status).toBe('failed');
    expect(final.error).toBeTruthy();
  });

  test('the async job gives the suggest LLM call the long thinking clock (5 min, not 60s)', async () => {
    seedDb();
    axios.post.mockResolvedValue(vllmResponse(JSON.stringify({ topic: ['x'], forbidden: [], summary: '' })));
    const job = svc.startSuggestTags(REPO_ID);
    for (let i = 0; i < 100; i += 1) {
      if (svc.getSuggestJob(job.job_id).status !== 'running') break;
      await new Promise((r) => setTimeout(r, 5));
    }
    // the job path's LLM call carries the raised clock — thinking models
    // get minutes because the browser is no longer holding the connection
    const call = axios.post.mock.calls.find(
      (c) => String(c[0]).includes('/chat/completions') && c[2] && c[2].timeout === 300000
    );
    expect(call).toBeTruthy();
  });
});

describe('withUpstreamRetry — 429 is retriable (2026-10-23)', () => {
  // Live 2026-10-23: 4 of 100 benchmark rows died on a gateway burst-limit
  // 429 that sailed straight through RETRIABLE_UPSTREAM_STATUS. A rate limit
  // is the definition of wait-and-retry — assert the guard now treats it so.
  it('teiEmbed retries a 429 and succeeds on the next attempt', async () => {
    axios.post
      .mockRejectedValueOnce(
        Object.assign(new Error('Request failed with status code 429'), {
          code: 'ERR_BAD_REQUEST',
          response: { status: 429, headers: {}, data: {} }
        })
      )
      .mockResolvedValue({ data: { data: [[0.1, 0.2, 0.3]] } });
    const vectors = await svc.teiEmbed(['probe query']);
    expect(vectors).toEqual([[0.1, 0.2, 0.3]]);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('teiEmbed honors a persistent 429 by exhausting and throwing (honest failure)', async () => {
    const err429 = Object.assign(new Error('Request failed with status code 429'), {
      code: 'ERR_BAD_REQUEST',
      response: { status: 429, headers: {}, data: {} }
    });
    axios.post.mockRejectedValue(err429);
    await expect(svc.teiEmbed(['probe query'])).rejects.toBeTruthy();
    // 4 attempts (the binary exponential ladder), then honest failure.
    expect(axios.post.mock.calls.filter((c) => String(c[0]).includes('/embed'))).toHaveLength(4);
  }, 20000); // the real 1s+2s+4s backoff sleeps exceed the 5s default
});

describe('vllmChatCompletions — which judge an explicit env request actually names', () => {
  // The panel's "system default" label and the sidecar's default judge both
  // name the .env RAGAS_JUDGE_* pair. An explicit `config: null` asks for
  // exactly that judge, so it must read exactly those variables.
  const ENV_JUDGE = {
    RAGAS_JUDGE_BASE_URL: 'https://judge.example/v1',
    RAGAS_JUDGE_MODEL: 'judge-model-x',
    RAGAS_JUDGE_API_KEY: 'judge-key'
  };

  beforeEach(() => {
    axios.post.mockResolvedValue(vllmResponse('{}'));
    // The env judge names its model explicitly (RAGAS_JUDGE_MODEL), so no
    // probe is needed — but the NOT-judge test below falls back to the
    // deployment path, which discovers.
    axios.get.mockReset();
    axios.get.mockResolvedValue({ data: { data: [{ id: 'test/served-model' }] } });
    Object.entries(ENV_JUDGE).forEach(([k, v]) => {
      process.env[k] = v;
    });
  });

  afterEach(() => {
    Object.keys(ENV_JUDGE).forEach((k) => {
      delete process.env[k];
    });
  });

  it('the explicit env request calls the RAGAS_JUDGE_* pair the UI names', async () => {
    await svc.vllmChatCompletions([{ role: 'user', content: 'hi' }], { config: null });
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, cfg] = axios.post.mock.calls[0];
    expect(url).toBe('https://judge.example/v1/chat/completions');
    expect(body.model).toBe('judge-model-x');
    expect(cfg.headers.Authorization).toBe('Bearer judge-key');
  });

  it('the DEFAULT path still calls the VLLM_* pair (unchanged behaviour)', async () => {
    await svc.vllmChatCompletions([{ role: 'user', content: 'hi' }], {});
    const [url, body] = axios.post.mock.calls[0];
    expect(url).not.toBe('https://judge.example/v1/chat/completions');
    expect(body.model).not.toBe('judge-model-x');
  });
});

// #1181 — vLLM model-id discovery (!631 policy ported to the Node side).
// The chat body must name a model the CALLED endpoint actually serves:
// explicit pick (env judge / named model config) > env pin > /v1/models
// discovery > loud failure. The old hardcoded 'ibm-granite/granite-4.1-8b'
// fallback 404'd every call the day the endpoint served anything else.
describe('vllmChatCompletions — model-id resolution follows the !631 discovery policy', () => {
  const modelCache = require('../services/vllm-model-cache');
  const PIN_KEYS = ['VLLM_LLM_MODEL_ID', 'VLLM_MODEL_ID', 'VLLM_ENDPOINT'];

  beforeEach(() => {
    PIN_KEYS.forEach((k) => delete process.env[k]);
    modelCache.clearModelCache();
    axios.post.mockReset();
    axios.get.mockReset();
  });

  afterEach(() => {
    PIN_KEYS.forEach((k) => delete process.env[k]);
    modelCache.clearModelCache();
  });

  test('no pin, no override: the body carries the model discovered from the endpoint', async () => {
    axios.get.mockResolvedValue({ data: { data: [{ id: 'served/discovered-8b' }] } });
    axios.post.mockResolvedValue(vllmResponse('{}'));
    await svc.vllmChatCompletions([{ role: 'user', content: 'hi' }]);
    expect(axios.get).toHaveBeenCalledWith('http://vllm:8000/v1/models', expect.anything());
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe('http://vllm:8000/v1/chat/completions');
    expect(body.model).toBe('served/discovered-8b');
  });

  test('a VLLM_MODEL_ID pin wins and skips the probe entirely', async () => {
    process.env.VLLM_MODEL_ID = 'pinned/chat-model';
    axios.post.mockResolvedValue(vllmResponse('{}'));
    await svc.vllmChatCompletions([{ role: 'user', content: 'hi' }]);
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post.mock.calls[0][1].model).toBe('pinned/chat-model');
  });

  test('discovery failure with no pin is loud — no call is sent under a fabricated name', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(svc.vllmChatCompletions([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      name: 'ModelDiscoveryError'
    });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('a modelless named-config base resolves its OWN served model (the pin never names a foreign endpoint)', async () => {
    const modelConfig = require('../services/model-config-service');
    process.env.VLLM_MODEL_ID = 'pinned/chat-model';
    modelConfig.resolveModelOverride.mockResolvedValueOnce({
      provider: 'openai',
      base_url: 'https://frontier.example/v1',
      model: null,
      api_key: 'fk-3',
      source: 'active',
      config_key: 'mc3',
      config_name: 'Frontier (modelless)'
    });
    axios.get.mockResolvedValue({ data: { data: [{ id: 'frontier/served' }] } });
    axios.post.mockResolvedValue(vllmResponse('{}'));
    await svc.vllmChatCompletions([{ role: 'user', content: 'hi' }]);
    expect(axios.get).toHaveBeenCalledWith('https://frontier.example/v1/models', expect.anything());
    expect(axios.post.mock.calls[0][1].model).toBe('frontier/served');
  });
});

// Review round 1 (#1181): the env-judge path must not let the DEPLOYMENT
// pin name a model on the JUDGE endpoint, and a modelless named-config
// probe must carry that config's own api key.
describe('vllmChatCompletions — review r1 fixes (#1181)', () => {
  const modelCache2 = require('../services/vllm-model-cache');
  const KEYS = [
    'VLLM_LLM_MODEL_ID',
    'VLLM_MODEL_ID',
    'RAGAS_JUDGE_BASE_URL',
    'RAGAS_JUDGE_MODEL',
    'RAGAS_JUDGE_API_KEY'
  ];
  const saved = {};

  beforeEach(() => {
    KEYS.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
    modelCache2.clearModelCache();
    axios.post.mockReset();
    axios.get.mockReset();
  });

  afterEach(() => {
    KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
    modelCache2.clearModelCache();
  });

  test('env judge with no RAGAS_JUDGE_MODEL: discovery on the JUDGE base — the deployment pin never crosses over', async () => {
    process.env.VLLM_MODEL_ID = 'pinned/chat-model';
    process.env.RAGAS_JUDGE_BASE_URL = 'https://judge-gpu.example/v1';
    axios.get.mockResolvedValue({ data: { data: [{ id: 'judge/served-8b' }] } });
    axios.post.mockResolvedValue(vllmResponse('{}'));
    await svc.vllmChatCompletions([{ role: 'user', content: 'hi' }], { config: null });
    expect(axios.get).toHaveBeenCalledWith('https://judge-gpu.example/v1/models', expect.anything());
    expect(axios.post.mock.calls[0][1].model).toBe('judge/served-8b');
  });

  test('env judge without a base switch stays on the deployment path (pin applies)', async () => {
    process.env.VLLM_MODEL_ID = 'pinned/chat-model';
    axios.post.mockResolvedValue(vllmResponse('{}'));
    await svc.vllmChatCompletions([{ role: 'user', content: 'hi' }], { config: null });
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post.mock.calls[0][1].model).toBe('pinned/chat-model');
  });

  test('a modelless named-config base probes with ITS OWN api key', async () => {
    const modelConfig = require('../services/model-config-service');
    modelConfig.resolveModelOverride.mockResolvedValueOnce({
      provider: 'openai',
      base_url: 'https://frontier.example/v1',
      model: null,
      api_key: 'fk-3',
      source: 'active',
      config_key: 'mc4',
      config_name: 'Frontier (modelless)'
    });
    axios.get.mockResolvedValue({ data: { data: [{ id: 'frontier/served' }] } });
    axios.post.mockResolvedValue(vllmResponse('{}'));
    await svc.vllmChatCompletions([{ role: 'user', content: 'hi' }]);
    expect(axios.get).toHaveBeenCalledWith(
      'https://frontier.example/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer fk-3' } })
    );
    expect(axios.post.mock.calls[0][1].model).toBe('frontier/served');
  });

  test('suggest.done names the model that actually tagged (cache read, no second probe)', async () => {
    seedDb();
    delete process.env.VLLM_LLM_MODEL_ID;
    delete process.env.VLLM_MODEL_ID;
    modelCache2.clearModelCache();
    axios.get.mockResolvedValue({ data: { data: [{ id: 'served/tagger-8b' }] } });
    axios.post.mockResolvedValue(vllmResponse(JSON.stringify({ topic: ['x'], forbidden: [], summary: '' })));
    await svc.suggestTags(REPO_ID);
    expect(axios.get).toHaveBeenCalledTimes(1); // the chat resolution, not a second probe
    const logger = require('../shared-lib/logger').logger;
    // mock.calls accumulates across the file's tests — read THIS test's log.
    const done = [...logger.info.mock.calls].reverse().find((c) => c[0] === 'frontmatter.suggest.done');
    expect(done).toBeTruthy();
    expect(done[1].model).toBe('served/tagger-8b');
  });
});

// Review round 2 (#1181): the deployment key never leaks to a foreign
// base, the probe honors the chat path's VLLM_LLM_API_KEY spelling, and
// the model that answered rides the response object (no post-call probe).
describe('vllmChatCompletions — review r2 fixes (#1181)', () => {
  const modelCache3 = require('../services/vllm-model-cache');
  const KEYS = ['VLLM_LLM_MODEL_ID', 'VLLM_MODEL_ID', 'VLLM_API_KEY', 'VLLM_LLM_API_KEY'];
  const saved = {};

  beforeEach(() => {
    KEYS.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
    modelCache3.clearModelCache();
    axios.post.mockReset();
    axios.get.mockReset();
  });

  afterEach(() => {
    KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
    modelCache3.clearModelCache();
  });

  test('a modelless named config WITHOUT its own key probes with NO Authorization — the deployment key never leaks', async () => {
    const modelConfig = require('../services/model-config-service');
    process.env.VLLM_API_KEY = 'deployment-secret';
    modelConfig.resolveModelOverride.mockResolvedValueOnce({
      provider: 'openai',
      base_url: 'https://foreign.example/v1',
      model: null,
      api_key: '',
      source: 'active',
      config_key: 'mc5',
      config_name: 'Foreign (modelless, keyless)'
    });
    axios.get.mockResolvedValue({ data: { data: [{ id: 'foreign/served' }] } });
    axios.post.mockResolvedValue(vllmResponse('{}'));
    await svc.vllmChatCompletions([{ role: 'user', content: 'hi' }]);
    expect(axios.get.mock.calls[0][1].headers).toEqual({});
  });

  test('the deployment probe authenticates with the VLLM_LLM_API_KEY spelling like the chat path', async () => {
    process.env.VLLM_LLM_API_KEY = 'llm-spelled-key';
    axios.get.mockResolvedValue({ data: { data: [{ id: 'served/model' }] } });
    axios.post.mockResolvedValue(vllmResponse('{}'));
    await svc.vllmChatCompletions([{ role: 'user', content: 'hi' }]);
    expect(axios.get.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer llm-spelled-key' });
  });

  test('the resolved model rides the response object (resp.model) for provenance without a second probe', async () => {
    axios.get.mockResolvedValue({ data: { data: [{ id: 'served/stamped-8b' }] } });
    axios.post.mockResolvedValue(vllmResponse('{}'));
    const resp = await svc.vllmChatCompletions([{ role: 'user', content: 'hi' }]);
    expect(resp.model).toBe('served/stamped-8b');
  });
});
