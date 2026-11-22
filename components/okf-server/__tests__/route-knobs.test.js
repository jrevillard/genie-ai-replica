// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 1b — the ONE knob loader.
//
// The routing thresholds used to be captured at MODULE LOAD in three places
// (head-test-service.js, head-suite-service.js's GATE_* aliases, and the
// retriever's config.py). Two consequences:
//
//   1. A retune plus a single-service restart left the Lab and production on
//      DIFFERENT thresholds - both green, neither honest.
//   2. The effective values never reached the run doc, so a stored run could
//      not say which thresholds produced it.
//
// The loader reads the environment PER RUN (not at import), and the values
// it resolves are what the run record carries.
//
// The Python authority (genie-ai-overlay/retriever/config.py) reads the same
// env names with the same defaults. That parity is pinned by the
// config-validator suite (tests/config-validator) - this suite pins the
// JS side and the per-run read.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

const { logger } = require('../shared-lib/logger');
const { routeKnobs, routeParity, ROUTE_KNOB_DEFAULTS, ROUTE_KNOB_ENV } = require('../services/route-knobs');

describe('#2061: the route knob loader', () => {
  const ENV_KEYS = [
    'RETRIEVER_ROUTE_ENABLED',
    'RETRIEVER_ROUTE_TOP_K',
    'RETRIEVER_ROUTE_MIN_CHUNKS',
    'RETRIEVER_ROUTE_PROBE_TIMEOUT_MS',
    'RETRIEVER_ROUTE_RETRY',
    'RETRIEVER_ROUTE_HEAD_WEIGHT',
    'RETRIEVER_ROUTE_HEAD_MARGIN',
    'RETRIEVER_ROUTE_HEAD_FLOOR',
    'RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX',
    'RETRIEVER_ROUTE_HEADS_SUPERSEDE'
  ];

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    logger.warn.mockClear();
  });

  it('resolves the production defaults when nothing is set', () => {
    // These MUST equal genie-ai-overlay/retriever/config.py:171-223 - the
    // retriever IS the authority; the Lab mirrors it.
    expect(routeKnobs()).toEqual({
      ROUTE_ENABLED: true,
      ROUTE_TOP_K: 40,
      ROUTE_MIN_CHUNKS: 3,
      ROUTE_PROBE_TIMEOUT_MS: 2000,
      ROUTE_RETRY: 1,
      ROUTE_HEAD_WEIGHT: 1.0,
      ROUTE_HEAD_MARGIN: 0.01,
      ROUTE_HEAD_FLOOR: 0.55,
      ROUTE_FORBIDDEN_TAG_MAX: 0.55,
      ROUTE_HEADS_SUPERSEDE: true
    });
    expect(ROUTE_KNOB_DEFAULTS).toEqual({
      ROUTE_ENABLED: true,
      ROUTE_TOP_K: 40,
      ROUTE_MIN_CHUNKS: 3,
      ROUTE_PROBE_TIMEOUT_MS: 2000,
      ROUTE_RETRY: 1,
      ROUTE_HEAD_WEIGHT: 1.0,
      ROUTE_HEAD_MARGIN: 0.01,
      ROUTE_HEAD_FLOOR: 0.55,
      ROUTE_FORBIDDEN_TAG_MAX: 0.55,
      ROUTE_HEADS_SUPERSEDE: true
    });
  });

  it('reads the environment PER RUN, not at import', () => {
    // The whole point of the loader: a retune takes effect on the next run
    // without a service restart, and the run record can say which
    // thresholds produced it. A module-load capture could do neither.
    process.env.RETRIEVER_ROUTE_HEAD_FLOOR = '0.30';
    expect(routeKnobs().ROUTE_HEAD_FLOOR).toBe(0.3);
    process.env.RETRIEVER_ROUTE_HEAD_FLOOR = '0.42';
    expect(routeKnobs().ROUTE_HEAD_FLOOR).toBe(0.42);
    delete process.env.RETRIEVER_ROUTE_HEAD_FLOOR;
    expect(routeKnobs().ROUTE_HEAD_FLOOR).toBe(0.55);
  });

  it('reads every knob the retriever authority defines', () => {
    process.env.RETRIEVER_ROUTE_TOP_K = '11';
    process.env.RETRIEVER_ROUTE_MIN_CHUNKS = '7';
    process.env.RETRIEVER_ROUTE_PROBE_TIMEOUT_MS = '1234';
    process.env.RETRIEVER_ROUTE_RETRY = '4';
    process.env.RETRIEVER_ROUTE_HEAD_WEIGHT = '2.5';
    process.env.RETRIEVER_ROUTE_HEAD_MARGIN = '0.05';
    process.env.RETRIEVER_ROUTE_HEAD_FLOOR = '0.6';
    process.env.RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX = '0.7';
    expect(routeKnobs()).toEqual({
      ROUTE_ENABLED: true,
      ROUTE_TOP_K: 11,
      ROUTE_MIN_CHUNKS: 7,
      ROUTE_PROBE_TIMEOUT_MS: 1234,
      ROUTE_RETRY: 4,
      ROUTE_HEAD_WEIGHT: 2.5,
      ROUTE_HEAD_MARGIN: 0.05,
      ROUTE_HEAD_FLOOR: 0.6,
      ROUTE_FORBIDDEN_TAG_MAX: 0.7,
      ROUTE_HEADS_SUPERSEDE: true
    });
  });

  it('reads the boolean knobs the retriever also reads', () => {
    // The retriever reads these as os.getenv(X, "true").lower() == "true".
    process.env.RETRIEVER_ROUTE_ENABLED = 'false';
    process.env.RETRIEVER_ROUTE_HEADS_SUPERSEDE = 'false';
    const k = routeKnobs();
    expect(k.ROUTE_ENABLED).toBe(false);
    expect(k.ROUTE_HEADS_SUPERSEDE).toBe(false);
    // ... and an operator who PINS them true gets true.
    process.env.RETRIEVER_ROUTE_ENABLED = 'true';
    process.env.RETRIEVER_ROUTE_HEADS_SUPERSEDE = 'true';
    const pinned = routeKnobs();
    expect(pinned.ROUTE_ENABLED).toBe(true);
    expect(pinned.ROUTE_HEADS_SUPERSEDE).toBe(true);
  });

  it('falls back to the default on a garbled value (never NaN into a gate)', () => {
    // A gate compared against NaN is always false - the claim check would
    // silently invert. A garbled env value must degrade to the default.
    process.env.RETRIEVER_ROUTE_HEAD_FLOOR = 'not-a-number';
    process.env.RETRIEVER_ROUTE_TOP_K = 'abc';
    const k = routeKnobs();
    expect(k.ROUTE_HEAD_FLOOR).toBe(0.55);
    expect(k.ROUTE_TOP_K).toBe(40);
    expect(Number.isNaN(k.ROUTE_HEAD_FLOOR)).toBe(false);
    expect(Number.isNaN(k.ROUTE_TOP_K)).toBe(false);
  });

  it('does NOT let a garbled boolean silently flip a routing posture', () => {
    // The retriever reads `== "true"`, so a typo would DISABLE routing
    // there. The Lab keeps the default and says so - the divergence must
    // be loud, not silent.
    process.env.RETRIEVER_ROUTE_ENABLED = 'yes-please';
    const k = routeKnobs();
    expect(k.ROUTE_ENABLED).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      'route_knob.unparseable',
      expect.objectContaining({ knob: 'ROUTE_ENABLED' })
    );
  });

  it('warns ONCE per knob, not once per query (the loader is called per row)', () => {
    // A 200-row suite calls the loader 200 times; 200 identical warnings
    // drown the signal the warning exists to create.
    const warns = () => logger.warn.mock.calls.filter((c) => c[0] === 'route_knob.unparseable').length;
    process.env.RETRIEVER_ROUTE_RETRY = 'garbled';
    routeKnobs();
    const afterFirst = warns();
    routeKnobs();
    routeKnobs();
    routeKnobs();
    expect(warns()).toBe(afterFirst);
  });

  it("says when the Lab's verdict does NOT stand for production", () => {
    // Three of the retriever's route knobs change the routing OUTCOME, not
    // a threshold. Under those, the Lab scores the GATE while the
    // deployment decides routing some other way - and the record must say
    // so instead of certifying a parity that does not hold.
    expect(routeParity(routeKnobs())).toEqual({ production_equivalent: true, reasons: [] });

    process.env.RETRIEVER_ROUTE_ENABLED = 'false';
    let p = routeParity(routeKnobs());
    expect(p.production_equivalent).toBe(false);
    expect(p.reasons).toContain('routing_disabled');

    delete process.env.RETRIEVER_ROUTE_ENABLED;
    process.env.RETRIEVER_ROUTE_HEADS_SUPERSEDE = 'false';
    p = routeParity(routeKnobs());
    expect(p.production_equivalent).toBe(false);
    expect(p.reasons).toContain('heads_not_supersede');

    delete process.env.RETRIEVER_ROUTE_HEADS_SUPERSEDE;
    process.env.RETRIEVER_ROUTE_HEAD_WEIGHT = '2';
    p = routeParity(routeKnobs());
    expect(p.production_equivalent).toBe(false);
    expect(p.reasons).toContain('head_weight');
  });

  it("names every knob's env var once (the delivery gate reads this map)", () => {
    for (const knob of Object.keys(ROUTE_KNOB_DEFAULTS)) {
      expect(ROUTE_KNOB_ENV[knob]).toMatch(/^RETRIEVER_ROUTE_[A-Z_]+$/);
    }
    expect(Object.keys(ROUTE_KNOB_ENV).sort()).toEqual(Object.keys(ROUTE_KNOB_DEFAULTS).sort());
  });
});
