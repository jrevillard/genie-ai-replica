const { EventEmitter } = require('events');

// The markdown libraries are ESM-only (the leg loads them through a lazy
// require, which the jest VM resolves to these virtual mocks). The suite
// replaces them with a minimal mdast-shaped pipeline whose behavior is
// transparent: paragraphs split on blank lines, inline **strong** parsed into
// strong nodes with text children, stringify re-serialized. The discipline
// under test — text-leaf cores translated, edges and structure reassembled —
// is exercised against that skeleton; the real parser's behavior is pinned by
// the text-edges / markdown-normalize / translation-service suites and the
// node --test smoke in scripts/agentic-translation-markdown.node-test.js.
const mockMiniMarkdown = (() => {
  const inline = (s) => {
    const nodes = [];
    const re = /\*\*([^*]+)\*\*/g;
    let last = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) nodes.push({ type: 'text', value: s.slice(last, m.index) });
      nodes.push({ type: 'strong', children: [{ type: 'text', value: m[1] }] });
      last = m.index + m[0].length;
    }
    if (last < s.length) nodes.push({ type: 'text', value: s.slice(last) });
    return nodes;
  };
  const stringifyInline = (node) => {
    if (node.type === 'strong') return `**${node.children.map(stringifyInline).join('')}**`;
    return node.value;
  };
  const parse = (text) => ({
    type: 'root',
    children: String(text)
      .split('\n\n')
      .map((p) => ({ type: 'paragraph', children: inline(p) }))
  });
  const stringify = (tree) => tree.children.map((p) => p.children.map(stringifyInline).join('')).join('\n\n');
  const visit = (tree, type, fn) => {
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === type) fn(node);
      if (Array.isArray(node.children)) node.children.forEach(walk);
    })(tree);
  };
  const api = { use: () => api, parse, stringify };
  return { unified: () => api, visit };
})();

