import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Badge, Button, Dialog, Icon, Portal, Text, useTheme } from 'react-native-paper';
import { useDispatch, useSelector } from 'react-redux';

import AvatarWithStatus from '~/components/AvatarWithStatus';
import { dbDeleteConversation } from '~/global/database';
import { humanTime } from '~/global/helper';
import globalStyle from '~/global/style';
import { ERROR_RED, SECONDARY, SECONDARY_LITE, TEXT_SECONDARY, WARNING_AMBER } from '~/global/variables';
import { RootNavigation } from '~/store/actions/auth';
import { addContact } from '~/store/actions/user';
import { Conversation, DELETE_CONVERSATION, message } from '~/store/reducers/user';
import { AppDispatch, RootState } from '~/store/store';

interface MessagePreview {
    text: string;
    icon?: string;
    isMedia?: boolean;
}

function getMessagePreview(msg: message): MessagePreview {
    if (msg.system) {
        return { text: msg.message?.substring(0, 50) || 'System message', icon: 'shield-alert' };
    }

    if (!msg.is_decrypted) {
        return { text: 'Encrypted message', icon: 'shield-lock' };
    }

    try {
        const parsed = JSON.parse(msg.message);
        switch (parsed.type) {
            case 'MSG':
                return { text: parsed.message?.substring(0, 50) || '' };
            case 'IMG':
                return { text: 'Image', icon: 'image', isMedia: true };
            case 'VIDEO':
                return { text: 'Video', icon: 'video', isMedia: true };
            case 'AUDIO':
                return { text: 'Audio', icon: 'microphone', isMedia: true };
            default:
                return { text: parsed.message?.substring(0, 50) || '' };
        }
    } catch {
        // If parsing fails, show raw message
        return { text: msg.message?.substring(0, 50) || '' };
    }
}

interface IProps {
    navigation: RootNavigation;
    data: Conversation;
}

