'use strict';

// The shared ioredis mock records the constructor options, so the test can
// pin the connection contract without opening a real connection handle.
jest.mock('ioredis', () => require('../mocks/ioredis'));

const Redis = require('ioredis');
const { createRedisCacheClient } = require('../../services/redis-cache-client');

describe('redis-cache-client factory', () => {
  const originalEnv = {
    TRANSLATION_CACHE_HOST: process.env.TRANSLATION_CACHE_HOST,
    TRANSLATION_CACHE_PORT: process.env.TRANSLATION_CACHE_PORT,
    TRANSLATION_CACHE_PASSWORD: process.env.TRANSLATION_CACHE_PASSWORD
  };

  beforeEach(() => {
    Redis.mockClear();
    Redis.instances.length = 0;
    delete process.env.TRANSLATION_CACHE_HOST;
    delete process.env.TRANSLATION_CACHE_PORT;
    delete process.env.TRANSLATION_CACHE_PASSWORD;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
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

  test('an unusable TRANSLATION_CACHE_PORT falls back to 6379', () => {
    // #1477 — the two hand-copied parsers disagreed here: the translation
    // cache's `parseInt(x,10) || 6379` fell back to 6379 while the
    // provisioning one (`parsePositiveInt`) accepted the value as-is.
    process.env.TRANSLATION_CACHE_PORT = '0';
    createRedisCacheClient();
    expect(Redis.mock.calls[0][0].port).toBe(6379);

    process.env.TRANSLATION_CACHE_PORT = '-1';
    createRedisCacheClient();
    expect(Redis.mock.calls[1][0].port).toBe(6379);
  });

  test('the subscriber may override the offline queue and the retry cap only', () => {
    // The provisioning invalidation subscriber overrides both so its
    // buffered subscribe survives a cold Redis start.
    createRedisCacheClient({ enableOfflineQueue: true, maxRetriesPerRequest: null });

    const options = Redis.mock.calls[0][0];
    expect(options.enableOfflineQueue).toBe(true);
    expect(options.maxRetriesPerRequest).toBeNull();
    // Everything else stays shared
    expect(options.retryStrategy(1)).toBe(500);
    expect(options.host).toBe('localhost');
    expect(options.port).toBe(6379);
  });

  test('the connection contract cannot be overridden', () => {
    createRedisCacheClient({ host: 'elsewhere', retryStrategy: () => 50 });

    const options = Redis.mock.calls[0][0];
    expect(options.host).toBe('localhost');
    expect(options.retryStrategy(1)).toBe(500);
  });
});
