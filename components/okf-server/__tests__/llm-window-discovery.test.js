// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// #1205 — the window DISCOVERY: the tiers dataprep uses, mirrored.
//
// The discovery is network I/O, so it never runs on a write path — but the
// TIERS it resolves are what the ceiling's ladder stands on, and they are
// the half of the contract the derivation tests cannot reach (those drive
// the window in directly). Here the tiers themselves are exercised: the
// operator's statement, the probe, the stale serve and the unknown.

jest.mock('../shared-lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const llmWindow = require('../services/llm-window');
const { logger } = require('../shared-lib/logger');

describe('#1205 — the window discovery tiers', () => {
  const ORIGINAL = {
    DATAPREP_MAX_MODEL_LEN: process.env.DATAPREP_MAX_MODEL_LEN,
    VLLM_ENDPOINT: process.env.VLLM_ENDPOINT,
    MODEL_DETECT_TTL: process.env.MODEL_DETECT_TTL
  };

  beforeEach(() => {
    llmWindow._resetForTesting();
    logger.info.mockClear();
    logger.warn.mockClear();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(ORIGINAL)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("the operator's statement wins and costs NO request", async () => {
    process.env.DATAPREP_MAX_MODEL_LEN = '8192';
    const resolved = await llmWindow.resolveWindow();
    expect(resolved.window).toBe(8192);
    expect(resolved.source).toBe(llmWindow.WINDOW_SOURCES.OPERATOR_STATED);
    expect(logger.info).toHaveBeenCalledWith(
      'ceiling.window.overridden',
      expect.objectContaining({ window_tokens: 8192 })
    );
  });

  test('an unusable operator statement is NOT a statement (0, garbage, empty)', () => {
    for (const bad of ['0', '-5', 'abc', '']) {
      process.env.DATAPREP_MAX_MODEL_LEN = bad;
      expect(llmWindow.operatorStatedWindow()).toBeNull();
    }
    delete process.env.DATAPREP_MAX_MODEL_LEN;
    expect(llmWindow.operatorStatedWindow()).toBeNull();
  });

  test('an ABSURD operator statement is treated as unset (dataprep _sanitize_window_override parity)', () => {
    // A typo or a chars-not-tokens value (100000000) must not derive a
    // ceiling of hundreds of millions of characters — the same sanity
    // ceiling the discovered tier enforces applies to the stated one.
    process.env.DATAPREP_MAX_MODEL_LEN = '100000000';
    expect(llmWindow.operatorStatedWindow()).toBeNull();
  });

  test('the current window is readable SYNCHRONOUSLY (no network on a write path)', () => {
    delete process.env.DATAPREP_MAX_MODEL_LEN;
    llmWindow.__setWindowForTesting(65536, 'discovered');
    const current = llmWindow.currentWindow();
    expect(current.window).toBe(65536);
    expect(current.source).toBe('discovered');
  });

  test("the operator's statement is read live by the synchronous view", () => {
    llmWindow.__setWindowForTesting(65536, 'discovered');
    process.env.DATAPREP_MAX_MODEL_LEN = '4096';
    expect(llmWindow.currentWindow().window).toBe(4096);
    expect(llmWindow.currentWindow().source).toBe(llmWindow.WINDOW_SOURCES.OPERATOR_STATED);
  });

  test('a state change logs once, not once per poll', async () => {
    process.env.DATAPREP_MAX_MODEL_LEN = '8192';
    await llmWindow.resolveWindow();
    await llmWindow.resolveWindow();
    await llmWindow.resolveWindow();
    const overridden = logger.info.mock.calls.filter((c) => c[0] === 'ceiling.window.overridden');
    expect(overridden).toHaveLength(1);
  });

  test("the refresh cadence is the cache's OWN TTL knob (one .env line, both worlds)", () => {
    delete process.env.MODEL_DETECT_TTL;
    expect(llmWindow.refreshIntervalMs()).toBe(60000); // the house default
    process.env.MODEL_DETECT_TTL = '300';
    expect(llmWindow.refreshIntervalMs()).toBe(300000);
    process.env.MODEL_DETECT_TTL = 'nonsense';
    expect(llmWindow.refreshIntervalMs()).toBe(60000);
  });

  test('the background refresh resolves and can be stopped', async () => {
    process.env.DATAPREP_MAX_MODEL_LEN = '16384';
    const refresh = llmWindow.startWindowRefresh();
    const resolved = await refresh.ready;
    expect(resolved.window).toBe(16384);
    refresh.stop();
  });
});

describe('#1205 — the ceiling readout (admin surface)', () => {
  const ORIGINAL = {
    OKF_MAX_CONCEPT_DOC_CHARS: process.env.OKF_MAX_CONCEPT_DOC_CHARS,
    DATAPREP_MAX_MODEL_LEN: process.env.DATAPREP_MAX_MODEL_LEN
  };

  beforeEach(() => {
    llmWindow._resetForTesting();
    delete process.env.OKF_MAX_CONCEPT_DOC_CHARS;
    delete process.env.DATAPREP_MAX_MODEL_LEN;
    require('../services/concept-ceiling')._resetForTesting();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(ORIGINAL)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** Drive the handler the way the route does. */
  async function call() {
    const controller = require('../controllers/ceiling-controller');
    const res = {
      statusCode: null,
      body: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.body = b;
        return this;
      }
    };
    let nextErr = null;
    await controller.getCeiling({}, res, (e) => {
      nextErr = e;
    });
    return { res, nextErr };
  }

  test('the readout names the ceiling, its source and the derivation terms', async () => {
    llmWindow.__setWindowForTesting(65536, 'discovered');
    const { res, nextErr } = await call();
    expect(nextErr).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('discovered-from-window');
    expect(res.body.window_tokens).toBe(65536);
    expect(res.body.ceiling).toBeGreaterThan(0);
    // The terms are what makes the number explainable.
    expect(res.body.terms.prompt_tokens).toBeGreaterThan(0);
    expect(res.body.terms.batch_tokens).toBeGreaterThan(0);
    expect(res.body.terms.output_tokens).toBeGreaterThan(0);
    expect(res.body.terms.reserved_tokens).toBe(
      res.body.terms.prompt_tokens +
        res.body.terms.batch_tokens +
        res.body.terms.output_tokens +
        res.body.terms.scaffold_tokens
    );
    expect(res.body.derived_ceiling).toBe(res.body.ceiling);
    expect(res.body.derived_fits).toBe(true);
  });

  test('the readout reports the PIN when one is set', async () => {
    process.env.OKF_MAX_CONCEPT_DOC_CHARS = '1234';
    const { res } = await call();
    expect(res.body.ceiling).toBe(1234);
    expect(res.body.source).toBe('operator-pin');
  });

  test('the readout reports the static default when no window is known', async () => {
    const { res } = await call();
    expect(res.body.source).toBe('static-default');
    expect(res.body.ceiling).toBe(250000);
    expect(res.body.window_tokens).toBeNull();
    expect(res.body.derived_fits).toBeNull();
  });
});
