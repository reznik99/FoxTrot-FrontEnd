import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, Vibration, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import RNFS from 'react-native-fs';
import { launchImageLibrary } from 'react-native-image-picker';
import { FAB, Icon, Modal, Portal, useTheme } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { useSelector } from 'react-redux';

import FullScreenMedia from '~/components/FullScreenMedia';
import Message, { MessageContextMenuData } from '~/components/Message';
import MessageContextMenu from '~/components/MessageContextMenu';
import Messaging from '~/components/Messaging';
import SwipeableMessage from '~/components/SwipeableMessage';
import { dbGetMessages } from '~/global/database';
import { logger } from '~/global/logger';
import { HomeStackParamList } from '~/global/navigation';
import { DB_MSG_PAGE_SIZE, SECONDARY, TEXT_MUTED } from '~/global/variables';
import { getMediaCachePath, uploadMedia } from '~/store/actions/media';
import { sendMessage } from '~/store/actions/user';
import { APPEND_OLDER_MESSAGES, MARK_MESSAGES_SEEN, message } from '~/store/reducers/user';
import { RootState, store } from '~/store/store';

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
    const [contextMenuData, setContextMenuData] = useState<MessageContextMenuData | null>(null);
    const [replyTarget, setReplyTarget] = useState<{ messageId: number; preview: string } | null>(null);
    const [hasMore, setHasMore] = useState(conversation.messages.length >= DB_MSG_PAGE_SIZE);
    const paginationRef = useRef({
        loading: false,
        hasMore: conversation.messages.length >= DB_MSG_PAGE_SIZE,
        offset: conversation.messages.length,
    });

    // Mark unseen received messages as seen when conversation is opened
    useEffect(() => {
        const unseenIds = conversation.messages
            .filter(msg => !msg.seen && msg.sender !== user_data.phone_no)
            .map(msg => msg.id);
        if (unseenIds.length > 0) {
            store.dispatch(MARK_MESSAGES_SEEN({ conversationId: peer.phone_no, messageIds: unseenIds }));
        }
    }, [conversation.messages, user_data.phone_no, peer.phone_no]);

    const listRef = useRef<FlashListRef<message>>(null);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);

    const scrollToBottom = useCallback(() => {
        // Inverted list: index 0 is the newest message (bottom). scrollToIndex is virtualization-aware;
        // scrollToOffset under-shoots when the bottom isn't currently rendered.
        listRef.current?.scrollToIndex({ index: 0, animated: true });
    }, []);

    const getMessageById = useCallback(
        (id: number): message | undefined => {
            return conversation.messages.find(m => m.id === id);
        },
        [conversation.messages],
    );

    const handleSwipeReply = useCallback((item: message) => {
        Vibration.vibrate(30);
        let preview = 'Encrypted message';
        if (item.is_decrypted) {
            try {
                const parsed = JSON.parse(item.message);
                preview = (parsed.message || parsed.type || 'Message').slice(0, 60);
            } catch {
                preview = item.message.slice(0, 60);
            }
        }
        setReplyTarget({ messageId: item.id, preview });
    }, []);

    const handleScrollToMessage = useCallback(
        (messageId: number) => {
            const index = conversation.messages.findIndex(m => m.id === messageId);
            if (index === -1) {
                Toast.show({
                    type: 'info',
                    text1: 'Message not loaded',
                    text2: 'Scroll up to find older messages',
                    visibilityTime: 2000,
                });
                return;
            }
            listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
        },
        [conversation.messages],
    );

    const cancelReply = useCallback(() => setReplyTarget(null), []);

    const handleLongPress = useCallback((data: MessageContextMenuData) => {
        Vibration.vibrate(50);
        setContextMenuData(data);
    }, []);

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

        // Restore the input if the send fails (sendMessage returns false; it shows its own error toast)
        const savedInputMessage = inputMessage.trim();
        const savedReplyTarget = replyTarget;
        try {
            setLoading(true);
            setInputMessage('');

            const toSend = savedReplyTarget
                ? JSON.stringify({ type: 'REPLY', message: savedInputMessage, messageId: savedReplyTarget.messageId })
                : JSON.stringify({ type: 'MSG', message: savedInputMessage });
            setReplyTarget(null);
            const sent = await store.dispatch(sendMessage({ message: toSend, to_user: peer })).unwrap();
            if (!sent) throw new Error('Message send failed');
        } catch (err) {
            logger.error('Error sending message:', err);
            setInputMessage(savedInputMessage);
            setReplyTarget(savedReplyTarget);
        } finally {
            setLoading(false);
        }
    }, [inputMessage, peer, replyTarget]);

    const handleSendReaction = useCallback(
        async (emoji: string, targetMessageId: number) => {
            try {
                const toSend = JSON.stringify({ type: 'REPLY', message: emoji, messageId: targetMessageId });
                await store.dispatch(sendMessage({ message: toSend, to_user: peer }));
            } catch (err) {
                logger.error('Error sending reaction:', err);
            }
        },
        [peer],
    );

    const handleSendAudio = useCallback(
        async (filePath: string, duration: number) => {
            if (!filePath.trim()) return;

            try {
                setLoading(true);

                const { objectKey, keyBase64, ivBase64 } = await store
                    .dispatch(uploadMedia({ filePath, contentType: 'audio/mp4' }))
                    .unwrap();

                // Move source file into media cache so sent audio is playable without re-downloading
                RNFS.moveFile(filePath.replace('file://', ''), getMediaCachePath(objectKey)).catch(err =>
                    logger.warn('Failed to pre-cache sent audio:', err),
                );

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
            <View style={styles.listWrapper}>
                <FlashList
                    ref={listRef}
                    inverted
                    // Auto-scroll to new messages when the user is near the bottom
                    maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 0.25 }}
                    removeClippedSubviews={false}
                    contentContainerStyle={styles.messageList}
                    data={conversation.messages}
                    keyExtractor={t => t.id.toString()}
                    onEndReached={loadMoreMessages}
                    onEndReachedThreshold={0}
                    scrollEventThrottle={16}
                    onScroll={e => {
                        // Inverted: contentOffset.y grows as you scroll up away from the newest message.
                        const show = e.nativeEvent.contentOffset.y > 250;
                        if (show !== showScrollToBottom) setShowScrollToBottom(show);
                    }}
                    ListEmptyComponent={renderListEmpty}
                    ListHeaderComponent={renderListFooter}
                    ListFooterComponent={renderListHeader}
                    renderItem={({ item }) => {
                        const isSent = item.sender === user_data.phone_no;
                        return (
                            <SwipeableMessage
                                isSent={isSent}
                                isSystem={!!item.system}
                                onSwipeReply={() => handleSwipeReply(item)}
                            >
                                <Message
                                    key={item.id}
                                    item={item}
                                    peer={peer}
                                    isSent={isSent}
                                    zoomMedia={setZoomMedia}
                                    onLongPress={handleLongPress}
                                    getMessageById={getMessageById}
                                    onReplyPreviewPress={handleScrollToMessage}
                                    conversationId={peer.phone_no}
                                    primaryColor={colors.primary}
                                />
                            </SwipeableMessage>
                        );
                    }}
                />
                <FAB
                    icon="chevron-down"
                    size="small"
                    color={colors.primary}
                    visible={showScrollToBottom}
                    onPress={scrollToBottom}
                    style={styles.scrollToBottomFab}
                />
            </View>
            {/* Messaging controls */}
            <Messaging
                loading={loading}
                inputMessage={inputMessage}
                setInputMessage={setInputMessage}
                handleCameraSelect={handleCameraSelect}
                handleImageSelect={handleImageSelect}
                handleSend={handleSend}
                handleSendAudio={handleSendAudio}
                replyTarget={replyTarget}
                onCancelReply={cancelReply}
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
            {/* Message context menu */}
            <Portal>
                <Modal
                    visible={!!contextMenuData}
                    onDismiss={() => setContextMenuData(null)}
                    contentContainerStyle={styles.contextMenuModal}
                >
                    {contextMenuData && (
                        <MessageContextMenu
                            data={contextMenuData}
                            onDismiss={() => setContextMenuData(null)}
                            onReact={handleSendReaction}
                            onReply={(messageId, preview) => {
                                setReplyTarget({ messageId, preview });
                                setContextMenuData(null);
                            }}
                        />
                    )}
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
    listWrapper: {
        flex: 1,
    },
    scrollToBottomFab: {
        position: 'absolute',
        right: 12,
        bottom: 12,
        backgroundColor: '#333333', // received-message grey, opaque
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
    contextMenuModal: {
        justifyContent: 'flex-end',
        marginBottom: 40,
    },
});
