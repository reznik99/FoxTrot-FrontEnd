import { Buffer } from 'buffer';
import React, { PureComponent } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import RNFS from 'react-native-fs';
import Sound from 'react-native-nitro-sound';
import { ActivityIndicator, Icon } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import AudioPlayer from '~/components/AudioPlayer';
import { decrypt } from '~/global/crypto';
import { logger } from '~/global/logger';
import { TEXT_MUTED, TEXT_SECONDARY, WARNING_AMBER } from '~/global/variables';
import { downloadMedia, getMediaCachePath } from '~/store/actions/media';
import { message, UPDATE_MESSAGE_DECRYPTED, UserData } from '~/store/reducers/user';
import { store } from '~/store/store';

const todaysDate = new Date().toLocaleDateString();

type decryptedMessage = {
    type: string;
    message?: string;
    messageId?: number;
    duration?: number;
    objectKey?: string;
    fileKey?: string;
    fileIv?: string;
    mimeType?: string;
    thumbnail?: string;
};

export type MessageContextMenuData = {
    messageId: number;
    conversationId: string;
    type: string;
    text?: string;
    objectKey?: string;
    fileKey?: string;
    fileIv?: string;
    mediaUri?: string;
    sentAt: string;
    rawMessageLength: number;
    isSent: boolean;
};

type MProps = {
    item: message;
    isSent: boolean;
    peer: UserData;
    zoomMedia: (data: string) => void;
    onLongPress: (data: MessageContextMenuData) => void;
    getMessageById: (id: number) => message | undefined;
    conversationId: string;
    primaryColor: string;
};
type MState = {
    loading: boolean;
    decryptedMessage?: decryptedMessage;
    mediaUri?: string;
};

export default class Message extends PureComponent<MProps, MState> {
    constructor(props: MProps) {
        super(props);
        this.state = {
            loading: false,
            decryptedMessage: undefined,
        };
    }

    async componentDidMount() {
        // If message was previously decrypted, parse the content
        if (this.props.item.is_decrypted) {
            try {
                const parsed = JSON.parse(this.props.item.message);
                this.setState({ decryptedMessage: parsed });
                // Check if media is already cached on disk so we show the correct icon
                if ((parsed.type === 'IMG' || parsed.type === 'VIDEO' || parsed.type === 'AUDIO') && parsed.objectKey) {
                    const cachePath = getMediaCachePath(parsed.objectKey);
                    if (await RNFS.exists(cachePath)) {
                        this.setState({ mediaUri: `file://${cachePath}` });
                    }
                }
            } catch (err) {
                // Parse error, treat as plain text
                this.setState({ decryptedMessage: { type: 'MSG', message: this.props.item.message } });
            }
        }
    }

