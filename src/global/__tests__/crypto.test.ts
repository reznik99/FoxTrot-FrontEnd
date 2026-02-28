import { Buffer } from 'buffer';
import QuickCrypto from 'react-native-quick-crypto';
import { encrypt, decrypt, encryptFile, decryptFile, extractVersioningFromMessage, ProtocolVersion } from '../crypto';

// Hardcoded test key (256-bit AES key)
const TEST_KEY_BASE64 = '5ZFymSUme/8XA3T7f+FbGX7te8ri8N7iOQ5iHvyr/+A=';

// Test vectors
const TEST_VECTORS = {
    // "Hello, World!" encrypted with GCM (format: version:iv:ciphertext)
    gcmMessage: 'MQ==:WyPWnpu+rCFmK5P0:x1V7URvfnn7hMCI+mckwOjVDfCvuS9eyPb9Ouog=',
    gcmPlaintext: 'Hello, World!',

    // "Hello, World!" encrypted with GCM without version prefix (format: iv:ciphertext, 12-byte IV)
    gcmNoVersion: 'WyPWnpu+rCFmK5P0:x1V7URvfnn7hMCI+mckwOjVDfCvuS9eyPb9Ouog=',
    gcmNoVersionPlaintext: 'Hello, World!',

    // "Hello, World!" encrypted with CBC legacy (format: iv:ciphertext)
    cbcSingleChunk: 'oZYIgo24l9yYXwBm9+QV+Q==:z7eECS1KfKmxqG7OXpN6SQ==',
    cbcSinglePlaintext: 'Hello, World!',

    // "This is a longer message for chunked CBC" encrypted with CBC chunked (format: iv:ct:iv:ct:...)
    cbcChunked:
        '2m8ysP4RzewlMAdTkPHWzg==:4baP9Ja5sbi3jLBflFtksvjdijEX97pGaN4f8opE/Gs=:HT7s1VpmhF3e9WJ48uE5pQ==:OPitQJms2Z/dT2hGGJpC0PYGBKdOZsBQGx/5hKtrTVo=:9NB220Dtq+8zWf7odb8uTg==:hhTQe4KniSdj6K2ey3HDMg==',
    cbcChunkedPlaintext: 'This is a longer message for chunked CBC',
};

