import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert } from 'react-native';
import { Avatar, Badge, Button, Icon } from 'react-native-paper';
import { useSelector, useDispatch } from 'react-redux';

import { humanTime, milliseconds, millisecondsSince } from '~/global/helper';
import globalStyle from '~/global/style';
import { addContact } from '~/store/actions/user';
import { DARKHEADER, PRIMARY, SECONDARY_LITE } from '~/global/variables';
import { Conversation, message } from '~/store/reducers/user';
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
