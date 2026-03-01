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

// --- Module-level state (not in Redux — timers, flags, subscriptions) ---
let intentionalClose = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSubscription: NativeEventSubscription | null = null;
let netInfoSubscription: NetInfoSubscription | null = null;
let lastNetInfoConnected: boolean | null = null;

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const BACKGROUND_GRACE_MS = 60_000; // 60s before closing socket in background

// --- Public API ---

export function startWebsocketManager() {
    return async (dispatch: AppDispatch, getState: GetState) => {
        // Connect
        await dispatch(connectWebsocket());

        // Listen to AppState changes (background/foreground)
        appStateSubscription?.remove();
        appStateSubscription = AppState.addEventListener('change', nextState => {
            handleAppStateChange(nextState, dispatch, getState);
        });

        // Listen to network connectivity changes
        netInfoSubscription?.();
        netInfoSubscription = NetInfo.addEventListener(state => {
            handleNetInfoChange(state, dispatch, getState);
        });
    };
}

export function stopWebsocketManager() {
    return async (dispatch: AppDispatch, getState: GetState) => {
        // Cancel pending timers
        clearReconnectTimer();
        clearBackgroundTimer();

        // Remove listeners
        appStateSubscription?.remove();
        appStateSubscription = null;
        netInfoSubscription?.();
        netInfoSubscription = null;
        lastNetInfoConnected = null;

        // Close socket intentionally
        intentionalClose = true;
        const state = getState().userReducer;
        if (state.socketConn && state.socketConn.readyState !== WebSocket.CLOSED) {
            state.socketConn.close();
        }
        dispatch({ type: 'user/WEBSOCKET_CONNECT', payload: null });
        dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'disconnected' });

        // Reset reconnect state
        reconnectAttempt = 0;
    };
}

export function resetCallState() {
    return async (dispatch: AppDispatch) => {
        try {
            dispatch({ type: 'user/RESET_CALL_ICE_CANDIDATES', payload: undefined });
            dispatch({ type: 'user/RECV_CALL_ANSWER', payload: undefined });
            dispatch({ type: 'user/RECV_CALL_OFFER', payload: undefined });
        } catch (err) {
            console.warn('Error resetCallState: ', err);
        }
    };
}

// --- Internal ---

function connectWebsocket() {
    return async (dispatch: AppDispatch, getState: GetState) => {
        try {
            const state = getState().userReducer;
            if (!state.token) {
                throw new Error('Token is not present. Re-auth required');
            }

            // Close existing socket without triggering reconnect
            if (state.socketConn && state.socketConn.readyState !== WebSocket.CLOSED) {
                intentionalClose = true;
                state.socketConn.close();
            }

            dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'connecting' });

            const socketConn = new WebSocket(`${WEBSOCKET_URL}?token=${state.token}`);

            socketConn.onopen = () => {
                console.debug('Socket to server opened successfully');
                intentionalClose = false;
                reconnectAttempt = 0;
                dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'connected' });
                PushNotification.createChannel(
                    {
                        channelId: 'Messages',
                        channelName: 'Notifications for incoming messages',
                        channelDescription: 'Notifications for incoming messages',
                    },
                    () => {},
                );
            };

            socketConn.onclose = () => {
                console.debug('WebSocket closed');
                dispatch({ type: 'user/WEBSOCKET_CONNECT', payload: null });

                if (intentionalClose) {
                    intentionalClose = false;
                    dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'disconnected' });
                    return;
                }

                // Unexpected close — schedule reconnect
                dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'reconnecting' });
                scheduleReconnect(dispatch);
            };

            socketConn.onerror = (err: any) => {
                console.error('WebSocket error:', err);
                dispatch({ type: 'user/WEBSOCKET_ERROR', payload: err.message || 'Connection error' });
            };

            socketConn.onmessage = event => {
                handleSocketMessage(event.data, dispatch, getState);
            };

            dispatch({ type: 'user/WEBSOCKET_CONNECT', payload: socketConn });
        } catch (err) {
            console.error('Error establishing websocket:', err);
            dispatch({ type: 'user/WEBSOCKET_STATUS', payload: 'reconnecting' });
            scheduleReconnect(dispatch);
        }
    };
}

