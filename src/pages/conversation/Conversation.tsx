import React, { PureComponent, useState, useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, Text, Pressable, View, Linking, ToastAndroid, Image, Vibration } from 'react-native';
import { ActivityIndicator, Icon, Modal, Portal } from 'react-native-paper';
import { useSelector } from 'react-redux';
import { launchImageLibrary } from 'react-native-image-picker';
import { FlashList } from '@shopify/flash-list';
import Clipboard from '@react-native-clipboard/clipboard';
import { StackScreenProps } from '@react-navigation/stack';
import Toast from 'react-native-toast-message';

import FullScreenImage from '~/components/FullScreenImage';
import AudioPlayer from '~/components/AudioPlayer';
import Messaging from '~/components/Messaging';
import { DB_MSG_PAGE_SIZE, PRIMARY, SECONDARY } from '~/global/variables';
import { decrypt } from '~/global/crypto';

import {
    message,
    UserData,
    UPDATE_MESSAGE_DECRYPTED,
    MARK_MESSAGES_SEEN,
    APPEND_OLDER_MESSAGES,
} from '~/store/reducers/user';
import { RootState, store } from '~/store/store';
import { sendMessage } from '~/store/actions/user';
import { dbGetMessages } from '~/global/database';
import { HomeStackParamList } from '~/../App';

const todaysDate = new Date().toLocaleDateString();

export default function Conversation(props: StackScreenProps<HomeStackParamList, 'Conversation'>) {
    const { peer_user } = props.route.params.data;

    const conversation = useSelector((state: RootState) => {
        return state.userReducer.conversations.get(peer_user.phone_no) ?? { messages: [], other_user: peer_user };
    });
    const user_data = useSelector((state: RootState) => state.userReducer.user_data);
    const peer =
        useSelector((state: RootState) =>
            state.userReducer.contacts.find(contact => String(contact.id) === String(peer_user.id)),
        ) || peer_user;

    const [loading, setLoading] = useState(false);
    const [inputMessage, setInputMessage] = useState('');
    const [zoomMedia, setZoomMedia] = useState('');
    const [offset, setOffset] = useState(DB_MSG_PAGE_SIZE);
    const [hasMore, setHasMore] = useState(conversation.messages.length >= DB_MSG_PAGE_SIZE);
    const [loadingMore, setLoadingMore] = useState(false);

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

    const loadMoreMessages = useCallback(async () => {
        if (loadingMore || !hasMore) return;

        setLoadingMore(true);
        Vibration.vibrate();
        try {
            // Load previous messages
            const olderMessages = dbGetMessages(peer.phone_no, DB_MSG_PAGE_SIZE, offset);
            if (olderMessages.length === 0) {
                setHasMore(false);
                return;
            }
            // Save in redux
            store.dispatch(
                APPEND_OLDER_MESSAGES({
                    conversationId: peer.phone_no,
                    messages: olderMessages,
                }),
            );
            // Update state
            setOffset(prev => prev + olderMessages.length);
            if (olderMessages.length < DB_MSG_PAGE_SIZE) {
                setHasMore(false);
            }
        } catch (err) {
            console.error('Error loading more messages:', err);
        } finally {
            setLoadingMore(false);
        }
    }, [loadingMore, hasMore, offset, peer.phone_no]);

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
            console.error('Error sending message:', err);
        } finally {
            setLoading(false);
        }
    }, [inputMessage, peer]);

    const handleSendAudio = useCallback(
        async (data: string, duration: number) => {
            if (data.trim() === '') return;

            try {
                setLoading(true);

                const toSend = JSON.stringify({
                    type: 'AUDIO',
                    message: data,
                    duration: duration,
                });
                await store.dispatch(sendMessage({ message: toSend, to_user: peer }));
            } catch (err) {
                console.error('Error sending message:', err);
            } finally {
                setLoading(false);
            }
        },
        [peer],
    );

    const handleImageSelect = useCallback(async () => {
        try {
            setLoading(true);
            const { didCancel, assets } = await launchImageLibrary({ mediaType: 'photo', quality: 0.3 });
            if (didCancel || !assets?.length) return;

            // Render Camera page pre-filled with selected image
            props.navigation.navigate('CameraView', { data: { peer: peer, picturePath: assets[0].uri! } });
        } catch (err) {
            console.error('Error sending gallery image:', err);
        } finally {
            setLoading(false);
        }
    }, [props.navigation, peer]);

    const handleCameraSelect = useCallback(async () => {
        // Render Camera page
        props.navigation.navigate('CameraView', { data: { peer: peer, picturePath: '' } });
    }, [props.navigation, peer]);

    const renderListEmpty = useCallback(
        () => (
            <View>
                <Text style={[styles.message, styles.system]}> No messages </Text>
            </View>
        ),
        [],
    );

    const renderListHeader = useCallback(() => {
        if (loadingMore) {
            return (
                <View style={styles.footer}>
                    <ActivityIndicator size="small" color="#77f777" />
                </View>
            );
        }
        if (hasMore) {
            return (
                <View style={styles.footer}>
                    <Text style={{ color: '#969393' }}>Scroll up to load more</Text>
                </View>
            );
        }
        return null;
    }, [loadingMore, hasMore]);

    const renderListFooter = useCallback(
        () => (
            <View style={styles.footer}>
                <Icon source="lock" color="#77f777" size={20} />
                <Text style={{ color: 'white' }}> Click a message to decrypt it</Text>
            </View>
        ),
        [],
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
                        key={item.id}
                        item={item}
                        peer={peer}
                        isSent={item.sender === user_data.phone_no}
                        zoomMedia={data => setZoomMedia(data)}
                        conversationId={peer.phone_no}
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
                    {zoomMedia && <FullScreenImage media={zoomMedia} onDismiss={() => setZoomMedia('')} />}
                </Modal>
            </Portal>
        </View>
    );
}

