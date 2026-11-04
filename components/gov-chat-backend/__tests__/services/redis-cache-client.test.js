'use strict';

// Capture the constructor options so the test can pin the shared resilience
// contract without opening a real connection handle.
jest.mock('ioredis', () =>
  jest.fn(function (options) {
    this.options = options;
  })
);

const Redis = require('ioredis');
const { createRedisCacheClient } = require('../../services/redis-cache-client');

describe('redis-cache-client factory', () => {
  beforeEach(() => {
    Redis.mockClear();
    delete process.env.TRANSLATION_CACHE_HOST;
    delete process.env.TRANSLATION_CACHE_PORT;
    delete process.env.TRANSLATION_CACHE_PASSWORD;
  });

  test('applies the shared resilience contract defaults', () => {
    createRedisCacheClient();

    expect(Redis).toHaveBeenCalledTimes(1);
    const options = Redis.mock.calls[0][0];
    expect(options.host).toBe('localhost');
    expect(options.port).toBe(6379);
    expect(options.password).toBeNull();
    expect(options.maxRetriesPerRequest).toBe(3);
    expect(options.enableOfflineQueue).toBe(false);
    expect(options.retryStrategy(1)).toBe(500);
    expect(options.retryStrategy(10)).toBe(2000);
  });

  test('reads the TRANSLATION_CACHE_* env vars', () => {
    process.env.TRANSLATION_CACHE_HOST = 'redis.internal';
    process.env.TRANSLATION_CACHE_PORT = '6380';
    process.env.TRANSLATION_CACHE_PASSWORD = 'secret';

    createRedisCacheClient();

    const options = Redis.mock.calls[0][0];
    expect(options.host).toBe('redis.internal');
    expect(options.port).toBe(6380);
    expect(options.password).toBe('secret');
  });

  test('an invalid TRANSLATION_CACHE_PORT falls back to 6379', () => {
    // #1477 — the two hand-copied parsers used to disagree here
    // ('0' fell back to 6379 in one and returned 0 in the other).
    process.env.TRANSLATION_CACHE_PORT = '0';

    createRedisCacheClient();

    expect(Redis.mock.calls[0][0].port).toBe(6379);
  });

  test('caller options override the shared defaults', () => {
    // The provisioning invalidation subscriber overrides both so its
    // buffered subscribe survives a cold Redis start.
    createRedisCacheClient({ enableOfflineQueue: true, maxRetriesPerRequest: null });

    const options = Redis.mock.calls[0][0];
    expect(options.enableOfflineQueue).toBe(true);
    expect(options.maxRetriesPerRequest).toBeNull();
    // Everything not overridden stays shared
    expect(options.retryStrategy(1)).toBe(500);
  });
});
