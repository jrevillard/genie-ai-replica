/**
 * Manual mock for shared-lib module used by document-repository services.
 * This mock provides stubbed logger and dbService objects for unit testing.
 */
const logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

const dbService = {
  getConnection: jest.fn(),
};

module.exports = {
  logger,
  dbService,
};
