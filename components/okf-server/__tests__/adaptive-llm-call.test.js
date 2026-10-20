// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// adaptive-llm-call — the model-agnostic layers (David 2026-10-20: "work
// within reason for any selected model", "not a tactical fix for one
// model"). No vendor branches: a standard disable param with an unknown-
// param fallback, and an evidence-driven budget retry.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('axios');

const axios = require('axios');
const { adaptiveChatCompletion, MAX_TOKENS_CEILING } = require('../services/adaptive-llm-call');

const HEADERS = { 'Content-Type': 'application/json' };

function ok(content, { finish = 'stop', reasoning = 0, completion = 10 } = {}) {
  return {
    data: {
      choices: [{ message: { content }, finish_reason: finish }],
      usage: { completion_tokens: completion, completion_tokens_details: { reasoning_tokens: reasoning } }
    }
  };
}

beforeEach(() => {
  axios.post.mockReset();
});

describe('adaptiveChatCompletion', () => {
  test('happy path: one call, body untouched, response returned', async () => {
    axios.post.mockResolvedValue(ok('{"a":1}'));
    const body = { model: 'm', messages: [], max_tokens: 800 };
    const r = await adaptiveChatCompletion({ url: 'https://x/v1/chat/completions', headers: HEADERS, body });
    expect(r.data.choices[0].message.content).toBe('{"a":1}');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(body.max_tokens).toBe(800);
  });

  test('endpoint that rejects the thinking param: one retry WITHOUT it (OpenAI-class 400)', async () => {
    axios.post
      .mockRejectedValueOnce({
        response: { status: 400, data: { error: { message: "Unrecognized request argument: 'thinking'" } } }
      })
      .mockResolvedValueOnce(ok('{"a":1}'));
    const body = { model: 'm', messages: [], max_tokens: 800, thinking: { type: 'disabled' } };
    const r = await adaptiveChatCompletion({ url: 'https://x/v1/chat/completions', headers: HEADERS, body });
    expect(r.data.choices[0].message.content).toBe('{"a":1}');
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(body.thinking).toBeUndefined(); // dropped for the retry
  });

  test('any OTHER 400 propagates untouched', async () => {
    const err = { response: { status: 400, data: { error: { message: 'invalid model' } } } };
    axios.post.mockRejectedValue(err);
    const body = { model: 'm', messages: [], max_tokens: 800, thinking: { type: 'disabled' } };
    await expect(adaptiveChatCompletion({ url: 'https://x/v1/chat/completions', headers: HEADERS, body })).rejects.toBe(
      err
    );
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  test('starved by reasoning (finish=length, empty content): one retry with budget x4', async () => {
    axios.post
      .mockResolvedValueOnce(ok('', { finish: 'length', reasoning: 1499, completion: 1500 })) // the live M3.1-Flash shape
      .mockResolvedValueOnce(ok('{"a":1}'));
    const body = { model: 'm', messages: [], max_tokens: 1500 };
    const r = await adaptiveChatCompletion({ url: 'https://x/v1/chat/completions', headers: HEADERS, body });
    expect(r.data.choices[0].message.content).toBe('{"a":1}');
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(body.max_tokens).toBe(6000);
  });

  test('reasoning delivered separately with finish=stop and EMPTY content also counts as starved', async () => {
    axios.post
      .mockResolvedValueOnce(ok('', { finish: 'stop', reasoning: 700, completion: 700 }))
      .mockResolvedValueOnce(ok('{"a":1}'));
    const body = { model: 'm', messages: [], max_tokens: 300 };
    const r = await adaptiveChatCompletion({ url: 'https://x/v1/chat/completions', headers: HEADERS, body });
    expect(r.data.choices[0].message.content).toBe('{"a":1}');
    expect(body.max_tokens).toBe(1200);
  });

  test('a NON-starved length truncation (partial content, no reasoning) is left to the caller', async () => {
    axios.post.mockResolvedValue(ok('{"a": 1, "b": "trunc', { finish: 'length', reasoning: 0, completion: 800 }));
    const body = { model: 'm', messages: [], max_tokens: 800 };
    const r = await adaptiveChatCompletion({ url: 'https://x/v1/chat/completions', headers: HEADERS, body });
    expect(axios.post).toHaveBeenCalledTimes(1); // no retry — the caller's JSON-repair path owns this
    expect(r.data.choices[0].finish_reason).toBe('length');
  });

  test('budget never exceeds the ceiling, and a starved answer AT the ceiling does not retry', async () => {
    axios.post
      .mockResolvedValueOnce(ok('', { finish: 'length', reasoning: 4000, completion: 4000 }))
      .mockResolvedValueOnce(ok('', { finish: 'length', reasoning: 8192, completion: 8192 }));
    const body = { model: 'm', messages: [], max_tokens: 4096 };
    const r = await adaptiveChatCompletion({ url: 'https://x/v1/chat/completions', headers: HEADERS, body });
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(body.max_tokens).toBe(MAX_TOKENS_CEILING); // 4096x4 capped, not 16384
    expect(r.data.choices[0].finish_reason).toBe('length'); // honest: still starved at ceiling
  });

  test('the layers compose: thinking rejected AND the retry starves -> budget retry on top', async () => {
    axios.post
      .mockRejectedValueOnce({ response: { status: 400, data: { error: { message: 'unknown parameter: thinking' } } } })
      .mockResolvedValueOnce(ok('', { finish: 'length', reasoning: 900, completion: 900 }))
      .mockResolvedValueOnce(ok('{"a":1}'));
    const body = { model: 'm', messages: [], max_tokens: 300, thinking: { type: 'disabled' } };
    const r = await adaptiveChatCompletion({ url: 'https://x/v1/chat/completions', headers: HEADERS, body });
    expect(r.data.choices[0].message.content).toBe('{"a":1}');
    expect(axios.post).toHaveBeenCalledTimes(3);
    expect(body.thinking).toBeUndefined();
    expect(body.max_tokens).toBe(1200);
  });
});
