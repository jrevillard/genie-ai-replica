// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0

// The ONE outbound chat URL rule (services/llm-url.js). Pinned after the
// live 2026-10-21 failure: an active z.ai config (…/paas/v4) made every
// benchmark answer row POST to …/paas/v4/v1/chat/completions → 404, while
// the sidecar's SDK-built URL on the same base returned 200.

'use strict';

const { openAiChatUrl } = require('../services/llm-url');

describe('openAiChatUrl', () => {
  test.each([
    // Bare hosts get the /v1 prefix (vLLM, the sovereign /llm nginx path)
    ['http://vllm:8000', 'http://vllm:8000/v1/chat/completions'],
    ['https://ai.assembly.govstack.global/llm', 'https://ai.assembly.govstack.global/llm/v1/chat/completions'],
    // A version segment stays — /chat/completions is appended DIRECTLY
    ['https://api.openai.com/v1', 'https://api.openai.com/v1/chat/completions'],
    ['https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/chat/completions'],
    ['https://api.z.ai/api/coding/paas/v4', 'https://api.z.ai/api/coding/paas/v4/chat/completions'],
    // Trailing slashes are normalized away first
    ['https://api.z.ai/api/coding/paas/v4/', 'https://api.z.ai/api/coding/paas/v4/chat/completions'],
    ['http://vllm:8000//', 'http://vllm:8000/v1/chat/completions']
  ])('%s → %s', (base, expected) => {
    expect(openAiChatUrl(base)).toBe(expected);
  });
});

// The models-listing sibling of the same ONE rule — the discovery probe
// (services/vllm-model-cache.js) must never disagree with the chat path on
// how a base is completed (#1181).
describe('openAiModelsUrl', () => {
  test.each([
    ['http://vllm:8000', 'http://vllm:8000/v1/models'],
    ['https://ai.assembly.govstack.global/llm', 'https://ai.assembly.govstack.global/llm/v1/models'],
    ['https://api.openai.com/v1', 'https://api.openai.com/v1/models'],
    ['https://api.z.ai/api/coding/paas/v4', 'https://api.z.ai/api/coding/paas/v4/models'],
    ['https://frontier.example/v1/', 'https://frontier.example/v1/models']
  ])('%s → %s', (base, expected) => {
    expect(require('../services/llm-url').openAiModelsUrl(base)).toBe(expected);
  });
});
