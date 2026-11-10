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
    '^\\.\\./shared-lib/(tracing-background|tracing-baggage|pii-span-processor)$': '<rootDir>/../shared/lib/$1.js',
    // The auth middleware's verification core is the REAL shared verifier;
    // suites stand in for it at the module boundary
    // (jest.mock('../../shared-lib/keycloak-auth-service')), so it must
    // resolve to the real file here — the catch-all mock barrel below has no
    // verifyToken and a middleware bound to it would 500 on first request.
    // TRAP: the real verifier requires `jose`, which this component does NOT
    // declare — a suite that loads the middleware WITHOUT
    // jest.mock('../../shared-lib/keycloak-auth-service') dies here with
    // MODULE_NOT_FOUND in CI after a clean install (the test:doc-repo job
    // installs only this component's node_modules; a dev machine may carry a
    // hoisted stray jose that masks it). Every suite must stand in for the verifier
    // at that module boundary, as all three existing ones do.
    '^\\.\\./\\.\\./shared-lib/keycloak-auth-service$': '<rootDir>/../shared/lib/keycloak-auth-service.js',
    // Everything else in shared-lib still goes to the mock barrel, so require
    // chains inside src/ never touch the real filesystem path (which Docker
    // drops /lib/ from) and the existing suites keep their stubs.
    '.*shared-lib(/.*)?$': '<rootDir>/src/__tests__/__mocks__/shared-lib.js'
  }
};
