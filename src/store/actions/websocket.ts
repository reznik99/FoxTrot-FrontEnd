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

export function initializeWebsocket() {
    return async (dispatch: AppDispatch, getState: GetState) => {
        try {
            dispatch({ type: 'user/SET_LOADING', payload: true });

            const state = getState().userReducer;
            if (!state.token) {
                throw new Error('Token is not present. Re-auth required');
            }

            // Already opened so return early
            if (state.socketConn) {
                state.socketConn.close();
            }

            // Enstablish websocket
            const socketConn = new WebSocket(`${WEBSOCKET_URL}?token=${state.token}`);
            socketConn.onopen = () => {
                console.debug('Socket to server opened succesfully');
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
                console.debug('Websocket connection has been closed gracefully');
            };
            socketConn.onerror = (err: any) => {
                console.error('Websocket err:', err);
                Toast.show({
                    type: 'error',
                    text1: 'Connection to Servers Lost! Please restart FoxTrot',
                    text2: err.message || err,
                    visibilityTime: 5000,
                });
                dispatch({ type: 'user/WEBSOCKET_ERROR', payload: err });
            };
            socketConn.onmessage = event => {
                handleSocketMessage(event.data, dispatch, getState);
            };
            dispatch({ type: 'user/WEBSOCKET_CONNECT', payload: socketConn });
        } catch (err) {
            console.error('Error establishing websocket:', err);
        } finally {
            dispatch({ type: 'user/SET_LOADING', payload: false });
        }
    };
}

export function destroyWebsocket() {
    return async (dispatch: AppDispatch, getState: GetState) => {
        try {
            const state = getState().userReducer;

            // Close existing socket
            if (state.socketConn) {
                state.socketConn.close();
            }

            dispatch({ type: 'user/WEBSOCKET_CONNECT', payload: null });
        } catch (err) {
            console.warn('Error destroying websocket: ', err);
        }
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

                const state = getState().userReducer;
                let caller = state.contacts.find(con => con.phone_no === parsedData.data.sender);
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