// Helper to create session key from base64
async function createSessionKey(base64Key: string) {
    const keyData = Buffer.from(base64Key, 'base64');
    return QuickCrypto.subtle.importKey('raw', keyData, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

describe('crypto.ts', () => {
    describe('encrypt', () => {
        it('should encrypt a message and return base64 format version:iv:ciphertext', async () => {
            const sessionKey = await createSessionKey(TEST_KEY_BASE64);
            const message = 'Hello, World!';

            const encrypted = await encrypt(sessionKey, message);

            const parts = encrypted.split(':');
            expect(parts).toHaveLength(3);

            // Version should decode to "1" (GCM_V1)
            const version = Buffer.from(parts[0], 'base64').toString();
            expect(version).toBe('1');

            // IV should be 12 bytes
            const iv = Buffer.from(parts[1], 'base64');
            expect(iv.length).toBe(12);
        });

        it('should throw error when session key is null/undefined', async () => {
            await expect(encrypt(null as any, 'test')).rejects.toThrow("SessionKey isn't initialized");
            await expect(encrypt(undefined as any, 'test')).rejects.toThrow("SessionKey isn't initialized");
        });

        it('should produce different ciphertexts for the same message (random IV)', async () => {
            const sessionKey = await createSessionKey(TEST_KEY_BASE64);
            const message = 'Same message';

            const encrypted1 = await encrypt(sessionKey, message);
            const encrypted2 = await encrypt(sessionKey, message);

            expect(encrypted1).not.toBe(encrypted2);
        });

        it('should round-trip with decrypt', async () => {
            const sessionKey = await createSessionKey(TEST_KEY_BASE64);
            const message = 'Round trip test message';

            const encrypted = await encrypt(sessionKey, message);
            const decrypted = await decrypt(sessionKey, encrypted);

            expect(decrypted).toBe(message);
        });
    });

    describe('decrypt', () => {
        describe('GCM format', () => {
            it('should decrypt GCM message with version prefix', async () => {
                const sessionKey = await createSessionKey(TEST_KEY_BASE64);

                const decrypted = await decrypt(sessionKey, TEST_VECTORS.gcmMessage);

                expect(decrypted).toBe(TEST_VECTORS.gcmPlaintext);
            });

            it('should decrypt GCM message without version prefix', async () => {
                const sessionKey = await createSessionKey(TEST_KEY_BASE64);

                const decrypted = await decrypt(sessionKey, TEST_VECTORS.gcmNoVersion);

                expect(decrypted).toBe(TEST_VECTORS.gcmNoVersionPlaintext);
            });
        });

        describe('Legacy CBC format', () => {
            it('should decrypt single-chunk CBC message', async () => {
                const sessionKey = await createSessionKey(TEST_KEY_BASE64);

                const decrypted = await decrypt(sessionKey, TEST_VECTORS.cbcSingleChunk);

                expect(decrypted).toBe(TEST_VECTORS.cbcSinglePlaintext);
            });

            it('should decrypt multi-chunk CBC message', async () => {
                const sessionKey = await createSessionKey(TEST_KEY_BASE64);

                const decrypted = await decrypt(sessionKey, TEST_VECTORS.cbcChunked);

                expect(decrypted).toBe(TEST_VECTORS.cbcChunkedPlaintext);
            });
        });

        describe('error cases', () => {
            it('should throw error when session key is null/undefined', async () => {
                await expect(decrypt(null as any, 'test:data')).rejects.toThrow("SessionKey isn't initialized");
                await expect(decrypt(undefined as any, 'test:data')).rejects.toThrow("SessionKey isn't initialized");
            });

            it('should throw error for message without separator', async () => {
                const sessionKey = await createSessionKey(TEST_KEY_BASE64);

                await expect(decrypt(sessionKey, 'noseparator')).rejects.toThrow('Failed to find ":" separator in message');
            });

            it('should throw error for unknown version number', async () => {
                const sessionKey = await createSessionKey(TEST_KEY_BASE64);
                const unknownVersion = Buffer.from('99').toString('base64');
                const fakeIv = Buffer.alloc(12).toString('base64');
                const fakeCiphertext = Buffer.from('fake').toString('base64');
                const invalidMessage = `${unknownVersion}:${fakeIv}:${fakeCiphertext}`;

                await expect(decrypt(sessionKey, invalidMessage)).rejects.toThrow('Unknown protocol version: 99');
            });

            it('should throw error for corrupted ciphertext', async () => {
                const sessionKey = await createSessionKey(TEST_KEY_BASE64);
                const version = Buffer.from('1').toString('base64');
                const iv = Buffer.alloc(12).toString('base64');
                const corruptedCiphertext = Buffer.from('corrupted').toString('base64');
                const corruptedMessage = `${version}:${iv}:${corruptedCiphertext}`;

                await expect(decrypt(sessionKey, corruptedMessage)).rejects.toThrow();
            });
        });
    });

    describe('extractVersioningFromMessage', () => {
        it('should parse versioned GCM message (version:iv:ciphertext)', () => {
            // "1" base64-encoded = "MQ=="
            const [version, remainder] = extractVersioningFromMessage('MQ==:ivdata:ciphertext');
            expect(version).toBe(ProtocolVersion.GCM_V1);
            expect(remainder).toBe('ivdata:ciphertext');
        });

        it('should parse versioned legacy CBC message (version:iv:ciphertext)', () => {
            // "0" base64-encoded = "MA=="
            const [version, remainder] = extractVersioningFromMessage('MA==:ivdata:ciphertext');
            expect(version).toBe(ProtocolVersion.LEGACY_CBC_CHUNKED);
            expect(remainder).toBe('ivdata:ciphertext');
        });

        it('should detect unversioned GCM by 12-byte IV (iv:ciphertext)', () => {
            // 12 bytes of zeros as base64 = "AAAAAAAAAAAAAAAA"
            const iv12 = Buffer.alloc(12).toString('base64');
            const msg = `${iv12}:ciphertext`;
            const [version, remainder] = extractVersioningFromMessage(msg);
            expect(version).toBe(ProtocolVersion.GCM_V1);
            expect(remainder).toBe(msg); // returns full message (no version stripped)
        });

        it('should detect unversioned CBC by 16-byte IV (iv:ciphertext)', () => {
            // 16 bytes of zeros as base64 = "AAAAAAAAAAAAAAAAAAAAAA=="
            const iv16 = Buffer.alloc(16).toString('base64');
            const msg = `${iv16}:ciphertext`;
            const [version, remainder] = extractVersioningFromMessage(msg);
            expect(version).toBe(ProtocolVersion.LEGACY_CBC_CHUNKED);
            expect(remainder).toBe(msg);
        });

        it('should detect chunked CBC (iv:ct:iv:ct:...)', () => {
            const iv16 = Buffer.alloc(16).toString('base64');
            const msg = `${iv16}:ct1:${iv16}:ct2:${iv16}:ct3`;
            const [version, remainder] = extractVersioningFromMessage(msg);
            expect(version).toBe(ProtocolVersion.LEGACY_CBC_CHUNKED);
            expect(remainder).toBe(msg);
        });

        it('should throw on message with no separator', () => {
            expect(() => extractVersioningFromMessage('noseparator')).toThrow('Failed to find ":" separator');
        });

        it('should throw on non-numeric version prefix', () => {
            // "abc" base64-encoded = "YWJj"
            expect(() => extractVersioningFromMessage('YWJj:iv:ct')).toThrow('Failed to extract version from message');
        });

        it('should throw on unknown version number', () => {
            // "99" base64-encoded = "OTk="
            expect(() => extractVersioningFromMessage('OTk=:iv:ct')).toThrow('Unknown protocol version: 99');
        });
    });

    describe('encryptFile / decryptFile', () => {
        it('should round-trip small binary data', async () => {
            const original = Buffer.from('Hello, file encryption!');

            const { encrypted, keyBase64, ivBase64 } = await encryptFile(original);
            const decrypted = await decryptFile(encrypted, keyBase64, ivBase64);

            expect(decrypted.toString()).toBe('Hello, file encryption!');
        });

        it('should round-trip a larger buffer (simulating an image)', async () => {
            // 64KB of random data
            const original = Buffer.from(QuickCrypto.getRandomValues(new Uint8Array(65536)));

            const { encrypted, keyBase64, ivBase64 } = await encryptFile(original);
            const decrypted = await decryptFile(encrypted, keyBase64, ivBase64);

            expect(decrypted).toEqual(original);
        });

        it('should produce different ciphertexts for the same data (random key + IV)', async () => {
            const data = Buffer.from('same data');

            const result1 = await encryptFile(data);
            const result2 = await encryptFile(data);

            expect(result1.keyBase64).not.toBe(result2.keyBase64);
            expect(result1.ivBase64).not.toBe(result2.ivBase64);
        });

        it('should return a 256-bit key and 96-bit IV as base64', async () => {
            const data = Buffer.from('test');

            const { keyBase64, ivBase64 } = await encryptFile(data);

            expect(Buffer.from(keyBase64, 'base64').length).toBe(32); // 256 bits
            expect(Buffer.from(ivBase64, 'base64').length).toBe(12); // 96 bits
        });

        it('should fail to decrypt with wrong key', async () => {
            const data = Buffer.from('secret data');
            const { encrypted, ivBase64 } = await encryptFile(data);

            // Generate a different random key
            const wrongKey = Buffer.from(QuickCrypto.getRandomValues(new Uint8Array(32))).toString('base64');

            await expect(decryptFile(encrypted, wrongKey, ivBase64)).rejects.toThrow();
        });

        it('should fail to decrypt with wrong IV', async () => {
            const data = Buffer.from('secret data');
            const { encrypted, keyBase64 } = await encryptFile(data);

            const wrongIv = Buffer.from(QuickCrypto.getRandomValues(new Uint8Array(12))).toString('base64');

            await expect(decryptFile(encrypted, keyBase64, wrongIv)).rejects.toThrow();
        });

        it('should handle empty data', async () => {
            const original = Buffer.alloc(0);

            const { encrypted, keyBase64, ivBase64 } = await encryptFile(original);
            const decrypted = await decryptFile(encrypted, keyBase64, ivBase64);

            expect(decrypted.length).toBe(0);
        });
    });
});
