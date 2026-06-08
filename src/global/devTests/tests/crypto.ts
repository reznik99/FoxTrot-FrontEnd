import { Buffer } from 'buffer';
import QuickCrypto from 'react-native-quick-crypto';

import {
    decrypt,
    encrypt,
    exportKeypair,
    generateIdentityKeypair,
    generateSessionKeyECDH,
    importKeypair,
    publicKeyFingerprint,
} from '~/global/crypto';
import { SymmetricAlgorithm } from '~/global/variables';

import { assert, assertEq, assertRejects, type TestCase } from '../runner';

export const cryptoTests: TestCase[] = [
    {
        id: 'crypto/message-e2e',
        category: 'crypto',
        name: 'E2EE message Alice → Bob via ECDH session key (full native path)',
        run: async () => {
            const alice = await generateIdentityKeypair();
            const bob = await generateIdentityKeypair();
            const alicePub = (await exportKeypair(alice)).publicKey;
            const bobPub = (await exportKeypair(bob)).publicKey;
            const aliceSession = await generateSessionKeyECDH(bobPub, alice.privateKey);
            const bobSession = await generateSessionKeyECDH(alicePub, bob.privateKey);
            const msg = 'hello bob from alice 👋';
            const ciphertext = await encrypt(aliceSession, msg);
            const plaintext = await decrypt(bobSession, ciphertext);
            assertEq(plaintext, msg);
        },
    },
    {
        id: 'crypto/keypair-export-import',
        category: 'crypto',
        name: 'Identity keypair export → import → re-export is byte-identical',
        run: async () => {
            const kp = await generateIdentityKeypair();
            const exported = await exportKeypair(kp);
            const reimported = await importKeypair(exported);
            const reexported = await exportKeypair(reimported);
            assertEq(reexported.publicKey, exported.publicKey);
            assertEq(reexported.privateKey, exported.privateKey);
        },
    },
    {
        id: 'crypto/fingerprint-stable',
        category: 'crypto',
        name: 'publicKeyFingerprint is deterministic and well-formed',
        run: async () => {
            const kp = await generateIdentityKeypair();
            const { publicKey } = await exportKeypair(kp);
            const fp1 = await publicKeyFingerprint(publicKey);
            const fp2 = await publicKeyFingerprint(publicKey);
            assertEq(fp1, fp2);
            assert(fp1.length > 0, 'fingerprint is empty');
            assert(/^([0-9A-F]{2} )+$/.test(fp1), `unexpected fingerprint format: ${fp1}`);
        },
    },
    {
        id: 'crypto/tampered-ciphertext-rejected',
        category: 'crypto',
        name: 'Tampered ciphertext is rejected by native AES-GCM auth tag',
        run: async () => {
            const a = await generateIdentityKeypair();
            const b = await generateIdentityKeypair();
            const aPub = (await exportKeypair(a)).publicKey;
            const session = await generateSessionKeyECDH(aPub, b.privateKey);
            const original = await encrypt(session, 'sensitive payload');
            // Flip a byte deep in the ciphertext portion (last segment is base64 ct).
            const parts = original.split(':');
            const ct = Buffer.from(parts[2], 'base64');
            ct[Math.floor(ct.length / 2)] ^= 0x01;
            parts[2] = ct.toString('base64');
            await assertRejects(() => decrypt(session, parts.join(':')), 'tampered ciphertext was accepted');
        },
    },
    {
        id: 'crypto/legacy-cbc-golden-vector',
        category: 'crypto',
        name: 'Native module decrypts the legacy AES-CBC golden vector',
        run: async () => {
            // Same golden vector used by the Node-crypto unit tests in
            // __tests__/crypto.test.ts. Running it through the native module catches
            // quick-crypto regressions on the legacy code path — which would otherwise
            // rot silently because nobody decrypts old messages until someone does.
            const TEST_KEY_BASE64 = '5ZFymSUme/8XA3T7f+FbGX7te8ri8N7iOQ5iHvyr/+A=';
            const cbcSingleChunk = 'oZYIgo24l9yYXwBm9+QV+Q==:z7eECS1KfKmxqG7OXpN6SQ==';
            const expected = 'Hello, World!';

            const sessionKey = await QuickCrypto.subtle.importKey(
                'raw',
                Buffer.from(TEST_KEY_BASE64, 'base64'),
                SymmetricAlgorithm,
                false,
                ['encrypt', 'decrypt'],
            );
            const plaintext = await decrypt(sessionKey, cbcSingleChunk);
            assertEq(plaintext, expected);
        },
    },
];