type decryptedMessage = {
    type: string;
    message: string;
    duration?: number;
};
type MProps = {
    item: message;
    isSent: boolean;
    peer: UserData;
    zoomMedia: (data: string) => void;
    conversationId: string;
};
type MState = {
    loading: boolean;
    decryptedMessage?: decryptedMessage;
};
class Message extends PureComponent<MProps, MState> {
    constructor(props: MProps) {
        super(props);
        this.state = {
            loading: false,
            decryptedMessage: undefined,
        };
    }

    componentDidMount() {
        // If message was previously decrypted, parse the content
        if (this.props.item.is_decrypted) {
            try {
                this.setState({ decryptedMessage: JSON.parse(this.props.item.message) });
            } catch (err) {
                // Parse error, treat as plain text
                this.setState({ decryptedMessage: { type: 'MSG', message: this.props.item.message } });
            }
        }
    }

    copyMessage = () => {
        if (!this.state.decryptedMessage) {
            return;
        }
        if (this.state.decryptedMessage?.type !== 'MSG') {
            return;
        }

        Clipboard.setString(this.state.decryptedMessage.message);
        ToastAndroid.show('Message Copied', ToastAndroid.SHORT);
    };

    decryptMessage = async (item: message): Promise<decryptedMessage> => {
        const decryptedMessage = await decrypt(this.props.peer.session_key!, item.message);
        try {
            return JSON.parse(decryptedMessage);
        } catch (err) {
            // Backwards compatibility for messages that didn't contain a type (pre v1.7)
            console.warn(err);
            return { type: 'MSG', message: decryptedMessage };
        }
    };

    renderMessage = (item: decryptedMessage | undefined, _isSent: boolean) => {
        if (!item || !item?.message) {
            return;
        }

        switch (item.type) {
            // TODO: Add VIDEO and GIF message types
            case 'IMG':
                return (
                    <Image
                        source={{ uri: `data:image/jpeg;base64,${item.message}` }}
                        style={{ width: 200, height: 'auto', aspectRatio: 1.5 }}
                        resizeMode="contain"
                    />
                );
            case 'MSG':
                const messageChunks = item.message.split(' ');
                const linkIndex = messageChunks.findIndex(
                    chunk => chunk.startsWith('https://') || chunk.startsWith('http://'),
                );

                if (linkIndex < 0) {
                    return (
                        <Text style={styles.text} selectable>
                            {item.message}
                        </Text>
                    );
                }

                return (
                    <Text style={styles.text}>
                        <Text selectable>{messageChunks.slice(0, linkIndex).join(' ')}</Text>
                        <Text selectable style={{ color: '#82B1FF' }}>
                            {linkIndex > 0 ? ' ' : ''}
                            {messageChunks[linkIndex]}
                            {linkIndex < messageChunks.length - 1 ? ' ' : ''}
                        </Text>
                        <Text selectable>{messageChunks.slice(linkIndex + 1, messageChunks.length).join(' ')}</Text>
                    </Text>
                );
            case 'AUDIO': {
                return (
                    <>
                        <Text style={styles.text}>
                            Audio data: {Number(~~(4 * (item.message.length / 3))).toLocaleString()}Bytes
                        </Text>
                        <AudioPlayer audioData={item.message} audioDuration={item.duration || 10} />
                    </>
                );
            }
            default:
                console.warn('Unrecognized message type:', item.type);
                return null;
        }
    };