    handlePress = async () => {
        if (this.state.loading) return;
        try {
            this.setState({ loading: true });
            const msgObject = this.state.decryptedMessage;

            // Check if message is encrypted, if so, decrypt it
            if (!msgObject) {
                const decryptedMessage = await this.decryptMessage(this.props.item);
                this.setState({ decryptedMessage });

                // Update Redux store (also persists to SQLite)
                store.dispatch(
                    UPDATE_MESSAGE_DECRYPTED({
                        conversationId: this.props.conversationId,
                        messageId: this.props.item.id,
                        decryptedContent: JSON.stringify(decryptedMessage),
                    }),
                );
                return;
            }
            // Message is decrypted so behaviour depends on content
            switch (msgObject?.type) {
                case 'IMG':
                    if (msgObject.message) {
                        // Legacy inline base64 — zoom in
                        this.props.zoomMedia(msgObject.message);
                    } else if (msgObject.objectKey && msgObject.fileKey && msgObject.fileIv) {
                        if (this.state.mediaUri) {
                            // Already downloaded — zoom in
                            this.props.zoomMedia(this.state.mediaUri);
                        } else {
                            // Download from S3, decrypt, cache, and open immediately
                            const uri = await store
                                .dispatch(
                                    downloadMedia({
                                        objectKey: msgObject.objectKey,
                                        keyBase64: msgObject.fileKey,
                                        ivBase64: msgObject.fileIv,
                                    }),
                                )
                                .unwrap();
                            this.setState({ mediaUri: uri });
                            this.props.zoomMedia(uri);
                        }
                    }
                    break;
                case 'VIDEO':
                    if (msgObject.objectKey && msgObject.fileKey && msgObject.fileIv) {
                        if (this.state.mediaUri) {
                            // Already downloaded — open full screen
                            this.props.zoomMedia(this.state.mediaUri);
                        } else {
                            // Download from S3, decrypt, cache, and open immediately
                            const uri = await store
                                .dispatch(
                                    downloadMedia({
                                        objectKey: msgObject.objectKey,
                                        keyBase64: msgObject.fileKey,
                                        ivBase64: msgObject.fileIv,
                                    }),
                                )
                                .unwrap();
                            this.setState({ mediaUri: uri });
                            this.props.zoomMedia(uri);
                        }
                    }
                    break;
                case 'AUDIO':
                    if (msgObject.objectKey && msgObject.fileKey && msgObject.fileIv && !this.state.mediaUri) {
                        const uri = await store
                            .dispatch(
                                downloadMedia({
                                    objectKey: msgObject.objectKey,
                                    keyBase64: msgObject.fileKey,
                                    ivBase64: msgObject.fileIv,
                                }),
                            )
                            .unwrap();
                        this.setState({ mediaUri: uri });
                    }
                    break;
                case 'MSG': // If message contains URL open it in browser
                    const messageChunks = msgObject?.message?.split(' ') || [];
                    const link = messageChunks.find(chunk => chunk.startsWith('https://') || chunk.startsWith('http://'));
                    if (link) {
                        Linking.openURL(link);
                    }
                    break;
            }
        } catch (err: any) {
            logger.error('Error on message click:', err);
            Toast.show({
                type: 'error',
                text1: 'Failed to decrypt message',
                text2: err?.message || 'Session Key might have been rotated since this message was sent',
            });
        } finally {
            this.setState({ loading: false });
        }
    };

    handleLongPress = () => {
        const msg = this.state.decryptedMessage;
        if (msg) {
            this.props.onLongPress({
                messageId: this.props.item.id,
                conversationId: this.props.conversationId,
                type: msg.type,
                text: msg.message,
                objectKey: msg.objectKey,
                fileKey: msg.fileKey,
                fileIv: msg.fileIv,
                mediaUri: this.state.mediaUri,
                sentAt: this.props.item.sent_at,
                rawMessageLength: Buffer.byteLength(this.props.item.message, 'utf8'),
                isSent: this.props.isSent,
            });
        } else {
            this.props.onLongPress({
                messageId: this.props.item.id,
                conversationId: this.props.conversationId,
                type: 'MSG',
                text: this.props.item.message,
                sentAt: this.props.item.sent_at,
                rawMessageLength: Buffer.byteLength(this.props.item.message, 'utf8'),
                isSent: this.props.isSent,
            });
        }
    };

    decryptMessage = async (item: message): Promise<decryptedMessage> => {
        const decryptedMessage = await decrypt(this.props.peer.session_key!, item.message);
        try {
            return JSON.parse(decryptedMessage);
        } catch (err) {
            // Backwards compatibility for messages that didn't contain a type (pre v1.7)
            logger.warn(err);
            return { type: 'MSG', message: decryptedMessage };
        }
    };

    getReplyPreview = (messageId?: number): string => {
        if (!messageId) return 'Original message unavailable';

        const referenced = this.props.getMessageById(messageId);
        if (!referenced) return 'Original message unavailable';
        if (!referenced.is_decrypted) return 'Encrypted message';

        try {
            const parsed = JSON.parse(referenced.message);
            switch (parsed.type) {
                case 'MSG': {
                    const text = parsed.message || '';
                    return text.length > 60 ? text.slice(0, 60) + '...' : text;
                }
                case 'IMG':
                    return 'Photo';
                case 'VIDEO':
                    return 'Video';
                case 'AUDIO':
                    return 'Audio message';
                case 'REPLY': {
                    const replyText = parsed.message || '';
                    return replyText.length > 60 ? replyText.slice(0, 60) + '...' : replyText;
                }
                default:
                    return 'Message';
            }
        } catch {
            const text = referenced.message;
            return text.length > 60 ? text.slice(0, 60) + '...' : text;
        }
    };

