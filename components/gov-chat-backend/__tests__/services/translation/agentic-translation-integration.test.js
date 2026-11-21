const { EventEmitter } = require('events');

// Story 2.5's additive integration pin (scope ruling 132214 — NO BFF
// production change): the 2.10 answer-translation leg, asserted against the
// CANONICAL run usage record the agent-service emits — the terminal frame's
// `usage_record`, consumed verbatim by the residual plan and by the leg.
// The pairing is the whole contract: one record shape, two consumers, one
// arithmetic — the plan's remainder is what the leg's request carries.

// The markdown libraries are ESM-only; the leg loads them through a lazy
// require. The same minimal mdast skeleton the leg's unit suite uses: one
// paragraph, one text leaf, transparent behavior.
jest.mock('http', () => ({ request: jest.fn() }));
jest.mock('https', () => ({ request: jest.fn() }));
jest.mock(
  '../../../shared-lib',
  () => ({
    ...jest.requireActual('../../../../shared/lib/validation-utils'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  }),
  { virtual: true }
);
jest.mock(
  'unified',
  () => {
    const api = {
      use: () => api,
      parse: (text) => ({
        type: 'root',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: String(text) }] }]
      }),
      stringify: (tree) => tree.children.map((p) => p.children.map((n) => n.value).join('')).join('\n\n')
    };
    return { unified: () => api };
  },
  { virtual: true }
);
jest.mock('remark-parse', () => ({ default: {} }), { virtual: true });
jest.mock('remark-stringify', () => ({ default: {} }), { virtual: true });
jest.mock(
  'unist-util-visit',
  () => ({
    visit: (tree, type, fn) => {
      (function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (node.type === type) fn(node);
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(tree);
    }
  }),
  { virtual: true }
);

const http = require('http');
const { createAgenticTranslationLeg } = require('../../../services/translation/agentic-translation-leg');
const { SKIP_STATUSES, computeResidual, planTranslation } = require('../../../services/agent-residual-budget');

// The canonical terminal usage record — the RunUsageRecord the governed run
// surface emits as its stream's last frame (story 2.3's counters plus the
// integration slice's additive fields: language, preparation_status,
// injection_findings). ONE home for the pairing suites.
const canonicalRunUsage = (overrides = {}) => ({
  run_id: 'run-5f2a1b',
  outcome: 'answered',
  steps: 3,
  model_calls: 4,
  aux_model_calls: 1,
  tool_calls: 2,
  evidence_bytes: 4096,
  prompt_tokens: 400,
  completion_tokens: 200,
  wall_clock_seconds: 6.1,
  error: null,
  language: 'fr',
  preparation_status: 'translated',
  injection_findings: 0,
  ...overrides
});

describe('agentic translation pairing (story 2.5 — the integration pin)', () => {
  let savedEnv;

  const serve = ({ chat = {} } = {}) => {
    const calls = [];
    const chatWrites = [];
    http.request.mockImplementation((opts, cb) => {
      calls.push(opts);
      const path = String(opts.path);
      const req = new EventEmitter();
      req.write = jest.fn((d) => {
        if (path.includes('/chat/completions')) chatWrites.push(JSON.parse(d));
      });
      req.end = jest.fn();
      req.setTimeout = jest.fn();
      req.destroy = jest.fn((err) => {
        if (err) req.emit('error', err);
      });
      process.nextTick(() => {
        const res = new EventEmitter();
        res.setEncoding = () => {};
        if (path.endsWith('/health') || path.endsWith('/v1/models')) {
          res.statusCode = 200;
          cb(res);
          res.emit(path.endsWith('/health') ? 'end' : 'data', JSON.stringify({ data: [] }));
          res.emit('end');
          return;
        }
        res.statusCode = chat.status || 200;
        cb(res);
        if (chat.json !== undefined) res.emit('data', JSON.stringify(chat.json));
        res.emit('end');
      });
      return req;
    });
    return { calls, chatWrites };
  };

  beforeEach(() => {
    savedEnv = Object.fromEntries(
      ['AGENT_TRANSLATION_MAX_TOKENS', 'AGENT_TRANSLATION_MAX_CALLS', 'GPU_NODE_HOST', 'VLLM_TRANSLATION_ENDPOINT'].map(
        (name) => [name, process.env[name]]
      )
    );
    process.env.AGENT_TRANSLATION_MAX_TOKENS = '10000';
    process.env.AGENT_TRANSLATION_MAX_CALLS = '10';
    process.env.GPU_NODE_HOST = '10.0.0.9';
    delete process.env.VLLM_TRANSLATION_ENDPOINT;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    jest.clearAllMocks();
  });

  it('plans the residual off the canonical record: tokens and calls, not a guess', () => {
    const usage = canonicalRunUsage();

    const plan = planTranslation({
      deadlineRemainingMs: 8000,
      usage,
      allowances: { maxTokens: 10000, maxCalls: 10 }
    });

    expect(plan.decision).toBe('translate');
    // The record IS the arithmetic: what the run spent, subtracted once.
    expect(plan.residual.remainingTokens).toBe(9400); // 10000 - (400 + 200)
    expect(plan.residual.remainingCalls).toBe(5); // 10 - (4 loop + 1 aux)
    expect(plan.maxTokens).toBe(9400);
  });

  it('ignores the additive record fields: the arithmetic is the counters', () => {
    // The integration slice added language/preparation_status/
    // injection_findings to the record — the plan consumes the record
    // VERBATIM, so new fields must never shift the residual.
    const withAdditives = canonicalRunUsage({
      injection_findings: 2,
      language: 'de',
      preparation_status: 'passthrough_english'
    });
    const clean = planTranslation({
      deadlineRemainingMs: 8000,
      usage: canonicalRunUsage(),
      allowances: { maxTokens: 10000, maxCalls: 10 }
    });
    const additive = planTranslation({
      deadlineRemainingMs: 8000,
      usage: withAdditives,
      allowances: { maxTokens: 10000, maxCalls: 10 }
    });
    expect(additive).toEqual(clean);
    expect(
      computeResidual({
        deadline: { remainingMs: 8000 },
        usage: withAdditives,
        allowances: { maxTokens: 10000, maxCalls: 10 }
      }).remainingTokens
    ).toBe(9400);
  });

  it('executes the leg against the same record: bounded, served usage, coherent accounting', async () => {
    const { calls, chatWrites } = serve({
      chat: {
        json: {
          choices: [{ finish_reason: 'stop', message: { content: 'Bonjour le monde' } }],
          usage: { prompt_tokens: 20, completion_tokens: 10 }
        }
      }
    });
    const usage = canonicalRunUsage();
    const plan = planTranslation({ deadlineRemainingMs: 8000, usage, allowances: { maxTokens: 10000, maxCalls: 10 } });

    const leg = createAgenticTranslationLeg({ routingDecision: 'agentic', runUsage: usage, targetLanguage: 'fr' });
    const result = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 8000 });

    // The leg translated under the plan's own bound: the request's
    // max_tokens is the plan's remaining allowance minus what the leg had
    // already spent when the call left (nothing, on the first call).
    expect(result.outcome).toBe('translated');
    expect(result.translated).toBe('Bonjour le monde');
    expect(chatWrites).toHaveLength(1);
    // The plan's allowance is the ceiling the request can never exceed
    // (the GPU backend's own window math may cap it tighter on a short
    // text — the bound is one-directional, never exceeded).
    expect(chatWrites[0].max_tokens).toBeGreaterThan(0);
    expect(chatWrites[0].max_tokens).toBeLessThanOrEqual(plan.maxTokens);
    expect(Number(calls.find((c) => String(c.path).includes('/chat/completions')).timeout)).toBeGreaterThan(0);
    expect(Number(calls.find((c) => String(c.path).includes('/chat/completions')).timeout)).toBeLessThanOrEqual(8000);
    // The accounting block is the shape the frame writer persists: the
    // decision, the served usage, the V05 status — one coherent record.
    expect(result.accounting).toEqual({
      backend: 'gpu-vllm',
      decision: 'translate',
      status: null,
      outcome: 'translated',
      queryTranslationStatus: 'translated',
      usage: { prompt_tokens: 20, completion_tokens: 10, estimated: false },
      configError: null,
      mode: 'full-answer'
    });
  });

  it('pairs the spent-record skip: a run that consumed the allowance skips with the same status the plan reports', async () => {
    const { calls } = serve({});
    const usage = canonicalRunUsage({ prompt_tokens: 9800, completion_tokens: 200 });

    const plan = planTranslation({ deadlineRemainingMs: 8000, usage, allowances: { maxTokens: 10000, maxCalls: 10 } });
    const leg = createAgenticTranslationLeg({ routingDecision: 'agentic', runUsage: usage, targetLanguage: 'fr' });
    const result = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 8000 });

    expect(plan.decision).toBe('skip');
    expect(plan.status).toBe(SKIP_STATUSES.TOKEN_ALLOWANCE_SPENT);
    expect(plan.residual.remainingTokens).toBe(0); // exactly spent: never negative, never guessed
    expect(result.outcome).toBe('skipped');
    expect(result.accounting.status).toBe(SKIP_STATUSES.TOKEN_ALLOWANCE_SPENT);
    expect(result.accounting.decision).toBe('skip');
    expect(calls).toHaveLength(0); // no call starts beyond the spent allowance
  });

  it('pairs the missing-record skip: no record, no plan, no leg call', async () => {
    const { calls } = serve({});

    const plan = planTranslation({
      deadlineRemainingMs: 8000,
      usage: null,
      allowances: { maxTokens: 10000, maxCalls: 10 }
    });
    const leg = createAgenticTranslationLeg({ routingDecision: 'agentic', runUsage: null, targetLanguage: 'fr' });
    const result = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 8000 });

    expect(plan.status).toBe(SKIP_STATUSES.USAGE_UNAVAILABLE);
    expect(plan.residual.remainingTokens).toBeNull(); // never estimated up to the allowance
    expect(result.outcome).toBe('skipped');
    expect(result.accounting.status).toBe(SKIP_STATUSES.USAGE_UNAVAILABLE);
    expect(calls).toHaveLength(0);
  });
});
