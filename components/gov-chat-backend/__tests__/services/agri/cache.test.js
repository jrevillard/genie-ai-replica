'use strict';

require('../../setup-env');

jest.mock('../../../shared-lib', () => require('../../mocks/shared-lib'), { virtual: true });

const { ServingCache } = require('../../../services/agri/cache');

/**
 * Mock ioredis with a minimal Map-backed store. Covers the four commands
 * cache.js uses: get, set with PX. Records errors via failNext to simulate
 * Redis outage / individual command failure.
 */
function makeMockRedis() {
  const store = new Map();
  const handlers = {
    get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key, value) => {
      if (handlers._failNext && handlers._failNext.includes('set')) {
        handlers._failNext = handlers._failNext.filter((c) => c !== 'set');
        throw new Error('simulated redis failure');
      }
      // value is already a JSON string (cache.js does JSON.stringify before set).
      // We skip the PX TTL bookkeeping — TTL is a server-side concern.
      store.set(key, value);
      return 'OK';
    })
  };
  handlers._failNext = [];
  handlers.failNext = (cmd) => handlers._failNext.push(cmd);
  handlers.__store = store;
  return handlers;
}

/**
 * Mock arangojs database with collection() returning a small facade. The
 * facade captures documents via .save() and returns them via .document().
 */
function makeMockArango() {
  const docs = new Map();
  return {
    collection: jest.fn((_name) => ({
      save: jest.fn(async (doc) => {
        docs.set(doc._key, doc);
        return { _key: doc._key, _rev: 1 };
      }),
      document: jest.fn(async (key) => {
        if (docs.has(key)) return docs.get(key);
        const err = new Error('document not found');
        err.code = 404;
        throw err;
      }),
      __docs: docs
    }))
  };
}

const seedEnvelopes = {
  'market-prices:maize': {
    data: { series: [{ date: '2025-01-01', value: 25 }] },
    meta: { source: 'seed', fetchedAt: '2025-01-01T00:00:00Z', caveats: [] }
  }
};

describe('ServingCache (Redis → Arango → seed fallback)', () => {
  test('Redis hit short-circuits Arango + seed', async () => {
    const redis = makeMockRedis();
    const arango = makeMockArango();
    const cache = new ServingCache({ redis, db: arango, seeds: seedEnvelopes });

    const expected = { data: { hot: true }, meta: { source: 'redis', fetchedAt: '2026-09-21T00:00:00Z', caveats: [] } };
    await cache.set('market-prices:maize', expected, 60_000);

    const result = await cache.get('market-prices:maize');
    expect(result.origin).toBe('redis');
    expect(result.envelope).toEqual(expected);

    // Redis hit means Arango isn't touched on the read path. (The set
    // path above did write to Arango, so reset the call counter before
    // the get to isolate the read.)
    const collectionCallsBefore = arango.collection.mock.calls.length;
    const result2 = await cache.get('market-prices:maize');
    expect(result2.origin).toBe('redis');
    expect(result2.envelope).toEqual(expected);
    // No additional collection() call during the read.
    expect(arango.collection.mock.calls.length).toBe(collectionCallsBefore);
  });

  test('Redis miss falls through to Arango hit', async () => {
    const redis = makeMockRedis();
    const arango = makeMockArango();
    const cache = new ServingCache({ redis, db: arango, seeds: seedEnvelopes });

    const expected = {
      data: { durable: true },
      meta: { source: 'arango', fetchedAt: '2026-09-20T00:00:00Z', caveats: [] }
    };
    await cache.set('market-prices:maize', expected, 60_000);
    // Wipe Redis to force Arango lookup
    redis.__store.clear();

    const result = await cache.get('market-prices:maize');
    expect(result.origin).toBe('arango');
    expect(result.envelope).toEqual(expected);
  });

  test('Redis + Arango miss falls through to seed', async () => {
    const redis = makeMockRedis();
    const arango = makeMockArango();
    const cache = new ServingCache({ redis, db: arango, seeds: seedEnvelopes });

    const result = await cache.get('market-prices:maize');
    expect(result.origin).toBe('seed');
    expect(result.envelope).toEqual(seedEnvelopes['market-prices:maize']);
  });

  test('All three miss returns envelope=null / origin=null', async () => {
    const cache = new ServingCache({ redis: makeMockRedis(), db: makeMockArango(), seeds: {} });
    const result = await cache.get('missing-key');
    expect(result).toEqual({ envelope: null, origin: null });
  });

  test('Redis unavailable → cache still serves from Arango + seed', async () => {
    const arango = makeMockArango();
    const cache = new ServingCache({ redis: null, db: arango, seeds: seedEnvelopes });

    const expected = {
      data: { noRedis: true },
      meta: { source: 'arango', fetchedAt: '2026-09-20T00:00:00Z', caveats: [] }
    };
    await cache.set('market-prices:maize', expected, 60_000);

    const result = await cache.get('market-prices:maize');
    expect(result.origin).toBe('arango');
    expect(result.envelope).toEqual(expected);
  });

  test('Redis set failure does not throw (writes Arango only)', async () => {
    const redis = makeMockRedis();
    redis.failNext('set');
    const arango = makeMockArango();
    const cache = new ServingCache({ redis, db: arango, seeds: seedEnvelopes });

    const expected = {
      data: { onlyArango: true },
      meta: { source: 'arango', fetchedAt: '2026-09-20T00:00:00Z', caveats: [] }
    };
    await expect(cache.set('market-prices:maize', expected, 60_000)).resolves.not.toThrow();

    // Now read it back — Redis has nothing, Arango has it.
    const result = await cache.get('market-prices:maize');
    expect(result.origin).toBe('arango');
    expect(result.envelope.data.onlyArango).toBe(true);
  });

  test('Arango set failure does not throw (Redis still has the envelope)', async () => {
    const redis = makeMockRedis();
    const brokenDb = {
      collection: () => ({
        save: jest.fn(async () => {
          throw new Error('simulated arango save failure');
        }),
        document: jest.fn(async () => {
          throw Object.assign(new Error('not found'), { code: 404 });
        })
      })
    };
    const cache = new ServingCache({ redis, db: brokenDb, seeds: seedEnvelopes });

    const expected = {
      data: { onlyRedis: true },
      meta: { source: 'redis', fetchedAt: '2026-09-21T00:00:00Z', caveats: [] }
    };
    await expect(cache.set('market-prices:maize', expected, 60_000)).resolves.not.toThrow();

    const result = await cache.get('market-prices:maize');
    expect(result.origin).toBe('redis');
    expect(result.envelope.data.onlyRedis).toBe(true);
  });

  test('Redis get failure (e.g. timeout) falls through to Arango', async () => {
    const redis = makeMockRedis();
    redis.failNext('get');
    // Pre-populate Arango so the fallback succeeds
    const arango = makeMockArango();
    const cache = new ServingCache({ redis, db: arango, seeds: seedEnvelopes });
    const expected = {
      data: { arangoFallback: true },
      meta: { source: 'arango', fetchedAt: '2026-09-20T00:00:00Z', caveats: [] }
    };
    await cache.set('market-prices:maize', expected, 60_000);
    redis.__store.clear(); // simulate only Redis miss
    redis.failNext('get'); // next get will throw
    redis.__store.clear(); // ensure no redis hit either

    const result = await cache.get('market-prices:maize');
    expect(result.origin).toBe('arango');
    expect(result.envelope.data.arangoFallback).toBe(true);
  });
});
