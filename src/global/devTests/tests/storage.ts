import { deleteFromStorage, getAllStorageKeys, popFromStorage, readFromStorage, writeToStorage } from '~/global/storage';

import { assert, assertEq, type TestCase } from '../runner';

// All test keys live under this prefix so a partial failure is easy to spot
// and clean up manually if needed.
const TEST_PREFIX = '__devtest__/';

function tkey(suffix: string): string {
    return `${TEST_PREFIX}${suffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function cleanupAllTestKeys(): Promise<void> {
    const keys = await getAllStorageKeys();
    await Promise.all(keys.filter(k => k.startsWith(TEST_PREFIX)).map(k => deleteFromStorage(k)));
}

export const storageTests: TestCase[] = [
    {
        id: 'storage/write-read-roundtrip',
        category: 'storage',
        name: 'writeToStorage → readFromStorage returns the same string',
        run: async () => {
            const k = tkey('roundtrip');
            try {
                await writeToStorage(k, 'hello world 🌍');
                const v = await readFromStorage(k);
                assertEq(v, 'hello world 🌍');
            } finally {
                await deleteFromStorage(k);
            }
        },
    },
    {
        id: 'storage/delete-removes-key',
        category: 'storage',
        name: 'deleteFromStorage → readFromStorage returns null',
        run: async () => {
            const k = tkey('delete');
            await writeToStorage(k, 'tmp');
            await deleteFromStorage(k);
            const v = await readFromStorage(k);
            assertEq(v, null);
        },
    },
    {
        id: 'storage/pop-removes-and-returns',
        category: 'storage',
        name: 'popFromStorage returns the value and clears the key',
        run: async () => {
            const k = tkey('pop');
            try {
                await writeToStorage(k, 'one-shot');
                const popped = await popFromStorage(k);
                assertEq(popped, 'one-shot');
                const after = await readFromStorage(k);
                assertEq(after, null);
            } finally {
                await deleteFromStorage(k);
            }
        },
    },
    {
        id: 'storage/cleanup-stale-test-keys',
        category: 'storage',
        name: 'Sweep removes any leftover __devtest__/ keys (idempotency check)',
        run: async () => {
            await cleanupAllTestKeys();
            const remaining = (await getAllStorageKeys()).filter(k => k.startsWith(TEST_PREFIX));
            assert(remaining.length === 0, `leftover test keys: ${remaining.join(', ')}`);
        },
    },
];
