import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView } from 'react-native';
import { Button, Dialog, Portal, Chip, Text, Divider, Switch, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { useDispatch, useSelector } from 'react-redux';
import * as Keychain from 'react-native-keychain';

import { API_URL, DARKHEADER, KeychainOpts, PRIMARY } from '~/global/variables';
import { logger, showErrorPortal } from '~/global/logger';
import DeviceInfo from 'react-native-device-info';
import { deleteFromStorage, getAllStorageKeys, readFromStorage, StorageKeys, writeToStorage } from '~/global/storage';
import { FlagSecure } from '~/global/native';
import globalStyle from '~/global/style';
import { logOut } from '~/store/actions/auth';
import { AppDispatch, RootState } from '~/store/store';
import { HomeStackParamList } from '~/../App';

export default function Settings(props: StackScreenProps<HomeStackParamList, 'Settings'>) {
    const dispatch = useDispatch<AppDispatch>();
    const user_data = useSelector((state: RootState) => state.userReducer.user_data);
    const theme = useTheme();
    const insets = useSafeAreaInsets();

    const [keys, setKeys] = useState<string[]>([]);
    const [hasIdentityKeys, setHasIdentityKeys] = useState(false);
    const [hasPassword, setHasPassword] = useState(false);
    const [alwaysRelay, setAlwaysRelay] = useState(false);
    const [screenSecurity, setScreenSecurity] = useState(false);
    const [autoEvict, setAutoEvict] = useState(true);
    const [visibleDialog, setVisibleDialog] = useState('');

    const loadAllDeviceData = useCallback(async () => {
        const allKeys = await getAllStorageKeys();
        const sortedKeys = allKeys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        setKeys(sortedKeys);
        readFromStorage(StorageKeys.ALWAYS_RELAY_CALLS).then(val => setAlwaysRelay(val === 'true'));
        readFromStorage(StorageKeys.SCREEN_SECURITY).then(val => setScreenSecurity(val === 'true'));
        readFromStorage(StorageKeys.AUTO_EVICT_CACHE).then(val => setAutoEvict(val !== 'false'));
        Keychain.hasInternetCredentials({ server: API_URL, service: `${user_data.phone_no}-keys` })
            .then(_hasKeys => setHasIdentityKeys(Boolean(_hasKeys)))
            .catch(err => logger.error('Error checking TPM for keys:', err));
        Keychain.hasGenericPassword({ server: API_URL, service: `${user_data.phone_no}-credentials` })
            .then(_hasPwd => setHasPassword(Boolean(_hasPwd)))
            .catch(err => logger.error('Error checking TPM for password:', err));
    }, [user_data]);

    useEffect(() => {
        loadAllDeviceData();
    }, [loadAllDeviceData]);

    const resetApp = useCallback(async () => {
        // Require authentication before allowing deletion
        const res = await Keychain.getGenericPassword({
            server: API_URL,
            service: `${user_data.phone_no}-credentials`,
            accessControl: KeychainOpts.accessControl,
            authenticationPrompt: {
                title: 'Authentication required',
            },
        });
        if (!res || !res.password) {
            return;
        }

        setVisibleDialog('');
        // Delete everything from the device
        const allKeys = await getAllStorageKeys();
        await Promise.all([
            ...allKeys.map(key => deleteFromStorage(key)),
            Keychain.resetInternetCredentials({ server: API_URL, service: `${user_data?.phone_no}-keys` }),
            Keychain.resetGenericPassword({ server: API_URL, service: `${user_data?.phone_no}-credentials` }),
        ]);
        dispatch(logOut({ navigation: props.navigation as any }));
    }, [user_data, props.navigation, dispatch]);

    const resetValue = useCallback(
        (key: string) => {
            deleteFromStorage(key);
            setKeys(keys.filter(k => k !== key));
        },
        [keys],
    );

    return (
        <View style={globalStyle.wrapper}>
            <ScrollView contentContainerStyle={{ padding: 30, paddingBottom: 30 + insets.bottom }}>
                <Text variant="titleSmall" style={{ marginBottom: 10, color: PRIMARY }}>
                    Security
                </Text>
                <View style={{ marginBottom: 10 }}>
                    <Text variant="bodyLarge">Identity Keys</Text>
                    <Text variant="bodySmall" style={{ color: '#999', marginBottom: 10 }}>
                        Your cryptographic identity. Generate, import, or export your encryption keys.
                    </Text>
                    <Button mode="contained" icon="key" onPress={() => props.navigation.navigate('KeySetup')}>
                        Manage Keys
                    </Button>
                </View>

                <Divider style={{ marginVertical: 15 }} />

                <Text variant="titleSmall" style={{ marginBottom: 10, color: PRIMARY }}>
                    Privacy
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1, marginRight: 10 }}>
                        <Text variant="bodyLarge">Always Relay Calls</Text>
                        <Text variant="bodySmall" style={{ color: '#999' }}>
                            Route calls through relay server to hide your IP address. May reduce call quality.
                        </Text>
                    </View>
                    <Switch
                        value={alwaysRelay}
                        onValueChange={val => {
                            setAlwaysRelay(val);
                            writeToStorage(StorageKeys.ALWAYS_RELAY_CALLS, String(val));
                        }}
                    />
                </View>
                <View
                    style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 15,
                    }}
                >
                    <View style={{ flex: 1, marginRight: 10 }}>
                        <Text variant="bodyLarge">Screen Security</Text>
                        <Text variant="bodySmall" style={{ color: '#999' }}>
                            Prevent screenshots and screen recording. Hides app content in recent apps.
                        </Text>
                    </View>
                    <Switch
                        value={screenSecurity}
                        onValueChange={val => {
                            setScreenSecurity(val);
                            writeToStorage(StorageKeys.SCREEN_SECURITY, String(val));
                            if (val) {
                                FlagSecure.enable();
                            } else {
                                FlagSecure.disable();
                            }
                        }}
                    />
                </View>

                <Divider style={{ marginVertical: 15 }} />

                <Text variant="titleSmall" style={{ marginBottom: 10, color: PRIMARY }}>
                    Diagnostics
                </Text>
                <View style={{ marginBottom: 10 }}>
                    <Text variant="bodyLarge">
                        App Logs{'  '}
                        <Text variant="bodySmall" style={{ color: '#666' }}>
                            v{DeviceInfo.getVersion()} ({DeviceInfo.getBuildNumber()})
                        </Text>
                    </Text>
                    <Text variant="bodySmall" style={{ color: '#999', marginBottom: 10 }}>
                        View recent application logs for troubleshooting. Logs are stored in memory and cleared on app
                        restart.
                    </Text>
                    <Button mode="contained-tonal" icon="text-box-search" onPress={() => showErrorPortal('Diagnostics')}>
                        View Logs
                    </Button>
                </View>
                <Divider style={{ marginVertical: 15 }} />

                <Text variant="titleSmall" style={{ marginBottom: 10, color: PRIMARY }}>
                    Storage
                </Text>
                <View
                    style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 15,
                    }}
                >
                    <View style={{ flex: 1, marginRight: 10 }}>
                        <Text variant="bodyLarge">Auto-Evict Media Cache</Text>
                        <Text variant="bodySmall" style={{ color: '#999' }}>
                            Automatically delete oldest cached media when cache exceeds 500 MB on app start.
                        </Text>
                    </View>
                    <Switch
                        value={autoEvict}
                        onValueChange={val => {
                            setAutoEvict(val);
                            writeToStorage(StorageKeys.AUTO_EVICT_CACHE, String(val));
                        }}
                    />
                </View>
                <View style={{ marginBottom: 10 }}>
                    <Text variant="bodyLarge">App Data</Text>
                    <Text variant="bodySmall" style={{ color: '#999', marginBottom: 10 }}>
                        Locally stored data including credentials, keys, and cached values. Tap X to remove individual
                        entries.
                    </Text>
                    <View style={{ gap: 5 }}>
                        {/* KeyChain values */}
                        {hasIdentityKeys && (
                            <Chip
                                selected
                                icon="key"
                                style={{ backgroundColor: DARKHEADER }}
                                closeIcon="close"
                                onClose={() => {
                                    Keychain.resetInternetCredentials({
                                        server: API_URL,
                                        service: `${user_data.phone_no}-keys`,
                                    }).then(() => setHasIdentityKeys(false));
                                }}
                            >
                                {user_data?.phone_no}-keys
                            </Chip>
                        )}
                        {hasPassword && (
                            <Chip
                                selected
                                icon="account-key"
                                style={{ backgroundColor: DARKHEADER }}
                                closeIcon="close"
                                onClose={() => {
                                    Keychain.resetGenericPassword({
                                        server: API_URL,
                                        service: `${user_data.phone_no}-credentials`,
                                    }).then(() => setHasPassword(false));
                                }}
                            >
                                {user_data?.phone_no}-credentials
                            </Chip>
                        )}
                        {/* Storage values */}
                        {keys.map((key, idx) => (
                            <Chip
                                icon="account"
                                style={{ backgroundColor: DARKHEADER }}
                                closeIcon="close"
                                onClose={() => resetValue(key)}
                                key={idx}
                            >
                                {key}
                            </Chip>
                        ))}
                    </View>
                </View>
                <View>
                    <Text variant="bodyLarge">Factory Reset</Text>
                    <Text variant="bodySmall" style={{ color: '#999', marginBottom: 10 }}>
                        Erase all local data including messages, keys, and credentials. This cannot be undone.
                    </Text>
                    <Button
                        mode="contained"
                        icon="alert-circle"
                        buttonColor={theme.colors.errorContainer}
                        textColor={theme.colors.error}
                        onPress={() => setVisibleDialog('reset')}
                        loading={visibleDialog === 'reset'}
                    >
                        Factory Reset App
                    </Button>
                </View>

                <Divider style={{ marginVertical: 15 }} />
            </ScrollView>

            <Portal>
                <Dialog visible={visibleDialog === 'reset'} onDismiss={() => setVisibleDialog('')}>
                    <Dialog.Icon icon="flash-triangle" color="yellow" />
                    <Dialog.Title style={{ textAlign: 'center' }}>Factory Reset App</Dialog.Title>
                    <Dialog.Content>
                        <Text>All message data will be lost.</Text>
                        <Text>If you plan to login from another device. Ensure you have exported your Keys!</Text>
                    </Dialog.Content>
                    <Dialog.Actions style={globalStyle.spaceBetween}>
                        <Button mode="contained-tonal" onPress={() => setVisibleDialog('')}>
                            Cancel
                        </Button>
                        <Button mode="contained" icon="delete" onPress={resetApp}>
                            Clear Data
                        </Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
        </View>
    );
}
