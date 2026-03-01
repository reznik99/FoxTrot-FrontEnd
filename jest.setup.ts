jest.mock('react-native-quick-crypto', () => crypto);

// Mock react-native-mmkv
jest.mock('react-native-mmkv', () => ({
    createMMKV: require('react-native-mmkv/jest').createMockMMKV,
}));

// Mock react-native-device-info
jest.mock('react-native-device-info', () => ({
    getVersion: () => '0.0.0-test',
    getBuildNumber: () => '0',
}));

global.console.debug = jest.fn();
