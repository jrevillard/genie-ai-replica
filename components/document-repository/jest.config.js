module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  testTimeout: 10000,
  verbose: true,
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/'
  ],
  moduleNameMapper: {
    // shared-lib only exists at Docker build time; map all require paths to mock
    '.*shared-lib$': '<rootDir>/src/__tests__/__mocks__/shared-lib.js',
  },
};
