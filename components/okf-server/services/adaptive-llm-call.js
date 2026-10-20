// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Adaptive OpenAI-wire chat call for internal strict-JSON tasks
// (David, 2026-10-20: "this needs to work within reason for any selected
// model"). Model-agnostic layers — no vendor special-casing beyond the
// de-facto disable param:
//
//   1. The caller may set body.thinking = {type:'disabled'} (MiniMax/GLM
//      convention) so reasoning models spend the budget on the ANSWER.
//      Endpoints that reject unknown body params (OpenAI: 400 "unknown
//      parameter") get ONE automatic retry without it.
//   2. Budget adaptation: some models cannot disable reasoning
//      (DeepSeek-R1 / o1-style). When a call finishes with
//      finish_reason "length" AND either reasoning tokens were burned or
//      the answer content is empty, retry ONCE with max_tokens ×4
//      (capped) — reasoning gets room, the strict JSON still gets written.
//   3. Whatever survives is the caller's to parse; errors propagate with
//      the raw response evidence intact.
//
// Live origin (2026-10-20): MiniMax M3.1-Flash spent 1499/1500 output
// tokens reasoning and wrote zero answer chars — every internal task 502'd
// with "LLM returned unparseable JSON" while the model itself was fine.

const axios = require('axios');
const { logger } = require('../shared-lib/logger');

const MAX_TOKENS_CEILING = 8192;
const BUDGET_SCALE = 4;

function statusOf(err) {
  return err && err.response && err.response.status;
}

function bodyText(err) {
  const d = err && err.response && err.response.data;
  if (!d) return '';
  return typeof d === 'string' ? d : JSON.stringify(d);
}

/** 400 that names the param — the endpoint doesn't know `thinking`. */
function rejectsParam(err, param) {
  return statusOf(err) === 400 && new RegExp(`\\b${param}\\b`, 'i').test(bodyText(err));
}

function contentOf(resp) {
  const c = resp && resp.data && resp.data.choices && resp.data.choices[0];
  return (c && c.message && c.message.content) || '';
}

function reasoningTokensOf(resp) {
  const u = resp && resp.data && resp.data.usage;
  const d = u && (u.completion_tokens_details || u.completion_tokens_details === null);
  return (d && Number(d.reasoning_tokens)) || 0;
}

function starvedAnswer(resp) {
  const ch = resp && resp.data && resp.data.choices && resp.data.choices[0];
  const fr = ch && ch.finish_reason;
  const empty = contentOf(resp).length === 0;
  const reasoned = reasoningTokensOf(resp) > 0;
  // Two starvation shapes, either model family:
  //   - cut off mid-thinking/answer (finish_reason "length"), or
  //   - thinking only, nothing written (some gateways deliver reasoning in
  //     a separate field and still report "stop" with empty content).
  return (fr === 'length' && (reasoned || empty)) || (reasoned && empty);
}

/**
 * POST {url}/v1/chat/completions with the adaptive layers above.
 * `body` is MUTATED by the retries (thinking removed / max_tokens raised)
 * so the caller's error logging reflects what was actually sent last.
 * @returns the final axios response; re-throws the last error otherwise.
 */
async function adaptiveChatCompletion({ url, headers, body, timeoutMs = 60000 }) {
  const post = () => axios.post(url, body, { headers, timeout: timeoutMs });

  let resp;
  try {
    resp = await post();
  } catch (e) {
    if (body.thinking && rejectsParam(e, 'thinking')) {
      logger.info('adaptive_llm.thinking_param_unsupported_retry', { url });
      delete body.thinking;
      resp = await post(); // may still throw — that one is real
    } else {
      throw e;
    }
  }

  if (starvedAnswer(resp) && body.max_tokens && body.max_tokens < MAX_TOKENS_CEILING) {
    const raised = Math.min(MAX_TOKENS_CEILING, body.max_tokens * BUDGET_SCALE);
    logger.warn('adaptive_llm.budget_starved_retry', {
      url,
      finish_reason: 'length',
      reasoning_tokens: reasoningTokensOf(resp),
      content_chars: contentOf(resp).length,
      max_tokens: body.max_tokens,
      raised_to: raised
    });
    body.max_tokens = raised;
    resp = await post();
  }
  return resp;
}

module.exports = { adaptiveChatCompletion, MAX_TOKENS_CEILING };
