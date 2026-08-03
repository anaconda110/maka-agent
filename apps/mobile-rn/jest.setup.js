/**
 * Runs after the jest test framework is installed but before each test file.
 * Mocks native modules that the store / components touch so tests stay pure.
 */
import { jest } from '@jest/globals';

// AsyncStorage is a native module; replace it with an in-memory stub so the
// zustand `persist` middleware does not try to reach the RN bridge.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

// react-native-keychain is a native module; stub the Keychain API so the store
// can call saveApiKey / loadApiKey without the RN bridge being available.
jest.mock('react-native-keychain', () => ({
  __esModule: true,
  setGenericPassword: jest.fn(async () => true),
  getGenericPassword: jest.fn(async () => false),
  resetGenericPassword: jest.fn(async () => true),
}));