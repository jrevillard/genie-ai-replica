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
  test('an UNNAMED 400 with optional params present strips them all and retries bare ONCE', async () => {
    axios.post.mockRejectedValueOnce(err400('invalid request body')).mockResolvedValueOnce(ok('plain text'));
    const body = { model: 'm', messages: [], max_tokens: 800, response_format: { type: 'json_object' } };
    const r = await adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body, disableThinking: true });
    expect(r.data.choices[0].message.content).toBe('plain text');
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(body).not.toHaveProperty('response_format');
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('enable_thinking');
  });

  test('an unnamed 400 that PERSISTS bare is a real error — exactly one strip-retry, then throw', async () => {
    const e = err400('invalid request body');
    axios.post.mockRejectedValue(e);
    const body = { model: 'm', messages: [], max_tokens: 800, response_format: { type: 'json_object' } };
    await expect(adaptiveChatCompletion({ url: ENDPOINT, headers: HEADERS, body, disableThinking: true })).rejects.toBe(
      e
    );
    expect(axios.post).toHaveBeenCalledTimes(2); // shaped, then bare — never more
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
    expect(body.max_tokens).toBe(MAX_TOKENS_CEILING);
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
});
