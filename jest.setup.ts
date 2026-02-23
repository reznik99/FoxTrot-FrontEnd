jest.mock('react-native-quick-crypto', () => crypto);

// Mock react-native-mmkv
jest.mock('react-native-mmkv', () => ({
    createMMKV: require('react-native-mmkv/jest').createMockMMKV,
}));

global.console.debug = jest.fn();
