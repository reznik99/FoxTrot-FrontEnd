/**
 * Database tests using sql.js in-memory database.
 * Tests that data is correctly stored and retrieved from SQLite.
 */
import initSqlJs, { Database } from 'sql.js';
import { CallRecord, message, UserData } from '~/store/reducers/user';

// Adapter to make sql.js match op-sqlite's executeSync API
function createOpSqliteAdapter(sqlJsDb: Database) {
    return {
        executeSync: (sql: string, params: any[] = []) => {
            const results = sqlJsDb.exec(sql, params);
            if (results.length === 0) {
                return { rows: [] };
            }
            // Convert sql.js format {columns, values} to op-sqlite format {rows: [{col: val}]}
            const { columns, values } = results[0];
            const rows = values.map(row => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
            return { rows };
        },
        close: () => sqlJsDb.close(),
    };
}

// Mock op-sqlite
jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));

// Mock Keychain
jest.mock('react-native-keychain', () => ({
    getGenericPassword: jest.fn().mockResolvedValue({ password: 'test-key' }),
    setGenericPassword: jest.fn().mockResolvedValue(true),
    ACCESS_CONTROL: { BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BiometryAnyOrDevicePasscode' },
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: '' },
    STORAGE_TYPE: { AES_GCM_NO_AUTH: '' },
}));

// Mock QuickCrypto
jest.mock('react-native-quick-crypto', () => ({
    getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
    },
}));

import {
    setDb,
    dbSaveMessage,
    dbSaveMessages,
    dbGetMessages,
    dbSaveConversation,
    dbGetConversations,
    dbGetConversation,
    dbUpdateMessageDecrypted,
    dbSaveCallRecord,
    dbGetCallHistory,
    dbClearCallHistory,
    dbGetUnseenCallCount,
    dbMarkAllCallsSeen,
} from '../database';

// Sample test data
const testUser: UserData = {
    id: '101',
    phone_no: '+1111111111',
    last_seen: 1700000000000,
    online: true,
    pic: 'https://example.com/pic1.jpg',
    public_key: 'pubkey-101',
};

const testMessages: message[] = [
    {
        id: 1,
        message: 'MQ==:iv:encrypted-hello',
        sent_at: '2024-01-15T10:30:00.000Z',
        seen: true,
        reciever: '+1111111111',
        reciever_id: '101',
        sender: '+0000000000',
        sender_id: '100',
    },
    {
        id: 2,
        message: 'MQ==:iv:encrypted-reply',
        sent_at: '2024-01-15T10:31:00.000Z',
        seen: false,
        reciever: '+0000000000',
        reciever_id: '100',
        sender: '+1111111111',
        sender_id: '101',
    },
];

// Normalize for comparison (DB stores IDs as strings, is_decrypted defaults to false)
const normalizeMessage = (msg: message): message => ({
    ...msg,
    reciever_id: String(msg.reciever_id),
    sender_id: String(msg.sender_id),
    is_decrypted: false,
});

