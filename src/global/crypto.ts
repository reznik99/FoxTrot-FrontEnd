// Crypto
import { Buffer } from 'buffer';
import QuickCrypto from 'react-native-quick-crypto';
import type { CryptoKey } from 'react-native-quick-crypto/src/keys/classes';
import type { WebCryptoKeyPair, RandomTypedArrays } from 'react-native-quick-crypto';
import { KeypairAlgorithm, LegacySymmetricAlgorithm, SaltLenCBC, SaltLenGCM, SymmetricAlgorithm } from '~/global/variables';

interface exportedKeypair {
    privateKey: string;
    publicKey: string;
}

/** Generates an Identity Keypair for this account/device */
export async function generateIdentityKeypair(): Promise<WebCryptoKeyPair> {
    return (await QuickCrypto.subtle.generateKey(KeypairAlgorithm, true, ['deriveKey'])) as WebCryptoKeyPair;
}

/** Imports an Identity Keypair into a usable QuickCrypto form */
export async function importKeypair(keyPair: exportedKeypair): Promise<WebCryptoKeyPair> {
    const privateKey = await QuickCrypto.subtle.importKey(
        'pkcs8',
        Buffer.from(keyPair.privateKey, 'base64'),
        KeypairAlgorithm,
        true,
        ['deriveKey', 'deriveBits'],
    );
    const publicKey = await QuickCrypto.subtle.importKey(
        'spki',
        Buffer.from(keyPair.publicKey, 'base64'),
        KeypairAlgorithm,
        true,
        [],
    );

    return { privateKey, publicKey };
}

/** Exports an Identity Keypair into JSON form containing Public and Private Key in DER Base64 */
export async function exportKeypair(keyPair: WebCryptoKeyPair): Promise<exportedKeypair> {
    const pubBytes = Buffer.from((await QuickCrypto.subtle.exportKey('spki', keyPair.publicKey)) as ArrayBuffer);
    const privBytes = Buffer.from((await QuickCrypto.subtle.exportKey('pkcs8', keyPair.privateKey)) as ArrayBuffer);
    return {
        publicKey: pubBytes.toString('base64'),
        privateKey: privBytes.toString('base64'),
    };
}

/** Generates a 256bit AES-GCM Encryption key for messages with a user */
export async function generateSessionKeyECDH(peerPublic: string, userPrivate: CryptoKey | undefined): Promise<CryptoKey> {
    if (!peerPublic) {
        throw new Error("Contacts's public key not present. ECDHE failed");
    }
    if (!userPrivate) {
        throw new Error('User private key not loaded. ECDHE failed');
    }
    const publicKey = await QuickCrypto.subtle.importKey(
        'spki',
        Buffer.from(peerPublic, 'base64'),
        KeypairAlgorithm,
        true,
        [],
    );

    return await QuickCrypto.subtle.deriveKey(
        {
            name: KeypairAlgorithm.name,
            public: publicKey,
            namedCurve: KeypairAlgorithm.namedCurve,
        },
        userPrivate,
        SymmetricAlgorithm,
        true,
        ['encrypt', 'decrypt'],
    );
}

/** Derives a 256bit AES-GCM Key Encryption key from a password and salt. Allows customising PBKDF2 difficulty through *Iterations* parameter */
export async function deriveKeyFromPassword(
    password: string,
    salt: RandomTypedArrays,
    iterations: number,
): Promise<CryptoKey> {
    // Derive Key from password using PBKDF2
    const keyMaterial = await QuickCrypto.subtle.importKey('raw', Buffer.from(password), 'PBKDF2', false, [
        'deriveBits',
        'deriveKey',
    ]);
    return await QuickCrypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as any,
            iterations: iterations,
            hash: 'SHA-256',
        },
        keyMaterial,
        SymmetricAlgorithm,
        false,
        ['encrypt', 'decrypt'],
    );
}

