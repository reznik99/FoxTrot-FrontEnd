import { decrypt, encrypt, exportKeypair, generateIdentityKeypair, generateSessionKeyECDH } from '~/global/crypto';
import { dbGetMessages, dbSaveConversation, dbSaveMessages } from '~/global/database';
import type { message, UserData } from '~/store/reducers/user';

import { withTestDb } from '../helpers';
import { assertEq, type TestCase } from '../runner';

export const integrationTests: TestCase[] = [
    {
        id: 'integration/message-roundtrip-via-db',
        category: 'integration',
        name: 'Full E2EE roundtrip: Alice encrypts → SQLCipher → Bob loads + decrypts',
        run: async () => {
            // 1. Generate identities + derive shared session keys via ECDH
            const alice = await generateIdentityKeypair();
            const bob = await generateIdentityKeypair();
            const alicePub = (await exportKeypair(alice)).publicKey;
            const bobPub = (await exportKeypair(bob)).publicKey;
            const aliceSession = await generateSessionKeyECDH(bobPub, alice.privateKey);
            const bobSession = await generateSessionKeyECDH(alicePub, bob.privateKey);

            // 2. Alice encrypts a message
            const plaintext = 'integration test message 🛡️ with emoji and spaces';
            const ciphertext = await encrypt(aliceSession, plaintext);

            // 3. Persist through the encrypted-at-rest SQLite layer
            await withTestDb(async () => {
                const peer: UserData = {
                    id: 'bob-id',
                    phone_no: '+15550000000',
                    last_seen: 0,
                    online: false,
                };
                dbSaveConversation(peer, Date.now());

                const msg: message = {
                    id: 42,
                    message: ciphertext,
                    sent_at: new Date(2026, 0, 1, 12, 0, 0).toISOString(),
                    seen: false,
                    reciever: peer.phone_no,
                    reciever_id: String(peer.id),
                    sender: 'alice',
                    sender_id: 'alice-id',
                    is_decrypted: false,
                };
                dbSaveMessages([msg], peer.phone_no);

                // 4. Bob loads from the DB
                const [retrieved] = dbGetMessages(peer.phone_no, 1, 0);
                assertEq(retrieved.message, ciphertext);
                assertEq(retrieved.is_decrypted, false);

                // 5. Bob decrypts and verifies the original plaintext survived the trip
                const decrypted = await decrypt(bobSession, retrieved.message);
                assertEq(decrypted, plaintext);
            });
        },
    },
];
