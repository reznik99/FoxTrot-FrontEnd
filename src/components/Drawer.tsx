import React, { useState, useCallback, useEffect } from 'react';
import { StyleSheet, View, ToastAndroid, Linking } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { Avatar, Button, Dialog, Icon, Portal, Text, TouchableRipple } from 'react-native-paper';
import { DrawerContentScrollView, DrawerItem } from '@react-navigation/drawer';
import { DrawerContentComponentProps } from '@react-navigation/drawer/lib/typescript/src/types';
import Clipboard from '@react-native-clipboard/clipboard';
import DeviceInfo from 'react-native-device-info';
import RNFS from 'react-native-fs';

import { SECONDARY, SECONDARY_LITE, KeypairAlgorithm, DARKHEADER, PRIMARY } from '~/global/variables';
import { logOut } from '~/store/actions/auth';
import { publicKeyFingerprint } from '~/global/crypto';
import { formatBytes, getAvatar } from '~/global/helper';
import { logger } from '~/global/logger';
import { AppDispatch, RootState } from '~/store/store';

const GITHUB_URL = 'https://github.com/reznik99/FoxTrot-FrontEnd';

export default function Drawer(props: DrawerContentComponentProps) {
    const state = useSelector((_state: RootState) => _state.userReducer);
    const dispatch = useDispatch<AppDispatch>();
    const [showSecurityCode, setShowSecurityCode] = useState(false);
    const [securityCode, setSecurityCode] = useState('');
    const [deviceName, setDeviceName] = useState('');
    const [cacheSize, setCacheSize] = useState('');

    useEffect(() => {
        DeviceInfo.getDeviceName().then(setDeviceName);
    }, []);

    useEffect(() => {
        RNFS.readDir(RNFS.CachesDirectoryPath).then(files => {
            const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
            setCacheSize(formatBytes(totalBytes));
        });
    }, [props.state]);

    const copySecurityCode = useCallback(() => {
        setShowSecurityCode(false);
        Clipboard.setString(securityCode);
        ToastAndroid.show('Security Code Copied', ToastAndroid.SHORT);
    }, [securityCode]);

    const loadSecurityCode = useCallback(async () => {
        try {
            setShowSecurityCode(true);
            const code = await publicKeyFingerprint(state.user_data.public_key || '');
            setSecurityCode(code);
        } catch (err) {
            logger.error(err);
        }
    }, [state.user_data]);

    return (
        <DrawerContentScrollView contentContainerStyle={{ height: '100%', backgroundColor: SECONDARY }} {...props}>
            <View style={{ flex: 1, justifyContent: 'space-between' }}>
                <View>
                    <View style={styles.profileContainer}>
                        <Avatar.Image
                            size={120}
                            source={{ uri: state.user_data.pic || getAvatar(state.user_data.id) }}
                            style={{ backgroundColor: DARKHEADER }}
                        />
                        <Text style={styles.username}>{state.user_data?.phone_no}</Text>
                        <TouchableRipple onPress={() => Linking.openURL(GITHUB_URL)}>
                            <View style={styles.versionRow}>
                                <Icon source="github" size={16} color={PRIMARY} />
                                <Text style={styles.version}>v{DeviceInfo.getVersion()}</Text>
                            </View>
                        </TouchableRipple>
                    </View>

                    <View style={styles.infoContainer}>
                        <InfoRow icon="account" label="Contacts" value={String(state.contacts?.length ?? 0)} />
                        <InfoRow
                            icon="account-key"
                            label="Keys"
                            value={KeypairAlgorithm.name + ' ' + KeypairAlgorithm.namedCurve}
                        />
                        <InfoRow icon="cellphone" label="Device" value={deviceName} />
                        <InfoRow icon="harddisk" label="Cache" value={cacheSize} />
                    </View>
                </View>

                <View>
                    <DrawerItem
                        inactiveTintColor={PRIMARY}
                        label="Security Code"
                        onPress={() => loadSecurityCode()}
                        icon={renderLockIcon}
                    />
                    <DrawerItem
                        inactiveTintColor={PRIMARY}
                        label="Settings"
                        onPress={() => {
                            props.navigation.navigate('Settings');
                            props.navigation.closeDrawer();
                        }}
                        icon={renderCogIcon}
                    />
                    <DrawerItem
                        inactiveTintColor="#fff"
                        label="Logout"
                        style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#333', backgroundColor: DARKHEADER }}
                        onPress={() => dispatch(logOut({ navigation: props.navigation as any }))}
                        icon={renderLogoutIcon}
                    />
                </View>
            </View>

            <Portal>
                <Dialog visible={showSecurityCode} onDismiss={() => setShowSecurityCode(false)}>
                    <Dialog.Icon icon="shield-lock" color={PRIMARY} />
                    <Dialog.Title style={{ textAlign: 'center' }}>Your Security Code</Dialog.Title>
                    <Dialog.Content>
                        {securityCode.match(/.{1,24}/g)?.map((val, idx) => (
                            <Text key={idx} style={{ fontFamily: 'monospace', textAlign: 'center', letterSpacing: 1 }}>
                                {val}
                            </Text>
                        ))}
                    </Dialog.Content>
                    <Dialog.Actions style={{ justifyContent: 'space-evenly' }}>
                        <Button
                            mode="contained-tonal"
                            onPress={() => setShowSecurityCode(false)}
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
            </Portal>
        </DrawerContentScrollView>
    );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
    return (
        <View style={styles.infoRow}>
            <Icon source={icon} size={18} color={SECONDARY_LITE} />
            <Text style={styles.infoLabel}>{label}</Text>
            <Text style={styles.infoValue}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    profileContainer: {
        alignItems: 'center',
        paddingVertical: 30,
    },
    username: {
        color: '#fff',
        fontSize: 18,
        marginTop: 12,
    },
    versionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 4,
        paddingVertical: 4,
        paddingHorizontal: 8,
    },
    version: {
        color: SECONDARY_LITE,
        fontSize: 12,
    },
    infoContainer: {
        paddingHorizontal: 8,
        paddingBottom: 0,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 8,
        gap: 10,
    },
    infoLabel: {
        color: SECONDARY_LITE,
        fontSize: 13,
    },
    infoValue: {
        color: '#fff',
        fontSize: 13,
        marginLeft: 'auto',
    },
});

const renderLockIcon = ({ size, color }: { size: number; color: string }) => {
    return <Icon source="shield-lock" color={color} size={size} />;
};

const renderCogIcon = ({ size, color }: { size: number; color: string }) => {
    return <Icon source="cog" color={color} size={size} />;
};

const renderLogoutIcon = ({ size, color }: { size: number; color: string }) => {
    return <Icon source="logout" color={color} size={size} />;
};
