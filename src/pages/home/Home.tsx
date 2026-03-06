import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import RNNotificationCall from 'react-native-full-screen-notification-incoming-call';
import InCallManager from 'react-native-incall-manager';
import { ActivityIndicator, Divider, FAB, Icon, Snackbar, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';

import ConversationPeek from '~/components/ConversationPeek';
import { dbSaveCallRecord, getDb } from '~/global/database';
import { logger } from '~/global/logger';
import { popFromStorage, readFromStorage, StorageKeys } from '~/global/storage';
import globalStyle from '~/global/style';
import { SECONDARY_LITE } from '~/global/variables';
import * as websocketManager from '~/global/websocketManager';
import { SocketMessage } from '~/global/websocketManager';
import { RootNavigation, setupInterceptors } from '~/store/actions/auth';
import { evictMediaCache } from '~/store/actions/media';
import {
    getTURNServerCreds,
    loadContacts,
    loadContactsFromDisk,
    loadKeys,
    loadMessages,
    loadMessagesFromDisk,
    registerPushNotifications,
} from '~/store/actions/user';
import { Conversation, UserData } from '~/store/reducers/user';
import { RootState, store } from '~/store/store';

export default function Home() {
    const navigation = useNavigation<RootNavigation>();
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const [loadingMsg, setLoadingMsg] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const conversations = useSelector((state: RootState) => state.userReducer.conversations);
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
        const initLoad = async () => {
            setLoadingMsg('Registering events...');
            // [background] Setup axios interceptors (before any authenticated API calls)
            setupInterceptors();
            // [background] Register device for push notifications
            store.dispatch(registerPushNotifications());
            // [background] Evict stale media cache if enabled
            readFromStorage(StorageKeys.AUTO_EVICT_CACHE).then(val => {
                if (val === 'true') evictMediaCache();
            });
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
            // Load SQLite databse
            await getDb();

            // Load keys from KeyChain — if none exist, redirect to key setup
            setLoadingMsg('Loading keys from Secure Storage...');
            const loaded = await store.dispatch(loadKeys()).unwrap();
            if (!loaded) {
                setLoadingMsg('');
                navigation.replace('KeySetup');
                return;
            }

            // Load cached data from disk (fast, renders immediately)
            setLoadingMsg('Loading keys from TPM...');
            await Promise.all([store.dispatch(loadMessagesFromDisk()), store.dispatch(loadContactsFromDisk())]);
            setLoadingMsg('');
            // Fetch fresh data from API in background
            setRefreshing(true);
            await Promise.all([store.dispatch(loadContacts({})), store.dispatch(loadMessages())]);
            setRefreshing(false);
        };

        // [background] Register Call Screen handler
        const cleanupCallHandlers = registerCallHandlers();
        initLoad();

        return () => {
            cleanupCallHandlers?.();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await Promise.all([store.dispatch(loadContacts({})), store.dispatch(loadMessages())]);
        setRefreshing(false);
    }, []);

    const renderListEmpty = useCallback(
        () => (
            <View style={styles.emptyContainer}>
                <Icon source="message-text-outline" size={64} color={SECONDARY_LITE} />
                <Text style={styles.emptyText}>No conversations yet</Text>
            </View>
        ),
        [],
    );

    if (loadingMsg) {
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
                        onPress: () => websocketManager.reconnect(),
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
