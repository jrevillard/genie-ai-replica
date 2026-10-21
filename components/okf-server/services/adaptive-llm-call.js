// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Adaptive OpenAI-wire chat call for internal strict-JSON tasks
// (David, 2026-10-20: "this needs to work within reason for any selected
// model"; "do not implement a tactical fix just for minimax-m3.1-flash").
// Vendor-neutral layers — capability negotiation, no vendor branches:
//
//   1. NO-THINK NEGOTIATION: with disableThinking, the call carries the
//      standard request params for turning reasoning off — both the
//      thinking-object convention (GLM/MiniMax-M2 family) and
//      enable_thinking=false (Qwen-style; live-verified accepted by
//      MiniMax M3.1-Flash, which rejects the thinking object with
//      "requires adaptive thinking"). An endpoint's 400 that NAMES a param
//      ("unknown parameter thinking" / "invalid params … thinking.type")
//      drops exactly that param and retries — every vendor converges on
//      the subset it understands, at most a few fast 400s.
//   2. BUDGET ADAPTATION: models whose reasoning cannot be disabled at all
//      starve the answer (finish_reason "length" with reasoning burn or
//      empty content, or reasoning delivered separately with empty
//      content). Retry ONCE with max_tokens ×4 (capped) AND a doubled
//      wall clock (capped) — more thinking room without the previous
//      failure mode where 4× tokens met the same 60s timeout
//      (live 2026-10-20: "upstream server is timing out").
//   3. Non-starved truncation (partial JSON, no reasoning) belongs to the
//      caller's JSON-repair path; everything else propagates with the
//      response evidence intact.
//
// Live origins (2026-10-20): MiniMax M3.1-Flash spent 1499/1500 output
// tokens reasoning and wrote zero answer chars; its endpoint then rejected
// the thinking object and the 6000-token retry timed out at 60s.

const axios = require('axios');
const { logger } = require('../shared-lib/logger');

// 32768 (live 2026-10-20): M3.1-Flash burned 300→1200→4800→8192 ENTIRELY
// on reasoning against the routing-advisor prompt (244 queries) and wrote
// zero content at every rung — 8192 was not "safe", it was a starve for
// big-task thinking models. The ceiling is a runaway guard, not a
// capability cap: non-reasoning models never climb (the ladder only
// triggers on reasoning burn), so only models that genuinely need the
// room ever see it. Same day, the 8192 rung took ~97s — a 32768 rung
// needs ~6-7 min, hence the 10-min clock ceiling (async callers only).
const MAX_TOKENS_CEILING = 32768;
const BUDGET_SCALE = 4;
const TIMEOUT_CEILING_MS = 600000; // 10 min — async callers hand thinking models minutes
const TIMEOUT_SCALE = 2;
/** The standard no-think request params, both wire conventions. */
const NO_THINK_PARAMS = { thinking: { type: 'disabled' }, enable_thinking: false };
/** Optional params the 400-negotiation may strip: the no-think pair plus the
 * strict-JSON response_format (live 2026-10-21: z.ai rejects it with an
 * UNNAMED 400 — named-only negotiation would propagate it and kill every
 * benchmark answer row). Callers already tolerate its absence: every strict
 * JSON consumer has a raw-content/repair fallback. */
const OPTIONAL_PARAMS = [...Object.keys(NO_THINK_PARAMS), 'response_format'];

function statusOf(err) {
  return err && err.response && err.response.status;
}

function bodyText(err) {
  const d = err && err.response && err.response.data;
  if (!d) return '';
  return typeof d === 'string' ? d : JSON.stringify(d);
}

/** The param names the endpoint's 400 explicitly rejects, if any. */
function rejectedParams(err, candidates) {
  if (statusOf(err) !== 400) return [];
  const text = bodyText(err);
  return candidates.filter((p) => new RegExp(`\\b${p}\\b`).test(text));
}

function contentOf(resp) {
  const c = resp && resp.data && resp.data.choices && resp.data.choices[0];
  return (c && c.message && c.message.content) || '';
}

