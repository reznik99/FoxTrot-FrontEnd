import React, { PureComponent } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import RNFS from 'react-native-fs';
import Sound from 'react-native-nitro-sound';
import { ActivityIndicator, Icon } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import AudioPlayer from '~/components/AudioPlayer';
import { decrypt } from '~/global/crypto';
import { logger } from '~/global/logger';
import { TEXT_MUTED, TEXT_SECONDARY } from '~/global/variables';
import { downloadMedia, getMediaCachePath } from '~/store/actions/media';
import { message, UPDATE_MESSAGE_DECRYPTED, UserData } from '~/store/reducers/user';
import { store } from '~/store/store';

const todaysDate = new Date().toLocaleDateString();

type decryptedMessage = {
    type: string;
    message?: string;
    duration?: number;
    objectKey?: string;
    fileKey?: string;
    fileIv?: string;
    mimeType?: string;
    thumbnail?: string;
};

type MProps = {
    item: message;
    isSent: boolean;
    peer: UserData;
    zoomMedia: (data: string) => void;
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

    onPress = () => this.handleClick(this.props.item);

    copyMessage = () => {
        if (!this.state.decryptedMessage) {
            return;
        }
        if (this.state.decryptedMessage?.type !== 'MSG') {
            return;
        }

        Clipboard.setString(this.state.decryptedMessage.message || '');
        ToastAndroid.show('Message Copied', ToastAndroid.SHORT);
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
                    return (
                        <Text style={styles.text} selectable>
                            {item.message}
                        </Text>
                    );
                }

                return (
                    <Text style={styles.text}>
                        <Text selectable>{messageChunks.slice(0, linkIndex).join(' ')}</Text>
                        <Text selectable style={styles.linkText}>
                            {linkIndex > 0 ? ' ' : ''}
                            {messageChunks[linkIndex]}
                            {linkIndex < messageChunks.length - 1 ? ' ' : ''}
                        </Text>
                        <Text selectable>{messageChunks.slice(linkIndex + 1, messageChunks.length).join(' ')}</Text>
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
            default:
                logger.warn('Unrecognized message type:', item.type);
                return null;
        }
    };

    handleClick = async (item: message) => {
        if (this.state.loading) return;
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

    render = () => {
        const { item, isSent } = this.props;
        const isEncrypted = !this.state.decryptedMessage;
        const sent_at = new Date(item.sent_at);

        return (
            <Pressable
                style={[
                    styles.messageContainer,
                    isSent ? [styles.sent, { backgroundColor: this.props.primaryColor }] : styles.received,
                ]}
                onPress={this.onPress}
                onLongPress={this.copyMessage}
            >
                <View style={[styles.message]}>
                    {/* Loader */}
                    {this.state.loading && <ActivityIndicator style={styles.loader} animating={true} />}
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
});
