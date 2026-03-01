import React, { useState, useCallback, useMemo } from 'react';
import { View, TouchableOpacity, ToastAndroid, Platform, StyleSheet } from 'react-native';
import { ActivityIndicator, Text, Button, Dialog, Portal, Icon } from 'react-native-paper';
import { useSelector } from 'react-redux';
import { Image } from 'react-native-elements';
import Clipboard from '@react-native-clipboard/clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';

import { publicKeyFingerprint } from '~/global/crypto';
import { RootState } from '~/store/store';
import { UserData } from '~/store/reducers/user';
import { HomeStackParamList } from '../../App';
import { DARKHEADER, PRIMARY } from '~/global/variables';
import { logger } from '~/global/logger';
import { humanTime, onlineStatus } from '~/global/helper';
import globalStyle from '~/global/style';

interface IProps {
    navigation: StackNavigationProp<HomeStackParamList, 'Conversation' | 'Call'>;
    data: {
        peer_user: UserData;
    };
    allowBack: boolean;
}

export default function HeaderConversation(props: IProps) {
    const { navigation, allowBack, data } = props;
    const [visibleDialog, setVisibleDialog] = useState('');
    const [securityCode, setSecurityCode] = useState('');
    const contacts = useSelector((store: RootState) => store.userReducer.contacts);
    const edgeInsets = useSafeAreaInsets();

    const contact = useMemo(() => {
        return contacts.find(_contact => _contact.phone_no === data.peer_user.phone_no);
    }, [contacts, data.peer_user.phone_no]);

    const showSecurityCode = useCallback(async () => {
        try {
            if (!contact || !contact.public_key) {
                throw new Error('No contact public key found');
            }

            setVisibleDialog('SecurityCode');
            const digest = await publicKeyFingerprint(contact.public_key);
            setSecurityCode(digest);
        } catch (err) {
            logger.error(err);
        }
    }, [contact]);

    const copySecurityCode = useCallback(() => {
        setVisibleDialog('');
        Clipboard.setString(securityCode);
        ToastAndroid.show('Security Code Copied', ToastAndroid.SHORT);
    }, [securityCode]);

    return (
        <View style={[styles.topBar, { paddingTop: edgeInsets.top, paddingHorizontal: edgeInsets.left }]}>
            <View style={styles.backAndTitle}>
                {allowBack ? (
                    <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
                        <Icon source="arrow-left" color={styles.topBarText.color} size={20} />
                    </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={styles.profileBtn} onPress={showSecurityCode}>
                    <View style={styles.profilePicContainer}>
                        <Image
                            source={{ uri: `${data?.peer_user?.pic}` }}
                            style={styles.profilePic}
                            PlaceholderContent={<ActivityIndicator />}
                        />
                    </View>
                    <Text style={styles.topBarText}>{data.peer_user.phone_no}</Text>
                </TouchableOpacity>
            </View>
            <View style={[styles.buttonContainer]}>
                <TouchableOpacity
                    style={styles.button}
                    onPress={() => navigation.navigate('Call', { data: { peer_user: data.peer_user, video_enabled: true } })}
                >
                    <Icon source="video" color={styles.topBarText.color} size={styles.topBarText.fontSize} />
                </TouchableOpacity>
                <TouchableOpacity
                    style={styles.button}
                    onPress={() =>
                        navigation.navigate('Call', { data: { peer_user: data.peer_user, video_enabled: false } })
                    }
                >
                    <Icon source="phone" color={styles.topBarText.color} size={styles.topBarText.fontSize} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => setVisibleDialog('UserInfo')}>
                    <Icon source="information" color={styles.topBarText.color} size={styles.topBarText.fontSize} />
                </TouchableOpacity>
            </View>

            <Portal>
                <Dialog visible={visibleDialog === 'SecurityCode'} onDismiss={() => setVisibleDialog('')}>
                    <Dialog.Icon icon="shield-lock" color={PRIMARY} />
                    <Dialog.Title style={{ textAlign: 'center' }}>Security Code</Dialog.Title>
                    <Dialog.Content>
                        <Text style={[globalStyle.dialogText, { textAlign: 'center', color: '#969393' }]}>
                            Verify this code matches on {data?.peer_user?.phone_no}'s device
                        </Text>
                        {securityCode.match(/.{1,24}/g)?.map((val, idx) => (
                            <Text key={idx} style={{ fontFamily: 'monospace', textAlign: 'center', letterSpacing: 1 }}>
                                {val}
                            </Text>
                        ))}
                    </Dialog.Content>
                    <Dialog.Actions style={{ justifyContent: 'space-evenly' }}>
                        <Button
                            mode="contained-tonal"
                            onPress={() => setVisibleDialog('')}
                            style={{ paddingHorizontal: 15 }}
                        >
                            Close
                        </Button>
                        <Button
                            mode="contained"
                            onPress={() => copySecurityCode()}
                            icon="content-copy"
                            style={{ paddingHorizontal: 15 }}
                        >
                            Copy
                        </Button>
                    </Dialog.Actions>
                </Dialog>
                <Dialog visible={visibleDialog === 'UserInfo'} onDismiss={() => setVisibleDialog('')}>
                    <Dialog.Icon icon="account-circle" />
                    <Dialog.Title style={{ textAlign: 'center' }}>
                        {contact?.phone_no || data.peer_user.phone_no}
                    </Dialog.Title>
                    <Dialog.Content style={{ gap: 12 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                            <Text>Status</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <View
                                    style={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: 4,
                                        backgroundColor: onlineStatus(contact || {}).color,
                                    }}
                                />
                                <Text>{onlineStatus(contact || {}).label}</Text>
                            </View>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                            <Text>Last seen</Text>
                            <Text>{humanTime(contact?.last_seen || '0')}</Text>
                        </View>
                        <View style={{ gap: 4 }}>
                            <Text>Identity Key</Text>
                            <Text style={{ fontFamily: 'monospace', fontSize: 12, color: '#969393' }} selectable>
                                {contact?.public_key || 'No key available'}
                            </Text>
                        </View>
                    </Dialog.Content>
                    <Dialog.Actions style={{ justifyContent: 'space-evenly' }}>
                        <Button
                            mode="contained-tonal"
                            onPress={() => setVisibleDialog('')}
                            style={{ paddingHorizontal: 15 }}
                        >
                            Close
                        </Button>
                        <Button
                            mode="contained"
                            icon="content-copy"
                            onPress={() => {
                                setVisibleDialog('');
                                Clipboard.setString(contact?.public_key || '');
                                ToastAndroid.show('Identity Key Copied', ToastAndroid.SHORT);
                            }}
                            style={{ paddingHorizontal: 15 }}
                        >
                            Copy Key
                        </Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
        </View>
    );
}

const styles = StyleSheet.create({
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: DARKHEADER,
        paddingBottom: 8,
    },
    backAndTitle: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        overflow: 'hidden',
    },
    topBarText: {
        color: '#fff',
        fontSize: 16,
    },
    buttonContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    button: {
        height: 50,
        padding: 10,
        marginHorizontal: 5,
        justifyContent: 'center',
        alignItems: 'center',
    },
    rightFloat: {
        justifyContent: 'flex-end',
    },
    padded: {
        paddingHorizontal: 15,
    },
    wider: {
        overflow: 'visible',
    },
    profileBtn: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    profilePicContainer: {
        overflow: 'hidden',
        borderRadius: Platform.OS === 'ios' ? 150 / 2 : 150,
        marginRight: 8,
    },
    profilePic: {
        width: 40,
        height: 40,
        borderRadius: Platform.OS === 'ios' ? 150 / 2 : 150,
    },
});