export default function ConversationPeek(props: IProps) {
    const { colors } = useTheme();
    const dispatch = useDispatch<AppDispatch>();
    const user_phone_no = useSelector((state: RootState) => state.userReducer.user_data?.phone_no);
    const contacts = useSelector((state: RootState) => state.userReducer.contacts);
    const [loading, setLoading] = useState<string | undefined>(undefined);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    const { data, navigation } = props;
    const lastMessage = data.messages[0] ?? {};
    const unreadCount = useMemo(
        () => data.messages.filter(m => m.sender !== user_phone_no && !m.seen).length,
        [data.messages, user_phone_no],
    );
    const isNew = unreadCount > 0;

    const { peer, isRequest } = useMemo(() => {
        const contact = contacts.find(con => con.phone_no === data.other_user.phone_no);
        if (!contact) {
            return { peer: data.other_user, isRequest: true };
        }
        return { peer: contact, isRequest: false };
    }, [contacts, data.other_user]);

    const onConfirmDelete = useCallback(() => {
        setShowDeleteDialog(false);
        dbDeleteConversation(data.other_user.phone_no);
        dispatch(DELETE_CONVERSATION(data.other_user.phone_no));
    }, [data.other_user.phone_no, dispatch]);

    const acceptMessageRequest = async () => {
        setLoading('accept');
        await dispatch(addContact({ user: data.other_user }));
        setLoading(undefined);
    };
    const showError = () => {
        Alert.alert(
            'Unable to reject message request',
            "This functionality isn't yet implemented. Simply ignore the message request for now",
            [{ text: 'OK', onPress: () => {} }],
        );
    };

    const boldIfUnseen = isNew ? styles.unseenMessage : null;
    return (
        <>
            <TouchableOpacity
                style={styles.conversationPeek}
                onPress={() => {
                    navigation.navigate('Conversation', { data: { peer_user: data.other_user } });
                }}
                onLongPress={() => setShowDeleteDialog(true)}
            >
                <View style={{ marginRight: 10 }}>
                    <AvatarWithStatus user={peer} size={55} borderColor={SECONDARY} />
                </View>
                <View style={styles.contentColumn}>
                    <Text style={[globalStyle.textInfo, boldIfUnseen]}>{peer.phone_no}</Text>
                    {(() => {
                        const preview = getMessagePreview(lastMessage);
                        const previewColor = isNew ? TEXT_SECONDARY : SECONDARY_LITE;
                        const isSystem = lastMessage.system;
                        if (preview.icon) {
                            return (
                                <View style={styles.previewRow}>
                                    <Icon
                                        source={preview.icon}
                                        size={14}
                                        color={isSystem ? WARNING_AMBER : colors.primary}
                                    />
                                    <Text
                                        style={[
                                            globalStyle.textInfo,
                                            boldIfUnseen,
                                            { color: isSystem ? WARNING_AMBER : previewColor, fontStyle: 'italic' },
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {preview.text}
                                    </Text>
                                </View>
                            );
                        }
                        return (
                            <Text style={[globalStyle.textInfo, boldIfUnseen, { color: previewColor }]} numberOfLines={1}>
                                {preview.text}
                            </Text>
                        );
                    })()}
                </View>
                <View style={styles.endRow}>
                    <Text style={[styles.timestamp, isNew && { color: colors.primary, fontWeight: 'bold' }]}>
                        {humanTime(lastMessage.sent_at)}
                    </Text>
                    {isNew && (
                        <Badge style={{ backgroundColor: colors.primary }}>{unreadCount > 99 ? '99+' : unreadCount}</Badge>
                    )}
                </View>
            </TouchableOpacity>
            {isRequest && (
                <View style={[styles.messageRequestContainer, { justifyContent: 'space-evenly' }]}>
                    <Button
                        mode="contained"
                        icon="check"
                        labelStyle={{ fontSize: 12 }}
                        style={[styles.button]}
                        loading={loading === 'accept'}
                        disabled={loading === 'accept'}
                        onPress={acceptMessageRequest}
                    >
                        Accept
                    </Button>
                    <Button
                        mode="contained"
                        icon="close"
                        labelStyle={{ fontSize: 12 }}
                        style={[styles.button, { backgroundColor: 'red' }]}
                        loading={loading === 'reject'}
                        disabled={loading === 'reject'}
                        onPress={showError}
                    >
                        Reject
                    </Button>
                </View>
            )}
            <Portal>
                <Dialog visible={showDeleteDialog} onDismiss={() => setShowDeleteDialog(false)}>
                    <Dialog.Icon icon="delete-alert" />
                    <Dialog.Title style={{ textAlign: 'center' }}>Delete Conversation</Dialog.Title>
                    <Dialog.Content>
                        <Text style={{ textAlign: 'center' }}>
                            Delete conversation with {peer.phone_no}? All messages will be removed.
                        </Text>
                    </Dialog.Content>
                    <Dialog.Actions style={{ justifyContent: 'space-evenly' }}>
                        <Button
                            mode="contained-tonal"
                            onPress={() => setShowDeleteDialog(false)}
                            style={{ paddingHorizontal: 15 }}
                        >
                            Cancel
                        </Button>
                        <Button
                            mode="contained"
                            buttonColor={ERROR_RED}
                            onPress={onConfirmDelete}
                            style={{ paddingHorizontal: 15 }}
                        >
                            Delete
                        </Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
        </>
    );
}

const styles = StyleSheet.create({
    conversationPeek: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
    },
    contentColumn: {
        flex: 1,
        gap: 2,
    },
    previewRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    endRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
        gap: 6,
    },
    timestamp: {
        fontSize: 12,
        color: SECONDARY_LITE,
    },
    messageRequestContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-evenly',
        padding: 5,
    },
    unseenMessage: {
        fontWeight: 'bold',
    },
    button: {
        width: '45%',
        paddingVertical: 6,
    },
});