function reasoningTokensOf(resp) {
  const u = resp && resp.data && resp.data.usage;
  const d = u && u.completion_tokens_details;
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
 * `body` is MUTATED by the retries (params dropped / budget raised) so the
 * caller's error logging reflects what was actually sent last.
 * @returns the final axios response; re-throws the last error otherwise.
 */
async function adaptiveChatCompletion({
  url,
  headers,
  body,
  timeoutMs = 60000,
  disableThinking = false,
  disableBudgetLadder = false
}) {
  if (disableThinking) Object.assign(body, NO_THINK_PARAMS);
  let timeout = timeoutMs;

  const post = () => axios.post(url, body, { headers, timeout });

  let resp;
  // Layer 1 — param negotiation, ordered least-to-most costly to lose:
  //   1. a 400 that NAMES a param drops exactly that param;
  //   2. a GENERIC 400 drops response_format ALONE first (every strict-JSON
  //      consumer has a raw-content fallback — it is never load-bearing);
  //   3. a still-generic 400 strips the remaining optional params as a LAST
  //      RESORT — this can re-enable thinking on an endpoint that merely
  //      rejected response_format, so it must not happen before (2) tried.
  // (live 2026-10-21: z.ai's enable_thinking rejection names nothing — the
  // sequence converges: thinking dropped by its prose 400, response_format
  // dropped by round 2, enable_thinking by round 3 → bare 200.)
  // A bare 400 is a real error (bad model, bad shape…) and propagates.
  let formatDropped = false;
  let bareRoundUsed = false;
  for (let round = 0; round <= OPTIONAL_PARAMS.length + 2; round += 1) {
    try {
      resp = await post();
      break;
    } catch (e) {
      if (statusOf(e) !== 400) throw e;
      const present = OPTIONAL_PARAMS.filter((p) => body[p] !== undefined);
      const rejected = rejectedParams(e, present);
      if (rejected.length) {
        logger.info('adaptive_llm.param_rejected', { url, dropped: rejected.join(',') });
        for (const p of rejected) delete body[p];
      } else if (!formatDropped && body.response_format !== undefined) {
        formatDropped = true;
        logger.info('adaptive_llm.unnamed_400_strip_response_format', { url });
        delete body.response_format;
      } else if (present.length && !bareRoundUsed) {
        bareRoundUsed = true;
        logger.info('adaptive_llm.unnamed_400_strip_optional', { url, dropped: present.join(',') });
        for (const p of present) delete body[p];
      } else {
        throw e; // a REAL 400 (bad model, bad shape…) — not ours to fix
      }
      if (round === OPTIONAL_PARAMS.length + 2) throw e; // safety: never loop unbounded
    }
  }

  // Layer 2 — budget + wall-clock adaptation for answers starved by
  // reasoning that could not be turned off. The ladder scales until the
  // ceiling (live 2026-10-20: M3.1-Flash starved at 1500 AND at 6000 — a
  // single retry was not enough); each rung doubles the wall clock.
  // disableBudgetLadder (the model-config ping): a ping must stay a ping —
  // a model that starves a 16-token call would climb ~7 rungs for up to
  // tens of minutes with the caller's UI hung; report the starvation
  // honestly instead so the operator picks a model that answers.
  if (disableBudgetLadder) return resp;
  while (starvedAnswer(resp) && body.max_tokens && body.max_tokens < MAX_TOKENS_CEILING) {
    const raised = Math.min(MAX_TOKENS_CEILING, body.max_tokens * BUDGET_SCALE);
    timeout = Math.min(TIMEOUT_CEILING_MS, timeout * TIMEOUT_SCALE);
    logger.warn('adaptive_llm.budget_starved_retry', {
      url,
      finish_reason: 'length',
      reasoning_tokens: reasoningTokensOf(resp),
      content_chars: contentOf(resp).length,
      max_tokens: body.max_tokens,
      raised_to: raised,
      timeout_ms: timeout
    });
    body.max_tokens = raised;
    resp = await post();
  }
  return resp;
}

module.exports = { adaptiveChatCompletion, NO_THINK_PARAMS, MAX_TOKENS_CEILING };
