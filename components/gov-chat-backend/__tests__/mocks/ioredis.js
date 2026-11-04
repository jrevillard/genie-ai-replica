'use strict';

/**
 * Shared ioredis mock for suites that transitively load the user
 * provisioning service (its cache invalidation broadcasts over Redis).
 * Use with jest.mock:
 *
 *   jest.mock('ioredis', () => require('../mocks/ioredis')); // from __tests__/
 *
 * Every client created during a test is collected in MockRedis.instances —
 * clear the array in beforeEach.
 */
const MockRedis = jest.fn(function () {
  this.publish = jest.fn().mockResolvedValue('1');
  this.subscribe = jest.fn().mockResolvedValue(1);
  this.on = jest.fn();
  this.disconnect = jest.fn();
  MockRedis.instances.push(this);
});

MockRedis.instances = [];

module.exports = MockRedis;
