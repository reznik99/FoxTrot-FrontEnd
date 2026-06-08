import { DB, open } from '@op-engineering/op-sqlite';

import { requireDb, setDb } from '~/global/database';

// 32-byte hex key. Not secret — the test DB file is deleted after every test.
const TEST_DB_ENCRYPTION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

/**
 * Runs `fn` against an isolated, encrypted test DB. The real DB handle is restored
 * in the finally block and the test DB file is deleted from disk — no residue.
 *
 * Caveat: while the test DB is active, any concurrent code path that writes to the
 * global DB (e.g. websocket message arrival) lands in the test DB and is thrown
 * away. Keep tests fast.
 *
 * Pass `{ initSchema: false }` to skip schema init — used by the migration test
 * which needs to set up an older schema manually before triggering init.
 */
export async function withTestDb<T>(fn: (db: DB) => Promise<T>, opts: { initSchema?: boolean } = {}): Promise<T> {
    const realDb = (() => {
        try {
            return requireDb();
        } catch {
            return null;
        }
    })();

    const testDbName = `foxtrot-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`;
    const testDb = open({ name: testDbName, encryptionKey: TEST_DB_ENCRYPTION_KEY });

    try {
        setDb(testDb, opts.initSchema ?? true);
        return await fn(testDb);
    } finally {
        try {
            testDb.delete();
        } catch {
            // best-effort cleanup
        }
        if (realDb) setDb(realDb);
        else setDb(null);
    }
}
