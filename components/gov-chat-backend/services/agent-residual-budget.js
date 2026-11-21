'use strict';

// The residual-budget contract the BFF's translation leg plans against
// (AD-6/AD-14): the run's usage record is the shared state between the
// agent service and the BFF, and translation may start a call only within
// what the run left unspent of the deployment's allowance.
//
// The contract is PURE: it computes a decision from the inputs and never
// touches the network, the clock or the environment. The wiring that
// fetches the usage record and executes the decision is story 2.10 — the
// legacy translation path keeps its deployed behavior untouched (the V05
// contract freezes it).
//
// The one rule that outranks everything else: translation NEVER exceeds
// the allowance. When the run's usage is unavailable (the record is
// missing, or the endpoint served no token counts), the plan is `skip`
// with the recorded status — the English answer stays, because a
// translation that cannot be bounded is a translation that must not
// start. The usage is never estimated up to the allowance: an estimate
// would be a guess wearing the budget's clothes.

// The deployed estimate constant (`_capMaxTokens` in the GPU translation
// backend): a translation prompt runs about `chars / 4` tokens. It sizes
// the CALLER's view of what a translation needs — the allowance bound
// below is what it may never exceed.
const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Estimate the token footprint of a text at the deployed `chars / 4`
 * constant (rounded up).
 *
 * @param {string} text
 * @returns {number} the estimated token count
 */
function estimateTextTokens(text) {
  return Math.ceil(String(text ?? '').length / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Compute what remains of the translation allowance after one agent run.
 *
 * @param {Object} params
 * @param {Object} params.deadline - the BFF's remaining end-to-end time,
 *   clock-skew-free: `{ remainingMs }` (the same remaining-duration
 *   convention the agent-phase `deadline_ms` uses).
 * @param {Object|null} params.usage - the run's terminal usage record
 *   (`{prompt_tokens, completion_tokens, model_calls, aux_model_calls, ...}`)
 *   as the agent service served it, or null when there is no record.
 * @param {Object} params.allowances - the deployment's translation-leg
 *   bounds: `{ maxTokens, maxCalls }` (required, server configuration —
 *   never a client-supplied value).
 * @returns {Object} `{ remainingMs, remainingTokens, remainingCalls, usageAvailable }`
 *   — `remainingTokens`/`remainingCalls` are null when the usage is
 *   unavailable (never guessed).
 * @throws {Error} when the deadline or the allowances are missing/not finite
 */
function computeResidual({ deadline, usage, allowances }) {
  if (!deadline || !Number.isFinite(deadline.remainingMs)) {
    throw new Error('computeResidual requires deadline.remainingMs');
  }
  if (!allowances || !Number.isFinite(allowances.maxTokens) || !Number.isFinite(allowances.maxCalls)) {
    throw new Error('computeResidual requires finite allowances.maxTokens and allowances.maxCalls');
  }

  // The record's token fields are the endpoint's served counts. Either one
  // missing makes the total a lower bound — the same degradation rule the
  // agent side runs — and a lower bound cannot bound a translation.
  const usageAvailable =
    usage !== null &&
    usage !== undefined &&
    Number.isFinite(usage.prompt_tokens) &&
    Number.isFinite(usage.completion_tokens);

  const remainingMs = deadline.remainingMs;
  let remainingTokens = null;
  let remainingCalls = null;
  if (usageAvailable) {
    const usedTokens = usage.prompt_tokens + usage.completion_tokens;
    remainingTokens = allowances.maxTokens - usedTokens;
    const usedCalls = (usage.model_calls || 0) + (usage.aux_model_calls || 0);
    remainingCalls = allowances.maxCalls - usedCalls;
  }
  return { remainingMs, remainingTokens, remainingCalls, usageAvailable };
}

/**
 * Plan the answer translation of one agentic turn against the residual.
 *
 * The plan is conservative in one direction only: it translates when (and
 * only when) the record proves room, and it bounds the call to the
 * remaining token allowance (`maxTokens`) so the request cannot spend more
 * than the run left. Every skip carries its recorded status — the caller
 * keeps the English answer and the status lands in the execution record.
 *
 * @param {Object} params - `{ deadlineRemainingMs, usage, allowances }`
 *   (`usage`/`allowances` pass through to `computeResidual`)
 * @returns {Object} `{ decision: 'translate', maxTokens, residual }` or
 *   `{ decision: 'skip', status, residual }` — status is one of
 *   `usage_unavailable` | `deadline_spent` | `call_allowance_spent` |
 *   `token_allowance_spent`
 */
function planTranslation({ deadlineRemainingMs, usage, allowances }) {
  const residual = computeResidual({
    deadline: { remainingMs: deadlineRemainingMs },
    usage,
    allowances
  });

  if (!residual.usageAvailable) {
    return { decision: 'skip', status: 'usage_unavailable', residual };
  }
  if (residual.remainingMs <= 0) {
    return { decision: 'skip', status: 'deadline_spent', residual };
  }
  if (residual.remainingCalls <= 0) {
    return { decision: 'skip', status: 'call_allowance_spent', residual };
  }
  if (residual.remainingTokens <= 0) {
    return { decision: 'skip', status: 'token_allowance_spent', residual };
  }
  // The bound is the remaining allowance, however large the text: a call
  // that needs more stops at the budget (the backend surfaces a truncated
  // translation as a failed request), it never exceeds it.
  return { decision: 'translate', maxTokens: residual.remainingTokens, residual };
}

module.exports = {
  estimateTextTokens,
  computeResidual,
  planTranslation
};
