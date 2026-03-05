import { AppState, NativeEventSubscription } from 'react-native';
import NetInfo, { NetInfoState, NetInfoSubscription } from '@react-native-community/netinfo';
import RNNotificationCall from 'react-native-full-screen-notification-incoming-call';
import InCallManager from 'react-native-incall-manager';
import PushNotification from 'react-native-push-notification';
import QuickCrypto from 'react-native-quick-crypto';
import Toast from 'react-native-toast-message';

import * as callManager from '~/global/callManager';
import { getAvatar } from '~/global/helper';
import { logger } from '~/global/logger';
import { navigationRef } from '~/global/navigation';
import { VibratePattern, WEBSOCKET_URL } from '~/global/variables';
import { loadMessages } from '~/store/actions/user';
import { store } from '~/store/store';

export interface SocketData {
    cmd: 'MSG' | 'CALL_OFFER' | 'CALL_ICE_CANDIDATE' | 'CALL_ANSWER';
    data: SocketMessage;
}

export interface SocketMessage {
    sender: string;
    sender_id: string | number;
    reciever: string;
    reciever_id: string | number;
    message?: string;
    sent_at?: string;
    seen?: boolean;
    offer?: any;
    answer?: any;
    candidate?: string;
    ring?: boolean;
    type?: 'video' | 'audio';
}

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

// Module-level state — timers, flags, subscriptions
const mgr = {
    ws: null as WebSocket | null,
    intentionalClose: false,
    reconnectAttempt: 0,
    reconnectTimer: null as ReturnType<typeof setTimeout> | null,
    appStateSub: null as NativeEventSubscription | null,
    netInfoSub: null as NetInfoSubscription | null,
    lastNetConnected: null as boolean | null,
};

// --- Helpers ---

function isSocketDead(): boolean {
    return !mgr.ws || mgr.ws.readyState === WebSocket.CLOSED || mgr.ws.readyState === WebSocket.CLOSING;
}

export function wsSendMessage(data: SocketData) {
    mgr.ws?.send(JSON.stringify(data));
}

function clearReconnectTimer() {
    if (mgr.reconnectTimer) {
        clearTimeout(mgr.reconnectTimer);
        mgr.reconnectTimer = null;
    }
}

// --- Public API ---

export async function start() {
    await connectWebsocket();

    mgr.appStateSub?.remove();
    mgr.appStateSub = AppState.addEventListener('change', nextState => {
        handleAppStateChange(nextState);
    });

    mgr.netInfoSub?.();
    mgr.netInfoSub = NetInfo.addEventListener(state => {
        handleNetInfoChange(state);
    });
}

export async function stop() {
    clearReconnectTimer();

    mgr.appStateSub?.remove();
    mgr.appStateSub = null;
    mgr.netInfoSub?.();
    mgr.netInfoSub = null;
    mgr.lastNetConnected = null;
    mgr.reconnectAttempt = 0;

    mgr.intentionalClose = true;
    if (mgr.ws && mgr.ws.readyState !== WebSocket.CLOSED) {
        mgr.ws.close();
    }
    mgr.ws = null;
    store.dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'disconnected' });
}

export function reconnect() {
    mgr.reconnectAttempt = 0;
    clearReconnectTimer();
    connectWebsocket();
    // Fetch any messages that arrived while disconnected
    store.dispatch(loadMessages());
}

// --- connect & reconnect ---

async function connectWebsocket() {
    try {
        const { token } = store.getState().userReducer;
        if (!token) {
            throw new Error('Token is not present. Re-auth required');
        }

        // Close existing socket without triggering reconnect
        if (mgr.ws && mgr.ws.readyState !== WebSocket.CLOSED) {
            mgr.intentionalClose = true;
            mgr.ws.close();
        }

        store.dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'connecting' });
        const ws = new WebSocket(`${WEBSOCKET_URL}?token=${token}`);

        const socketId: number = (ws as any)._socketId;
        ws.onopen = () => handleSocketOpen();
        ws.onclose = (event: any) => handleSocketClose(event.code, socketId);
        ws.onerror = (err: any) => handleSocketError(err);
        ws.onmessage = event => handleSocketMessage(event.data);
        mgr.ws = ws;
    } catch (err) {
        logger.error('Error establishing websocket:', err);
        store.dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'reconnecting' });
        scheduleReconnect();
    }
}

async function scheduleReconnect() {
    clearReconnectTimer();

    if (mgr.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        logger.warn('Max reconnect attempts reached');
        store.dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'disconnected' });
        store.dispatch({ type: 'user/WEBSOCKET_ERROR', payload: 'Unable to reconnect. Please check your connection.' });
        Toast.show({
            type: 'error',
            text1: 'Connection Lost',
            text2: 'Unable to reconnect after multiple attempts.',
            visibilityTime: 5000,
        });
        return;
    }

    // No point retrying without internet — NetInfo listener will reconnect when network returns
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
        logger.debug('No network, waiting for connectivity');
        return;
    }

    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, mgr.reconnectAttempt), MAX_DELAY_MS);
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    const finalDelay = Math.round(delay + jitter);

    logger.debug(`Reconnect ${mgr.reconnectAttempt + 1}/${MAX_RECONNECT_ATTEMPTS} in ${finalDelay}ms`);
    mgr.reconnectAttempt++;

    mgr.reconnectTimer = setTimeout(() => {
        mgr.reconnectTimer = null;
        connectWebsocket();
    }, finalDelay);
}

// --- AppState & NetInfo handlers ---

