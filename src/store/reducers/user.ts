import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { CryptoKey } from 'react-native-quick-crypto/src/keys/classes';
import type { WebCryptoKeyPair } from 'react-native-quick-crypto';
import { RTCIceCandidate } from 'react-native-webrtc';
import { getAvatar } from '~/global/helper';
import { writeToStorage } from '~/global/storage';
import { dbSaveMessage, dbSaveConversation, dbUpdateMessageDecrypted, dbMarkMessagesSeen } from '~/global/database';

export interface State {
    tokenValid: boolean;
    token: string;
    keys?: WebCryptoKeyPair;
    user_data: UserData;
    contacts: UserData[];
    conversations: Map<string, Conversation>;
    socketErr: string;
    socketConn?: WebSocket;
    caller?: UserData;
    callOffer?: RTCSessionDescription;
    callAnswer?: RTCSessionDescription;
    iceCandidates: RTCIceCandidate[];
    turnServerCredentials: TURNCredentials;
    loading: boolean;
    refreshing: boolean;
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
    socketErr: '',
    socketConn: undefined,
    caller: undefined,
    callOffer: undefined,
    callAnswer: undefined,
    iceCandidates: [],
    turnServerCredentials: {
        username: '',
        credential: '',
    },
    loading: false,
    refreshing: false,
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
        SET_REFRESHING: (state, action: PayloadAction<boolean>) => {
            state.refreshing = action.payload;
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
                console.error('Error saving sent message to SQLite:', err);
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
                console.error('Error saving received message to SQLite:', err);
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
                console.error('Error persisting decrypted message to SQLite:', err);
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
                console.error('Error persisting seen status to SQLite:', err);
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
        RECV_CALL_OFFER: (state, action: PayloadAction<{ offer: RTCSessionDescription; caller: UserData }>) => {
            state.callOffer = action.payload?.offer;
            state.caller = action.payload?.caller;
        },
        RECV_CALL_ANSWER: (state, action: PayloadAction<RTCSessionDescription>) => {
            state.callAnswer = action.payload;
        },
        RECV_CALL_ICE_CANDIDATE: (state, action: PayloadAction<RTCIceCandidate>) => {
            state.iceCandidates.push(action.payload);
        },
        RESET_CALL_ICE_CANDIDATES: state => {
            state.iceCandidates = [];
        },
        TURN_CREDS: (state, action: PayloadAction<TURNCredentials>) => {
            state.turnServerCredentials = action.payload;
        },
        WEBSOCKET_CONNECT: (state, action: PayloadAction<WebSocket>) => {
            state.socketConn = action.payload;
            state.socketErr = '';
        },
        WEBSOCKET_ERROR: (state, action: PayloadAction<string>) => {
            state.socketErr = action.payload;
        },
        LOGOUT: _state => {
            _state = initialState;
        },
    },
});

export const {
    ADD_CONTACT_SUCCESS,
    LOAD_CONTACTS,
    LOAD_CONVERSATIONS,
    SYNC_FROM_STORAGE,
    KEY_LOAD,
    TOKEN_VALID,
    LOGGED_IN,
    SIGNED_UP,
    LOGIN_ERROR_MSG,
    SIGNUP_ERROR_MSG,
    SET_LOADING,
    SET_REFRESHING,
    SEND_MESSAGE,
    RECV_MESSAGE,
    UPDATE_MESSAGE_DECRYPTED,
    MARK_MESSAGES_SEEN,
    APPEND_OLDER_MESSAGES,
    RECV_CALL_OFFER,
    RECV_CALL_ANSWER,
    RECV_CALL_ICE_CANDIDATE,
    RESET_CALL_ICE_CANDIDATES,
    TURN_CREDS,
    WEBSOCKET_CONNECT,
    WEBSOCKET_ERROR,
    LOGOUT,
} = userSlice.actions;
