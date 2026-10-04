import { getMessaging, getToken, registerDeviceForRemoteMessages } from '@react-native-firebase/messaging'; // Push Notifications
import { createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import * as Keychain from 'react-native-keychain';
import Toast from 'react-native-toast-message';

import { encrypt, exportKeypair, generateIdentityKeypair, generateSessionKeyECDH, importKeypair } from '~/global/crypto';
import {
    dbGetConversation,
    dbGetConversations,
    dbGetStoredContacts,
    dbSaveContacts,
    dbSaveConversation,
    dbSaveMessage,
} from '~/global/database';
import { getAvatar } from '~/global/helper';
import { logger } from '~/global/logger';
import { getPushNotificationPermission } from '~/global/permissions';
import { readFromStorage, StorageKeys, writeToStorage } from '~/global/storage';
import { API_URL, KeypairAlgorithm } from '~/global/variables';
import {
    ADD_CONTACT_SUCCESS,
    Conversation,
    KEY_LOAD,
    KEY_ROTATED,
    LOAD_CONTACTS,
    LOAD_CONVERSATIONS,
    message,
    SELF_KEY_ROTATED,
    SEND_MESSAGE,
    SET_LOADING,
    SYNC_FROM_STORAGE,
    TOKEN_VALID,
    TURN_CREDS,
    UserData,
} from '~/store/reducers/user';
import { AppDispatch, RootState } from '~/store/store';

const createDefaultAsyncThunk = createAsyncThunk.withTypes<{ state: RootState; dispatch: AppDispatch }>();

export const syncImportedPublicKey = createDefaultAsyncThunk<void, { publicKey: string }>(
    'syncImportedPublicKey',
    async ({ publicKey }, thunkAPI) => {
        const state = thunkAPI.getState().userReducer;
        await axios.post(`${API_URL}/savePublicKey`, { publicKey, force: true }, axiosBearerConfig(state.token));
        thunkAPI.dispatch(SELF_KEY_ROTATED({ publicKey }));
    },
);

export const loadKeys = createDefaultAsyncThunk('loadKeys', async (_, thunkAPI) => {
    try {
        thunkAPI.dispatch(SET_LOADING(true));

        const state = thunkAPI.getState().userReducer;
        if (state.keys) {
            return true;
        }

        logger.debug(
            `Loading '${KeypairAlgorithm.name} ${KeypairAlgorithm.namedCurve}' keys from secure storage for user ${state.user_data.phone_no}`,
        );
        const credentials = await Keychain.getInternetCredentials(API_URL, {
            server: API_URL,
            service: `${state.user_data.phone_no}-keys`,
        });
        if (!credentials || credentials.username !== `${state.user_data.phone_no}-keys`) {
            logger.info('No keys found. First time login on device');
            return false;
        }

        const keys = await importKeypair(JSON.parse(credentials.password));

        // Store keypair in memory
        thunkAPI.dispatch(KEY_LOAD(keys));
        return true;
    } catch (err: any) {
        logger.error('Error loading keys:', err, JSON.stringify(await Keychain.getSupportedBiometryType()));
        Toast.show({
            type: 'error',
            text1: 'Failed to load Identity Keypair from TPM',
            text2: err.message ?? err.toString(),
            visibilityTime: 5000,
        });
        return false;
    } finally {
        thunkAPI.dispatch(SET_LOADING(false));
    }
});

export const generateAndSyncKeys = createDefaultAsyncThunk<boolean>('generateAndSyncKeys', async (_, thunkAPI) => {
    const state = thunkAPI.getState().userReducer;

    try {
        thunkAPI.dispatch(SET_LOADING(true));

        // Generate User's Keypair
        const keyPair = await generateIdentityKeypair();
        const keys = await exportKeypair(keyPair);

        // Upload public key (force overwrite if rotating an existing key)
        const hasExistingKeys = !!state.keys || !!state.user_data.public_key;
        logger.debug(
            `Syncing '${KeypairAlgorithm.name} ${KeypairAlgorithm.namedCurve}' public key to server (force: ${hasExistingKeys})`,
        );
        await axios.post(
            `${API_URL}/savePublicKey`,
            { publicKey: keys.publicKey, force: hasExistingKeys },
            axiosBearerConfig(state.token),
        );

        // Store on device
        logger.debug(`Saving '${KeypairAlgorithm.name} ${KeypairAlgorithm.namedCurve}' keys to secure storage`);
        await Keychain.setInternetCredentials(API_URL, `${state.user_data.phone_no}-keys`, JSON.stringify(keys), {
            storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
            server: API_URL,
            service: `${state.user_data.phone_no}-keys`,
        });

        // Store keypair in memory
        thunkAPI.dispatch(KEY_LOAD(keyPair));

        // Re-derive all session keys with the new private key
        if (hasExistingKeys) {
            await thunkAPI.dispatch(loadContacts({ forceDerive: true }));
            thunkAPI.dispatch(SELF_KEY_ROTATED({ publicKey: keys.publicKey }));
        }

        return true;
    } catch (err: any) {
        await Keychain.resetInternetCredentials({ server: API_URL, service: `${state.user_data?.phone_no}-keys` });
        logger.error('Error generating and syncing keys:', err);
        Toast.show({
            type: 'error',
            text1: 'Failed to generate Identity Keypair',
            text2: err.message ?? err.toString(),
            visibilityTime: 5000,
        });
        return false;
    } finally {
        thunkAPI.dispatch(SET_LOADING(false));
    }
});

// --- Disk loaders (fast, synchronous SQLite reads) ---

export const loadMessagesFromDisk = createDefaultAsyncThunk('loadMessagesFromDisk', async (_, thunkAPI) => {
    try {
        const state = thunkAPI.getState().userReducer;
        if (state.conversations.size) return;

        const conversations = new Map<string, Conversation>();
        for (const conv of dbGetConversations()) {
            const fullConv = dbGetConversation(conv.other_user.phone_no);
            if (fullConv) {
                conversations.set(conv.other_user.phone_no, fullConv);
            }
        }

        if (conversations.size) {
            thunkAPI.dispatch(LOAD_CONVERSATIONS(conversations));
        }
    } catch (err: any) {
        logger.error('Error loading messages from disk:', err);
    }
});

export const loadContactsFromDisk = createDefaultAsyncThunk('loadContactsFromDisk', async (_, thunkAPI) => {
    try {
        const state = thunkAPI.getState().userReducer;
        if (state.contacts.length) return;

        const cached = dbGetStoredContacts();
        if (!cached.length) return;

        const contacts = await Promise.all<UserData>(
            cached.map(async sc => {
                try {
                    const session_key = await generateSessionKeyECDH(sc.public_key || '', state.keys?.privateKey);
                    return {
                        id: sc.id,
                        phone_no: sc.phone_no,
                        public_key: sc.public_key || undefined,
                        last_seen: 0,
                        online: false,
                        pic: getAvatar(sc.id),
                        session_key,
                    };
                } catch {
                    return {
                        id: sc.id,
                        phone_no: sc.phone_no,
                        public_key: sc.public_key || undefined,
                        last_seen: 0,
                        online: false,
                        pic: getAvatar(sc.id),
                    };
                }
            }),
        );

        thunkAPI.dispatch(LOAD_CONTACTS(contacts));
    } catch (err: any) {
        logger.error('Error loading contacts from disk:', err);
    }
});

// --- API loaders (network, merge with Redux state, persist to disk) ---

export const loadMessages = createDefaultAsyncThunk('loadMessages', async (_, thunkAPI) => {
    try {
        const { user_data, token } = thunkAPI.getState().userReducer;

        // Check last time we hit the API for messages
        const cachedLastChecked = (await readFromStorage(`messages-${user_data.id}-last-checked`)) || '0';
        let lastChecked = parseInt(cachedLastChecked, 10);

        // If no conversations in state yet, fetch everything
        if (!thunkAPI.getState().userReducer.conversations.size) {
            lastChecked = 0;
        }

        // Fetch new messages from API
        const response = await axios.get<message[]>(
            `${API_URL}/getConversations/?since=${lastChecked}`,
            axiosBearerConfig(token),
        );
        logger.debug('Loaded', response.data?.length, 'new messages from API');
        if (response.data.length === 0) return;

        // Watermark = newest server-stamped sent_at we received, so the device clock can't skip or re-fetch messages
        const newest = response.data.reduce((max, msg) => {
            const sentAt = new Date(msg.sent_at).getTime();
            return Number.isFinite(sentAt) ? Math.max(max, sentAt) : max;
        }, 0);
        writeToStorage(`messages-${user_data.id}-last-checked`, String(newest || Date.now()));

        // Snapshot conversations AFTER the network call returns — minimizes the window
        // where parallel dispatches (e.g. system messages) could be overwritten
        const conversations = new Map(thunkAPI.getState().userReducer.conversations);
        response.data.toReversed().forEach(msg => {
            const peer: UserData = {
                id: msg.sender_id,
                phone_no: msg.sender,
                pic: getAvatar(msg.sender_id),
                last_seen: new Date(msg.sent_at).getTime(),
                online: false,
            };
            if (msg.sender === user_data.phone_no) {
                peer.id = msg.reciever_id;
                peer.phone_no = msg.reciever;
                peer.pic = getAvatar(msg.reciever_id);
            }
            const convo = conversations.get(peer.phone_no);
            if (convo) {
                // Skip duplicates (message may have arrived via WebSocket while API call was in flight)
                if (convo.messages.some(m => m.id === msg.id)) return;
                conversations.set(peer.phone_no, {
                    other_user: convo.other_user,
                    messages: [msg, ...convo.messages],
                });
            } else {
                conversations.set(peer.phone_no, {
                    other_user: peer,
                    messages: [msg],
                });
            }

            // Persist to SQLite
            try {
                dbSaveConversation(peer, new Date(msg.sent_at).getTime());
                dbSaveMessage(msg, peer.phone_no);
            } catch (err: any) {
                logger.error('Error saving message to SQLite:', err);
            }
        });

        thunkAPI.dispatch(LOAD_CONVERSATIONS(conversations));
    } catch (err: any) {
        logger.error('Error loading messages:', err);
        Toast.show({
            type: 'error',
            text1: 'Error loading messages',
            text2: err.message ?? err.toString(),
            visibilityTime: 5000,
        });
    }
});

export const loadContacts = createDefaultAsyncThunk(
    'loadContacts',
    async ({ forceDerive }: { forceDerive?: boolean }, thunkAPI) => {
        try {
            const { token } = thunkAPI.getState().userReducer;
            const response = await axios.get<UserData[]>(`${API_URL}/getContacts`, axiosBearerConfig(token));

            const state = thunkAPI.getState().userReducer;

            // Copy the objects too, so updating session keys cannot mutate Redux.
            const contactsById = new Map<string, UserData>(
                state.contacts.map(contact => [String(contact.id), { ...contact }]),
            );

            // 1. Merge API contacts and report changed keys. Keep omitted contacts.
            for (const incoming of response.data) {
                const previous = contactsById.get(String(incoming.id));
                let keyChanged = false;

                if (previous?.public_key) {
                    keyChanged = previous.public_key !== incoming.public_key;
                }

                contactsById.set(String(incoming.id), {
                    ...previous,
                    ...incoming,
                    public_key: incoming.public_key,
                    last_seen: new Date(incoming.last_seen).getTime(),
                    pic: getAvatar(incoming.id),
                    session_key: keyChanged ? undefined : previous?.session_key,
                });

                if (keyChanged) {
                    // Same path as a live rotation: updates the key in Redux right now (so an overlapping refresh
                    // cannot warn a second time), inserts the warning once, and persists the key.
                    thunkAPI.dispatch(
                        KEY_ROTATED({
                            user_id: Number(incoming.id),
                            phone_no: incoming.phone_no,
                            public_key: incoming.public_key ?? undefined,
                        }),
                    );
                }
            }

            const contacts = [...contactsById.values()];

            // 2. Generate missing session keys in parallel, or regenerate all when forced.
            await Promise.all(
                contacts.map(async contact => {
                    if (contact.session_key && !forceDerive) {
                        return;
                    }
                    try {
                        contact.session_key = await generateSessionKeyECDH(contact.public_key || '', state.keys?.privateKey);
                    } catch (err: any) {
                        contact.session_key = undefined;
                        logger.warn('Failed to generate session key:', contact.phone_no, err.message || err);
                    }
                }),
            );

            thunkAPI.dispatch(LOAD_CONTACTS(contacts));

            // Persist to SQLite for future key-change detection and fast disk load
            try {
                dbSaveContacts(contacts);
            } catch (err) {
                logger.warn('Failed to persist contacts to SQLite:', err);
            }
        } catch (err: any) {
            logger.error('Error loading contacts:', err);
            Toast.show({
                type: 'error',
                text1: 'Error loading contacts',
                text2: err.message ?? err.toString(),
                visibilityTime: 5000,
            });
        }
    },
);

export const addContact = createDefaultAsyncThunk('addContact', async ({ user }: { user: UserData }, thunkAPI) => {
    try {
        const state = thunkAPI.getState().userReducer;
        const { data } = await axios.post(`${API_URL}/addContact`, { id: user.id }, axiosBearerConfig(state.token));
        const session_key = await generateSessionKeyECDH(data.public_key || '', state.keys?.privateKey);

        thunkAPI.dispatch(ADD_CONTACT_SUCCESS({ ...data, pic: getAvatar(user.id), session_key }));
        return true;
    } catch (err: any) {
        logger.error('Error adding contact:', err);
        Toast.show({
            type: 'error',
            text1: 'Failed to add contact',
            text2: err.message || 'Please try again later',
            visibilityTime: 5000,
        });
        return false;
    }
});

export const searchUsers = createDefaultAsyncThunk<UserData[], { prefix: string }>(
    'searchUsers',
    async ({ prefix }, thunkAPI) => {
        try {
            const state = thunkAPI.getState().userReducer;

            const response = await axios.get<UserData[]>(`${API_URL}/searchUsers/${prefix}`, axiosBearerConfig(state.token));

            // Append robot picture to users
            const results = response.data.map(user => ({
                ...user,
                pic: getAvatar(user.id),
                isContact: state.contacts.some(contact => contact.id === user.id),
            }));
            logger.debug(`searchUsers: ${results.length} users found for prefix '${prefix}'`);
            return results;
        } catch (err: any) {
            logger.error('Error searching users:', err);
            return [];
        }
    },
);

type sendMessageParams = { message: string; to_user: UserData };
export const sendMessage = createDefaultAsyncThunk('sendMessage', async (data: sendMessageParams, thunkAPI) => {
    try {
        thunkAPI.dispatch(SET_LOADING(true));
        const state = thunkAPI.getState().userReducer;

        if (!data.to_user?.session_key) {
            throw new Error('Missing session_key for ' + data.to_user?.phone_no);
        }

        // Encrypt and send message
        const encryptedMessage = await encrypt(data.to_user.session_key, data.message);
        const res = await axios.post(
            `${API_URL}/sendMessage`,
            { message: encryptedMessage, contact_id: data.to_user.id, contact_phone_no: data.to_user.phone_no },
            axiosBearerConfig(state.token),
        );

        // Save message locally using server-assigned ID (store plaintext so sent messages are readable immediately)
        const localMessage = {
            sender: state.user_data,
            reciever: data.to_user,
            rawMessage: {
                id: res.data.id ?? Date.now(),
                message: data.message,
                sender: state.user_data.phone_no,
                sender_id: state.user_data.id,
                reciever: data.to_user.phone_no,
                reciever_id: data.to_user.id,
                sent_at: new Date().toISOString(),
                seen: false,
                is_decrypted: true,
            },
        };
        thunkAPI.dispatch(SEND_MESSAGE(localMessage));
        return true;
    } catch (err: any) {
        logger.error('Error sending message:', err);
        Toast.show({
            type: 'error',
            text1: 'Error sending message',
            text2: err.message ?? err.toString(),
        });
        return false;
    } finally {
        thunkAPI.dispatch(SET_LOADING(false));
    }
});

export const validateToken = createDefaultAsyncThunk('validateToken', async (token: string, thunkAPI) => {
    try {
        thunkAPI.dispatch(SET_LOADING(true));
        if (!token) {
            return false;
        }

        const res = await axios.get(`${API_URL}/validateToken`, axiosBearerConfig(token));

        thunkAPI.dispatch(TOKEN_VALID({ token: token, valid: res.data?.valid }));
        return res.data?.valid === true;
    } catch (err: any) {
        thunkAPI.dispatch(TOKEN_VALID({ token: '', valid: false }));
        return false;
    } finally {
        thunkAPI.dispatch(SET_LOADING(false));
    }
});

export const syncFromStorage = createDefaultAsyncThunk('syncFromStorage', async (_, thunkAPI) => {
    try {
        thunkAPI.dispatch(SET_LOADING(true));

        logger.debug('Loading user from local storage');
        // TODO: Load existing contacts from async storage
        const user_data = await readFromStorage(StorageKeys.USER_DATA);
        if (!user_data) {
            return undefined;
        }

        const payload = {
            user_data: JSON.parse(user_data) as UserData,
        };
        thunkAPI.dispatch(SYNC_FROM_STORAGE(payload));
        return payload.user_data;
    } catch (err: any) {
        logger.error('Error syncing from storage:', err);
        Toast.show({
            type: 'error',
            text1: 'Failed to sync data from storage',
            text2: err.message ?? err.toString(),
            visibilityTime: 5000,
        });
        return undefined;
    } finally {
        thunkAPI.dispatch(SET_LOADING(false));
    }
});

export const registerPushNotifications = createDefaultAsyncThunk('registerPushNotifications', async (_, thunkAPI) => {
    try {
        const state = thunkAPI.getState().userReducer;

        logger.debug('Registering for Push Notifications');
        const granted = await getPushNotificationPermission();
        if (!granted) {
            logger.warn('Push notifications permission denied');
            return false;
        }
        const messaging = getMessaging();
        await registerDeviceForRemoteMessages(messaging);
        const token = await getToken(messaging);
        await axios.post(`${API_URL}/registerPushNotifications`, { token }, axiosBearerConfig(state.token));
    } catch (err: any) {
        logger.error('Error Registering for Push Notifications:', err);
        Toast.show({
            type: 'error',
            text1: 'Failed to register for push notifications',
            text2: err.message ?? err.toString(),
            visibilityTime: 5000,
        });
    }
    // Permission is allowed (a failed token registration above is reported by the toast, not as "notifications off")
    return true;
});

export const getTURNServerCreds = createDefaultAsyncThunk('getTURNServerCreds', async (_, thunkAPI) => {
    try {
        const state = thunkAPI.getState().userReducer;

        logger.debug('Fetching TURN server credentials');
        const response = await axios.get(`${API_URL}/turnServerKey`, axiosBearerConfig(state.token));
        thunkAPI.dispatch(TURN_CREDS(response.data));
    } catch (err: any) {
        logger.error('Error fetching TURN Server credentials:', err);
        Toast.show({
            type: 'info',
            text1: 'Failed to fetch proxy credentials',
            text2: 'call stability might be impacted',
            visibilityTime: 5000,
        });
    }
});

function axiosBearerConfig(token: string) {
    return { headers: { Authorization: `JWT ${token}` } };
}
