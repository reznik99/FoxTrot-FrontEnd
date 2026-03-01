import { createMMKV, type MMKV } from 'react-native-mmkv';
import * as Keychain from 'react-native-keychain';
import QuickCrypto from 'react-native-quick-crypto';
import { Buffer } from 'buffer';
import { logger } from '~/global/logger';

const MMKV_KEY_SERVICE = 'foxtrot-mmkv-key';

// MMKV storage is encrypted using AES-CFB-128.
// Key: 16 bytes (128-bit), stored in device Keychain.

let storage: MMKV | null = null;
let storageInitPromise: Promise<MMKV> | null = null;

async function getMmkvKey(): Promise<string | null> {
    try {
        const credentials = await Keychain.getGenericPassword({ service: MMKV_KEY_SERVICE });
        if (credentials && credentials.password) {
            return credentials.password;
        }
    } catch (err) {
        logger.debug('No existing MMKV key found');
    }
    return null;
}

async function createMmkvKey(): Promise<string> {
    const keyBytes = QuickCrypto.getRandomValues(new Uint8Array(16));
    const key = Buffer.from(keyBytes).toString('hex');

    await Keychain.setGenericPassword(MMKV_KEY_SERVICE, key, {
        service: MMKV_KEY_SERVICE,
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
    });

    logger.debug('Generated and stored new MMKV encryption key');
    return key;
}

/**
 * Gets the storage instance, initializing it with encryption if needed.
 * Handles migration from unencrypted to encrypted storage on first run.
 *
 * Migration logic: If no key exists in Keychain, this is either a fresh install
 * or an existing install with unencrypted data. We open unencrypted first,
 * then recrypt with a new key. If a key exists, storage is already encrypted.
 */
async function getStorage(): Promise<MMKV> {
    if (storage) {
        return storage;
    }

    // Prevent concurrent initialization
    if (storageInitPromise) {
        return storageInitPromise;
    }

    storageInitPromise = (async () => {
        const existingKey = await getMmkvKey();

        if (existingKey) {
            // Key exists, storage is already encrypted
            storage = createMMKV({
                id: 'foxtrot-storage',
                encryptionKey: existingKey,
            });
            logger.debug('MMKV storage opened with encryption');
        } else {
            // No key exists - fresh install or needs migration
            // Open unencrypted first to preserve any existing data
            storage = createMMKV({ id: 'foxtrot-storage' });
            const hasExistingData = storage.getAllKeys().length > 0;

            // Generate and store new key
            const newKey = await createMmkvKey();

            // Encrypt storage (migrates existing data if any)
            storage.recrypt(newKey);
            logger.debug(
                hasExistingData ? 'MMKV storage migrated to encrypted' : 'MMKV storage initialized with encryption',
            );
        }

        return storage;
    })();

    return storageInitPromise;
}

/** Keys used across the app for MMKV storage. Use these instead of raw strings. */
export const StorageKeys = {
    USER_DATA: 'user_data',
    ALWAYS_RELAY_CALLS: 'always-relay-calls',
    SCREEN_SECURITY: 'screen-security',
    AUTO_EVICT_CACHE: 'auto-evict-cache',
    CALL_ANSWERED_IN_BACKGROUND: 'call_answered_in_background',
} as const;

export async function writeToStorage(key: string, value: string): Promise<void> {
    const s = await getStorage();
    s.set(key, value);
}

export async function readFromStorage(key: string): Promise<string | null> {
    const s = await getStorage();
    return s.getString(key) ?? null;
}

export async function deleteFromStorage(key: string): Promise<void> {
    const s = await getStorage();
    s.remove(key);
}

export async function popFromStorage(key: string): Promise<string | null> {
    const value = await readFromStorage(key);
    if (value !== null) {
        await deleteFromStorage(key);
    }
    return value;
}

export async function getAllStorageKeys(): Promise<string[]> {
    const s = await getStorage();
    return s.getAllKeys();
}
