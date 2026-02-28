import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Avatar, Badge, Button, Dialog, Icon, Portal, Text } from 'react-native-paper';
import { useSelector, useDispatch } from 'react-redux';

import { humanTime, milliseconds, millisecondsSince } from '~/global/helper';
import globalStyle from '~/global/style';
import { addContact } from '~/store/actions/user';
import { dbDeleteConversation } from '~/global/database';
import { DARKHEADER, PRIMARY, SECONDARY_LITE } from '~/global/variables';
import { Conversation, DELETE_CONVERSATION, message } from '~/store/reducers/user';
import { AppDispatch, RootState } from '~/store/store';
import { RootNavigation } from '~/store/actions/auth';

interface MessagePreview {
    text: string;
    icon?: string;
    isMedia?: boolean;
}

function getMessagePreview(msg: message): MessagePreview {
    if (!msg.is_decrypted) {
        // Still encrypted, show truncated base64
        return { text: msg.message?.substring(0, 50) || '' };
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
    const dispatch = useDispatch<AppDispatch>();
    const user_phone_no = useSelector((state: RootState) => state.userReducer.user_data?.phone_no);
    const contacts = useSelector((state: RootState) => state.userReducer.contacts);
    const [loading, setLoading] = useState<string | undefined>(undefined);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    const { data, navigation } = props;
    const lastMessage = data.messages[0] ?? {};
    const isNew = lastMessage.sender !== user_phone_no && !lastMessage.seen;

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

    const renderStatus = useCallback(() => {
        if (peer.online) {
            return <Badge size={10} style={{ backgroundColor: '#039111ff' }} />;
        } else if (millisecondsSince(new Date(peer.last_seen)) < milliseconds.hour) {
            return <Badge size={10} style={{ backgroundColor: PRIMARY }} />;
        } else {
            return <Badge size={10} style={{ backgroundColor: SECONDARY_LITE }} />;
        }
    }, [peer]);

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
                <View style={{ display: 'flex', flexDirection: 'row' }}>
                    {renderStatus()}
                    <Avatar.Image size={55} source={{ uri: peer.pic }} style={styles.profilePicContainer} />
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={[globalStyle.textInfo, boldIfUnseen]}>{peer.phone_no}</Text>
                    {(() => {
                        const preview = getMessagePreview(lastMessage);
                        if (preview.icon) {
                            return (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <Icon source={preview.icon} size={14} color={SECONDARY_LITE} />
                                    <Text
                                        style={[
                                            globalStyle.textInfo,
                                            boldIfUnseen,
                                            { color: SECONDARY_LITE, fontStyle: 'italic' },
                                        ]}
                                    >
                                        {preview.text}
                                    </Text>
                                </View>
                            );
                        }
                        return <Text style={[globalStyle.textInfo, boldIfUnseen]}>{preview.text}</Text>;
                    })()}
                </View>
                <View
                    style={{
                        alignSelf: 'center',
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginHorizontal: 5,
                    }}
                >
                    <Text style={[globalStyle.textInfo, boldIfUnseen]}> {humanTime(lastMessage.sent_at)} </Text>
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
                            buttonColor="#e53935"
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
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 10,
    },
    messageRequestContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 5,
    },
    profilePicContainer: {
        marginRight: 10,
        backgroundColor: DARKHEADER,
    },
    unseenMessage: {
        fontWeight: 'bold',
    },
    button: {
        width: '45%',
        paddingVertical: 6,
    },
});
