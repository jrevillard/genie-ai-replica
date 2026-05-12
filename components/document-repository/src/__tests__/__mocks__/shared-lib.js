// Global mock for shared-lib (only exists at Docker build time)
module.exports = {
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
  dbService: {
    getConnection: jest.fn()
  }
};
