import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { WebCryptoKeyPair } from 'react-native-quick-crypto';
import type { CryptoKey } from 'react-native-quick-crypto/src/keys/classes';
import { RTCSessionDescription } from 'react-native-webrtc';

import {
    dbDeleteMessage,
    dbMarkMessagesSeen,
    dbSaveConversation,
    dbSaveMessage,
    dbUpdateMessageDecrypted,
} from '~/global/database';
import { getAvatar } from '~/global/helper';
import { logger } from '~/global/logger';
import { writeToStorage } from '~/global/storage';

export interface State {
    tokenValid: boolean;
    token: string;
    keys?: WebCryptoKeyPair;
    user_data: UserData;
    contacts: UserData[];
    conversations: Map<string, Conversation>;
    socketStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
    socketErr: string;
    caller?: UserData;
    callOffer?: RTCSessionDescription;
    turnServerCredentials: TURNCredentials;
    loading: boolean;
    loginErr: string;
    signupErr: string;
}

export interface UserData {
    id: string | number;
    phone_no: string;
    last_seen: number;
    online: boolean;
    pic?: string;
    public_key?: string;
    session_key?: CryptoKey;
}

export interface Conversation {
    other_user: UserData;
    messages: message[];
}

export interface message {
    id: number;
    message: string;
    sent_at: string;
    seen: boolean;
    reciever: string;
    reciever_id: string | number;
    sender: string;
    sender_id: string | number;
    is_decrypted?: boolean;
    system?: boolean;
}

export interface CallRecord {
    id: number;
    peer_phone: string;
    peer_id: string;
    peer_pic?: string;
    direction: 'incoming' | 'outgoing';
    call_type: 'audio' | 'video';
    status: 'answered' | 'missed';
    duration: number;
    started_at: string;
    seen: boolean;
}

export interface TURNCredentials {
    username: string;
    credential: string;
}

const initialState: State = {
    tokenValid: false,
    token: '',
    keys: undefined,
    user_data: {
        id: '',
        phone_no: '',
        pic: '',
        last_seen: 0,
        online: false,
    },
    contacts: [],
    conversations: new Map(),
    socketStatus: 'disconnected',
    socketErr: '',
    caller: undefined,
    callOffer: undefined,
    turnServerCredentials: {
        username: '',
        credential: '',
    },
    loading: false,
    loginErr: '',
    signupErr: '',
};

