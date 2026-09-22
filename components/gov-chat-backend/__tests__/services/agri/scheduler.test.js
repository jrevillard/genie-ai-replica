'use strict';

require('../../setup-env');

jest.mock('../../../shared-lib', () => require('../../mocks/shared-lib'), { virtual: true });

const { AgriScheduler } = require('../../../services/agri/scheduler');

/**
 * Mock arangojs that records calls but otherwise never blocks.
 * agri_fetch_log writes never throw.
 */
function makeMockDb() {
  return {
    collection: () => ({
      save: jest.fn(async () => ({})),
      document: jest.fn(async () => {
        throw Object.assign(new Error('not found'), { code: 404 });
      })
    }),
    query: jest.fn(async () => {
      const all = jest.fn(async () => []);
      return { all };
    })
  };
}

/** Adapter that just resolves, then "fetches" successfully after a delay. */
function makeAdapter(id, opts = {}) {
  return {
    id,
    configPrefix: id.toUpperCase(),
    cadence: opts.cadence || '24h',
    defaults: {},
    endpoints: [opts.endpoint || 'news'],
    // Allow empty parse so 0-doc returns ok=true (mirrors real adapters
    // like iNaturalist whose allowEmpty flag is true).
    allowEmpty: true,
    async resolve() {
      return [`https://example.test/${id}`];
    },
    async fetch() {
      if (opts.fetchDelayMs) {
        await new Promise((r) => setTimeout(r, opts.fetchDelayMs));
      }
      return [];
    },
    async parse() {
      return [];
    },
    async normalize() {
      return { collection: 'agri_series', docs: opts.docs || [] };
    }
  };
}

/** Adapter that fails with a 429-style error. */
function makeFailingAdapter(id) {
  return {
    id,
    configPrefix: id.toUpperCase(),
    cadence: '24h',
    defaults: {},
    endpoints: ['news'],
    async resolve() {
      return [`https://example.test/${id}`];
    },
    async fetch() {
      throw new Error('HTTP 429 rate-limited');
    },
    async parse() {
      return [];
    },
    async normalize() {
      return { collection: 'agri_series', docs: [] };
    }
  };
}

