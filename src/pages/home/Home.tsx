import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, ScrollView, RefreshControl, Text } from 'react-native';
import { Divider, FAB, ActivityIndicator, Snackbar, Icon } from 'react-native-paper';
import RNNotificationCall from 'react-native-full-screen-notification-incoming-call';
import InCallManager from 'react-native-incall-manager';
import { useSelector } from 'react-redux';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ConversationPeek from '~/components/ConversationPeek';
import { loadMessages, loadContacts, loadKeys, registerPushNotifications, getTURNServerCreds } from '~/store/actions/user';
import { startWebsocketManager, SocketMessage } from '~/store/actions/websocket';
import { Conversation, UserData } from '~/store/reducers/user';
import { setupInterceptors, RootNavigation } from '~/store/actions/auth';
import { RootState, store } from '~/store/store';
import { popFromStorage, StorageKeys } from '~/global/storage';
import { dbSaveCallRecord } from '~/global/database';
import { PRIMARY } from '~/global/variables';
import { logger } from '~/global/logger';
import globalStyle from '~/global/style';

export default function Home() {
    const navigation = useNavigation<RootNavigation>();
    const insets = useSafeAreaInsets();
    const { conversations, loading, refreshing, socketStatus, socketErr } = useSelector(
        (state: RootState) => state.userReducer,
    );
    const [loadingMsg, setLoadingMsg] = useState('');
    const convos: Array<Conversation> = useMemo(() => {
        return [...conversations.values()].sort((a, b) => {
            const aTime = a.messages?.[0]?.sent_at ? new Date(a.messages[0].sent_at).getTime() : 0;
            const bTime = b.messages?.[0]?.sent_at ? new Date(b.messages[0].sent_at).getTime() : 0;
            return bTime - aTime;
        });
    }, [conversations]);

    useEffect(() => {
        let cleanupCallHandlers: (() => void) | undefined;
        const initLoad = async () => {
            // [background] Register device for push notifications
            store.dispatch(registerPushNotifications());
            // [background] Get TURN credentials for proxying calls if peer-to-peer ICE fails
            store.dispatch(getTURNServerCreds()).then(async () => {
                // Check if user answered a call in the background
                const callerRaw = await popFromStorage(StorageKeys.CALL_ANSWERED_IN_BACKGROUND);
                if (callerRaw) {
                    const data = JSON.parse(callerRaw || '{}') as { caller: UserData; data: SocketMessage };
                    navigation.navigate('Call', {
                        data: {
                            peer_user: data.caller,
                            video_enabled: data.data.type === 'video',
                        },
                    });
                }
            });
            // Register Call Screen handler
            cleanupCallHandlers = registerCallHandlers();
            // Load keys from TPM — if none exist, redirect to key setup
            const loaded = await loadKeypair();
            if (!loaded) {
                setLoadingMsg('');
                navigation.replace('KeySetup');
                return;
            }
            // Load new messages from backend and old messages from storage
            await loadMessagesAndContacts();
            // Setup axios interceptors
            setupInterceptors(navigation);
            setLoadingMsg('');
        };
        initLoad();
        // returned function will be called on component unmount
        return () => {
            cleanupCallHandlers?.();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadMessagesAndContacts = useCallback(async () => {
        setLoadingMsg('Loading contacts & messages...');
        await Promise.all([store.dispatch(loadContacts({ atomic: false })), store.dispatch(loadMessages())]);
    }, []);

    const loadKeypair = useCallback(async () => {
        setLoadingMsg('Loading keys from TPM...');
        const loadedKeys = await store.dispatch(loadKeys()).unwrap();
        return loadedKeys;
    }, []);

    const registerCallHandlers = useCallback(() => {
        RNNotificationCall.addEventListener('answer', info => {
            logger.debug('RNNotificationCall: User answered call', info.callUUID);
            RNNotificationCall.backToApp();
            const data = JSON.parse(info.payload || '{}') as { caller: UserData; data: SocketMessage };
            navigation.navigate('Call', {
                data: {
                    peer_user: data.caller,
                    video_enabled: data.data.type === 'video',
                },
            });
        });
        // endCall only fires when the call is declined or times out (never after answer)
        RNNotificationCall.addEventListener('endCall', info => {
            logger.debug('RNNotificationCall: User ended call', info.callUUID);
            InCallManager.stopRingtone();
            try {
                const data = JSON.parse(info.payload || '{}') as { caller: UserData; data: SocketMessage };
                if (data.caller) {
                    dbSaveCallRecord({
                        peer_phone: data.caller.phone_no,
                        peer_id: String(data.caller.id),
                        peer_pic: data.caller.pic,
                        direction: 'incoming',
                        call_type: data.data?.type || 'audio',
                        status: 'missed',
                        duration: 0,
                        started_at: new Date().toISOString(),
                    });
                }
            } catch (err) {
                logger.error('Failed to save missed call record:', err);
            }
        });
        return () => {
            RNNotificationCall.removeEventListener('answer');
            RNNotificationCall.removeEventListener('endCall');
        };
    }, [navigation]);

    return (
        <View style={globalStyle.wrapper}>
            {socketStatus === 'reconnecting' && (
                <Snackbar visible={true} style={{ zIndex: 100 }} onDismiss={() => {}}>
                    Reconnecting to server...
                </Snackbar>
            )}
            {socketStatus === 'disconnected' && !!socketErr && (
                <Snackbar
                    visible={true}
                    style={{ zIndex: 100 }}
                    onDismiss={() => {}}
                    action={{
                        label: 'Reconnect',
                        onPress: () => store.dispatch(startWebsocketManager()),
                    }}
                >
                    Connection to servers lost! Please try again later
                </Snackbar>
            )}
            {loading || loadingMsg ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={[globalStyle.errorMsg, { color: 'white', marginBottom: 10 }]}>{loadingMsg}</Text>
                    <ActivityIndicator size="large" />
                </View>
            ) : (
                <>
                    <ScrollView
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={() => {
                                    loadMessagesAndContacts().finally(() => setLoadingMsg(''));
                                }}
                            />
                        }
                    >
                        {convos?.length ? (
                            convos.map((convo, index) => (
                                <View key={index}>
                                    <ConversationPeek data={convo} navigation={navigation} />
                                    <Divider />
                                </View>
                            ))
                        ) : (
                            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                                <Text style={[globalStyle.errorMsg, { color: '#fff' }]}>No Conversations.</Text>
                            </View>
                        )}
                    </ScrollView>

                    <FAB
                        color="#fff"
                        style={[
                            globalStyle.fab,
                            { backgroundColor: PRIMARY, marginBottom: globalStyle.fab.margin + insets.bottom },
                        ]}
                        onPress={() => navigation.navigate('NewConversation')}
                        icon={renderFABIcon}
                    />
                </>
            )}
        </View>
    );
}

const renderFABIcon = (props: { size: number; color: string }) => {
    return <Icon source="message" color={props.color} size={props.size} />;
};
