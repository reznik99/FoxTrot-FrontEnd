import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, FlatList, RefreshControl, Text, Image, StyleSheet } from 'react-native';
import { Divider, FAB, ActivityIndicator, Snackbar, Icon, useTheme } from 'react-native-paper';
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
import { SECONDARY_LITE } from '~/global/variables';
import { logger } from '~/global/logger';
import globalStyle from '~/global/style';

export default function Home() {
    const navigation = useNavigation<RootNavigation>();
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const [loadingMsg, setLoadingMsg] = useState('');

    const conversations = useSelector((state: RootState) => state.userReducer.conversations);
    const loading = useSelector((state: RootState) => state.userReducer.loading);
    const refreshing = useSelector((state: RootState) => state.userReducer.refreshing);
    const socketStatus = useSelector((state: RootState) => state.userReducer.socketStatus);
    const socketErr = useSelector((state: RootState) => state.userReducer.socketErr);

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

    const onRefresh = useCallback(() => {
        loadMessagesAndContacts().finally(() => setLoadingMsg(''));
    }, [loadMessagesAndContacts]);

    const renderListEmpty = useCallback(
        () => (
            <View style={styles.emptyContainer}>
                <Icon source="message-text-outline" size={64} color={SECONDARY_LITE} />
                <Text style={styles.emptyText}>No conversations yet</Text>
            </View>
        ),
        [],
    );

    if (loading || loadingMsg) {
        return (
            <View style={globalStyle.wrapper}>
                <View style={styles.loadingContainer}>
                    <Text style={styles.loadingText}>{loadingMsg}</Text>
                    <ActivityIndicator size="large" />
                </View>
            </View>
        );
    }

    return (
        <View style={globalStyle.wrapper}>
            {socketStatus === 'reconnecting' && (
                <Snackbar visible={true} style={styles.snackbar} onDismiss={() => {}}>
                    Reconnecting to server...
                </Snackbar>
            )}
            {socketStatus === 'disconnected' && !!socketErr && (
                <Snackbar
                    visible={true}
                    style={styles.snackbar}
                    onDismiss={() => {}}
                    action={{
                        label: 'Reconnect',
                        onPress: () => store.dispatch(startWebsocketManager()),
                    }}
                >
                    Connection to servers lost! Please try again later
                </Snackbar>
            )}

            <Image source={require('../../../assets/bootsplash/logo.png')} style={styles.watermark} />
            <FlatList
                data={convos}
                keyExtractor={(item, index) => item.other_user.phone_no || String(index)}
                renderItem={({ item }) => <ConversationPeek data={item} navigation={navigation} />}
                ItemSeparatorComponent={Divider}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                ListEmptyComponent={renderListEmpty}
            />

            <FAB
                color="#fff"
                style={[
                    globalStyle.fab,
                    { backgroundColor: colors.primary, marginBottom: globalStyle.fab.margin + insets.bottom },
                ]}
                onPress={() => navigation.navigate('NewConversation')}
                icon="pencil"
            />
        </View>
    );
}

const styles = StyleSheet.create({
    watermark: {
        position: 'absolute',
        width: 200,
        height: 200,
        alignSelf: 'center',
        top: '40%',
        opacity: 0.08,
    },
    snackbar: {
        zIndex: 100,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        color: 'white',
        textAlign: 'center',
        fontSize: 20,
        paddingVertical: 20,
        marginBottom: 10,
    },
    emptyContainer: {
        alignItems: 'center',
        marginTop: 80,
    },
    emptyText: {
        color: SECONDARY_LITE,
        fontSize: 16,
        marginTop: 12,
    },
});
