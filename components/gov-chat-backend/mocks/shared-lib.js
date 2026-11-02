// Mock for the Docker-build-time-only ../shared-lib module (moduleNameMapper target).
// Shape ported from upstream v2.0.1 components/gov-chat-backend/__tests__/mocks/shared-lib.js (Epic A5).
module.exports = {
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  },
  dbService: { getConnection: jest.fn() }
};
