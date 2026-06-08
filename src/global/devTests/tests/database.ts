import {
    dbDeleteConversation,
    dbGetConversations,
    dbGetMessages,
    dbSaveConversation,
    dbSaveMessages,
    setDb,
} from '~/global/database';
import type { message, UserData } from '~/store/reducers/user';

import { withTestDb } from '../helpers';
import { assertEq, type TestCase } from '../runner';

function fakePeer(suffix: string): UserData {
    return {
        id: `peer-${suffix}`,
        phone_no: `+1555000${suffix}`,
        last_seen: 0,
        online: false,
        public_key: undefined,
        pic: undefined,
    };
}

function fakeMessage(id: number, conversationId: string, body: string): message {
    return {
        id,
        message: body,
        sent_at: new Date(2026, 0, 1, 12, 0, id).toISOString(),
        seen: false,
        reciever: 'me',
        reciever_id: 'me-id',
        sender: conversationId,
        sender_id: conversationId,
        is_decrypted: true,
    };
}

export const databaseTests: TestCase[] = [
    {
        id: 'db/delete-conversation',
        category: 'database',
        name: 'dbDeleteConversation removes the conversation and all its messages',
        run: async () => {
            await withTestDb(async () => {
                const peer = fakePeer('001');
                dbSaveConversation(peer, Date.now());
                dbSaveMessages([fakeMessage(50, peer.phone_no, 'bye')], peer.phone_no);
                dbDeleteConversation(peer.phone_no);
                assertEq(dbGetMessages(peer.phone_no, 10, 0).length, 0);
                assertEq(
                    dbGetConversations().find(c => c.other_user.phone_no === peer.phone_no),
                    undefined,
                );
            });
        },
    },
    {
        id: 'db/schema-migration-v2-to-v3',
        category: 'database',
        name: 'Schema v2 → v3 migration preserves old messages and adds the system column',
        run: async () => {
            await withTestDb(
                async db => {
                    // Manually set up a v2 schema (no `system` column, no conversations/calls/contacts tables).
                    db.executeSync('CREATE TABLE schema_version (version INTEGER PRIMARY KEY)');
                    db.executeSync('INSERT INTO schema_version (version) VALUES (2)');
                    db.executeSync(`
                        CREATE TABLE messages (
                            id INTEGER PRIMARY KEY,
                            message TEXT NOT NULL,
                            sent_at TEXT NOT NULL,
                            seen INTEGER DEFAULT 0,
                            receiver TEXT NOT NULL,
                            receiver_id TEXT NOT NULL,
                            sender TEXT NOT NULL,
                            sender_id TEXT NOT NULL,
                            conversation_id TEXT NOT NULL,
                            is_decrypted INTEGER DEFAULT 0
                        )
                    `);
                    db.executeSync(
                        `INSERT INTO messages
                         (id, message, sent_at, seen, receiver, receiver_id, sender, sender_id, conversation_id, is_decrypted)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [1, 'pre-migration msg', new Date(2025, 5, 1).toISOString(), 0, 'me', '1', 'peer', '2', 'conv-1', 1],
                    );

                    // Trigger initializeSchema, which detects v2 and runs the ALTER TABLE.
                    setDb(db, true);

                    // Old data preserved
                    const msgs = dbGetMessages('conv-1', 10, 0);
                    assertEq(msgs.length, 1);
                    assertEq(msgs[0].message, 'pre-migration msg');
                    // `system` column was added with default 0 → false
                    assertEq(msgs[0].system, false);

                    // Schema version bumped
                    const result = db.executeSync('SELECT version FROM schema_version LIMIT 1');
                    assertEq(result.rows?.[0]?.version, 3);
                },
                { initSchema: false },
            );
        },
    },
];