function handleAppStateChange(nextState: string) {
    if (nextState === 'background') {
        if (callManager.isActive()) {
            logger.debug('App backgrounded, keeping socket open for active call');
            return;
        }
        logger.debug('App backgrounded, closing socket');
        if (mgr.ws && mgr.ws.readyState === WebSocket.OPEN) {
            mgr.intentionalClose = true;
            mgr.ws.close();
        }
    } else if (nextState === 'active') {
        if (isSocketDead()) {
            logger.debug('App foregrounded, reconnecting');
            reconnect();
        }
    }
}

function handleNetInfoChange(state: NetInfoState) {
    const wasConnected = mgr.lastNetConnected;
    mgr.lastNetConnected = state.isConnected;

    if (!state.isConnected) {
        clearReconnectTimer();
        return;
    }

    if (wasConnected === false && isSocketDead()) {
        logger.debug('Network restored, reconnecting WebSocket');
        reconnect();
    }
}

// --- WebSocket event handlers ---

function handleSocketOpen() {
    logger.debug('[WebSocket] opened successfully');
    mgr.intentionalClose = false;
    mgr.reconnectAttempt = 0;
    store.dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'connected' });
    PushNotification.createChannel(
        {
            channelId: 'Messages',
            channelName: 'Notifications for incoming messages',
            channelDescription: 'Notifications for incoming messages',
        },
        () => {},
    );
}

function handleSocketClose(code: number, closedSocketId: number) {
    if (mgr.ws && (mgr.ws as any)._socketId !== closedSocketId) {
        logger.debug('[WebSocket] stale close event, ignoring');
        return;
    }

    logger.debug(`[WebSocket] closed (code: ${code})`);
    mgr.ws = null;

    if (code === 4401) {
        logger.warn('[WebSocket] auth failed, redirecting to login');
        clearReconnectTimer();
        store.dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'disconnected' });
        if (navigationRef.isReady()) {
            navigationRef.reset({
                index: 0,
                routes: [
                    {
                        name: 'Login',
                        params: { data: { loggedOut: true, errorMsg: 'Session expired. Please re-authenticate.' } },
                    },
                ],
            });
        }
        return;
    }

    if (mgr.intentionalClose) {
        mgr.intentionalClose = false;
        store.dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'disconnected' });
        return;
    }

    store.dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'reconnecting' });
    scheduleReconnect();
}

function handleSocketError(err: any) {
    const message = err?.message || err?.type || 'Connection error';
    logger.error(`[WebSocket] error: ${message} (url: ${WEBSOCKET_URL})`);
    store.dispatch({ type: 'user/WEBSOCKET_ERROR', payload: message });
}

function handleSocketMessage(data: any) {
    try {
        const parsedData: SocketData = JSON.parse(data);
        switch (parsedData.cmd) {
            case 'MSG':
                store.dispatch({ type: 'user/RECV_MESSAGE', payload: parsedData.data });
                PushNotification.localNotification({
                    channelId: 'Messages',
                    title: `Message from ${parsedData.data.sender}`,
                    message: parsedData.data?.message || '',
                    when: parsedData.data.sent_at ? new Date(parsedData.data.sent_at).getTime() : Date.now(),
                    visibility: 'private',
                    picture: getAvatar(parsedData.data.sender_id),
                    largeIcon: 'foxtrot',
                    smallIcon: 'foxtrot',
                });
                break;
            case 'CALL_OFFER':
                logger.debug('[Websocket] CALL_OFFER Recieved', parsedData.data?.sender);

                const userState = store.getState().userReducer;
                let caller = userState.contacts.find(con => con.phone_no === parsedData.data.sender);
                if (!caller) {
                    caller = {
                        id: parsedData.data.sender_id,
                        phone_no: parsedData.data.sender,
                        last_seen: Date.now(),
                        online: true,
                    };
                }
                store.dispatch({ type: 'user/RECV_CALL_OFFER', payload: { offer: parsedData.data?.offer, caller: caller } });

                // Don't ring if offer was cached and received after app open on answer event
                if (parsedData.data.ring === false) {
                    break;
                }
                // Ring and show notification
                InCallManager.startRingtone('_DEFAULT_', VibratePattern, '', 20);
                RNNotificationCall.displayNotification(QuickCrypto.randomUUID(), caller.pic || getAvatar(caller.id), 30000, {
                    channelId: 'com.foxtrot.callNotifications',
                    channelName: 'Notifications for incoming calls',
                    notificationIcon: '@mipmap/foxtrot', // mipmap
                    notificationTitle: caller?.phone_no || 'Unknown User',
                    notificationBody: `Incoming ${parsedData.data.type || 'audio'} call`,
                    answerText: 'Answer',
                    declineText: 'Decline',
                    notificationColor: 'colorAccent',
                    payload: { caller: caller, data: parsedData.data },
                    isVideo: parsedData.data.type === 'video',
                    // notificationSound: 'skype_ring',
                    // mainComponent: "CallScreen"
                });
                break;
            case 'CALL_ANSWER':
                logger.debug('[Websocket] CALL_ANSWER Recieved', parsedData.data?.sender);
                callManager.onCallAnswer(parsedData.data?.answer);
                break;
            case 'CALL_ICE_CANDIDATE':
                logger.debug('[Websocket] RECV_CALL_ICE_CANDIDATE Recieved', parsedData.data?.sender);
                callManager.onIceCandidate(parsedData.data?.candidate);
                break;
            default:
                logger.debug('[Websocket] RECV unknown command from', parsedData.data?.sender, parsedData.cmd);
        }
    } catch (err: any) {
        logger.error('[Websocket] RECV error:', err);
    }
}
