import { open, DB } from '@op-engineering/op-sqlite';

import * as Keychain from 'react-native-keychain';
import QuickCrypto from 'react-native-quick-crypto';
import { Buffer } from 'buffer';

import { CallRecord, message, UserData } from '~/store/reducers/user';
import { DB_MSG_PAGE_SIZE } from './variables';

const DB_NAME = 'foxtrot.db';
const DB_KEY_SERVICE = 'foxtrot-db-key';
const SCHEMA_VERSION = 2;

// SQLite database is encrypted using SQLCipher (AES-256-CBC with HMAC-SHA512).
// Key: 32 bytes (256-bit), stored in device Keychain.

let db: DB | null = null;

/**
 * Returns the current database connection or throws if not initialized.
 * All functions use this getter to access the database, making it easy to mock in tests.
 */
export function requireDb(): DB {
    if (!db) throw new Error('Database not initialized');
    return db;
}

/**
 * Sets the database instance. Used for testing with in-memory databases.
 * Optionally initializes the schema.
 */
export function setDb(instance: DB | null, initSchema = false): void {
    db = instance;
    if (initSchema && db) {
        initializeSchema();
    }
}

// Database Connection

async function getOrCreateDbKey(): Promise<string> {
    try {
        const credentials = await Keychain.getGenericPassword({ service: DB_KEY_SERVICE });
        if (credentials && credentials.password) {
            return credentials.password;
        }
    } catch (err) {
        console.debug('No existing database key found, generating new one');
    }

    const keyBytes = QuickCrypto.getRandomValues(new Uint8Array(32));
    const key = Buffer.from(keyBytes).toString('hex');

    await Keychain.setGenericPassword(DB_KEY_SERVICE, key, {
        service: DB_KEY_SERVICE,
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
    });

    console.debug('Generated and stored new database encryption key');
    return key;
}

/**
 * Gets the database connection, opening it if necessary.
 * Also initializes the schema on first open.
 */
export async function getDb(): Promise<DB> {
    if (db) {
        return db;
    }

    const encryptionKey = await getOrCreateDbKey();
    db = open({ name: DB_NAME, encryptionKey });
    console.debug('Database opened');

    initializeSchema();
    return db;
}

export function closeDb(): void {
    if (db) {
        db.close();
        db = null;
        console.debug('Database closed');
    }
}

// Schema

