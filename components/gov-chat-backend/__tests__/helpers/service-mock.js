'use strict';

/**
 * Builds a Jest mock of a service from the real service prototype.
 *
 * A hand-written list of method names lets the mock invent methods the service
 * does not have — which is how a route calling a missing method stays behind a
 * green test: the mock answers the very call the route makes. Deriving the mock
 * from the prototype means the mocked surface can only ever be what the service
 * actually implements.
 *
 * @param {Object} realService - The real service instance (`jest.requireActual`).
 * @param {Object} [overrides] - Members to set on the mock (mocked methods, plain properties).
 * @returns {Object} The mocked service.
 */
function mockServiceFromPrototype(realService, overrides = {}) {
  const mocked = {};
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(realService))) {
    if (name === 'constructor') continue;
    // Only methods: a prototype that is not a class prototype would also expose
    // inherited accessors (`__proto__`), and assigning those would corrupt the mock.
    if (typeof realService[name] !== 'function') continue;
    mocked[name] = jest.fn();
  }
  return Object.assign(mocked, overrides);
}

module.exports = { mockServiceFromPrototype };
