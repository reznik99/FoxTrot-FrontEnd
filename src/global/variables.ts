import * as Keychain from 'react-native-keychain';
import { AnyAlgorithm, NamedCurve } from 'react-native-quick-crypto';

// Networking (dev: 'http://10.0.2.2:1234/foxtrot-api')
export const API_URL = 'https://francescogorini.com/foxtrot-api';
export const WEBSOCKET_URL = 'wss://francescogorini.com/foxtrot-api/ws';

// Crypto
export const KeypairAlgorithm = {
    name: 'ECDH' as AnyAlgorithm,
    namedCurve: 'P-384' as NamedCurve,
};
export const SymmetricAlgorithm = {
    name: 'AES-GCM' as AnyAlgorithm,
    length: 256,
};
export const LegacySymmetricAlgorithm = {
    name: 'AES-CBC' as AnyAlgorithm,
    length: 256,
};
export const SaltLenGCM = 12;
export const SaltLenCBC = 16;
export const SaltLenPBKDF2 = 16;

export const KeychainOpts = {
    authenticationPrompt: {
        title: 'Authentication required for Login',
        cancel: 'Cancel',
    },
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
};

// Style
export const PRIMARY = '#3672eb'; // '#199187';
export const SECONDARY = '#1b1c1f';
export const SECONDARY_LITE = '#aaa';
export const ACCENT = '#6227e3';
export const DARKHEADER = '#272a31';

export const VibratePattern = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];

export const DB_MSG_PAGE_SIZE = 25;
