import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View, Vibration } from 'react-native';
import { Icon, Modal, Portal, useTheme } from 'react-native-paper';
import { useSelector } from 'react-redux';
import { launchImageLibrary } from 'react-native-image-picker';
import { FlashList } from '@shopify/flash-list';
import { StackScreenProps } from '@react-navigation/stack';

import FullScreenMedia from '~/components/FullScreenMedia';
import Message from '~/components/Message';
import Messaging from '~/components/Messaging';
import { SECONDARY, TEXT_MUTED, DB_MSG_PAGE_SIZE } from '~/global/variables';

import { message, MARK_MESSAGES_SEEN, APPEND_OLDER_MESSAGES } from '~/store/reducers/user';
import { RootState, store } from '~/store/store';
import { sendMessage } from '~/store/actions/user';
import { uploadMedia } from '~/store/actions/media';
import { dbGetMessages } from '~/global/database';
import { HomeStackParamList } from '~/../App';
import { logger } from '~/global/logger';

export default function Conversation(props: StackScreenProps<HomeStackParamList, 'Conversation'>) {
    const { colors } = useTheme();
    const { peer_user } = props.route.params.data;

    const fallbackConversation = useMemo(() => ({ messages: [] as message[], other_user: peer_user }), [peer_user]);
    const user_data = useSelector((state: RootState) => state.userReducer.user_data);
    const conversation =
        useSelector((state: RootState) => state.userReducer.conversations.get(peer_user.phone_no)) ?? fallbackConversation;
    const peer =
        useSelector((state: RootState) =>
            state.userReducer.contacts.find(contact => String(contact.id) === String(peer_user.id)),
        ) || peer_user;

    const [loading, setLoading] = useState(false);
    const [inputMessage, setInputMessage] = useState('');
    const [zoomMedia, setZoomMedia] = useState('');
    const [hasMore, setHasMore] = useState(conversation.messages.length >= DB_MSG_PAGE_SIZE);
    const paginationRef = useRef({
        loading: false,
        hasMore: conversation.messages.length >= DB_MSG_PAGE_SIZE,
        offset: conversation.messages.length,
    });

    // Mark unseen decrypted received messages as seen
    useEffect(() => {
        const unseenIds = conversation.messages
            .filter(msg => !msg.seen && msg.is_decrypted && msg.sender !== user_data.phone_no)
            .map(msg => msg.id);
        if (unseenIds.length > 0) {
            store.dispatch(MARK_MESSAGES_SEEN({ conversationId: peer.phone_no, messageIds: unseenIds }));
        }
    }, [conversation.messages, user_data.phone_no, peer.phone_no]);

    // Memoize the reversed messages
    const reversedMessages = useMemo(() => {
        return [...conversation.messages].reverse();
    }, [conversation.messages]);

    const loadMoreMessages = useCallback(() => {
        const pg = paginationRef.current;
        if (pg.loading || !pg.hasMore) return;

        pg.loading = true;
        Vibration.vibrate();
        try {
            const olderMessages = dbGetMessages(peer.phone_no, DB_MSG_PAGE_SIZE, pg.offset);
            if (olderMessages.length === 0) {
                pg.hasMore = false;
                setHasMore(false);
                return;
            }
            store.dispatch(
                APPEND_OLDER_MESSAGES({
                    conversationId: peer.phone_no,
                    messages: olderMessages,
                }),
            );
            pg.offset += olderMessages.length;
            if (olderMessages.length < DB_MSG_PAGE_SIZE) {
                pg.hasMore = false;
                setHasMore(false);
            }
        } catch (err) {
            logger.error('Error loading more messages:', err);
        } finally {
            pg.loading = false;
        }
    }, [peer.phone_no]);

    const handleSend = useCallback(async () => {
        if (inputMessage.trim() === '') return;

        try {
            setLoading(true);
            setInputMessage('');

            const toSend = JSON.stringify({
                type: 'MSG',
                message: inputMessage.trim(),
            });
            await store.dispatch(sendMessage({ message: toSend, to_user: peer }));
        } catch (err) {
            logger.error('Error sending message:', err);
        } finally {
            setLoading(false);
        }
    }, [inputMessage, peer]);

    const handleSendAudio = useCallback(
        async (filePath: string, duration: number) => {
            if (!filePath.trim()) return;

            try {
                setLoading(true);

                const { objectKey, keyBase64, ivBase64 } = await store
                    .dispatch(uploadMedia({ filePath, contentType: 'audio/mp4' }))
                    .unwrap();

                const toSend = JSON.stringify({
                    type: 'AUDIO',
                    objectKey,
                    fileKey: keyBase64,
                    fileIv: ivBase64,
                    mimeType: 'audio/mp4',
                    duration: duration,
                });
                await store.dispatch(sendMessage({ message: toSend, to_user: peer }));
            } catch (err) {
                logger.error('Error sending audio:', err);
            } finally {
                setLoading(false);
            }
        },
        [peer],
    );

    const handleImageSelect = useCallback(async () => {
        try {
            setLoading(true);
            const { didCancel, assets } = await launchImageLibrary({
                mediaType: 'mixed',
                quality: 0.3,
                maxWidth: 1600,
                maxHeight: 1600,
            });
            if (didCancel || !assets?.length) return;

            const asset = assets[0];
            const isVideo = asset.type?.startsWith('video');

            // Render Camera page pre-filled with selected media
            props.navigation.navigate('CameraView', {
                data: { peer: peer, mediaPath: asset.uri!, mediaType: isVideo ? 'video' : 'image' },
            });
        } catch (err) {
            logger.error('Error selecting gallery media:', err);
        } finally {
            setLoading(false);
        }
    }, [props.navigation, peer]);

    const handleCameraSelect = useCallback(async () => {
        // Render Camera page
        props.navigation.navigate('CameraView', { data: { peer: peer, mediaPath: '' } });
    }, [props.navigation, peer]);

    const renderListEmpty = useCallback(
        () => (
            <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                <Icon source="message-text-outline" size={40} color="#969393" />
                <Text style={{ color: TEXT_MUTED, marginTop: 8 }}>No messages yet</Text>
            </View>
        ),
        [],
    );

    const renderListHeader = useCallback(() => {
        if (!hasMore) return null;
        return (
            <View style={styles.footer}>
                <Text style={{ color: TEXT_MUTED }}>Scroll up to load more</Text>
            </View>
        );
    }, [hasMore]);

    const renderListFooter = useCallback(
        () => (
            <View style={styles.footer}>
                <Icon source="shield-lock" color={colors.primary} size={20} />
                <Text style={{ color: 'white' }}> Messages are end-to-end encrypted</Text>
            </View>
        ),
        [colors.primary],
    );

    return (
        <View style={styles.container}>
            {/* Message list */}
            <FlashList
                removeClippedSubviews={false}
                contentContainerStyle={styles.messageList}
                data={reversedMessages}
                maintainVisibleContentPosition={{
                    autoscrollToBottomThreshold: 0.25,
                    startRenderingFromBottom: true,
                }}
                keyExtractor={t => t.id.toString()}
                onStartReached={loadMoreMessages}
                onStartReachedThreshold={0}
                ListEmptyComponent={renderListEmpty}
                ListHeaderComponent={renderListHeader}
                ListFooterComponent={renderListFooter}
                renderItem={({ item }) => (
                    <Message
                        item={item}
                        peer={peer}
                        isSent={item.sender === user_data.phone_no}
                        zoomMedia={setZoomMedia}
                        conversationId={peer.phone_no}
                        primaryColor={colors.primary}
                    />
                )}
            />
            {/* Messaging controls */}
            <Messaging
                loading={loading}
                inputMessage={inputMessage}
                setInputMessage={setInputMessage}
                handleCameraSelect={handleCameraSelect}
                handleImageSelect={handleImageSelect}
                handleSend={handleSend}
                handleSendAudio={handleSendAudio}
            />
            {/* Media viewer */}
            <Portal>
                <Modal
                    visible={!!zoomMedia}
                    onDismiss={() => setZoomMedia('')}
                    contentContainerStyle={{ width: '100%', height: '100%' }}
                >
                    {zoomMedia && <FullScreenMedia media={zoomMedia} onDismiss={() => setZoomMedia('')} />}
                </Modal>
            </Portal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        width: '100%',
        backgroundColor: SECONDARY,
    },
    messageList: {
        paddingHorizontal: 10,
    },
    footer: {
        width: '100%',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 8,
        marginVertical: 5,
        backgroundColor: '#333333a0',
        borderRadius: 10,
    },
});
