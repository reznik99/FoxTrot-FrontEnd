import { configureStore } from '@reduxjs/toolkit';
import axios from 'axios';
import { enableMapSet } from 'immer';
import Toast from 'react-native-toast-message';

import { generateSessionKeyECDH } from '~/global/crypto';
import { dbSaveContacts, dbSaveMessage } from '~/global/database';
import { logger } from '~/global/logger';
import { KEY_ROTATED, State, UserData, userSlice } from '~/store/reducers/user';

import { loadContacts } from '../user';

jest.mock('@react-native-firebase/messaging', () => ({}));
jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('react-native-keychain', () => ({}));
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));
jest.mock('~/global/crypto', () => ({ generateSessionKeyECDH: jest.fn() }));
jest.mock('~/global/database', () => ({
    dbSaveContacts: jest.fn(),
    dbSaveConversation: jest.fn(),
    dbSaveMessage: jest.fn(),
}));
jest.mock('~/global/helper', () => ({
    generateLocalMessageId: () => -1,
    getAvatar: (id: string | number) => `avatar-${id}`,
}));
jest.mock('~/global/logger', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('~/global/permissions', () => ({}));
jest.mock('~/global/storage', () => ({ writeToStorage: jest.fn(), StorageKeys: {} }));
jest.mock('~/global/variables', () => ({ API_URL: 'https://test.invalid' }));

enableMapSet();

// Only key reuse/replacement is tested here; native key derivation is mocked.
const identityKeys = { privateKey: {}, publicKey: {} } as NonNullable<State['keys']>;
const existingSessionKey = {} as NonNullable<UserData['session_key']>;
const derivedSessionKey = {} as NonNullable<UserData['session_key']>;
const apiBob = {
    id: 2,
    phone_no: 'Bob',
    public_key: 'bob-public-key',
    last_seen: 0,
    online: false,
};
const apiAlice = { ...apiBob, id: 3, phone_no: 'Alice', public_key: 'alice-public-key' };
const bob: UserData = { ...apiBob, session_key: existingSessionKey };
const alice: UserData = { ...apiAlice, session_key: existingSessionKey };

function createTestStore(contacts: UserData[]) {
    return configureStore({
        reducer: { userReducer: userSlice.reducer },
        preloadedState: {
            userReducer: {
                ...userSlice.getInitialState(),
                token: 'test-token',
                user_data: { id: 1, phone_no: 'Me', last_seen: 0, online: true },
                keys: identityKeys,
                contacts,
            },
        },
        middleware: getDefaultMiddleware => getDefaultMiddleware({ serializableCheck: false }),
    });
}

let store: ReturnType<typeof createTestStore>;

async function refreshWith(apiContacts: unknown[], options: { forceDerive?: boolean } = {}) {
    jest.mocked(axios.get).mockResolvedValue({ data: apiContacts });
    await store.dispatch(loadContacts(options));
    return store.getState().userReducer;
}

function expectContactsSaved(contacts: UserData[]) {
    const persistedFields = contacts.map(({ id, phone_no, public_key }) =>
        expect.objectContaining({ id, phone_no, public_key }),
    );
    expect(dbSaveContacts).toHaveBeenLastCalledWith(persistedFields);
}

beforeEach(() => {
    jest.resetAllMocks();
    store = createTestStore([bob]);
    jest.mocked(generateSessionKeyECDH).mockImplementation(async publicKey => {
        if (!publicKey) throw new Error('Missing public key');
        return derivedSessionKey;
    });
});

describe('loadContacts', () => {
    it('merges new and existing contacts, retains omitted contacts, and reuses unchanged keys', async () => {
        store = createTestStore([bob, alice]);
        const originalContacts = store.getState().userReducer.contacts;
        const lastSeen = '2026-09-17T00:00:00Z';
        const { contacts } = await refreshWith([
            // Deliberately inject a server field that must never replace the local key.
            { ...apiBob, id: '2', online: true, last_seen: lastSeen, session_key: 'untrusted-api-value' },
            { id: 4, phone_no: 'Charlie', public_key: 'charlie-public-key', last_seen: 0, online: false },
        ]);

        expect(contacts).toHaveLength(3);
        expect(contacts[0]).toMatchObject({ id: '2', online: true, last_seen: Date.parse(lastSeen) });
        expect(contacts[0].session_key).toBe(existingSessionKey);
        expect(contacts[1]).toEqual(alice);
        expect(contacts[2].session_key).toBe(derivedSessionKey);
        expect(originalContacts).toEqual([bob, alice]);
        expect(generateSessionKeyECDH).toHaveBeenCalledTimes(1);
        expect(generateSessionKeyECDH).toHaveBeenCalledWith('charlie-public-key', identityKeys.privateKey);
        expect(dbSaveMessage).not.toHaveBeenCalled();
        expectContactsSaved(contacts);
    });

    it('detects a changed key after a contact was omitted from an earlier response', async () => {
        const afterOmission = await refreshWith([]);
        expect(afterOmission.contacts).toEqual([bob]);
        expectContactsSaved([bob]);

        const changedBob = { ...apiBob, public_key: 'replacement-key' };
        await refreshWith([changedBob]);
        const { contacts, conversations } = await refreshWith([changedBob]);

        expect(dbSaveMessage).toHaveBeenCalledTimes(1);
        expect(dbSaveMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                system: true,
                sender: 'Bob',
                message: expect.stringContaining('changed their security key'),
            }),
            'Bob',
        );
        expect(conversations.get('Bob')?.messages).toHaveLength(1);
        expect(contacts[0].session_key).toBe(derivedSessionKey);
        expect(generateSessionKeyECDH).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['undefined to null', undefined, null, 0],
        ['null to undefined', null, undefined, 0],
        ['first public key', null, 'first-key', 0],
        ['same public key', 'bob-public-key', 'bob-public-key', 0],
        ['key removed as null', 'bob-public-key', null, 1],
        ['key removed as undefined', 'bob-public-key', undefined, 1],
    ] as const)('uses the agreed warning rule: %s', async (_name, previousKey, incomingKey, warningCount) => {
        // API JSON can contain null even though UserData declares an optional string.
        const previous = {
            ...bob,
            public_key: previousKey,
            session_key: previousKey ? existingSessionKey : undefined,
        } as UserData;
        store = createTestStore([previous]);
        const { contacts } = await refreshWith([{ ...apiBob, public_key: incomingKey }]);

        expect(dbSaveMessage).toHaveBeenCalledTimes(warningCount);
        if (!incomingKey) {
            expect(contacts[0].session_key).toBeUndefined();
        }
    });

    it('forceDerive starts all keys together and waits for every result before saving contacts', async () => {
        store = createTestStore([bob, alice]);
        const originalContacts = store.getState().userReducer.contacts;
        const aliceSessionKey = {} as NonNullable<UserData['session_key']>;
        let resolveBob!: (key: NonNullable<UserData['session_key']>) => void;
        let resolveAlice!: (key: NonNullable<UserData['session_key']>) => void;
        jest.mocked(generateSessionKeyECDH)
            .mockReturnValueOnce(
                new Promise(resolve => {
                    resolveBob = resolve;
                }),
            )
            .mockReturnValueOnce(
                new Promise(resolve => {
                    resolveAlice = resolve;
                }),
            );

        const refresh = refreshWith([apiBob], { forceDerive: true });
        await new Promise<void>(resolve => setImmediate(resolve));

        expect(generateSessionKeyECDH).toHaveBeenCalledTimes(2);
        expect(store.getState().userReducer.contacts).toBe(originalContacts);
        expect(dbSaveContacts).not.toHaveBeenCalled();

        // Finish the second key first. The first is still pending, so nothing is saved.
        resolveAlice(aliceSessionKey);
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(store.getState().userReducer.contacts).toBe(originalContacts);
        expect(dbSaveContacts).not.toHaveBeenCalled();

        resolveBob(derivedSessionKey);
        const { contacts } = await refresh;

        expect(contacts).toHaveLength(2);
        expect(contacts[0].session_key).toBe(derivedSessionKey);
        expect(contacts[1].session_key).toBe(aliceSessionKey);
        expect(originalContacts[0].session_key).toBe(existingSessionKey);
        expect(originalContacts[1].session_key).toBe(existingSessionKey);
        expect(generateSessionKeyECDH).toHaveBeenCalledTimes(2);
        expect(dbSaveContacts).toHaveBeenCalledTimes(1);
        expectContactsSaved(contacts);
        expect(dbSaveMessage).not.toHaveBeenCalled();
    });

    it('uses a key rotation received while the API request was pending without warning twice', async () => {
        let respond!: (response: { data: UserData[] }) => void;
        jest.mocked(axios.get).mockReturnValueOnce(
            new Promise(resolve => {
                respond = resolve;
            }),
        );
        const refresh = store.dispatch(loadContacts({}));

        store.dispatch(
            KEY_ROTATED({
                user_id: 2,
                phone_no: 'Bob',
                public_key: 'replacement-key',
                session_key: derivedSessionKey,
            }),
        );
        respond({ data: [{ ...apiBob, public_key: 'replacement-key' }] });
        await refresh;

        expect(store.getState().userReducer.contacts[0].session_key).toBe(derivedSessionKey);
        expect(generateSessionKeyECDH).not.toHaveBeenCalled();
        expect(dbSaveMessage).toHaveBeenCalledTimes(1);
    });

    it('clears a stale key on derivation failure, preserves the warning, and continues with other contacts', async () => {
        jest.mocked(generateSessionKeyECDH).mockRejectedValueOnce(new Error('Invalid public key'));
        const { contacts } = await refreshWith([{ ...apiBob, public_key: 'invalid-key' }, apiAlice]);

        expect(contacts[0].session_key).toBeUndefined();
        expect(contacts[1].session_key).toBe(derivedSessionKey);
        expect(dbSaveMessage).toHaveBeenCalledTimes(1);
        expectContactsSaved(contacts);
        expect(logger.warn).toHaveBeenCalledWith('Failed to generate session key:', 'Bob', 'Invalid public key');
    });

    it('preserves local contacts when the API request fails', async () => {
        const originalContacts = store.getState().userReducer.contacts;
        jest.mocked(axios.get).mockRejectedValue(new Error('Offline'));

        await store.dispatch(loadContacts({}));

        expect(store.getState().userReducer.contacts).toBe(originalContacts);
        expect(generateSessionKeyECDH).not.toHaveBeenCalled();
        expect(dbSaveContacts).not.toHaveBeenCalled();
        expect(Toast.show).toHaveBeenCalledWith(
            expect.objectContaining({ text1: 'Error loading contacts', text2: 'Offline' }),
        );
    });

    it('keeps merged contacts in Redux and logs a persistence failure', async () => {
        const error = new Error('Disk full');
        jest.mocked(dbSaveContacts).mockImplementation(() => {
            throw error;
        });

        const { contacts } = await refreshWith([apiAlice]);

        expect(contacts).toHaveLength(2);
        expect(logger.warn).toHaveBeenCalledWith('Failed to persist contacts to SQLite:', error);
    });
});
