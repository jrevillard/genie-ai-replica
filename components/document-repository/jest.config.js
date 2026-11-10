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
    // TRAP: a suite that loads the middleware WITHOUT standing in for the
    // verifier at its module boundary loads the real verifier and dies on
    // `jose` (not declared here) — the `^jose$` entry below makes that
    // failure deterministic; the stub file and the verifierTrap suite tell
    // the full story.
    '^\\.\\./\\.\\./shared-lib/keycloak-auth-service$': '<rootDir>/../shared/lib/keycloak-auth-service.js',
    // `jose` is required by the REAL shared verifier above, and this
    // component does NOT declare it: a suite that loads the auth middleware
    // without standing in for the verifier dies with MODULE_NOT_FOUND (in
    // clean CI only — a dev machine may carry a hoisted stray `jose`). The
    // stub makes the failure deterministic and local (#1707); the stub file
    // and the verifierTrap suite carry the full story.
    '^jose$': '<rootDir>/src/__tests__/__mocks__/jose-not-a-dependency.js',
    // Everything else in shared-lib still goes to the mock barrel, so require
    // chains inside src/ never touch the real filesystem path (which Docker
    // drops /lib/ from) and the existing suites keep their stubs.
    '.*shared-lib(/.*)?$': '<rootDir>/src/__tests__/__mocks__/shared-lib.js'
  }
};
