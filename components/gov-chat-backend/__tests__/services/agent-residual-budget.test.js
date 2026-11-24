'use strict';

require('../setup-env');

// The residual-budget contract: pure math, no mocks — the
// module under test touches no network, clock or environment.
const { SKIP_STATUSES, computeResidual, planTranslation } = require('../../services/agent-residual-budget');

// A run that served its usage: 120 tokens spent, 2 model calls (1 loop + 1 aux).
const SERVED_USAGE = {
  run_id: 'run-1',
  outcome: 'answered',
  model_calls: 1,
  aux_model_calls: 1,
  tool_calls: 2,
  evidence_bytes: 2048,
  prompt_tokens: 90,
  completion_tokens: 30,
  wall_clock_seconds: 4.2
};

const ALLOWANCES = { maxTokens: 500, maxCalls: 4 };

describe('computeResidual', () => {
  it('subtracts the served usage from the allowances', () => {
    const residual = computeResidual({
      deadline: { remainingMs: 3000 },
      usage: SERVED_USAGE,
      allowances: ALLOWANCES
    });
    expect(residual).toEqual({
      remainingMs: 3000,
      remainingTokens: 500 - 120,
      remainingCalls: 4 - 2,
      usageAvailable: true
    });
  });

  it('counts aux model calls into the call spend', () => {
    const residual = computeResidual({
      deadline: { remainingMs: 3000 },
      usage: { ...SERVED_USAGE, model_calls: 2, aux_model_calls: 3 },
      allowances: ALLOWANCES
    });
    expect(residual.remainingCalls).toBe(-1);
  });

  it('reports unavailable usage as null remainders — never a guess', () => {
    for (const usage of [null, undefined]) {
      const residual = computeResidual({ deadline: { remainingMs: 3000 }, usage, allowances: ALLOWANCES });
      expect(residual.usageAvailable).toBe(false);
      expect(residual.remainingTokens).toBeNull();
      expect(residual.remainingCalls).toBeNull();
    }
  });

  it('treats a partially served record as unavailable (a lower bound cannot bound)', () => {
    const residual = computeResidual({
      deadline: { remainingMs: 3000 },
      usage: { ...SERVED_USAGE, completion_tokens: null },
      allowances: ALLOWANCES
    });
    expect(residual.usageAvailable).toBe(false);
    expect(residual.remainingTokens).toBeNull();
  });

  it('refuses to compute without a deadline or without allowances', () => {
    expect(() => computeResidual({ usage: SERVED_USAGE, allowances: ALLOWANCES })).toThrow(/remainingMs/);
    expect(() => computeResidual({ deadline: { remainingMs: 1 }, usage: SERVED_USAGE })).toThrow(/allowances/);
  });
});

describe('planTranslation', () => {
  it('plans the translation bounded to the remaining token allowance', () => {
    const plan = planTranslation({
      deadlineRemainingMs: 3000,
      usage: SERVED_USAGE,
      allowances: ALLOWANCES
    });
    expect(plan.decision).toBe('translate');
    expect(plan.maxTokens).toBe(380); // 500 − 120 served: the allowance, never more
    expect(plan.residual.remainingCalls).toBe(2);
  });

  it('skips with usage_unavailable and never estimates the usage up to the allowance', () => {
    const plan = planTranslation({ deadlineRemainingMs: 3000, usage: null, allowances: ALLOWANCES });
    expect(plan.decision).toBe('skip');
    expect(plan.status).toBe(SKIP_STATUSES.USAGE_UNAVAILABLE);
    expect(plan.maxTokens).toBeUndefined();
  });

  it('skips when the remaining deadline is spent', () => {
    const plan = planTranslation({ deadlineRemainingMs: 0, usage: SERVED_USAGE, allowances: ALLOWANCES });
    expect(plan.decision).toBe('skip');
    expect(plan.status).toBe(SKIP_STATUSES.DEADLINE_SPENT);
  });

  it('skips when the call allowance is spent', () => {
    const plan = planTranslation({
      deadlineRemainingMs: 3000,
      usage: { ...SERVED_USAGE, model_calls: 3, aux_model_calls: 1 },
      allowances: ALLOWANCES
    });
    expect(plan.decision).toBe('skip');
    expect(plan.status).toBe(SKIP_STATUSES.CALL_ALLOWANCE_SPENT);
  });

  it('skips when the token allowance is spent, even mid-text', () => {
    const plan = planTranslation({
      deadlineRemainingMs: 3000,
      usage: { ...SERVED_USAGE, prompt_tokens: 460, completion_tokens: 40 },
      allowances: ALLOWANCES
    });
    expect(plan.decision).toBe('skip');
    expect(plan.status).toBe(SKIP_STATUSES.TOKEN_ALLOWANCE_SPENT);
    // Exactly spent is a boundary of its own: never negative, never guessed.
    expect(plan.residual.remainingTokens).toBe(0);
  });

  it('never returns a maxTokens above the remaining allowance', () => {
    // A big window must not invite a big ask: the bound is what the run left.
    const plan = planTranslation({
      deadlineRemainingMs: 3000,
      usage: { ...SERVED_USAGE, prompt_tokens: 1, completion_tokens: 1 },
      allowances: { maxTokens: 100, maxCalls: 4 }
    });
    expect(plan.decision).toBe('translate');
    expect(plan.maxTokens).toBe(98);
    expect(plan.maxTokens).toBeLessThanOrEqual(100 - 2);
  });
});