async function scheduleReconnect(dispatch: AppDispatch) {
    clearReconnectTimer();

    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        console.warn('Max reconnect attempts reached');
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

    // Check network before scheduling — no point retrying without internet
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
        console.debug('No network available, waiting for connectivity to reconnect');
        // NetInfo listener will trigger reconnect when network returns
        return;
    }

    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, reconnectAttempt), MAX_DELAY_MS);
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    const finalDelay = Math.round(delay + jitter);

    console.debug(`Scheduling reconnect attempt ${reconnectAttempt + 1}/${MAX_RECONNECT_ATTEMPTS} in ${finalDelay}ms`);
    reconnectAttempt++;

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        dispatch(connectWebsocket());
    }, finalDelay);
}

function handleAppStateChange(nextState: string, dispatch: AppDispatch, getState: GetState) {
    if (nextState === 'background') {
        // Keep socket open for a grace period (local notifications still work),
        // then close cleanly so server falls back to FCM push
        clearBackgroundTimer();
        backgroundTimer = setTimeout(() => {
            backgroundTimer = null;
            console.debug('Background grace period expired, closing socket');
            const state = getState().userReducer;
            if (state.socketConn && state.socketConn.readyState === WebSocket.OPEN) {
                intentionalClose = true;
                state.socketConn.close();
            }
        }, BACKGROUND_GRACE_MS);
    } else if (nextState === 'active') {
        // App foregrounded — cancel background timer if it hasn't fired
        clearBackgroundTimer();

        // Check if socket is alive; if not, reconnect immediately
        const state = getState().userReducer;
        const sock = state.socketConn;
        if (!sock || sock.readyState === WebSocket.CLOSED || sock.readyState === WebSocket.CLOSING) {
            console.debug('App foregrounded with dead socket, reconnecting');
            reconnectAttempt = 0;
            clearReconnectTimer();
            dispatch(connectWebsocket());
        }
    }
    // 'inactive' is transient (notification shade, app switcher) — ignore
}

function handleNetInfoChange(state: NetInfoState, dispatch: AppDispatch, getState: GetState) {
    const wasConnected = lastNetInfoConnected;
    lastNetInfoConnected = state.isConnected;

    if (!state.isConnected) {
        // Network lost — cancel pending reconnect timers (no point retrying)
        clearReconnectTimer();
        return;
    }

    // Network restored (was disconnected or unknown → now connected)
    if (wasConnected === false) {
        const { socketConn } = getState().userReducer;
        if (!socketConn || socketConn.readyState === WebSocket.CLOSED || socketConn.readyState === WebSocket.CLOSING) {
            console.debug('Network restored, reconnecting WebSocket');
            reconnectAttempt = 0;
            clearReconnectTimer();
            dispatch(connectWebsocket());
        }
    }
}

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function clearBackgroundTimer() {
    if (backgroundTimer) {
        clearTimeout(backgroundTimer);
        backgroundTimer = null;
    }
}

// --- Message handler (unchanged) ---

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
                console.debug('Websocket CALL_OFFER Recieved', parsedData.data?.sender);

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
                console.debug('Websocket CALL_ANSWER Recieved', parsedData.data?.sender);
                dispatch({ type: 'user/RECV_CALL_ANSWER', payload: parsedData.data?.answer });
                break;
            case 'CALL_ICE_CANDIDATE':
                console.debug('Websocket RECV_CALL_ICE_CANDIDATE Recieved', parsedData.data?.sender);
                dispatch({ type: 'user/RECV_CALL_ICE_CANDIDATE', payload: parsedData.data?.candidate });
                break;
            default:
                console.debug('Websocket RECV unknown command from', parsedData.data?.sender, parsedData.cmd);
        }
    } catch (err: any) {
        console.error('Websocket RECV error:', err);
    }
}
