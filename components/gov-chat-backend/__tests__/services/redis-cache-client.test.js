'use strict';

// The shared ioredis mock records the constructor options, so the test can
// pin the connection contract without opening a real connection handle.
jest.mock('ioredis', () => require('../mocks/ioredis'));

const Redis = require('ioredis');
const { createRedisCacheClient } = require('../../services/redis-cache-client');

describe('redis-cache-client factory', () => {
  const ENV_KEYS = ['TRANSLATION_CACHE_HOST', 'TRANSLATION_CACHE_PORT', 'TRANSLATION_CACHE_PASSWORD'];
  const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    Redis.mockClear();
    Redis.instances.length = 0;
    ENV_KEYS.forEach((key) => delete process.env[key]);
  });

  afterEach(() => {
    ENV_KEYS.forEach((key) => {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    });
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
    // A caller that tries to change the contract fails loudly instead of
    // silently diverging from the other clients
    expect(() => createRedisCacheClient({ host: 'elsewhere', retryStrategy: () => 50 })).toThrow(/unknown option/);
    expect(Redis).not.toHaveBeenCalled();
  });

  test('an unknown option fails loudly', () => {
    // A typo in an option name would otherwise be ignored — and the
    // subscriber would silently get the publisher's contract
    expect(() => createRedisCacheClient({ offline_queue: true })).toThrow(/unknown option/);
  });

  test('a pre-resolved endpoint is used as given', () => {
    createRedisCacheClient({ endpoint: { host: 'redis.internal', port: 6380, password: 'secret' } });

    const options = Redis.mock.calls[0][0];
    expect(options.host).toBe('redis.internal');
    expect(options.port).toBe(6380);
    expect(options.password).toBe('secret');
  });
});