function initializeSchema(): void {
    const database = requireDb();

    database.executeSync(`
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY
        )
    `);

    const result = database.executeSync('SELECT version FROM schema_version LIMIT 1');
    const currentVersion = result.rows?.[0]?.version as number | undefined;

    if (currentVersion === SCHEMA_VERSION) {
        return;
    }

    console.debug('Initializing database schema version', SCHEMA_VERSION);

    // Messages table - matches the `message` interface from reducers
    database.executeSync(`
        CREATE TABLE IF NOT EXISTS messages (
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
    database.executeSync(`
        CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id, sent_at DESC)
    `);

    // Conversations table - stores peer info
    database.executeSync(`
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            peer_id TEXT NOT NULL,
            peer_phone TEXT NOT NULL,
            peer_public_key TEXT,
            peer_pic TEXT,
            peer_last_seen INTEGER DEFAULT 0,
            updated_at INTEGER NOT NULL
        )
    `);

    // Calls table - stores call history records
    database.executeSync(`
        CREATE TABLE IF NOT EXISTS calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            peer_phone TEXT NOT NULL,
            peer_id TEXT NOT NULL,
            peer_pic TEXT,
            direction TEXT NOT NULL,
            call_type TEXT NOT NULL,
            status TEXT NOT NULL,
            duration INTEGER NOT NULL DEFAULT 0,
            started_at TEXT NOT NULL,
            seen INTEGER DEFAULT 0
        )
    `);
    database.executeSync(`
        CREATE INDEX IF NOT EXISTS idx_calls_started_at
        ON calls(started_at DESC)
    `);

    if (currentVersion === undefined) {
        database.executeSync('INSERT INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION]);
    } else {
        database.executeSync('UPDATE schema_version SET version = ?', [SCHEMA_VERSION]);
    }

    console.debug('Database schema initialized');
}

// Messages

export function dbSaveMessage(msg: message, conversationId: string): void {
    dbSaveMessages([msg], conversationId);
}

export function dbSaveMessages(messages: message[], conversationId: string): void {
    if (messages.length === 0) return;

    const database = requireDb();
    const placeholders = messages.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, 0)').join(', ');
    const params = messages.flatMap(msg => [
        msg.id,
        msg.message,
        msg.sent_at,
        msg.seen ? 1 : 0,
        msg.reciever,
        String(msg.reciever_id),
        msg.sender,
        String(msg.sender_id),
        conversationId,
    ]);

    database.executeSync(
        `INSERT OR REPLACE INTO messages
         (id, message, sent_at, seen, receiver, receiver_id, sender, sender_id, conversation_id, is_decrypted)
         VALUES ${placeholders}`,
        params,
    );
}

export function dbGetMessages(conversationId: string, limit = DB_MSG_PAGE_SIZE, offset = 0): message[] {
    const database = requireDb();

    const result = database.executeSync(
        `SELECT id, message, sent_at, seen, receiver, receiver_id, sender, sender_id, is_decrypted
         FROM messages WHERE conversation_id = ?
         ORDER BY datetime(sent_at) DESC LIMIT ? OFFSET ?`,
        [conversationId, limit, offset],
    );
    console.debug('Loaded', result.rows.length, 'messages from database');
    return (result.rows || []).map(row => ({
        id: row.id as number,
        message: row.message as string,
        sent_at: row.sent_at as string,
        seen: Boolean(row.seen),
        reciever: row.receiver as string, // typo in interface, correct in DB
        reciever_id: row.receiver_id as string,
        sender: row.sender as string,
        sender_id: row.sender_id as string,
        is_decrypted: Boolean(row.is_decrypted),
    }));
}

export function dbUpdateMessageDecrypted(messageId: number, decryptedContent: string): void {
    const database = requireDb();

    database.executeSync(`UPDATE messages SET message = ?, is_decrypted = 1 WHERE id = ?`, [decryptedContent, messageId]);
}

export function dbMarkMessagesSeen(messageIds: number[]): void {
    if (messageIds.length === 0) return;

    const database = requireDb();
    const placeholders = messageIds.map(() => '?').join(', ');
    database.executeSync(`UPDATE messages SET seen = 1 WHERE id IN (${placeholders})`, messageIds);
}

// Conversations

export function dbSaveConversation(peer: UserData, updatedAt: number): void {
    const database = requireDb();

    database.executeSync(
        `INSERT INTO conversations (id, peer_id, peer_phone, peer_public_key, peer_pic, peer_last_seen, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
             peer_public_key = excluded.peer_public_key,
             peer_pic = excluded.peer_pic,
             peer_last_seen = excluded.peer_last_seen,
             updated_at = excluded.updated_at`,
        [
            peer.phone_no,
            String(peer.id),
            peer.phone_no,
            peer.public_key || null,
            peer.pic || null,
            peer.last_seen || 0,
            updatedAt,
        ],
    );
}

export function dbGetConversations(): Array<{ other_user: UserData; messageCount: number; updatedAt: number }> {
    const database = requireDb();

    const result = database.executeSync(`
        SELECT c.*, COUNT(m.id) as message_count
        FROM conversations c
        LEFT JOIN messages m ON c.id = m.conversation_id
        GROUP BY c.id
        ORDER BY c.updated_at DESC
    `);

    return (result.rows || []).map(row => ({
        other_user: {
            id: row.peer_id as string,
            phone_no: row.peer_phone as string,
            public_key: (row.peer_public_key as string) || undefined,
            pic: (row.peer_pic as string) || undefined,
            last_seen: row.peer_last_seen as number,
            online: false,
        },
        messageCount: row.message_count as number,
        updatedAt: row.updated_at as number,
    }));
}

export function dbGetConversation(peerPhone: string): { other_user: UserData; messages: message[] } | null {
    const database = requireDb();

    const convResult = database.executeSync('SELECT * FROM conversations WHERE id = ?', [peerPhone]);
    const row = convResult.rows?.[0];
    if (!row) return null;

    return {
        other_user: {
            id: row.peer_id as string,
            phone_no: row.peer_phone as string,
            public_key: (row.peer_public_key as string) || undefined,
            pic: (row.peer_pic as string) || undefined,
            last_seen: row.peer_last_seen as number,
            online: false,
        },
        messages: dbGetMessages(peerPhone),
    };
}

// Calls

export function dbSaveCallRecord(record: Omit<CallRecord, 'id' | 'seen'>): void {
    const database = requireDb();

    database.executeSync(
        `INSERT INTO calls (peer_phone, peer_id, peer_pic, direction, call_type, status, duration, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            record.peer_phone,
            record.peer_id,
            record.peer_pic || null,
            record.direction,
            record.call_type,
            record.status,
            record.duration,
            record.started_at,
        ],
    );
}

export function dbGetCallHistory(limit = 50, offset = 0): CallRecord[] {
    const database = requireDb();

    const result = database.executeSync(
        `SELECT id, peer_phone, peer_id, peer_pic, direction, call_type, status, duration, started_at, seen
         FROM calls ORDER BY datetime(started_at) DESC LIMIT ? OFFSET ?`,
        [limit, offset],
    );

    return (result.rows || []).map(row => ({
        id: row.id as number,
        peer_phone: row.peer_phone as string,
        peer_id: row.peer_id as string,
        peer_pic: (row.peer_pic as string) || undefined,
        direction: row.direction as CallRecord['direction'],
        call_type: row.call_type as CallRecord['call_type'],
        status: row.status as CallRecord['status'],
        duration: row.duration as number,
        started_at: row.started_at as string,
        seen: Boolean(row.seen),
    }));
}

export function dbGetUnseenCallCount(): number {
    const database = requireDb();
    const result = database.executeSync('SELECT COUNT(*) as count FROM calls WHERE seen = 0');
    return (result.rows?.[0]?.count as number) || 0;
}

export function dbMarkAllCallsSeen(): void {
    const database = requireDb();
    database.executeSync('UPDATE calls SET seen = 1 WHERE seen = 0');
}

export function dbClearCallHistory(): void {
    const database = requireDb();
    database.executeSync('DELETE FROM calls');
}
