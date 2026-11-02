module.exports = {
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons'],
  },
  // *.test.js only — keeps __tests__/mocks helpers out of the suite
  testMatch: ['<rootDir>/src/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {
    '^.+\\.vue$': '@vue/vue3-jest',
    '^.+\\.js$': 'babel-jest',
  },
  // oidc-client-ts ships ESM (upstream v2.0.1 pattern); fast-check was already allowed
  transformIgnorePatterns: ['/node_modules/(?!(oidc-client-ts|fast-check))'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/src/__tests__/setup.js'],
  moduleFileExtensions: ['js', 'json', 'vue'],
};
