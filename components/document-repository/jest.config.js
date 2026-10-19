module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  testTimeout: 10000,
  verbose: true,
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'reports',
        outputName: 'jest-docrepo.xml',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true
      }
    ]
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
  coveragePathIgnorePatterns: ['/node_modules/', '/__tests__/'],
  moduleNameMapper: {
    // Order matters — Jest uses the first pattern that matches. The tracing
    // helpers must resolve to the REAL files: src/tracing.js constructs the
    // SDK with them, and the mock barrel below exports only `logger` and
    // `dbService`, so a mocked `createGeniePropagator` would be `undefined`
    // and this component would fail to boot exactly the way the backend did.
    '^\\.\\./shared-lib/(tracing-[a-z-]+|pii-span-processor)$': '<rootDir>/../shared/lib/$1.js',
    // Everything else in shared-lib still goes to the mock barrel, so require
    // chains inside src/ never touch the real filesystem path (which Docker
    // drops /lib/ from) and the existing suites keep their stubs.
    '.*shared-lib(/.*)?$': '<rootDir>/src/__tests__/__mocks__/shared-lib.js'
  }
};
