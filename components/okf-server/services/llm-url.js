// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0

'use strict';

/** The ONE OpenAI-compatible chat URL rule for every outbound call.
 *
 * A base that already carries a version segment (OpenAI's …/v1, DeepSeek's
 * …/v1, z.ai's …/paas/v4) takes /chat/completions DIRECTLY; a bare host
 * (vLLM at http://vllm:8000, the sovereign /llm nginx path) gets the /v1
 * prefix appended.
 *
 * Why this module exists (2026-10-21, live): the answer/curation/tagging
 * legs stripped only a literal trailing /v1 and then force-appended
 * /v1/chat/completions — an active z.ai config (…/paas/v4) therefore 404'd
 * EVERY benchmark answer row while the ragas sidecar, whose LangChain SDK
 * builds the URL correctly from the same base, returned 200 on the very
 * next path segment. One rule, shared by every call site, so the
 * test-connection (which already built it right), the benchmark legs and
 * the curation legs can never disagree again. */
function openAiChatUrl(base) {
  const b = String(base || '').replace(/\/+$/, '');
  return /\/v\d+$/.test(b) ? `${b}/chat/completions` : `${b}/v1/chat/completions`;
}

/** The models-listing sibling of the same rule: GET {base}/v1/models for
 * the discovery probe (services/vllm-model-cache.js). Same base-completion
 * semantics so the probe and the chat path can never disagree on a base. */
function openAiModelsUrl(base) {
  const b = String(base || '').replace(/\/+$/, '');
  return /\/v\d+$/.test(b) ? `${b}/models` : `${b}/v1/models`;
}

module.exports = { openAiChatUrl, openAiModelsUrl };