describe('database operations', () => {
    let SQL: Awaited<ReturnType<typeof initSqlJs>>;

    beforeAll(async () => {
        SQL = await initSqlJs();
    });

    beforeEach(() => {
        // Create fresh in-memory database with adapter
        const sqlJsDb = new SQL.Database();
        const adapter = createOpSqliteAdapter(sqlJsDb);
        setDb(adapter as any, true);
    });

    afterEach(() => {
        setDb(null);
    });

    describe('messages', () => {
        it('should save and retrieve a single message', () => {
            const conversationId = '+1111111111';
            dbSaveMessage(testMessages[0], conversationId);

            const messages = dbGetMessages(conversationId);
            expect(messages).toHaveLength(1);
            expect(messages[0]).toEqual(normalizeMessage(testMessages[0]));
        });

        it('should save and retrieve multiple messages', () => {
            const conversationId = '+1111111111';
            dbSaveMessages(testMessages, conversationId);

            const messages = dbGetMessages(conversationId);
            expect(messages).toHaveLength(2);
        });

        it('should return messages in descending order by sent_at', () => {
            const conversationId = '+1111111111';
            dbSaveMessages(testMessages, conversationId);

            const messages = dbGetMessages(conversationId);
            // Most recent message first
            expect(messages[0].id).toBe(2);
            expect(messages[1].id).toBe(1);
        });

        it('should update message decrypted status', () => {
            const conversationId = '+1111111111';
            dbSaveMessage(testMessages[0], conversationId);

            const decryptedContent = JSON.stringify({ type: 'MSG', message: 'Hello!' });
            dbUpdateMessageDecrypted(testMessages[0].id, decryptedContent);

            const messages = dbGetMessages(conversationId);
            expect(messages[0].message).toBe(decryptedContent);
            expect(messages[0].is_decrypted).toBe(true);
        });

        it('should respect limit and offset', () => {
            const conversationId = '+1111111111';
            dbSaveMessages(testMessages, conversationId);

            const limited = dbGetMessages(conversationId, 1, 0);
            expect(limited).toHaveLength(1);

            const offset = dbGetMessages(conversationId, 1, 1);
            expect(offset).toHaveLength(1);
            expect(offset[0].id).not.toBe(limited[0].id);
        });
    });

    describe('conversations', () => {
        it('should save and retrieve a conversation', () => {
            dbSaveConversation(testUser, Date.now());

            const conversations = dbGetConversations();
            expect(conversations).toHaveLength(1);
            expect(conversations[0].other_user.phone_no).toBe(testUser.phone_no);
        });

        it('should get full conversation with messages', () => {
            dbSaveConversation(testUser, Date.now());
            dbSaveMessages(testMessages, testUser.phone_no);

            const conversation = dbGetConversation(testUser.phone_no);
            expect(conversation).not.toBeNull();
            expect(conversation!.other_user.phone_no).toBe(testUser.phone_no);
            expect(conversation!.messages).toHaveLength(2);
        });

        it('should return null for non-existent conversation', () => {
            const conversation = dbGetConversation('+9999999999');
            expect(conversation).toBeNull();
        });

        it('should update existing conversation on conflict', () => {
            const initialTime = 1000;
            const updatedTime = 2000;

            dbSaveConversation(testUser, initialTime);
            dbSaveConversation({ ...testUser, last_seen: 9999 }, updatedTime);

            const conversations = dbGetConversations();
            expect(conversations).toHaveLength(1);
            expect(conversations[0].updatedAt).toBe(updatedTime);
        });

        it('should include message count in conversation list', () => {
            dbSaveConversation(testUser, Date.now());
            dbSaveMessages(testMessages, testUser.phone_no);

            const conversations = dbGetConversations();
            expect(conversations[0].messageCount).toBe(2);
        });
    });

    describe('calls', () => {
        const testCallRecord: Omit<CallRecord, 'id' | 'seen'> = {
            peer_phone: '+1111111111',
            peer_id: '101',
            peer_pic: 'https://example.com/pic1.jpg',
            direction: 'outgoing',
            call_type: 'audio',
            status: 'answered',
            duration: 120,
            started_at: '2024-01-15T10:30:00.000Z',
        };

        it('should save and retrieve a call record', () => {
            dbSaveCallRecord(testCallRecord);

            const history = dbGetCallHistory();
            expect(history).toHaveLength(1);
            expect(history[0].peer_phone).toBe(testCallRecord.peer_phone);
            expect(history[0].direction).toBe('outgoing');
            expect(history[0].status).toBe('answered');
            expect(history[0].duration).toBe(120);
        });

        it('should return records in descending order by started_at', () => {
            dbSaveCallRecord({ ...testCallRecord, started_at: '2024-01-15T10:00:00.000Z' });
            dbSaveCallRecord({ ...testCallRecord, started_at: '2024-01-15T12:00:00.000Z' });
            dbSaveCallRecord({ ...testCallRecord, started_at: '2024-01-15T11:00:00.000Z' });

            const history = dbGetCallHistory();
            expect(history).toHaveLength(3);
            expect(history[0].started_at).toBe('2024-01-15T12:00:00.000Z');
            expect(history[1].started_at).toBe('2024-01-15T11:00:00.000Z');
            expect(history[2].started_at).toBe('2024-01-15T10:00:00.000Z');
        });

        it('should respect limit and offset', () => {
            dbSaveCallRecord({ ...testCallRecord, started_at: '2024-01-15T10:00:00.000Z' });
            dbSaveCallRecord({ ...testCallRecord, started_at: '2024-01-15T11:00:00.000Z' });
            dbSaveCallRecord({ ...testCallRecord, started_at: '2024-01-15T12:00:00.000Z' });

            const limited = dbGetCallHistory(2, 0);
            expect(limited).toHaveLength(2);

            const offset = dbGetCallHistory(2, 1);
            expect(offset).toHaveLength(2);
            expect(offset[0].started_at).toBe('2024-01-15T11:00:00.000Z');
        });

        it('should clear all call records', () => {
            dbSaveCallRecord(testCallRecord);
            dbSaveCallRecord({ ...testCallRecord, started_at: '2024-01-15T11:00:00.000Z' });

            expect(dbGetCallHistory()).toHaveLength(2);

            dbClearCallHistory();

            expect(dbGetCallHistory()).toHaveLength(0);
        });

        it('should handle missing peer_pic', () => {
            dbSaveCallRecord({ ...testCallRecord, peer_pic: undefined });

            const history = dbGetCallHistory();
            expect(history).toHaveLength(1);
            expect(history[0].peer_pic).toBeUndefined();
        });

        it('should store and distinguish all call statuses and directions', () => {
            dbSaveCallRecord({
                ...testCallRecord,
                direction: 'outgoing',
                status: 'answered',
                started_at: '2024-01-15T10:00:00.000Z',
            });
            dbSaveCallRecord({
                ...testCallRecord,
                direction: 'incoming',
                status: 'answered',
                started_at: '2024-01-15T11:00:00.000Z',
            });
            dbSaveCallRecord({
                ...testCallRecord,
                direction: 'incoming',
                status: 'missed',
                duration: 0,
                started_at: '2024-01-15T12:00:00.000Z',
            });

            const history = dbGetCallHistory();
            expect(history).toHaveLength(3);
            // Most recent first
            expect(history[0]).toMatchObject({ direction: 'incoming', status: 'missed', duration: 0 });
            expect(history[1]).toMatchObject({ direction: 'incoming', status: 'answered' });
            expect(history[2]).toMatchObject({ direction: 'outgoing', status: 'answered' });
        });

        it('should count unseen call records', () => {
            dbSaveCallRecord({ ...testCallRecord, started_at: '2024-01-15T10:00:00.000Z' });
            dbSaveCallRecord({ ...testCallRecord, started_at: '2024-01-15T11:00:00.000Z' });

            expect(dbGetUnseenCallCount()).toBe(2);
        });

        it('should mark all calls as seen', () => {
            dbSaveCallRecord({ ...testCallRecord, started_at: '2024-01-15T10:00:00.000Z' });
            dbSaveCallRecord({ ...testCallRecord, started_at: '2024-01-15T11:00:00.000Z' });

            expect(dbGetUnseenCallCount()).toBe(2);

            dbMarkAllCallsSeen();

            expect(dbGetUnseenCallCount()).toBe(0);

            const history = dbGetCallHistory();
            expect(history.every(r => r.seen === true)).toBe(true);
        });
    });
});