/** Returns the SHA-256 fingerprint of the public key as an Uppercase HEX string with a space separator */
export async function publicKeyFingerprint(peerPublic: string): Promise<string> {
    const digest = await QuickCrypto.subtle.digest({ name: 'SHA-256' }, Buffer.from(peerPublic, 'base64'));

    return Buffer.from(digest)
        .toString('hex')
        .toUpperCase()
        .split('')
        .reduce((prev, curr, i) => prev + curr + (i % 2 === 1 ? ' ' : ''), '');
}

export interface EncryptedFileResult {
    encrypted: Buffer;
    keyBase64: string;
    ivBase64: string;
}

/** Encrypts raw file data with a random AES-256-GCM key. Returns the ciphertext and the key+IV needed to decrypt (to be sent inside the E2EE message). */
export async function encryptFile(data: Buffer): Promise<EncryptedFileResult> {
    const startTime = performance.now();

    const keyRaw = QuickCrypto.getRandomValues(new Uint8Array(32));
    const iv = QuickCrypto.getRandomValues(new Uint8Array(SaltLenGCM));

    const key = await QuickCrypto.subtle.importKey('raw', keyRaw, SymmetricAlgorithm, false, ['encrypt']);

    const encrypted = Buffer.from(await QuickCrypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data));

    console.debug('Encrypt file took:', (performance.now() - startTime).toLocaleString(), 'ms', '| size:', data.byteLength);
    return {
        encrypted,
        keyBase64: Buffer.from(keyRaw).toString('base64'),
        ivBase64: Buffer.from(iv).toString('base64'),
    };
}

/** Decrypts file data that was encrypted with encryptFile. Takes the ciphertext and the key+IV from the E2EE message. */
export async function decryptFile(encrypted: Buffer, keyBase64: string, ivBase64: string): Promise<Buffer> {
    const startTime = performance.now();

    const key = await QuickCrypto.subtle.importKey('raw', Buffer.from(keyBase64, 'base64'), SymmetricAlgorithm, false, [
        'decrypt',
    ]);

    const decrypted = Buffer.from(
        await QuickCrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(ivBase64, 'base64') }, key, encrypted),
    );

    console.debug(
        'Decrypt file took:',
        (performance.now() - startTime).toLocaleString(),
        'ms',
        '| size:',
        encrypted.byteLength,
    );
    return decrypted;
}

/** Encrypts a given message using the supplied AES Session Key (GCM) (generated from *generateSessionKeyECDH*) and returns it as a Base64 string. */
export async function encrypt(sessionKey: CryptoKey, message: string): Promise<string> {
    if (!sessionKey) {
        throw new Error("SessionKey isn't initialized. Please import your Identity Keys exported from you previous device.");
    }
    const startTime = performance.now();

    const plaintext = Buffer.from(message);
    const iv = QuickCrypto.getRandomValues(new Uint8Array(SaltLenGCM));
    const ciphertext = await QuickCrypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, sessionKey, plaintext);

    console.debug('Encrypt took:', (performance.now() - startTime).toLocaleString(), 'ms');
    return (
        Buffer.from(`${ProtocolVersion.GCM_V1}`).toString('base64') +
        ':' +
        Buffer.from(iv).toString('base64') +
        ':' +
        Buffer.from(ciphertext).toString('base64')
    );
}

/** Decrypts a given base64 message using the supplied AES Session Key (generated from *generateSessionKeyECDH*) and returns it as a string. */
export async function decrypt(sessionKey: CryptoKey, encryptedMessageRaw: string): Promise<string> {
    if (!sessionKey) {
        throw new Error("SessionKey isn't initialized. Please import your Identity Keys exported from you previous device.");
    }

    const [version, encryptedMessage] = extractVersioningFromMessage(encryptedMessageRaw);
    switch (version) {
        case ProtocolVersion.LEGACY_CBC_CHUNKED:
            return decryptLegacyCBC(sessionKey, encryptedMessage);
        case ProtocolVersion.GCM_V1:
            return decryptGCM(sessionKey, encryptedMessage);
        case ProtocolVersion.GCM_RATCHET_V2:
            // TODO:
            throw new Error('Please update the app to decrypt this new type of message');
    }
}

