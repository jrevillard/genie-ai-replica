module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  testTimeout: 10000,
  verbose: true,
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'reports',
      outputName: 'jest-docrepo.xml',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}',
      ancestorSeparator: ' › ',
      usePathForSuiteName: true,
    }],
  ],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  collectCoverageFrom: [
    'src/routes/**/*.js',
    'src/services/**/*.js',
    'src/middleware/**/*.js',
    'src/controllers/**/*.js',
    'src/utils/**/*.js',
    '!**/node_modules/**',
    '!**/__tests__/**'
  ],
  coverageThreshold: {
    global: {
      statements: 55,
      branches: 50,
      functions: 55,
      lines: 55
    }
  },
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/'
  ],
  moduleNameMapper: {
    // shared-lib only exists at Docker build time; map all require paths to mock
    '.*shared-lib$': '<rootDir>/src/__tests__/__mocks__/shared-lib.js',
  },
};