    handleClick = async (item: message) => {
        try {
            this.setState({ loading: true });
            const msgObject = this.state.decryptedMessage;

            // Check if message is encrypted, if so, decrypt it
            if (!msgObject) {
                const decryptedMessage = await this.decryptMessage(item);
                this.setState({ decryptedMessage });

                // Update Redux store (also persists to SQLite)
                store.dispatch(
                    UPDATE_MESSAGE_DECRYPTED({
                        conversationId: this.props.conversationId,
                        messageId: item.id,
                        decryptedContent: JSON.stringify(decryptedMessage),
                    }),
                );
                return;
            }
            // Message is decrypted so behaviour depends on content
            switch (msgObject?.type) {
                case 'IMG': // Image is contained in message, then zoom in
                    this.props.zoomMedia(this.state.decryptedMessage!.message);
                    break;
                case 'MSG': // If message contains URL open it in browser
                    const messageChunks = this.state.decryptedMessage?.message?.split(' ') || [];
                    const link = messageChunks.find(chunk => chunk.startsWith('https://') || chunk.startsWith('http://'));
                    if (link) {
                        Linking.openURL(link);
                    }
                    break;
            }
        } catch (err: any) {
            console.error('Error on message click:', err);
            Toast.show({
                type: 'error',
                text1: 'Failed to decrypt message',
                text2: err?.message || 'Session Key might have been rotated since this message was sent',
            });
        } finally {
            this.setState({ loading: false });
        }
    };

    render = () => {
        const { item, isSent } = this.props;
        const isEncrypted = !this.state.decryptedMessage;
        const sent_at = new Date(item.sent_at);

        return (
            <Pressable
                style={[styles.messageContainer, isSent ? styles.sent : styles.received]}
                onPress={() => this.handleClick(item)}
                onLongPress={() => this.copyMessage()}
            >
                <View style={[styles.message]}>
                    {/* Loader */}
                    <ActivityIndicator
                        style={{ position: 'absolute', zIndex: 10 }}
                        animating={this.state.loading && !this.state.decryptedMessage}
                    />
                    {/* Message preview */}
                    {isEncrypted && (
                        <>
                            <Text selectable style={styles.text}>
                                {item.message?.length < 200
                                    ? item.message
                                    : item.message?.substring(0, 197).padEnd(200, '...')}
                            </Text>
                            <View style={{ position: 'absolute', zIndex: 10, left: '50%', top: '50%' }}>
                                <Icon source="lock" color="#00ff00" size={25} />
                            </View>
                        </>
                    )}
                    {/* Message */}
                    {this.renderMessage(this.state.decryptedMessage, isSent)}
                    {/* Footers of message */}
                    <View style={{ flexDirection: 'row', alignSelf: 'stretch', justifyContent: 'space-between' }}>
                        {isEncrypted && (
                            <Text style={[styles.messageTime, { alignSelf: 'flex-start' }]}> Message Encrypted </Text>
                        )}
                        <Text style={styles.messageTime}>
                            {sent_at.toLocaleDateString() === todaysDate
                                ? sent_at.toLocaleTimeString()
                                : sent_at.toLocaleDateString()}
                        </Text>
                    </View>
                </View>
            </Pressable>
        );
    };
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
    messageContainer: {
        marginVertical: 5,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        maxWidth: '75%',
    },
    message: {
        padding: 15,
        borderRadius: 10,
    },
    received: {
        alignSelf: 'flex-start',
        backgroundColor: '#333333a0',
    },
    text: {
        color: '#f2f0f0',
        fontFamily: 'Roboto',
    },
    sent: {
        alignSelf: 'flex-end',
        backgroundColor: PRIMARY,
    },
    system: {
        alignSelf: 'center',
        backgroundColor: 'gray',
    },
    messageTime: {
        color: '#969393',
        alignContent: 'flex-end',
        fontSize: 13,
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