    renderMessage = (item: decryptedMessage | undefined, _isSent: boolean) => {
        if (!item) {
            return;
        }

        switch (item.type) {
            case 'IMG': {
                // Legacy inline base64 image
                if (item.message) {
                    return (
                        <Image
                            source={{ uri: `data:image/jpeg;base64,${item.message}` }}
                            style={styles.mediaImage}
                            resizeMode="contain"
                        />
                    );
                }
                // S3-backed: use full-res if downloaded, otherwise thumbnail
                const imgSource = this.state.mediaUri
                    ? { uri: this.state.mediaUri }
                    : item.thumbnail
                    ? { uri: `data:image/jpeg;base64,${item.thumbnail}` }
                    : null;
                if (imgSource) {
                    return (
                        <View>
                            <Image
                                source={imgSource}
                                style={styles.mediaImage}
                                resizeMode="contain"
                                blurRadius={this.state.mediaUri ? 0 : 1}
                            />
                            {!this.state.mediaUri && (
                                <View style={styles.mediaOverlay}>
                                    <Icon source="download" color="#fff" size={30} />
                                </View>
                            )}
                        </View>
                    );
                }
                return (
                    <View style={styles.mediaPlaceholder}>
                        <Icon source="image" color="#aaa" size={40} />
                        <Text style={styles.text}>Tap to load image</Text>
                    </View>
                );
            }
            case 'VIDEO': {
                const thumbUri = item.thumbnail ? `data:image/jpeg;base64,${item.thumbnail}` : null;
                const downloaded = !!this.state.mediaUri;
                if (thumbUri) {
                    return (
                        <View>
                            <Image
                                source={{ uri: thumbUri }}
                                style={styles.mediaImage}
                                resizeMode="contain"
                                blurRadius={downloaded ? 0 : 1}
                            />
                            <View style={styles.mediaOverlay}>
                                <Icon
                                    source={downloaded ? 'play-circle' : 'download'}
                                    color="#fff"
                                    size={downloaded ? 40 : 30}
                                />
                            </View>
                        </View>
                    );
                }
                return (
                    <View style={styles.mediaPlaceholder}>
                        <Icon
                            source={downloaded ? 'play-circle' : 'video'}
                            color={downloaded ? '#fff' : '#aaa'}
                            size={downloaded ? 50 : 40}
                        />
                        <Text style={styles.text}>{downloaded ? 'Tap to play video' : 'Tap to load video'}</Text>
                    </View>
                );
            }
            case 'MSG': {
                if (!item.message) return null;
                const messageChunks = item.message.split(' ');
                const linkIndex = messageChunks.findIndex(
                    chunk => chunk.startsWith('https://') || chunk.startsWith('http://'),
                );

                if (linkIndex < 0) {
                    return <Text style={styles.text}>{item.message}</Text>;
                }

                return (
                    <Text style={styles.text}>
                        <Text>{messageChunks.slice(0, linkIndex).join(' ')}</Text>
                        <Text style={styles.linkText}>
                            {linkIndex > 0 ? ' ' : ''}
                            {messageChunks[linkIndex]}
                            {linkIndex < messageChunks.length - 1 ? ' ' : ''}
                        </Text>
                        <Text>{messageChunks.slice(linkIndex + 1, messageChunks.length).join(' ')}</Text>
                    </Text>
                );
            }
            case 'AUDIO': {
                // Legacy inline base64 audio
                if (item.message) {
                    return (
                        <AudioPlayer
                            messageId={this.props.item.id}
                            audioData={item.message}
                            audioDuration={item.duration || 10}
                            isSent={this.props.isSent}
                        />
                    );
                }
                // S3-backed audio
                if (item.objectKey) {
                    if (this.state.mediaUri) {
                        return (
                            <AudioPlayer
                                messageId={this.props.item.id}
                                audioUri={this.state.mediaUri}
                                audioDuration={item.duration || 10}
                                isSent={this.props.isSent}
                            />
                        );
                    }
                    return (
                        <View style={styles.audioDownloadRow}>
                            <Icon
                                source="download"
                                color={this.props.isSent ? '#ffffffcc' : this.props.primaryColor}
                                size={28}
                            />
                            <View>
                                <Text style={styles.text}>Audio message</Text>
                                <Text style={styles.audioDuration}>{Sound.mmssss(Math.floor(item.duration || 0))}</Text>
                            </View>
                        </View>
                    );
                }
                return null;
            }
            case 'REPLY': {
                const preview = this.getReplyPreview(item.messageId);
                return (
                    <View>
                        <View style={styles.replyPreviewContainer}>
                            <Text style={styles.replyPreviewText} numberOfLines={2}>
                                {preview}
                            </Text>
                        </View>
                        {item.message ? <Text style={styles.text}>{item.message}</Text> : null}
                    </View>
                );
            }
            default:
                logger.warn('Unrecognized message type:', item.type);
                return null;
        }
    };

