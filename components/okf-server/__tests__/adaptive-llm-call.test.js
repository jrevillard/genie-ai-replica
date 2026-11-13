// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// adaptive-llm-call — the model-agnostic layers (David 2026-10-20: "work
// within reason for any selected model", "not a tactical fix for one
// model"). Capability negotiation over the standard no-think params, an
// evidence-driven budget retry, and a wall clock that scales with it.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('axios');

const axios = require('axios');
const { adaptiveChatCompletion, MAX_TOKENS_CEILING } = require('../services/adaptive-llm-call');

const HEADERS = { 'Content-Type': 'application/json' };
const ENDPOINT = 'https://x/v1/chat/completions';

function ok(content, { finish = 'stop', reasoning = 0, completion = 10 } = {}) {
  return {
    data: {
      choices: [{ message: { content }, finish_reason: finish }],
      usage: { completion_tokens: completion, completion_tokens_details: { reasoning_tokens: reasoning } }
    }
  };
}

function err400(message) {
  return { response: { status: 400, data: { error: { message } } } };
}

function lastCall() {
  return axios.post.mock.calls[axios.post.mock.calls.length - 1];
}

beforeEach(() => {
  axios.post.mockReset();
});

describe('adaptiveChatCompletion', () => {
  test('happy path without disableThinking: one plain call, body untouched', async () => {
    axios.post.mockResolvedValue(ok('{"a":1}'));
    const body = { model: 'm', messages: [], max_tokens: 800 };
    const r = await adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body });
    expect(r.data.choices[0].message.content).toBe('{"a":1}');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('enable_thinking');
  });

  test('negotiation, the live MiniMax M3.1-Flash shape: 400 names thinking -> dropped, enable_thinking stays, 200', async () => {
    axios.post
      .mockRejectedValueOnce(
        err400('invalid params, model "X" requires adaptive thinking; thinking.type="disabled" is not permitted')
      )
      .mockResolvedValueOnce(ok('{"a":1}'));
    const body = { model: 'm', messages: [], max_tokens: 800 };
    const r = await adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body, disableThinking: true });
    expect(r.data.choices[0].message.content).toBe('{"a":1}');
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(body.thinking).toBeUndefined(); // dropped — the endpoint named it
    expect(body.enable_thinking).toBe(false); // the Qwen-style convention stayed
  });

  test('negotiation, the OpenAI shape: each 400 names one param until none remain -> plain call', async () => {
    axios.post
      .mockRejectedValueOnce(err400("Unrecognized request argument: 'thinking'"))
      .mockRejectedValueOnce(err400("Unrecognized request argument: 'enable_thinking'"))
      .mockResolvedValueOnce(ok('{"a":1}'));
    const body = { model: 'm', messages: [], max_tokens: 800 };
    const r = await adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body, disableThinking: true });
    expect(r.data.choices[0].message.content).toBe('{"a":1}');
    expect(axios.post).toHaveBeenCalledTimes(3);
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('enable_thinking');
  });

  test('a 400 that names no param, with a BARE body (nothing to strip), is a real error', async () => {
    const e = err400('invalid model id');
    axios.post.mockRejectedValue(e);
    const body = { model: 'm', messages: [], max_tokens: 800 };
    await expect(adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body })).rejects.toBe(e);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  // Live 2026-10-21 (z.ai, the GLM-5.3 config): the endpoint rejects the
  // strict-JSON response_format with an UNNAMED 400. Named-only negotiation
  // propagated it and zeroed a whole 20-question benchmark run.
  test('an UNNAMED 400 with optional params present strips response_format ALONE first', async () => {
    axios.post.mockRejectedValueOnce(err400('invalid request body')).mockResolvedValueOnce(ok('plain text'));
    const body = { model: 'm', messages: [], max_tokens: 800, response_format: { type: 'json_object' } };
    const r = await adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body, disableThinking: true });
    expect(r.data.choices[0].message.content).toBe('plain text');
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(body).not.toHaveProperty('response_format');
    // The no-think pair SURVIVED (review F12: stripping all params re-enabled
    // thinking on endpoints that only rejected response_format — every row
    // then climbed the budget ladder).
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.enable_thinking).toBe(false);
  });

  // The z.ai convergence sequence end-to-end: prose 400 names "thinking"
  // (drops the object), enable_thinking rejection names nothing twice, and
  // the ladder of last-resort strips reaches a bare 200.
  test('the live z.ai sequence: prose-named thinking, then unnamed strip rounds, converges bare', async () => {
    axios.post
      .mockRejectedValueOnce(err400('this model always engages in thinking and cannot be disabled'))
      .mockRejectedValueOnce(err400('this model always engages in thinking and cannot be disabled'))
      .mockRejectedValueOnce(err400('this model always engages in thinking and cannot be disabled'))
      .mockResolvedValueOnce(ok('answer'));
    const body = { model: 'glm', messages: [], max_tokens: 800, response_format: { type: 'json_object' } };
    const r = await adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body, disableThinking: true });
    expect(r.data.choices[0].message.content).toBe('answer');
    expect(axios.post).toHaveBeenCalledTimes(4);
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('enable_thinking');
    expect(body).not.toHaveProperty('response_format');
  });

  test('disableBudgetLadder (the model-config ping): a starved answer returns WITHOUT climbing', async () => {
    axios.post.mockResolvedValueOnce(ok('', { finish: 'length', reasoning: 15, completion: 16 }));
    const body = { model: 'm', messages: [], max_tokens: 16 };
    const r = await adaptiveChatCompletion({
      url: ENDPOINT,
      headers: HEADERS,
      body,
      timeoutMs: 30000,
      disableBudgetLadder: true
    });
    expect(axios.post).toHaveBeenCalledTimes(1); // no rung — the caller reports starvation
    expect(r.data.choices[0].finish_reason).toBe('length');
  });

  test('an unnamed 400 that PERSISTS bare is a real error — strips exhausted, then throw', async () => {
    const e = err400('invalid request body');
    axios.post.mockRejectedValue(e);
    const body = { model: 'm', messages: [], max_tokens: 800, response_format: { type: 'json_object' } };
    await expect(adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body, disableThinking: true })).rejects.toBe(
      e
    );
    // shaped → −response_format → bare — never more
    expect(axios.post).toHaveBeenCalledTimes(3);
    expect(body).not.toHaveProperty('response_format');
  });

  test('a NAMED response_format rejection drops just that param and keeps the no-think pair', async () => {
    axios.post
      .mockRejectedValueOnce(err400("Unrecognized request argument: 'response_format'"))
      .mockResolvedValueOnce(ok('{"a":1}'));
    const body = { model: 'm', messages: [], max_tokens: 800, response_format: { type: 'json_object' } };
    const r = await adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body, disableThinking: true });
    expect(r.data.choices[0].message.content).toBe('{"a":1}');
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(body).not.toHaveProperty('response_format');
    expect(body.enable_thinking).toBe(false); // the endpoint never complained about it
  });

  test('starved by reasoning: ONE retry with budget x4 AND a doubled wall clock', async () => {
    axios.post
      .mockResolvedValueOnce(ok('', { finish: 'length', reasoning: 1499, completion: 1500 })) // the live shape
      .mockResolvedValueOnce(ok('{"a":1}', { reasoning: 0, completion: 400 }));
    const body = { model: 'm', messages: [], max_tokens: 1500 };
    const r = await adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body, timeoutMs: 60000 });
    expect(r.data.choices[0].message.content).toBe('{"a":1}');
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(body.max_tokens).toBe(6000);
    // 4x tokens met the same 60s clock once before (live: "upstream server
    // is timing out") — the retry's clock must scale too.
    expect(lastCall()[2].timeout).toBe(120000);
  });

  test('reasoning delivered separately (finish=stop, empty content) also counts as starved', async () => {
    axios.post
      .mockResolvedValueOnce(ok('', { finish: 'stop', reasoning: 700, completion: 700 }))
      .mockResolvedValueOnce(ok('{"a":1}'));
    const body = { model: 'm', messages: [], max_tokens: 300 };
    const r = await adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body, timeoutMs: 60000 });
    expect(r.data.choices[0].message.content).toBe('{"a":1}');
    expect(body.max_tokens).toBe(1200);
  });

  test('a NON-starved length truncation (partial content, no reasoning) is left to the caller', async () => {
    axios.post.mockResolvedValue(ok('{"a": 1, "b": "trunc', { finish: 'length', reasoning: 0, completion: 800 }));
    const body = { model: 'm', messages: [], max_tokens: 800 };
    const r = await adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body });
    expect(axios.post).toHaveBeenCalledTimes(1); // the caller's JSON-repair path owns this
    expect(r.data.choices[0].finish_reason).toBe('length');
  });

  test('budget and clock respect their ceilings; a starved answer AT the ceiling does not retry', async () => {
    axios.post.mockResolvedValueOnce(ok('', { finish: 'length', reasoning: 32767, completion: 32768 }));
    const body = { model: 'm', messages: [], max_tokens: MAX_TOKENS_CEILING };
    const r = await adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body, timeoutMs: 300000 });
    expect(axios.post).toHaveBeenCalledTimes(1); // already at the ceiling — another rung is a runaway
    expect(body.max_tokens).toBe(32768); // the ceiling VALUE pinned — a silent ceiling change must fail here
    expect(lastCall()[2].timeout).toBe(300000); // the clock is never raised without a retry
    expect(r.data.choices[0].finish_reason).toBe('length'); // honest: still starved at ceiling
  });

  test('the layers compose: thinking rejected, enable_thinking kept-but-starving, budget retry on top', async () => {
    axios.post
      .mockRejectedValueOnce(err400('unknown parameter: thinking'))
      // enable_thinking silently ignored by this gateway — model still reasons
      .mockResolvedValueOnce(ok('', { finish: 'length', reasoning: 900, completion: 900 }))
      .mockResolvedValueOnce(ok('{"a":1}'));
    const body = { model: 'm', messages: [], max_tokens: 300 };
    const r = await adaptiveChatCompletion({
      url: URL,
      headers: HEADERS,
      body,
      disableThinking: true,
      timeoutMs: 60000
    });
    expect(r.data.choices[0].message.content).toBe('{"a":1}');
    expect(axios.post).toHaveBeenCalledTimes(3);
    expect(body.thinking).toBeUndefined();
    expect(body.max_tokens).toBe(1200);
    expect(lastCall()[2].timeout).toBe(120000);
  });

  test('the ladder CLIMBS to the ceiling (live shape: starved at 1500 AND at 6000)', async () => {
    axios.post
      .mockResolvedValueOnce(ok('', { finish: 'length', reasoning: 1499, completion: 1500 }))
      .mockResolvedValueOnce(ok('', { finish: 'length', reasoning: 5999, completion: 6000 }))
      .mockResolvedValueOnce(ok('{"a":1}', { reasoning: 7000, completion: 7400 }));
    const body = { model: 'm', messages: [], max_tokens: 1500 };
    const r = await adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body, timeoutMs: 300000 });
    expect(r.data.choices[0].message.content).toBe('{"a":1}');
    expect(axios.post).toHaveBeenCalledTimes(3);
    expect(body.max_tokens).toBe(24000); // 1500 -> 6000 -> 24000 (the 8192 ceiling was a starve — live 2026-10-20)
    // a 5-min async base clock doubles once, capped at the 10-min ceiling
    expect(lastCall()[2].timeout).toBe(600000);
  });

  // #1725 — the caller's wall-clock budget. The budget-aware callers
  // (frontmatter, curation, concept-meta summary, topic links) already
  // track remainingMs (resolveCallModel / resolveDeploymentModel); the
  // ladder must never hold the wire past it. Date.now is scripted so the
  // rung arithmetic is exact — and the timeline is the production one: the
  // FIRST scripted value anchors the deadline at the function's ENTRY,
  // each later value is the clock reading at a rung check (the elapsed
  // gap is attempt 1's real cost).
  describe('budgetMs — the caller-declared wall-clock budget', () => {
    const nowSpy = (values) => {
      const spy = jest.spyOn(Date, 'now');
      for (const v of values) spy.mockReturnValueOnce(v);
      // An exhausted script falls back to the REAL clock silently — a
      // future call-count change would then flip which assertion the
      // epoch-sized number satisfies. Fail loudly instead.
      spy.mockImplementation(() => {
        throw new Error('Date.now scripted past its timeline — extend the values');
      });
      return spy;
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('the #1725 shape: the first attempt ate the budget — NO rung fires, starvation propagates', async () => {
      nowSpy([0, 800]); // deadline = 5000; after attempt 1 the remaining 4200 < the 5000 clock
      axios.post.mockResolvedValue(ok('', { finish: 'length', reasoning: 200, completion: 201 }));
      const body = { model: 'm', messages: [], max_tokens: 200 };
      const r = await adaptiveChatCompletion({
        url: ENDPOINT,
        headers: HEADERS,
        body,
        timeoutMs: 5000,
        budgetMs: 5000
      });
      expect(axios.post).toHaveBeenCalledTimes(1); // a rung would be a hold the caller never granted
      expect(r.data.choices[0].finish_reason).toBe('length'); // honest, like disableBudgetLadder
    });

    test('a rung CLAMPS to the remaining budget instead of the doubled clock', async () => {
      nowSpy([0, 1000, 101000]); // entry 0; check1 at 1000; check2 at 101000
      axios.post
        .mockResolvedValueOnce(ok('', { finish: 'length', reasoning: 1499, completion: 1500 }))
        .mockResolvedValueOnce(ok('', { finish: 'length', reasoning: 5999, completion: 6000 }));
      const body = { model: 'm', messages: [], max_tokens: 1500 };
      const r = await adaptiveChatCompletion({
        url: ENDPOINT,
        headers: HEADERS,
        body,
        timeoutMs: 60000,
        budgetMs: 100000
      });
      expect(axios.post).toHaveBeenCalledTimes(2);
      // min(doubled 120000, remaining 99000) — the clamp, not the scale
      expect(lastCall()[2].timeout).toBe(99000);
      expect(body.max_tokens).toBe(6000);
      expect(r.data.choices[0].finish_reason).toBe('length');
    });

    test('a non-finite budgetMs is no budget — axios would silently drop a NaN timeout', async () => {
      // The vllm-model-cache precedent: a NaN clock hangs the request
      // instead of failing on its budget, so a non-finite grant is treated
      // as no grant at all (the climb stays ceiling-bounded).
      axios.post
        .mockResolvedValueOnce(ok('', { finish: 'length', reasoning: 1499, completion: 1500 }))
        .mockResolvedValueOnce(ok('{"a":1}'));
      const body = { model: 'm', messages: [], max_tokens: 1500 };
      const r = await adaptiveChatCompletion({
        url: ENDPOINT,
        headers: HEADERS,
        body,
        timeoutMs: 60000,
        budgetMs: NaN
      });
      expect(r.data.choices[0].message.content).toBe('{"a":1}');
      expect(lastCall()[2].timeout).toBe(120000); // the plain doubled clock — no budget arithmetic ran
    });

    test('the budget bounds the WHOLE ladder: rungs stop when the clock runs out', async () => {
      nowSpy([0, 100, 120100, 250000]); // deadlines/checks: 0=start, 100=check1, 120100=check2, 250000=check3
      axios.post.mockResolvedValue(ok('', { finish: 'length', reasoning: 900, completion: 901 }));
      const body = { model: 'm', messages: [], max_tokens: 1500 };
      const r = await adaptiveChatCompletion({
        url: ENDPOINT,
        headers: HEADERS,
        body,
        timeoutMs: 60000,
        budgetMs: 250000
      });
      // check1: remaining 249900 -> rung min(120000, 249900) = 120000;
      // check2: remaining 129900 -> rung min(240000, 129900) = 129900;
      // check3: remaining 0 -> nothing fits -> stop. Three calls, starved.
      expect(axios.post).toHaveBeenCalledTimes(3);
      expect(body.max_tokens).toBe(24000);
      expect(r.data.choices[0].finish_reason).toBe('length');
    });

    test('no budgetMs: the async callers keep the unchanged climb to the ceiling', async () => {
      // The regression guard — every pre-#1725 caller without a declared
      // budget must behave exactly as before.
      axios.post
        .mockResolvedValueOnce(ok('', { finish: 'length', reasoning: 1499, completion: 1500 }))
        .mockResolvedValueOnce(ok('{"a":1}'));
      const body = { model: 'm', messages: [], max_tokens: 1500 };
      const r = await adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body, timeoutMs: 60000 });
      expect(r.data.choices[0].message.content).toBe('{"a":1}');
      expect(lastCall()[2].timeout).toBe(120000); // the doubled clock, no budget in sight
    });
  });
});