/** Decrypts a given base64 message using the supplied AES-GCM Session Key */
async function decryptGCM(sessionKey: CryptoKey, encryptedMessage: string): Promise<string> {
    const startTime = performance.now();
    const [iv, ciphertext] = encryptedMessage.split(':');
    const plaintext = await QuickCrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: Buffer.from(iv, 'base64') },
        sessionKey,
        Buffer.from(ciphertext, 'base64'),
    );

    console.debug('Decrypt took:', (performance.now() - startTime).toLocaleString(), 'ms');
    return Buffer.from(plaintext).toString();
}

/** Decrypts a given base64 message using the supplied AES Session Key */
async function decryptLegacyCBC(sessionKey: CryptoKey, encryptedMessage: string): Promise<string> {
    const startTime = performance.now();

    const newSessionKey = await QuickCrypto.subtle.importKey(
        'raw',
        await QuickCrypto.subtle.exportKey('raw', sessionKey),
        LegacySymmetricAlgorithm,
        false,
        ['encrypt', 'decrypt'],
    );

    const chunks = encryptedMessage.split(':');
    const promises = [];
    for (let i = 0; i < chunks.length; i += 2) {
        const iv = Buffer.from(chunks[i], 'base64');
        const ciphertext = Buffer.from(chunks[i + 1], 'base64');
        promises.push(QuickCrypto.subtle.decrypt({ name: 'AES-CBC', iv: iv }, newSessionKey, ciphertext));
    }
    const decryptedChunks = await Promise.all(promises);

    console.debug(
        'Legacy Decrypt took:',
        (performance.now() - startTime).toLocaleString(),
        'ms',
        '| chunks:',
        decryptedChunks.length,
    );
    return decryptedChunks.map(chunk => Buffer.from(chunk).toString()).join('');
}

export enum ProtocolVersion {
    LEGACY_CBC_CHUNKED = 0,
    GCM_V1 = 1,
    GCM_RATCHET_V2 = 2, // TODO
}
/** Parses version number to check if its a valid protocol version */
function parseProtocolVersion(n: number): ProtocolVersion {
    switch (n) {
        case ProtocolVersion.LEGACY_CBC_CHUNKED:
        case ProtocolVersion.GCM_V1:
        case ProtocolVersion.GCM_RATCHET_V2:
            return n;
        default:
            throw new Error(`Unknown protocol version: ${n}`);
    }
}

/** Extracts versioning from message, if not present it analyzes the message structure to figure out message version. */
export function extractVersioningFromMessage(encryptedMessage: string): [ProtocolVersion, string] {
    let separators = 0;
    let indexFirstSeparator = -1;
    for (let i = 0; i < encryptedMessage.length; i++) {
        if (encryptedMessage[i] === ':') {
            if (indexFirstSeparator === -1) {
                indexFirstSeparator = i;
            }
            separators++;
        }
        if (separators > 3) {
            break;
        }
    }
    if (indexFirstSeparator === -1) {
        throw new Error('Failed to find ":" separator in message');
    }

    // "version:iv:ciphertext"
    if (separators === 2) {
        const decoded = Buffer.from(encryptedMessage.slice(0, indexFirstSeparator), 'base64').toString();
        if (!/^\d+$/.test(decoded)) {
            throw new Error('Failed to extract version from message: ' + decoded);
        }
        return [parseProtocolVersion(Number(decoded)), encryptedMessage.slice(indexFirstSeparator + 1)];
    }
    // "iv:ciphertext"
    else if (separators === 1) {
        const ivLength = Buffer.from(encryptedMessage.slice(0, indexFirstSeparator), 'base64').length;
        if (ivLength === SaltLenGCM) {
            return [ProtocolVersion.GCM_V1, encryptedMessage];
        } else if (ivLength === SaltLenCBC) {
            return [ProtocolVersion.LEGACY_CBC_CHUNKED, encryptedMessage];
        }
    }
    // "iv:ciphertext:iv:ciphertext..."
    return [ProtocolVersion.LEGACY_CBC_CHUNKED, encryptedMessage];
}
