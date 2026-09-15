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
    // shared-lib only exists at Docker build time; map all require paths to mock
    '.*shared-lib$': '<rootDir>/src/__tests__/__mocks__/shared-lib.js',
    // Source-tree resolution for the OTel SDK paths that tracing.js requires.
    // In Docker runtime the COPY `shared/lib ./shared-lib` step drops `/lib/`,
    // so tracing.js (which lives at src/tracing.js in the image, i.e.
    // `/app/src/tracing.js`) uses `../shared-lib/X` — same string Jest sees
    // in the source tree (`components/document-repository/src/tracing.js`).
    // Map BOTH `../shared-lib/X` and the bare `../shared-lib` barrel to
    // the real source-tree files.
    '^\\.\\./shared-lib/boolean-env$': '<rootDir>/../shared/lib/boolean-env.js',
    '^\\.\\./shared-lib/otel-batch-config$': '<rootDir>/../shared/lib/otel-batch-config.js',
    '^\\.\\./shared-lib/tracing-background$': '<rootDir>/../shared/lib/tracing-background.js',
    '^\\.\\./shared-lib$': '<rootDir>/../shared/lib/index.js',
    // src/services/X.js uses ../../shared-lib/X (two levels up) in Docker.
    '^\\.\\./\\.\\./shared-lib/tracing-background$': '<rootDir>/../shared/lib/tracing-background.js',
    '^\\.\\./\\.\\./shared-lib/boolean-env$': '<rootDir>/../shared/lib/boolean-env.js',
    '^\\.\\./\\.\\./shared-lib/otel-batch-config$': '<rootDir>/../shared/lib/otel-batch-config.js'
  }
};
