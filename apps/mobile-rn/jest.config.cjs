/**
 * Jest configuration for @maka/mobile-rn.
 *
 * Uses the React Native jest preset (babel-jest transform, asset transformer,
 * RN setup file, node testEnvironment) and adds an AsyncStorage mock so the
 * zustand `persist` middleware can hydrate during unit tests.
 *
 * NOTE: `npm test` requires `jest`, `react-test-renderer`, and `@types/jest`
 * to be installed (declared in package.json devDependencies).
 */
module.exports = {
  preset: 'react-native',
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};