    render = () => {
        const { item, isSent } = this.props;
        const sent_at = new Date(item.sent_at);

        // System messages render with a distinct centered style
        if (item.system) {
            return (
                <View style={styles.systemMessageContainer}>
                    <Icon source="shield-alert" color={WARNING_AMBER} size={16} />
                    <Text style={styles.systemMessageText}>{item.message}</Text>
                    <Text style={styles.systemMessageTime}>
                        {sent_at.toLocaleDateString() === todaysDate
                            ? sent_at.toLocaleTimeString()
                            : `${sent_at.toLocaleDateString()} ${sent_at.toLocaleTimeString()}`}
                    </Text>
                </View>
            );
        }

        const isEncrypted = !this.state.decryptedMessage;

        return (
            <Pressable
                style={[
                    styles.messageContainer,
                    isSent ? [styles.sent, { backgroundColor: this.props.primaryColor }] : styles.received,
                ]}
                onPress={this.handlePress}
                onLongPress={this.handleLongPress}
            >
                <View style={[styles.message]}>
                    {/* Loader */}
                    {this.state.loading && (
                        <ActivityIndicator
                            style={styles.loader}
                            animating={true}
                            color={isSent ? '#ffffffcc' : this.props.primaryColor}
                        />
                    )}
                    {/* Encrypted placeholder */}
                    {isEncrypted && (
                        <View style={styles.encryptedPlaceholder}>
                            <Icon source="shield-lock" color={isSent ? '#ffffffcc' : this.props.primaryColor} size={20} />
                            <Text style={isSent ? styles.encryptedTextSent : styles.encryptedTextReceived}>
                                Tap to decrypt
                            </Text>
                        </View>
                    )}
                    {/* Message */}
                    {this.renderMessage(this.state.decryptedMessage, isSent)}
                    {/* Footers of message */}
                    <View style={styles.messageFooter}>
                        <Text style={[styles.messageTime, isSent && styles.messageTimeSent]}>
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
    },
    messageTime: {
        color: TEXT_MUTED,
        alignContent: 'flex-end',
        fontSize: 13,
    },
    messageTimeSent: {
        color: '#ffffffaa',
    },
    mediaOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.25)',
    },
    mediaImage: {
        width: 200,
        height: 'auto' as any,
        aspectRatio: 1.5,
    },
    mediaPlaceholder: {
        width: 200,
        aspectRatio: 1.5,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loader: {
        position: 'absolute',
        zIndex: 10,
        alignSelf: 'center',
        top: '40%',
    },
    encryptedPlaceholder: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 6,
        paddingHorizontal: 4,
    },
    messageFooter: {
        flexDirection: 'row',
        alignSelf: 'stretch',
        justifyContent: 'flex-end',
    },
    audioDownloadRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minWidth: 200,
    },
    linkText: {
        color: '#82B1FF',
    },
    audioDuration: {
        color: TEXT_MUTED,
        fontSize: 12,
    },
    encryptedTextSent: {
        color: '#ffffffcc',
        fontSize: 14,
    },
    encryptedTextReceived: {
        color: TEXT_SECONDARY,
        fontSize: 14,
    },
    replyPreviewContainer: {
        borderLeftWidth: 2,
        borderLeftColor: '#ffffff66',
        paddingLeft: 8,
        marginBottom: 6,
    },
    replyPreviewText: {
        color: '#ffffff99',
        fontSize: 12,
        fontStyle: 'italic',
    },
    systemMessageContainer: {
        alignSelf: 'center',
        alignItems: 'center',
        backgroundColor: '#2a2a2e',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E0A50040',
        paddingVertical: 10,
        paddingHorizontal: 16,
        marginVertical: 8,
        maxWidth: '85%',
        gap: 4,
    },
    systemMessageText: {
        color: WARNING_AMBER,
        fontSize: 13,
        textAlign: 'center',
        lineHeight: 18,
    },
    systemMessageTime: {
        color: TEXT_MUTED,
        fontSize: 11,
        marginTop: 2,
    },
});
