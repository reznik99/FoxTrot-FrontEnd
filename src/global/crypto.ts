// Crypto
import { Buffer } from 'buffer';
import QuickCrypto from 'react-native-quick-crypto';
import type { CryptoKey } from 'react-native-quick-crypto/src/keys/classes';
import type { WebCryptoKeyPair, RandomTypedArrays } from 'react-native-quick-crypto';
import { KeypairAlgorithm, LegacySymmetricAlgorithm, SaltLenCBC, SaltLenGCM, SymmetricAlgorithm } from '~/global/variables';
import { milliseconds } from './helper';

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

enum ProtocolVersion {
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
function extractVersioningFromMessage(encryptedMessage: string): [ProtocolVersion, string] {
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

// ============================================================================
// EXPERIMENTAL - V2 CHAINED RATCHET ENCRYPTION
// ============================================================================
// This implements time-based symmetric key ratcheting for forward secrecy.
// Each day's key is derived from the previous day's key, and old keys are
// deleted after 7 days. This means a key compromise only exposes recent messages.
// ============================================================================

const RATCHET_KEY_RETENTION_DAYS = 7;
const RATCHET_SALT = 'foxtrot-ratchet';

/** Ratchet state stored per contact */
export interface RatchetState {
    epoch: number; // Unix timestamp (ms) of day 0, clipped to midnight UTC
    currentDayOffset: number; // days since epoch
    currentDayKey: string; // base64 encoded current day key
    recentKeys: Record<number, string>; // dayOffset -> base64 key (last 7 days)
}

/** Returns today's midnight UTC as Unix timestamp (ms) */
export function getTodayTimestamp(): number {
    return Math.floor(Date.now() / milliseconds.day) * milliseconds.day;
}

/** Calculates day offset from epoch timestamp to a target timestamp */
export function getDayOffset(epoch: number, timestamp: number): number {
    return Math.floor((timestamp - epoch) / milliseconds.day);
}

/** Derives a new key from input key material (used for both initial derivation and ratchet steps) */
export async function deriveRatchetKey(inputKeyMaterial: ArrayBuffer): Promise<QCCryptoKey> {
    const newKeyMaterial = await QuickCrypto.subtle.digest(
        { name: 'SHA-256' },
        Buffer.concat([Buffer.from(inputKeyMaterial), Buffer.from(RATCHET_SALT)]),
    );
    return QuickCrypto.subtle.importKey('raw', newKeyMaterial, SymmetricAlgorithm, true, ['encrypt', 'decrypt']);
}

/** Derives a new key from the current key (one ratchet step) */
export async function ratchetKey(currentKey: QCCryptoKey): Promise<QCCryptoKey> {
    const keyMaterial = (await QuickCrypto.subtle.exportKey('raw', currentKey)) as ArrayBuffer;
    return deriveRatchetKey(keyMaterial);
}

/** Creates initial ratchet state from X25519 shared secret */
export async function initRatchetState(sharedSecret: ArrayBuffer): Promise<RatchetState> {
    const epoch = getTodayTimestamp();
    const day0Key = await deriveRatchetKey(sharedSecret);
    const day0KeyBase64 = Buffer.from((await QuickCrypto.subtle.exportKey('raw', day0Key)) as ArrayBuffer).toString(
        'base64',
    );

    return {
        epoch,
        currentDayOffset: 0,
        currentDayKey: day0KeyBase64,
        recentKeys: { 0: day0KeyBase64 },
    };
}

/** Imports a key from base64 string */
async function importKeyFromBase64(base64Key: string): Promise<QCCryptoKey> {
    return QuickCrypto.subtle.importKey('raw', Buffer.from(base64Key, 'base64'), SymmetricAlgorithm, true, [
        'encrypt',
        'decrypt',
    ]);
}

/** Exports a key to base64 string */
async function exportKeyToBase64(key: QCCryptoKey): Promise<string> {
    return Buffer.from((await QuickCrypto.subtle.exportKey('raw', key)) as ArrayBuffer).toString('base64');
}

/** Advances ratchet state to target day offset, returns updated state */
export async function advanceRatchetToDay(state: RatchetState, targetDayOffset: number): Promise<RatchetState> {
    if (targetDayOffset < state.currentDayOffset) {
        throw new Error('Cannot ratchet backwards');
    }
    if (targetDayOffset === state.currentDayOffset) {
        return state;
    }

    let currentKey = await importKeyFromBase64(state.currentDayKey);
    const newRecentKeys = { ...state.recentKeys };

    for (let offset = state.currentDayOffset + 1; offset <= targetDayOffset; offset++) {
        currentKey = await ratchetKey(currentKey);
        const keyBase64 = await exportKeyToBase64(currentKey);
        newRecentKeys[offset] = keyBase64;
    }

    // Prune old keys (keep only last RATCHET_KEY_RETENTION_DAYS days)
    const minOffset = targetDayOffset - RATCHET_KEY_RETENTION_DAYS;
    for (const offsetStr of Object.keys(newRecentKeys)) {
        const offset = parseInt(offsetStr, 10);
        if (offset < minOffset) {
            delete newRecentKeys[offset];
        }
    }

    return {
        epoch: state.epoch,
        currentDayOffset: targetDayOffset,
        currentDayKey: await exportKeyToBase64(currentKey),
        recentKeys: newRecentKeys,
    };
}

/** Gets key for a specific day offset from state, returns null if too old */
export async function getKeyForDayOffset(state: RatchetState, targetOffset: number): Promise<QCCryptoKey | null> {
    // Too old - key was deleted
    const minOffset = state.currentDayOffset - RATCHET_KEY_RETENTION_DAYS;
    if (targetOffset < minOffset) {
        return null;
    }
    // Check cache
    if (state.recentKeys[targetOffset]) {
        return importKeyFromBase64(state.recentKeys[targetOffset]);
    }
    // Future key - should not happen during decrypt (state should be advanced first)
    if (targetOffset > state.currentDayOffset) {
        return null;
    }
    return null;
}

/** Encrypts a message using V2 ratchet format. Returns updated state and ciphertext. */
export async function encryptV2(state: RatchetState, message: string): Promise<{ state: RatchetState; ciphertext: string }> {
    const todayOffset = getDayOffset(state.epoch, getTodayTimestamp());

    // Advance ratchet if needed
    const newState = await advanceRatchetToDay(state, todayOffset);

    const dayKey = await importKeyFromBase64(newState.currentDayKey);
    const iv = QuickCrypto.getRandomValues(new Uint8Array(SaltLenGCM));
    const plaintext = Buffer.from(message);

    const ciphertext = await QuickCrypto.subtle.encrypt({ name: 'AES-GCM', iv }, dayKey, plaintext);

    // Format: version:epoch:dayOffset:iv:ciphertext
    const encoded =
        Buffer.from(`${ProtocolVersion.GCM_RATCHET_V2}`).toString('base64') +
        ':' +
        newState.epoch +
        ':' +
        newState.currentDayOffset +
        ':' +
        Buffer.from(iv).toString('base64') +
        ':' +
        Buffer.from(ciphertext).toString('base64');

    return { state: newState, ciphertext: encoded };
}

/** Decrypts a V2 ratchet message. Returns updated state and plaintext. */
export async function decryptV2(
    state: RatchetState,
    encryptedMessage: string,
): Promise<{ state: RatchetState; plaintext: string }> {
    const parts = encryptedMessage.split(':');
    if (parts.length !== 5) {
        throw new Error('Invalid V2 message format');
    }

    const [versionB64, epochStr, dayOffsetStr, ivB64, ciphertextB64] = parts;

    // Validate version
    const version = parseInt(Buffer.from(versionB64, 'base64').toString(), 10);
    if (version !== ProtocolVersion.GCM_RATCHET_V2) {
        throw new Error(`Expected V2 message, got version ${version}`);
    }

    // Validate epoch matches
    const epoch = parseInt(epochStr, 10);
    if (epoch !== state.epoch) {
        throw new Error(`Epoch mismatch: expected ${state.epoch}, got ${epoch}`);
    }

    const targetOffset = parseInt(dayOffsetStr, 10);

    // Advance ratchet if message is from the future (relative to our state)
    let newState = state;
    if (targetOffset > state.currentDayOffset) {
        newState = await advanceRatchetToDay(state, targetOffset);
    }

    // Get key for target day
    const dayKey = await getKeyForDayOffset(newState, targetOffset);
    if (!dayKey) {
        throw new Error(`Message too old - key for day offset ${targetOffset} has been deleted for forward secrecy`);
    }

    // Decrypt
    const plaintext = await QuickCrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: Buffer.from(ivB64, 'base64') },
        dayKey,
        Buffer.from(ciphertextB64, 'base64'),
    );

    return { state: newState, plaintext: Buffer.from(plaintext).toString() };
}
