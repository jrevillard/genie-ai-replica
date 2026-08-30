const { join } = require('path');

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.js'],
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: join(__dirname, 'reports'),
        outputName: 'jest-config.xml'
      }
    ]
  ]
};