jest.mock('http', () => ({ request: jest.fn() }));
jest.mock('https', () => ({ request: jest.fn() }));
jest.mock(
  '../../../shared-lib',
  () => ({
    // The real helpers, not copies: the knob reader's fail-closed semantics
    // must be tested against the deployed parser.
    ...jest.requireActual('../../../../shared/lib/validation-utils'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  }),
  { virtual: true }
);
jest.mock('unified', () => ({ unified: mockMiniMarkdown.unified }), { virtual: true });
jest.mock('remark-parse', () => ({ default: {} }), { virtual: true });
jest.mock('remark-stringify', () => ({ default: {} }), { virtual: true });
jest.mock('unist-util-visit', () => ({ visit: mockMiniMarkdown.visit }), { virtual: true });

const http = require('http');
const { logger } = require('../../../shared-lib');
const {
  createAgenticTranslationLeg,
  createWholeAnswerTranslator,
  translateWholeAnswerWithLeg
} = require('../../../services/translation/agentic-translation-leg');
const { SKIP_STATUSES } = require('../../../services/agent-residual-budget');
const { serveTranslationHttp } = require('../../helpers/translation-http-stub');

describe('agentic translation leg (story 2.10)', () => {
  let savedEnv;

  // The shared outbound http.request double (ONE home for the
  // request-interface model — see __tests__/helpers/translation-http-stub.js):
  // it routes by path (health/models/chat), models the install-tick delivery
  // and the request's write/setTimeout/destroy interface.
  const serve = serveTranslationHttp;

  const chatBody = (content, extra = {}) => ({
    choices: [{ finish_reason: 'stop', message: { content } }],
    ...extra
  });

  // The chat-completions requests among the captured calls — the probes
  // (/health, /v1/models) ride the same mock.
  const chatCalls = (calls) => calls.filter((c) => String(c.path).includes('/chat/completions'));

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

  const makeLeg = (overrides = {}) =>
    createAgenticTranslationLeg({
      routingDecision: 'agentic',
      runUsage: { prompt_tokens: 100, completion_tokens: 50, model_calls: 3, aux_model_calls: 1 },
      targetLanguage: 'fr',
      ...overrides
    });

  describe('the accounting block (the shape 2.4 persists)', () => {
    it('carries exactly the pinned keys', async () => {
      serve({ chat: { json: chatBody('Bonjour', { usage: { prompt_tokens: 20, completion_tokens: 10 } }) } });
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });
      expect(Object.keys(r.accounting)).toEqual([
        'backend',
        'decision',
        'status',
        'outcome',
        'queryTranslationStatus',
        'usage',
        'configError',
        'mode'
      ]);
    });
  });

  describe('translate (happy path)', () => {
    it('translates against the GPU backend and returns the served usage verbatim', async () => {
      const { chatWrites, calls } = serve({
        chat: { json: chatBody('Bonjour le monde', { usage: { prompt_tokens: 20, completion_tokens: 10 } }) }
      });
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });

      expect(r.outcome).toBe('translated');
      expect(r.translated).toBe('Bonjour le monde');
      expect(r.accounting).toEqual({
        backend: 'gpu-vllm',
        decision: 'translate',
        status: null,
        outcome: 'translated',
        queryTranslationStatus: 'translated',
        usage: { prompt_tokens: 20, completion_tokens: 10, estimated: false },
        configError: null,
        mode: 'full-answer'
      });
      // The bound rides the request: max_tokens = remaining allowance
      // (10000 - 150), the timeout the remaining deadline at call start.
      expect(chatWrites[0].max_tokens).toBeLessThanOrEqual(9850);
      const chatCall = chatCalls(calls)[0];
      expect(chatCall.timeout).toBeLessThanOrEqual(5000);
      expect(chatCall.timeout).toBeGreaterThan(4000);
    });

    it('preserves the markdown skeleton: only the text-leaf cores are translated', async () => {
      const { calls, chatWrites } = serve({
        chat: { json: chatBody('X', { usage: { prompt_tokens: 2, completion_tokens: 1 } }) }
      });
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'First point. **Bold** tail', remainingMs: 5000 });

      // Three text-leaf cores (sentence, bold content, tail), each one call.
      expect(chatWrites).toHaveLength(3);
      // The strong wrapper survives; the translated cores sit inside it.
      expect(r.translated).toBe('X **X** X');
      expect(r.accounting.usage).toEqual({ prompt_tokens: 6, completion_tokens: 3, estimated: false });
      expect(chatCalls(calls)).toHaveLength(3);
    });

    it('caps the output budget exactly at the remaining token allowance', async () => {
      process.env.AGENT_TRANSLATION_MAX_TOKENS = '200';
      const { chatWrites } = serve({
        chat: { json: chatBody('Bonjour', { usage: { prompt_tokens: 2, completion_tokens: 1 } }) }
      });
      const leg = makeLeg();
      await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });
      // plan.maxTokens = 200 - 150 = 50: the request carries the remaining
      // allowance, not the window math's larger cap.
      expect(chatWrites[0].max_tokens).toBe(50);
    });
  });

  describe('skips before any call', () => {
    it('skips a GPU API the deployment never named — never the CPU model, never a probe', async () => {
      delete process.env.GPU_NODE_HOST;
      const { calls } = serve({});
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });

      expect(r.outcome).toBe('skipped');
      expect(r.accounting.configError).toBe('gpu_not_configured');
      expect(r.accounting.decision).toBe('skip');
      expect(r.accounting.queryTranslationStatus).toBe('passthrough_english');
      expect(r.accounting.usage).toBeNull();
      expect(calls).toHaveLength(0);
    });

    it('skips when the run served no usage record — never estimated up to the allowance', async () => {
      const { calls } = serve({});
      const leg = makeLeg({ runUsage: null });
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });

      expect(r.outcome).toBe('skipped');
      expect(r.accounting.status).toBe(SKIP_STATUSES.USAGE_UNAVAILABLE);
      expect(calls).toHaveLength(0);
    });

    it('skips when the remaining deadline is spent', async () => {
      serve({});
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 0 });
      expect(r.accounting.status).toBe(SKIP_STATUSES.DEADLINE_SPENT);
      expect(r.outcome).toBe('skipped');
    });

    it('skips when the call allowance is spent', async () => {
      serve({});
      const leg = makeLeg({
        runUsage: { prompt_tokens: 0, completion_tokens: 0, model_calls: 8, aux_model_calls: 2 }
      });
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });
      expect(r.accounting.status).toBe(SKIP_STATUSES.CALL_ALLOWANCE_SPENT);
    });

    it('skips when the token allowance is spent', async () => {
      serve({});
      const leg = makeLeg({
        runUsage: { prompt_tokens: 9990, completion_tokens: 10, model_calls: 0, aux_model_calls: 0 }
      });
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });
      expect(r.accounting.status).toBe(SKIP_STATUSES.TOKEN_ALLOWANCE_SPENT);
    });

    it('skips a remaining-deadline no clock could have produced, with the reason named', async () => {
      const { calls } = serve({});
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: NaN });

      expect(r.outcome).toBe('skipped');
      expect(r.accounting.configError).toBe('invalid_remaining_ms');
      expect(r.accounting.queryTranslationStatus).toBe('passthrough_english');
      expect(chatCalls(calls)).toHaveLength(0);
    });

    it('treats a malformed call-count record as usage unavailable — never a misbound plan', async () => {
      serve({});
      const leg = makeLeg({
        runUsage: { prompt_tokens: 10, completion_tokens: 10, model_calls: '3', aux_model_calls: 0 }
      });
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });

      expect(r.outcome).toBe('skipped');
      expect(r.accounting.status).toBe(SKIP_STATUSES.USAGE_UNAVAILABLE);
    });

    it('treats an explicit translation endpoint as a configured GPU API', async () => {
      // The second configured-GPU signal: a named endpoint, without a GPU
      // node host. The leg proceeds to plan, init and the call.
      delete process.env.GPU_NODE_HOST;
      process.env.VLLM_TRANSLATION_ENDPOINT = 'http://gpu-node:9031';
      const { chatWrites } = serve({
        chat: { json: chatBody('X', { usage: { prompt_tokens: 2, completion_tokens: 1 } }) }
      });
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });

      expect(r.outcome).toBe('translated');
      expect(chatWrites).toHaveLength(1);
    });

    it('skips a GPU that fails at request time, with the recorded reason', async () => {
      // The health check resolves true on a non-2xx status (it is not the
      // boot gate); a request-time failure is a connection error.
      serve({ health: { emitError: 'connect ECONNREFUSED 10.0.0.9' } });
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });

      expect(r.outcome).toBe('skipped');
      expect(r.accounting.configError).toBe('gpu_init_failed');
    });
  });

  describe('fail-closed knobs', () => {
    it.each([
      ['unset', () => delete process.env.AGENT_TRANSLATION_MAX_TOKENS],
      ['non-numeric', () => (process.env.AGENT_TRANSLATION_MAX_TOKENS = 'abc')],
      ['non-positive', () => (process.env.AGENT_TRANSLATION_MAX_TOKENS = '0')]
    ])('skips with the knob named when AGENT_TRANSLATION_MAX_TOKENS is %s', async (_label, breakEnv) => {
      breakEnv();
      serve({});
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });

      expect(leg.configError).toBe('AGENT_TRANSLATION_MAX_TOKENS');
      expect(r.outcome).toBe('skipped');
      expect(r.accounting.configError).toBe('AGENT_TRANSLATION_MAX_TOKENS');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('AGENT_TRANSLATION_MAX_TOKENS'));
    });

    it('names AGENT_TRANSLATION_MAX_CALLS when it is the missing one', async () => {
      delete process.env.AGENT_TRANSLATION_MAX_CALLS;
      serve({});
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });
      expect(r.accounting.configError).toBe('AGENT_TRANSLATION_MAX_CALLS');
    });
  });

  describe('usage returned or estimated', () => {
    it('estimates chars/4, flagged estimated, when the endpoint discards usage', async () => {
      const { chatWrites } = serve({ chat: { json: chatBody('Bonjour') } });
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });

      expect(r.accounting.usage.estimated).toBe(true);
      const body = chatWrites[0];
      expect(r.accounting.usage).toEqual({
        prompt_tokens: Math.ceil(JSON.stringify(body.messages).length / 4),
        completion_tokens: Math.ceil('Bonjour'.length / 4),
        estimated: true
      });
    });
  });

  describe('attempted-and-failed (the V05 semantics)', () => {
    it.each([
      ['backend error', { chat: { status: 500 } }, 'fallback_error'],
      [
        'truncation',
        { chat: { json: { choices: [{ finish_reason: 'length', message: { content: 'Une traduc' } }] } } },
        'fallback_error'
      ],
      ['empty output', { chat: { json: chatBody('') } }, 'fallback_error'],
      ['timeout', { chat: { emitTimeout: true } }, 'fallback_timeout']
    ])('fails on %s and never reports it as a skip', async (_label, serveArgs, status) => {
      serve(serveArgs);
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });

      expect(r.outcome).toBe('failed');
      expect(r.translated).toBeNull();
      expect(r.accounting.decision).toBe('translate');
      expect(r.accounting.outcome).toBe('failed');
      expect(r.accounting.queryTranslationStatus).toBe(status);
    });
  });

  describe('disconnect cancellation', () => {
    it('records cancelled without any call when the caller aborted before entry', async () => {
      const { calls } = serve({});
      const controller = new AbortController();
      controller.abort();
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000, signal: controller.signal });

      expect(r.outcome).toBe('cancelled');
      expect(r.accounting.outcome).toBe('cancelled');
      expect(calls).toHaveLength(0);
    });

    it('destroys the downstream request and never retries', async () => {
      const controller = new AbortController();
      const { calls } = serve({
        chat: { beforeResponse: () => controller.abort() }
      });
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000, signal: controller.signal });

      expect(r.outcome).toBe('cancelled');
      expect(r.accounting.decision).toBe('translate');
      expect(r.accounting.queryTranslationStatus).toBe('fallback_error');
      // One chat request, destroyed — no retry.
      expect(chatCalls(calls)).toHaveLength(1);
    });
  });

  describe('routing-keyed selection', () => {
    it('serves only the agentic routing decision', () => {
      expect(() =>
        createAgenticTranslationLeg({ routingDecision: 'legacy', runUsage: null, targetLanguage: 'fr' })
      ).toThrow(/agentic/);
    });

    it('never references the CPU backend or the OPEA image from the leg source', () => {
      const fs = require('fs');
      const source = fs.readFileSync(require.resolve('../../../services/translation/agentic-translation-leg'), 'utf-8');
      expect(source).not.toMatch(/cpu-translate-backend/);
      expect(source).not.toMatch(/opea/i);
    });
  });

  describe('language resolution', () => {
    it('records an unknown language as passthrough, without a call', async () => {
      const { calls } = serve({ chat: { json: chatBody('X') } });
      const leg = makeLeg({ targetLanguage: 'xyz' });
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });

      expect(r.outcome).toBe('skipped');
      expect(r.accounting.queryTranslationStatus).toBe('passthrough_unknown_language');
      expect(chatCalls(calls)).toHaveLength(0);
    });

    it('answers English with passthrough_english and no call', async () => {
      const { calls } = serve({ chat: { json: chatBody('X') } });
      const leg = makeLeg({ targetLanguage: 'en' });
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });

      expect(r.outcome).toBe('skipped');
      expect(r.accounting.queryTranslationStatus).toBe('passthrough_english');
      expect(chatCalls(calls)).toHaveLength(0);
    });
  });

  describe('the deadline spent mid-pass (the full-answer path)', () => {
    const zeroRun = { prompt_tokens: 0, completion_tokens: 0, model_calls: 0, aux_model_calls: 0 };

    it('stops mid-pass when the remaining deadline is spent, as a failed unit', async () => {
      process.env.AGENT_TRANSLATION_MAX_TOKENS = '100000';
      let now = 0;
      const realNow = Date.now.bind(Date);
      // Two cores; the first response consumes the whole remaining deadline,
      // so the second core never starts (the pass fails as a timeout).
      const { calls } = serve({
        chat: {
          json: chatBody('X', { usage: { prompt_tokens: 2, completion_tokens: 1 } }),
          afterResponse: () => {
            now = realNow() + 5001;
          }
        }
      });
      const leg = makeLeg({ runUsage: zeroRun });
      const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => (now === 0 ? realNow() : now));
      const r = await leg.translateFullAnswer({ text: 'First point.\n\nSecond point.', remainingMs: 5000 });
      dateSpy.mockRestore();

      expect(r.outcome).toBe('failed');
      expect(r.accounting.queryTranslationStatus).toBe('fallback_timeout');
      expect(chatCalls(calls)).toHaveLength(1);
    });
  });

  describe('init is inside the translation budget', () => {
    const zeroRun = { prompt_tokens: 0, completion_tokens: 0, model_calls: 0, aux_model_calls: 0 };

    it('subtracts the probes’ wall time from the remaining deadline', async () => {
      let now = 0;
      const realNow = Date.now.bind(Date);
      // The models probe consumes 4000 of the 5000ms the caller left.
      const { calls } = serve({
        models: {
          afterResponse: () => {
            now = realNow() + 4000;
          }
        },
        chat: { json: chatBody('X', { usage: { prompt_tokens: 2, completion_tokens: 1 } }) }
      });
      const leg = makeLeg({ runUsage: zeroRun });
      const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => (now === 0 ? realNow() : now));
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });
      dateSpy.mockRestore();

      expect(r.outcome).toBe('translated');
      const chatCall = chatCalls(calls)[0];
      // The call's budget is the remainder after init (~1000 of the 5000),
      // never the caller's original 5000. The few-ms band absorbs the real
      // clock's granularity between the mocked reads.
      expect(chatCall.timeout).toBeGreaterThan(900);
      expect(chatCall.timeout).toBeLessThanOrEqual(1000);
    });

    it('returns cancelled without a chat call when the caller aborts during init', async () => {
      const controller = new AbortController();
      const { calls } = serve({
        models: {
          afterResponse: () => controller.abort()
        },
        chat: { json: chatBody('X') }
      });
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000, signal: controller.signal });

      expect(r.outcome).toBe('cancelled');
      expect(r.accounting.decision).toBe('translate');
      expect(chatCalls(calls)).toHaveLength(0);
    });

    it('cuts a hung init at the remaining budget: skipped deadline_spent, no chat call', async () => {
      // The health probe accepts the connection and never answers; its own
      // budget is 30s, the caller's is 60ms. The race must cut at 60ms —
      // without it this test hangs past Jest's own suite timeout (the
      // mocked request never answers, so the probe's 30s socket budget
      // never fires either).
      const { calls } = serve({ health: { hang: true }, chat: { json: chatBody('X') } });
      const leg = makeLeg({ runUsage: zeroRun });
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 60 });

      expect(r.outcome).toBe('skipped');
      expect(r.accounting.status).toBe(SKIP_STATUSES.DEADLINE_SPENT);
      expect(chatCalls(calls)).toHaveLength(0);
    });

    it('cuts a hung init at the abort: cancelled without a chat call, inside the probe budget', async () => {
      // The abort fires the moment the health request exists; without the
      // race's signal leg the budget leg would still cut, but 30s later
      // (inside Jest's 60s testTimeout): the outcome is still cancelled via
      // the `aborted()` check — the signal leg is what makes the cut land
      // at the abort.
      const controller = new AbortController();
      const { calls } = serve({
        health: {
          hang: true,
          onRequest: () => controller.abort()
        },
        chat: { json: chatBody('X') }
      });
      const leg = makeLeg();
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 30000, signal: controller.signal });

      expect(r.outcome).toBe('cancelled');
      expect(r.accounting.decision).toBe('translate');
      expect(chatCalls(calls)).toHaveLength(0);
    });

    it('keeps the dangling init handled when its failure lands after a lost budget', async () => {
      // The budget timer wins at 50ms; the hung probe's socket error fires
      // at 200ms — after the race settled. The late failure must land
      // handled: the suite completing cleanly pins that no unhandled
      // rejection escapes the run (the race's own subscriptions already
      // mark it handled; this canary stays green only while that holds).
      serve({ health: { emitErrorAfterMs: 200 }, chat: { json: chatBody('X') } });
      const leg = makeLeg({ runUsage: zeroRun });
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 50 });

      expect(r.outcome).toBe('skipped');
      expect(r.accounting.status).toBe(SKIP_STATUSES.DEADLINE_SPENT);
    });

    it('skips deadline_spent when init consumes the whole remaining deadline', async () => {
      let now = 0;
      const realNow = Date.now.bind(Date);
      const { calls } = serve({
        models: {
          afterResponse: () => {
            now = realNow() + 5001;
          }
        },
        chat: { json: chatBody('X') }
      });
      const leg = makeLeg({ runUsage: zeroRun });
      const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => (now === 0 ? realNow() : now));
      const r = await leg.translateFullAnswer({ text: 'Hello world', remainingMs: 5000 });
      dateSpy.mockRestore();

      expect(r.outcome).toBe('skipped');
      expect(r.accounting.status).toBe(SKIP_STATUSES.DEADLINE_SPENT);
      expect(chatCalls(calls)).toHaveLength(0);
    });
  });

  describe('pass-loop branches', () => {
    const zeroRun = { prompt_tokens: 0, completion_tokens: 0, model_calls: 0, aux_model_calls: 0 };

    it('stops mid-pass when the call allowance is spent, as a failed pass', async () => {
      process.env.AGENT_TRANSLATION_MAX_CALLS = '2';
      const { calls } = serve({ chat: { json: chatBody('X', { usage: { prompt_tokens: 1, completion_tokens: 1 } }) } });
      const leg = makeLeg({ runUsage: zeroRun });
      // Three cores against a two-call allowance: the third never starts.
      const r = await leg.translateFullAnswer({ text: 'A.\n\nB.\n\nC.', remainingMs: 5000 });

      expect(r.outcome).toBe('failed');
      expect(r.accounting.queryTranslationStatus).toBe('fallback_timeout');
      expect(chatCalls(calls)).toHaveLength(2);
    });

    it('stops mid-pass when the token allowance is spent, as a failed pass', async () => {
      process.env.AGENT_TRANSLATION_MAX_TOKENS = '10';
      const { calls } = serve({ chat: { json: chatBody('X', { usage: { prompt_tokens: 6, completion_tokens: 6 } }) } });
      const leg = makeLeg({ runUsage: zeroRun });
      const r = await leg.translateFullAnswer({ text: 'A.\n\nB.', remainingMs: 5000 });

      expect(r.outcome).toBe('failed');
      expect(r.accounting.queryTranslationStatus).toBe('fallback_timeout');
      // The spent work stays in the accounting even though the pass failed.
      expect(r.accounting.usage).toEqual({ prompt_tokens: 6, completion_tokens: 6, estimated: false });
      expect(chatCalls(calls)).toHaveLength(1);
    });

    it('answers a text with no text nodes as a no-op translation (decision translate, usage null)', async () => {
      const { calls } = serve({ chat: { json: chatBody('X') } });
      const leg = makeLeg({ runUsage: zeroRun });
      const r = await leg.translateFullAnswer({ text: '', remainingMs: 5000 });

      expect(r.outcome).toBe('translated');
      expect(r.translated).toBe('');
      expect(r.accounting.decision).toBe('translate');
      expect(r.accounting.usage).toBeNull();
      expect(chatCalls(calls)).toHaveLength(0);
    });
  });

  describe('translateWholeAnswerWithLeg — the whole-answer delivery mapping', () => {
    // The mapping both post-stream consumers share: one home for the
    // outcome→delivery contract (mirrors whole-answer.js's {text, failed}
    // shape plus the V05 status the callers persist).
    const makeStubLeg = (result) => ({ translateFullAnswer: jest.fn().mockResolvedValue(result) });

    it('a translated outcome delivers the text, never latched', async () => {
      const leg = makeStubLeg({
        outcome: 'translated',
        translated: 'Bonjour le monde.',
        accounting: { outcome: 'translated', queryTranslationStatus: 'translated', configError: null }
      });
      const r = await translateWholeAnswerWithLeg(leg, { text: 'Hello world.', remainingMs: 5000 });
      expect(r.text).toBe('Bonjour le monde.');
      expect(r.failed).toBe(false);
      expect(r.queryTranslationStatus).toBe('translated');
      expect(r.accounting).toEqual(expect.objectContaining({ outcome: 'translated' }));
      expect(leg.translateFullAnswer).toHaveBeenCalledWith({
        text: 'Hello world.',
        remainingMs: 5000,
        signal: undefined
      });
    });

    it('a failed outcome latches and delivers nothing', async () => {
      const leg = makeStubLeg({
        outcome: 'failed',
        translated: null,
        accounting: { outcome: 'failed', queryTranslationStatus: 'fallback_timeout', configError: null }
      });
      const r = await translateWholeAnswerWithLeg(leg, { text: 'Hello', remainingMs: 100 });
      expect(r.failed).toBe(true);
      expect(r.text).toBeNull();
      expect(r.queryTranslationStatus).toBe('fallback_timeout');
    });

    it('a skipped outcome keeps the English answer, never latched (a skip is not a failure)', async () => {
      const leg = makeStubLeg({
        outcome: 'skipped',
        translated: null,
        accounting: {
          outcome: 'skipped',
          queryTranslationStatus: 'passthrough_english',
          configError: 'AGENT_TRANSLATION_MAX_TOKENS'
        }
      });
      const r = await translateWholeAnswerWithLeg(leg, { text: 'Hello', remainingMs: 100 });
      expect(r.failed).toBe(false);
      expect(r.text).toBeNull();
      expect(r.queryTranslationStatus).toBe('passthrough_english');
    });

    it('a cancelled outcome keeps the English answer, never latched', async () => {
      const leg = makeStubLeg({
        outcome: 'cancelled',
        translated: null,
        accounting: { outcome: 'cancelled', queryTranslationStatus: 'fallback_error', configError: null }
      });
      const r = await translateWholeAnswerWithLeg(leg, {
        text: 'Hello',
        remainingMs: 100,
        signal: new AbortController().signal
      });
      expect(r.failed).toBe(false);
      expect(r.text).toBeNull();
      expect(r.queryTranslationStatus).toBe('fallback_error');
    });

    it('a leg rejecting past its resolve-every-outcome contract is fail-soft, never raises', async () => {
      // whole-answer.js's same contract, leg side: the helper is the ONE
      // fail-soft home — the consumers carry no guard of their own, so a
      // rejecting leg (a defect) must resolve the fallback delivery (English
      // stands, latched, V05 status) and never propagate.
      const leg = { translateFullAnswer: jest.fn().mockRejectedValue(new Error('leg exploded')) };
      const r = await translateWholeAnswerWithLeg(leg, { text: 'Hello', remainingMs: 100 });
      expect(r.failed).toBe(true);
      expect(r.text).toBeNull();
      expect(r.queryTranslationStatus).toBe('fallback_error');
      expect(r.error).toBeInstanceOf(Error);
      expect(r.accounting).toEqual(
        expect.objectContaining({ outcome: 'failed', queryTranslationStatus: 'fallback_error' })
      );
    });

    it('a leg resolving a non-object outcome maps onto the failed fallback, never raises', async () => {
      // The contract resolves an outcome object; a null/primitive resolve is
      // the same defect class as a rejection — the consumers carry no guard
      // of their own, so the helper absorbs it.
      const leg = { translateFullAnswer: jest.fn().mockResolvedValue(undefined) };
      const r = await translateWholeAnswerWithLeg(leg, { text: 'Hello', remainingMs: 100 });
      expect(r.failed).toBe(true);
      expect(r.text).toBeNull();
      expect(r.queryTranslationStatus).toBe('fallback_error');
      expect(r.accounting).toEqual(
        expect.objectContaining({ outcome: 'failed', queryTranslationStatus: 'fallback_error' })
      );
    });

    it('a leg resolving without an accounting block still delivers a classifiable status', async () => {
      // The mapping never derefs a missing block: the fallback status keeps
      // the persisted metadata in the V05 vocabulary.
      const leg = {
        translateFullAnswer: jest.fn().mockResolvedValue({ outcome: 'translated', translated: 'Bonjour' })
      };
      const r = await translateWholeAnswerWithLeg(leg, { text: 'Hello', remainingMs: 100 });
      expect(r.text).toBe('Bonjour');
      expect(r.failed).toBe(false);
      expect(r.queryTranslationStatus).toBe('fallback_error');
    });
  });

  describe('createWholeAnswerTranslator — the construction stanza both consumers share', () => {
    it('builds the request-local closure and translates through it (unconfigured GPU: the skip survives)', async () => {
      delete process.env.GPU_NODE_HOST;
      delete process.env.VLLM_TRANSLATION_ENDPOINT;
      const translate = createWholeAnswerTranslator({
        runUsage: { prompt_tokens: 10, completion_tokens: 5, model_calls: 1, aux_model_calls: 0 },
        targetLanguage: 'fr',
        deadlineStartMs: Date.now(),
        timeoutMs: 60000
      });
      expect(typeof translate).toBe('function');
      const r = await translate('Hello world.');
      // The leg ran (routing decision accepted, plan consumed the runUsage)
      // and the GPU-only selection skipped: no endpoint named.
      expect(r.failed).toBe(false);
      expect(r.queryTranslationStatus).toBe('passthrough_english');
      expect(r.accounting.configError).toBe('gpu_not_configured');
    });

    it('the deadline math: a deadline already spent plans a deadline_spent skip', async () => {
      const timeoutMs = 5000;
      const translate = createWholeAnswerTranslator({
        runUsage: { prompt_tokens: 10, completion_tokens: 5, model_calls: 1, aux_model_calls: 0 },
        targetLanguage: 'fr',
        deadlineStartMs: Date.now() - timeoutMs,
        timeoutMs
      });
      const r = await translate('Hello world.');
      expect(r.failed).toBe(false);
      expect(r.accounting.status).toBe('deadline_spent');
    });
  });
});
