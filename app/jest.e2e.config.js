// Jest config for end-to-end tests against a running kitcount-server.
// Uses plain Node (real fetch) instead of the React Native preset.
const path = require('node:path');

// babel-preset-expo ships inside the expo package.
const babelPresetExpo = require.resolve('babel-preset-expo', { paths: [path.dirname(require.resolve('expo/package.json'))] });

module.exports = {
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/src/core/e2e/**/*.test.ts'],
  transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: [babelPresetExpo] }] },
  transformIgnorePatterns: ['/node_modules/(?!(@noble|yaml)/)'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
};
