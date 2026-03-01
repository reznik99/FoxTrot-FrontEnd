import { AppState, NativeEventSubscription } from 'react-native';
import NetInfo, { NetInfoSubscription, NetInfoState } from '@react-native-community/netinfo';
import { VibratePattern, WEBSOCKET_URL } from '~/global/variables';
import PushNotification from 'react-native-push-notification';
import InCallManager from 'react-native-incall-manager';
import RNNotificationCall from 'react-native-full-screen-notification-incoming-call';
import QuickCrypto from 'react-native-quick-crypto';
import Toast from 'react-native-toast-message';

import { AppDispatch, GetState } from '../store';
import { getAvatar } from '~/global/helper';
import { logger } from '~/global/logger';

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

// Module-level state (not Redux — timers, flags, subscriptions)
const mgr = {
    intentionalClose: false,
    reconnectAttempt: 0,
    reconnectTimer: null as ReturnType<typeof setTimeout> | null,
    appStateSub: null as NativeEventSubscription | null,
    netInfoSub: null as NetInfoSubscription | null,
    lastNetConnected: null as boolean | null,
};

// --- Helpers ---

function isSocketDead(getState: GetState): boolean {
    const sock = getState().userReducer.socketConn;
    return !sock || sock.readyState === WebSocket.CLOSED || sock.readyState === WebSocket.CLOSING;
}

function clearReconnectTimer() {
    if (mgr.reconnectTimer) {
        clearTimeout(mgr.reconnectTimer);
        mgr.reconnectTimer = null;
    }
}

function reconnectNow(dispatch: AppDispatch) {
    mgr.reconnectAttempt = 0;
    clearReconnectTimer();
    dispatch(connectWebsocket());
}

// --- Public API ---

export function startWebsocketManager() {
    return async (dispatch: AppDispatch, getState: GetState) => {
        await dispatch(connectWebsocket());

        mgr.appStateSub?.remove();
        mgr.appStateSub = AppState.addEventListener('change', nextState => {
            handleAppStateChange(nextState, dispatch, getState);
        });

        mgr.netInfoSub?.();
        mgr.netInfoSub = NetInfo.addEventListener(state => {
            handleNetInfoChange(state, dispatch, getState);
        });
    };
}

export function stopWebsocketManager() {
    return async (dispatch: AppDispatch, getState: GetState) => {
        clearReconnectTimer();

        mgr.appStateSub?.remove();
        mgr.appStateSub = null;
        mgr.netInfoSub?.();
        mgr.netInfoSub = null;
        mgr.lastNetConnected = null;
        mgr.reconnectAttempt = 0;

        mgr.intentionalClose = true;
        const { socketConn } = getState().userReducer;
        if (socketConn && socketConn.readyState !== WebSocket.CLOSED) {
            socketConn.close();
        }
        dispatch({ type: 'user/WEBSOCKET_CONNECT', payload: null });
        dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'disconnected' });
    };
}

export function resetCallState() {
    return async (dispatch: AppDispatch) => {
        try {
            dispatch({ type: 'user/RESET_CALL_ICE_CANDIDATES', payload: undefined });
            dispatch({ type: 'user/RECV_CALL_ANSWER', payload: undefined });
            dispatch({ type: 'user/RECV_CALL_OFFER', payload: undefined });
        } catch (err) {
            logger.warn('Error resetCallState: ', err);
        }
    };
}

// --- connect & reconnect ---

function connectWebsocket() {
    return async (dispatch: AppDispatch, getState: GetState) => {
        try {
            const { token, socketConn } = getState().userReducer;
            if (!token) {
                throw new Error('Token is not present. Re-auth required');
            }

            // Close existing socket without triggering reconnect
            if (socketConn && socketConn.readyState !== WebSocket.CLOSED) {
                mgr.intentionalClose = true;
                socketConn.close();
            }

            dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'connecting' });
            const ws = new WebSocket(`${WEBSOCKET_URL}?token=${token}`);

            const socketId: number = (ws as any)._socketId;
            ws.onopen = () => handleSocketOpen(dispatch);
            ws.onclose = () => handleSocketClose(dispatch, getState, socketId);
            ws.onerror = (err: any) => handleSocketError(err, dispatch);
            ws.onmessage = event => handleSocketMessage(event.data, dispatch, getState);
            dispatch({ type: 'user/WEBSOCKET_CONNECT', payload: ws });
        } catch (err) {
            logger.error('Error establishing websocket:', err);
            dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'reconnecting' });
            scheduleReconnect(dispatch);
        }
    };
}

