'use strict';

module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/jest-setup.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js', '<rootDir>/tests/**/test_*.js'],
  moduleNameMapper: {
    '^jstest$': '<rootDir>/tests/test-custom/jstest.js',
  },
};
