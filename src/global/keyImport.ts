import { pick, types } from '@react-native-documents/picker';
import * as Keychain from 'react-native-keychain';
import QuickCrypto from 'react-native-quick-crypto';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';

import { API_URL } from '~/global/variables';
import { getReadExtPermission } from '~/global/permissions';
import { deriveKeyFromPassword } from '~/global/crypto';
import { loadContacts, loadKeys } from '~/store/actions/user';
import { logger } from '~/global/logger';
import { store } from '~/store/store';

/**
 * Import identity keys from an encrypted file.
 * Prompts for file selection, decrypts with the given password,
 * stores in Keychain, loads into Redux, and regenerates session keys.
 * Throws on any failure.
 */
export async function importKeysFromFile(password: string, phoneNo: string): Promise<void> {
    const hasPermission = await getReadExtPermission();
    if (!hasPermission) {
        throw new Error('Permission to read from external storage denied');
    }

    // Read encrypted key file
    logger.debug('Reading encrypted keypair file...');
    const [fileSelected] = await pick({ type: types.plainText, mode: 'open' });
    if (!fileSelected.uri) {
        throw new Error('Failed to pick file: ' + (fileSelected.error || 'unknown'));
    }

    const file = await RNFS.readFile(fileSelected.uri);

    // Parse PBKDF2 iterations, salt, IV and ciphertext, then re-derive encryption key
    logger.debug('Deriving key encryption key from password...');
    const [_, iter, salt, iv, ciphertext] = file.split('\n');
    const derivedKEK = await deriveKeyFromPassword(password, Buffer.from(salt, 'base64'), parseInt(iter, 10));

    // Decrypt keypair
    logger.debug('Decrypting keypair file...');
    let decryptedKeys: ArrayBuffer;
    try {
        decryptedKeys = await QuickCrypto.subtle.decrypt(
            { name: 'AES-GCM', iv: Buffer.from(iv, 'base64') },
            derivedKEK,
            Buffer.from(ciphertext, 'base64'),
        );
    } catch (err) {
        logger.error('Decryption error: Invalid password or corrupted file:', err);
        throw new Error('Decryption error: Invalid password or corrupted file');
    }

    // Store in Keychain
    logger.debug('Saving keys into TPM...');
    await Keychain.setInternetCredentials(API_URL, `${phoneNo}-keys`, Buffer.from(decryptedKeys).toString(), {
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
        server: API_URL,
        service: `${phoneNo}-keys`,
    });

    // Load into Redux
    logger.debug('Loading keys into app...');
    const success = await store.dispatch(loadKeys()).unwrap();
    if (!success) {
        throw new Error('Failed to load imported keys into app');
    }

    // Regenerate per-conversation session keys (ECDH)
    logger.debug('Regenerating conversation encryption keys...');
    await store.dispatch(loadContacts({ atomic: true }));
}