describe('AgriScheduler single-flight discipline', () => {
  test('two concurrent runAdapterOnce calls collapse onto one one upstream fetch', async () => {
    let fetchCount = 0;
    const adapter = {
      id: 'gdelt',
      configPrefix: 'GDELT',
      allowEmpty: true,
      cadence: '1h',
      defaults: {},
      endpoints: ['news'],
      async resolve() {
        return ['https://example.test/gdelt'];
      },
      async fetch() {
        fetchCount += 1;
        await new Promise((r) => setTimeout(r, 30));
        return [];
      },
      async parse() {
        return [];
      },
      async normalize() {
        return { collection: 'agri_series', docs: [] };
      }
    };

    const sched = new AgriScheduler({
      adapters: [adapter],
      db: makeMockDb(),
      redis: null,
      onAdaptersRun: async () => {}
    });

    const [a, b] = await Promise.all([sched.runAdapterOnce(adapter), sched.runAdapterOnce(adapter)]);
    expect(fetchCount).toBe(1); // single-flight: only one upstream call
    expect(a).toBe(b); // both callers received the same Promise result
    expect(sched.inFlight.size).toBe(0); // Map cleared after completion
  });

  test('sequential calls each invoke upstream exactly once', async () => {
    let fetchCount = 0;
    const adapter = {
      id: 'wfp',
      configPrefix: 'WFP',
      allowEmpty: true,
      cadence: '24h',
      defaults: {},
      endpoints: ['news'],
      async resolve() {
        return ['https://example.test/wfp'];
      },
      async fetch() {
        fetchCount += 1;
        return [];
      },
      async parse() {
        return [];
      },
      async normalize() {
        return { collection: 'agri_series', docs: [] };
      }
    };
    const sched = new AgriScheduler({
      adapters: [adapter],
      db: makeMockDb(),
      redis: null,
      onAdaptersRun: async () => {}
    });

    await sched.runAdapterOnce(adapter);
    await sched.runAdapterOnce(adapter);
    expect(fetchCount).toBe(2); // sequential calls each go upstream
    expect(sched.inFlight.size).toBe(0);
  });

  test('failure clears the inflight slot (next call goes upstream)', async () => {
    let fetchCount = 0;
    const fail = makeFailingAdapter('failing');
    // Wrap to count fetch invocations
    const origFetch = fail.fetch;
    fail.fetch = async () => {
      fetchCount += 1;
      return origFetch();
    };

    const sched = new AgriScheduler({ adapters: [fail], db: makeMockDb(), redis: null, onAdaptersRun: async () => {} });

    const r1 = await sched.runAdapterOnce(fail);
    expect(r1.ok).toBe(false);
    expect(fetchCount).toBe(1);
    expect(sched.inFlight.size).toBe(0);

    const r2 = await sched.runAdapterOnce(fail);
    expect(r2.ok).toBe(false);
    expect(fetchCount).toBe(2); // second call attempted again (no zombie lock)
  });

  test('different adapters do not block each other', async () => {
    const a = makeAdapter('a');
    const b = makeAdapter('b');
    const sched = new AgriScheduler({ adapters: [a, b], db: makeMockDb(), redis: null, onAdaptersRun: async () => {} });

    const [ra, rb] = await Promise.all([sched.runAdapterOnce(a), sched.runAdapterOnce(b)]);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    expect(sched.inFlight.size).toBe(0);
  });

  test('redis set() throw: claim prevents second fetch from concurrent caller', async () => {
    let fetchCount = 0;
    const adapter = {
      id: 'gdelt',
      configPrefix: 'GDELT',
      allowEmpty: true,
      cadence: '1h',
      defaults: {},
      endpoints: ['news'],
      async resolve() {
        return ['https://example.test/gdelt'];
      },
      async fetch() {
        fetchCount += 1;
        await new Promise((r) => setTimeout(r, 30));
        return [];
      },
      async parse() {
        return [];
      },
      async normalize() {
        return { collection: 'agri_series', docs: [] };
      }
    };

    // Mock redis: set() throws for the first caller (simulating Redis down),
    // but del() succeeds so the finally block does not explode.
    const mockRedis = {
      set: jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
      del: jest.fn(async () => {})
    };

    const sched = new AgriScheduler({
      adapters: [adapter],
      db: makeMockDb(),
      redis: mockRedis,
      onAdaptersRun: async () => {}
    });

    // Caller A: redis.set() throws → catch → proceeds in-process.
    // Caller B: enters while A is still inside runAdapterOnce, finds the
    // claim placeholder in the Map, and awaits it instead of creating a
    // second fetchPromise. Result: only one upstream fetch.
    const [resultA, resultB] = await Promise.all([sched.runAdapterOnce(adapter), sched.runAdapterOnce(adapter)]);

    expect(fetchCount).toBe(1); // single-flight: only one upstream call
    expect(resultA.ok).toBe(true); // A proceeds in-process after redis throw
    expect(resultB.ok).toBe(true); // B awaits A's fetch and gets the same ok
    expect(sched.inFlight.size).toBe(0); // Map cleared after completion
  });

  test('runOnce dedupes concurrent entries of the same adapter', async () => {
    let fetchCount = 0;
    const adapter = {
      id: 'twice',
      configPrefix: 'TWICE',
      allowEmpty: true,
      cadence: '1h',
      defaults: {},
      endpoints: ['news'],
      async resolve() {
        return ['https://example.test/twice'];
      },
      async fetch() {
        fetchCount += 1;
        await new Promise((r) => setTimeout(r, 20));
        return [];
      },
      async parse() {
        return [];
      },
      async normalize() {
        return { collection: 'agri_series', docs: [] };
      }
    };

    const sched = new AgriScheduler({
      adapters: [adapter],
      db: makeMockDb(),
      redis: null,
      onAdaptersRun: async () => {}
    });

    // Two runOnce calls in parallel (e.g. scheduler tick + manual trigger).
    const [touched1, touched2] = await Promise.all([sched.runOnce(), sched.runOnce()]);
    expect(fetchCount).toBe(1); // single-flight across runOnce boundaries
    expect(touched1).toEqual(['twice']);
    expect(touched2).toEqual(['twice']);
    expect(sched.inFlight.size).toBe(0);
  });
});
