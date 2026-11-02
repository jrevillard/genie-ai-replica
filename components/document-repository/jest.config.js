module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    // Map the shared-lib import to a manual mock
    '.*shared-lib$': '<rootDir>/src/services/__mocks__/shared-lib.js', // upstream v2.0.1 pattern — catches every require depth
  },
};