export const userSlice = createSlice({
    name: 'user',
    initialState,
    reducers: {
        ADD_CONTACT_SUCCESS: (state, action: PayloadAction<UserData>) => {
            state.contacts.push(action.payload);
        },
        LOAD_CONTACTS: (state, action: PayloadAction<UserData[]>) => {
            state.contacts = action.payload;
        },
        LOAD_CONVERSATIONS: (state, action: PayloadAction<Map<string, Conversation>>) => {
            state.conversations = action.payload;
        },
        DELETE_CONVERSATION: (state, action: PayloadAction<string>) => {
            state.conversations.delete(action.payload);
        },
        SYNC_FROM_STORAGE: (state, action: PayloadAction<{ user_data: UserData }>) => {
            state.user_data = action.payload.user_data;
        },
        KEY_LOAD: (state, action: PayloadAction<WebCryptoKeyPair>) => {
            state.keys = action.payload;
        },
        TOKEN_VALID: (state, action: PayloadAction<{ token: string; valid: boolean }>) => {
            state.token = action.payload.token;
            state.tokenValid = action.payload.valid;
        },
        LOGGED_IN: (state, action: PayloadAction<{ token: string; user_data: UserData }>) => {
            state.token = action.payload.token;
            state.user_data = action.payload.user_data;
            state.loginErr = '';
        },
        SIGNED_UP: (state, action: PayloadAction<UserData>) => {
            state.user_data = action.payload;
        },
        LOGIN_ERROR_MSG: (state, action: PayloadAction<string>) => {
            state.loginErr = action.payload;
        },
        SIGNUP_ERROR_MSG: (state, action: PayloadAction<string>) => {
            state.signupErr = action.payload;
        },
        SET_LOADING: (state, action: PayloadAction<boolean>) => {
            state.loading = action.payload;
        },
        SEND_MESSAGE: (state, action: PayloadAction<{ sender: UserData; reciever: UserData; rawMessage: message }>) => {
            const reciever = action.payload.reciever;
            const message = action.payload.rawMessage;
            const converastionS = state.conversations.get(reciever.phone_no);
            if (converastionS) {
                converastionS.messages = [message, ...converastionS.messages];
            } else {
                state.conversations.set(reciever.phone_no, {
                    other_user: reciever,
                    messages: [message],
                });
            }
            // Save to SQLite
            try {
                dbSaveConversation(reciever, Date.now());
                dbSaveMessage(message, reciever.phone_no);
            } catch (err) {
                logger.error('Error saving sent message to SQLite:', err);
            }
            writeToStorage(`messages-${state.user_data.id}-last-checked`, String(Date.now()));
        },
        RECV_MESSAGE: (state, action: PayloadAction<message>) => {
            const data = action.payload;
            const conversationR = state.conversations.get(data.sender);
            // Update contact online status
            let contact = state.contacts.find(c => c.id === data.sender_id);
            if (!contact) {
                contact = {
                    id: data.sender_id,
                    phone_no: data.sender,
                    last_seen: new Date(data.sent_at).getTime(),
                    online: true,
                    pic: getAvatar(data.sender_id),
                };
            }
            contact.last_seen = new Date(data.sent_at).getTime();
            contact.online = true;
            // Update conversation
            if (conversationR) {
                conversationR.other_user = contact;
                conversationR.messages = [data, ...conversationR.messages];
            } else {
                state.conversations.set(data.sender, {
                    other_user: contact,
                    messages: [data],
                });
            }
            // Save to SQLite
            try {
                dbSaveConversation(contact, Date.now());
                dbSaveMessage(data, data.sender);
            } catch (err) {
                logger.error('Error saving received message to SQLite:', err);
            }
            writeToStorage(`messages-${state.user_data.id}-last-checked`, String(Date.now()));
        },
        UPDATE_MESSAGE_DECRYPTED: (
            state,
            action: PayloadAction<{ conversationId: string; messageId: number; decryptedContent: string }>,
        ) => {
            const { conversationId, messageId, decryptedContent } = action.payload;
            const conversation = state.conversations.get(conversationId);
            if (conversation) {
                const msg = conversation.messages.find(m => m.id === messageId);
                if (msg) {
                    msg.message = decryptedContent;
                    msg.is_decrypted = true;
                }
            }
            // Save to SQLite
            try {
                dbUpdateMessageDecrypted(messageId, decryptedContent);
            } catch (err) {
                logger.error('Error persisting decrypted message to SQLite:', err);
            }
        },
        MARK_MESSAGES_SEEN: (state, action: PayloadAction<{ conversationId: string; messageIds: number[] }>) => {
            const { conversationId, messageIds } = action.payload;
            if (messageIds.length === 0) return;

            const conversation = state.conversations.get(conversationId);
            if (conversation) {
                const idSet = new Set(messageIds);
                conversation.messages.forEach(msg => {
                    if (idSet.has(msg.id)) {
                        msg.seen = true;
                    }
                });
            }
            try {
                dbMarkMessagesSeen(messageIds);
            } catch (err) {
                logger.error('Error persisting seen status to SQLite:', err);
            }
        },
        DELETE_MESSAGE: (state, action: PayloadAction<{ conversationId: string; messageId: number }>) => {
            const { conversationId, messageId } = action.payload;
            const conversation = state.conversations.get(conversationId);
            if (conversation) {
                conversation.messages = conversation.messages.filter(m => m.id !== messageId);
            }
            try {
                dbDeleteMessage(messageId);
            } catch (err) {
                logger.error('Error deleting message from SQLite:', err);
            }
        },
        APPEND_OLDER_MESSAGES: (state, action: PayloadAction<{ conversationId: string; messages: message[] }>) => {
            const { conversationId, messages } = action.payload;
            if (messages.length === 0) {
                return;
            }
            const conversation = state.conversations.get(conversationId);
            if (conversation) {
                // Append older messages to the end (messages are sorted newest first)
                conversation.messages = [...conversation.messages, ...messages];
            }
        },
        KEY_ROTATED: (
            state,
            action: PayloadAction<{ user_id: number; phone_no: string; public_key: string; session_key: CryptoKey }>,
        ) => {
            const { phone_no, public_key, session_key } = action.payload;

            const contact = state.contacts.find(c => c.phone_no === phone_no);
            if (contact) {
                contact.public_key = public_key;
                contact.session_key = session_key;
            }

            const conversation = state.conversations.get(phone_no);
            if (conversation) {
                conversation.other_user.public_key = public_key;
                conversation.other_user.session_key = session_key;
            }

            // Insert a system message warning about the key change
            const systemMsg: message = {
                id: -Date.now(),
                message: `${phone_no} changed their security key. Verify their identity if this was unexpected.`,
                sent_at: new Date().toISOString(),
                seen: true,
                reciever: state.user_data.phone_no,
                reciever_id: state.user_data.id,
                sender: phone_no,
                sender_id: action.payload.user_id,
                system: true,
            };
            if (conversation) {
                conversation.messages = [systemMsg, ...conversation.messages];
            } else {
                const peer: UserData = {
                    id: action.payload.user_id,
                    phone_no,
                    last_seen: Date.now(),
                    online: true,
                    pic: getAvatar(action.payload.user_id),
                    public_key,
                    session_key,
                };
                state.conversations.set(phone_no, { other_user: peer, messages: [systemMsg] });
            }
            // Persist system message to SQLite
            try {
                dbSaveMessage(systemMsg, phone_no);
            } catch (err) {
                logger.error('Error saving key rotation system message to SQLite:', err);
            }
        },
        CONTACT_STATUS: (
            state,
            action: PayloadAction<{ user_id: number; phone_no: string; online: boolean; last_seen: string }>,
        ) => {
            const { phone_no, online, last_seen } = action.payload;
            const lastSeenMs = new Date(last_seen).getTime();

            const contact = state.contacts.find(c => c.phone_no === phone_no);
            if (contact) {
                contact.online = online;
                contact.last_seen = lastSeenMs;
            }

            const conversation = state.conversations.get(phone_no);
            if (conversation) {
                conversation.other_user.online = online;
                conversation.other_user.last_seen = lastSeenMs;
            }
        },
        RECV_CALL_OFFER: (state, action: PayloadAction<{ offer: RTCSessionDescription; caller: UserData }>) => {
            state.callOffer = action.payload?.offer;
            state.caller = action.payload?.caller;
        },
        TURN_CREDS: (state, action: PayloadAction<TURNCredentials>) => {
            state.turnServerCredentials = action.payload;
        },
        WEBSOCKET_STATUS: (state, action: PayloadAction<'disconnected' | 'connecting' | 'connected' | 'reconnecting'>) => {
            state.socketStatus = action.payload;
            if (action.payload === 'connected') {
                state.socketErr = '';
            }
        },
        WEBSOCKET_ERROR: (state, action: PayloadAction<string>) => {
            state.socketErr = action.payload;
        },
        LOGOUT: () => initialState,
    },
});

export const {
    ADD_CONTACT_SUCCESS,
    LOAD_CONTACTS,
    LOAD_CONVERSATIONS,
    DELETE_CONVERSATION,
    SYNC_FROM_STORAGE,
    KEY_LOAD,
    TOKEN_VALID,
    LOGGED_IN,
    SIGNED_UP,
    LOGIN_ERROR_MSG,
    SIGNUP_ERROR_MSG,
    SET_LOADING,
    SEND_MESSAGE,
    RECV_MESSAGE,
    UPDATE_MESSAGE_DECRYPTED,
    MARK_MESSAGES_SEEN,
    DELETE_MESSAGE,
    APPEND_OLDER_MESSAGES,
    KEY_ROTATED,
    CONTACT_STATUS,
    RECV_CALL_OFFER,
    TURN_CREDS,
    WEBSOCKET_STATUS,
    WEBSOCKET_ERROR,
    LOGOUT,
} = userSlice.actions;
