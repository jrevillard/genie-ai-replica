'use strict';

// The residual-budget contract the BFF's translation leg plans against:
// the run's usage record is the shared state between the
// agent service and the BFF, and translation may start a call only within
// what the run left unspent of the deployment's allowance.
//
// The contract is PURE: it computes a decision from the inputs and never
// touches the network, the clock or the environment. The wiring that
// fetches the usage record and executes the decision sits outside this
// module — the legacy translation path keeps its deployed behavior
// untouched (the V05 contract freezes it).
//
// The one rule that outranks everything else: translation NEVER exceeds
// the allowance. When the run's usage is unavailable (the record is
// missing, or the endpoint served no token counts), the plan is `skip`
// with the recorded status — the English answer stays, because a
// translation that cannot be bounded is a translation that must not
// start. The usage is never estimated up to the allowance: an estimate
// would be a guess wearing the budget's clothes.

// The skip-status vocabulary — the recorded statuses a caller sees on the
// skip decision. Named and frozen: one home, so a wiring site
// compares against the constant and a typo surfaces at import.
const SKIP_STATUSES = Object.freeze({
  USAGE_UNAVAILABLE: 'usage_unavailable',
  DEADLINE_SPENT: 'deadline_spent',
  CALL_ALLOWANCE_SPENT: 'call_allowance_spent',
  TOKEN_ALLOWANCE_SPENT: 'token_allowance_spent'
});

// The usage fields the allowance is computed from. ALL FOUR must be finite
// for the record to bound anything: the token fields bound the token
// allowance, the call fields bound the call allowance, and a missing one
// leaves that half unbounded (a string `model_calls` would poison the
// call-allowance arithmetic — `NaN` remaining — and silently unbound it).
// The rule is ONE home: the leg's own gate applies this same predicate, so
// the two cannot disagree about what "available" means.
const USAGE_FIELDS = Object.freeze(['prompt_tokens', 'completion_tokens', 'model_calls', 'aux_model_calls']);

/**
 * Whether the run's usage record can bound a translation.
 *
 * A missing record, or one with a non-finite field, bounds nothing —
 * translation is skipped and the run's usage is never estimated up to the
 * allowance. The same rule the agent side runs, on the same fields.
 *
 * @param {Object|null} usage - The run's terminal usage record.
 * @returns {boolean}
 */
function usageAvailable(usage) {
  return usage !== null && usage !== undefined && USAGE_FIELDS.every((field) => Number.isFinite(usage[field]));
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

  // The record's fields are the endpoint's served counts. Any one of them
  // missing makes the total a lower bound — the same degradation rule the
  // agent side runs — and a lower bound cannot bound a translation.
  const usageIsAvailable = usageAvailable(usage);

  const remainingMs = deadline.remainingMs;
  let remainingTokens = null;
  let remainingCalls = null;
  if (usageIsAvailable) {
    const usedTokens = usage.prompt_tokens + usage.completion_tokens;
    remainingTokens = allowances.maxTokens - usedTokens;
    const usedCalls = usage.model_calls + usage.aux_model_calls;
    remainingCalls = allowances.maxCalls - usedCalls;
  }
  return { remainingMs, remainingTokens, remainingCalls, usageAvailable: usageIsAvailable };
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
    return { decision: 'skip', status: SKIP_STATUSES.USAGE_UNAVAILABLE, residual };
  }
  if (residual.remainingMs <= 0) {
    return { decision: 'skip', status: SKIP_STATUSES.DEADLINE_SPENT, residual };
  }
  if (residual.remainingCalls <= 0) {
    return { decision: 'skip', status: SKIP_STATUSES.CALL_ALLOWANCE_SPENT, residual };
  }
  if (residual.remainingTokens <= 0) {
    return { decision: 'skip', status: SKIP_STATUSES.TOKEN_ALLOWANCE_SPENT, residual };
  }
  // The bound is the remaining allowance, however large the text: a call
  // that needs more stops at the budget (the backend surfaces a truncated
  // translation as a failed request), it never exceeds it.
  return { decision: 'translate', maxTokens: residual.remainingTokens, residual };
}

module.exports = {
  SKIP_STATUSES,
  usageAvailable,
  computeResidual,
  planTranslation
};
