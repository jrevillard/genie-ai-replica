module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    // Map the shared-lib import to a manual mock (doc-repo pattern)
    '^((\\.\\./)+)shared-lib$': '<rootDir>/mocks/shared-lib.js',
  },
};
