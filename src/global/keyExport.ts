import QuickCrypto from 'react-native-quick-crypto';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';

import { SaltLenPBKDF2, SaltLenGCM, PBKDF2Iterations } from '~/global/variables';
import { getWriteExtPermission } from '~/global/permissions';
import { deriveKeyFromPassword, exportKeypair } from '~/global/crypto';
import { logger } from '~/global/logger';
import { store } from '~/store/store';

/**
 * Export identity keys to an encrypted file in Downloads.
 * Reads the keypair from Redux, encrypts with the given password,
 * and writes to a timestamped file.
 * Returns the full file path on success, throws on failure.
 */
export async function exportKeysToFile(password: string, phoneNo: string): Promise<string> {
    const keypair = store.getState().userReducer.keys;
    if (!keypair) {
        throw new Error('No identity keys to export');
    }

    const IKeys = await exportKeypair(keypair);
    const salt = QuickCrypto.getRandomValues(new Uint8Array(SaltLenPBKDF2));
    const derivedKEK = await deriveKeyFromPassword(password, salt, PBKDF2Iterations);

    // Encrypt keypair
    const iv = QuickCrypto.getRandomValues(new Uint8Array(SaltLenGCM));
    const encryptedIKeys = await QuickCrypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        derivedKEK,
        Buffer.from(JSON.stringify(IKeys)),
    );

    // Store PBKDF2 no. of iterations, salt, IV and Ciphertext
    const file =
        'Foxtrot encrypted keys' +
        '\n' +
        PBKDF2Iterations +
        '\n' +
        Buffer.from(salt).toString('base64') +
        '\n' +
        Buffer.from(iv).toString('base64') +
        '\n' +
        Buffer.from(encryptedIKeys).toString('base64');
    logger.debug('File: \n', file);

    const hasPermission = await getWriteExtPermission();
    if (!hasPermission) {
        throw new Error('Permission to write to external storage denied');
    }

    const fullPath = RNFS.DownloadDirectoryPath + `/${phoneNo}-keys-${Date.now()}.txt`;
    // Delete file first, RNFS bug causes malformed writes if overwriting: https://github.com/itinance/react-native-fs/issues/700
    await RNFS.writeFile(fullPath, file);
    return fullPath;
}