async function scheduleReconnect(dispatch: AppDispatch) {
    clearReconnectTimer();

    if (mgr.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        logger.warn('Max reconnect attempts reached');
        dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'disconnected' });
        dispatch({ type: 'user/WEBSOCKET_ERROR', payload: 'Unable to reconnect. Please check your connection.' });
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
        dispatch(connectWebsocket());
    }, finalDelay);
}

// --- AppState & NetInfo handlers ---

function handleAppStateChange(nextState: string, dispatch: AppDispatch, getState: GetState) {
    if (nextState === 'background') {
        const { socketConn, callOffer, callAnswer } = getState().userReducer;
        if (callOffer || callAnswer) {
            logger.debug('App backgrounded, keeping socket open for active call');
            return;
        }
        logger.debug('App backgrounded, closing socket');
        if (socketConn && socketConn.readyState === WebSocket.OPEN) {
            mgr.intentionalClose = true;
            socketConn.close();
        }
    } else if (nextState === 'active') {
        if (isSocketDead(getState)) {
            logger.debug('App foregrounded, reconnecting');
            reconnectNow(dispatch);
        }
    }
}

function handleNetInfoChange(state: NetInfoState, dispatch: AppDispatch, getState: GetState) {
    const wasConnected = mgr.lastNetConnected;
    mgr.lastNetConnected = state.isConnected;

    if (!state.isConnected) {
        clearReconnectTimer();
        return;
    }

    if (wasConnected === false && isSocketDead(getState)) {
        logger.debug('Network restored, reconnecting WebSocket');
        reconnectNow(dispatch);
    }
}

// --- WebSocket event handlers ---

function handleSocketOpen(dispatch: AppDispatch) {
    logger.debug('[WebSocket] opened successfully');
    mgr.intentionalClose = false;
    mgr.reconnectAttempt = 0;
    dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'connected' });
    PushNotification.createChannel(
        {
            channelId: 'Messages',
            channelName: 'Notifications for incoming messages',
            channelDescription: 'Notifications for incoming messages',
        },
        () => {},
    );
}

function handleSocketClose(dispatch: AppDispatch, getState: GetState, closedSocketId: number) {
    const currentSocket = getState().userReducer.socketConn;
    if (currentSocket && (currentSocket as any)._socketId !== closedSocketId) {
        logger.debug('[WebSocket] stale close event, ignoring');
        return;
    }

    logger.debug('[WebSocket] closed');
    dispatch({ type: 'user/WEBSOCKET_CONNECT', payload: null });

    if (mgr.intentionalClose) {
        mgr.intentionalClose = false;
        dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'disconnected' });
        return;
    }

    dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'reconnecting' });
    scheduleReconnect(dispatch);
}

function handleSocketError(err: any, dispatch: AppDispatch) {
    const message = err?.message || err?.type || 'Connection error';
    logger.error('[WebSocket] error:', message);
    dispatch({ type: 'user/WEBSOCKET_ERROR', payload: message });
}

function handleSocketMessage(data: any, dispatch: AppDispatch, getState: GetState) {
    try {
        const parsedData: SocketData = JSON.parse(data);
        switch (parsedData.cmd) {
            case 'MSG':
                dispatch({ type: 'user/RECV_MESSAGE', payload: parsedData.data });
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

                const userState = getState().userReducer;
                let caller = userState.contacts.find(con => con.phone_no === parsedData.data.sender);
                if (!caller) {
                    caller = {
                        id: parsedData.data.sender_id,
                        phone_no: parsedData.data.sender,
                        last_seen: Date.now(),
                        online: true,
                    };
                }
                dispatch({ type: 'user/RECV_CALL_OFFER', payload: { offer: parsedData.data?.offer, caller: caller } });

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
                dispatch({ type: 'user/RECV_CALL_ANSWER', payload: parsedData.data?.answer });
                break;
            case 'CALL_ICE_CANDIDATE':
                logger.debug('[Websocket] RECV_CALL_ICE_CANDIDATE Recieved', parsedData.data?.sender);
                dispatch({ type: 'user/RECV_CALL_ICE_CANDIDATE', payload: parsedData.data?.candidate });
                break;
            default:
                logger.debug('[Websocket] RECV unknown command from', parsedData.data?.sender, parsedData.cmd);
        }
    } catch (err: any) {
        logger.error('[Websocket] RECV error:', err);
    }
}
