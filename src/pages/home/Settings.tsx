import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, Alert } from 'react-native';
import { Button, Dialog, Portal, Chip, Text, Divider, Switch, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pick, types } from '@react-native-documents/picker';
import { StackScreenProps } from '@react-navigation/stack';
import { useDispatch, useSelector } from 'react-redux';
import * as Keychain from 'react-native-keychain';
import QuickCrypto from 'react-native-quick-crypto';
import Toast from 'react-native-toast-message';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';

import { API_URL, DARKHEADER, KeychainOpts, PRIMARY, SaltLenGCM, SaltLenPBKDF2 } from '~/global/variables';
import { getReadExtPermission, getWriteExtPermission } from '~/global/permissions';
import { deriveKeyFromPassword, exportKeypair } from '~/global/crypto';
import { deleteFromStorage, getAllStorageKeys, readFromStorage, writeToStorage } from '~/global/storage';
import { FlagSecure } from '~/global/native';
import globalStyle from '~/global/style';
import { loadContacts, loadKeys } from '~/store/actions/user';
import { logOut } from '~/store/actions/auth';
import { AppDispatch, RootState } from '~/store/store';
import { HomeStackParamList } from '~/../App';
import PasswordInput from '~/components/PasswordInput';

export default function Settings(props: StackScreenProps<HomeStackParamList, 'Settings'>) {
    const dispatch = useDispatch<AppDispatch>();
    const user_data = useSelector((state: RootState) => state.userReducer.user_data);
    const keypair = useSelector((state: RootState) => state.userReducer.keys);
    const theme = useTheme();
    const insets = useSafeAreaInsets();

    const [keys, setKeys] = useState<string[]>([]);
    const [hasIdentityKeys, setHasIdentityKeys] = useState(false);
    const [hasPassword, setHasPassword] = useState(false);
    const [alwaysRelay, setAlwaysRelay] = useState(false);
    const [screenSecurity, setScreenSecurity] = useState(false);
    const [visibleDialog, setVisibleDialog] = useState('');
    const [encPassword, setEncPassword] = useState('');

    const loadAllDeviceData = useCallback(async () => {
        const allKeys = await getAllStorageKeys();
        const sortedKeys = allKeys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        setKeys(sortedKeys);
        readFromStorage('always-relay-calls').then(val => setAlwaysRelay(val === 'true'));
        readFromStorage('screen-security').then(val => setScreenSecurity(val === 'true'));
        Keychain.hasInternetCredentials({ server: API_URL, service: `${user_data.phone_no}-keys` })
            .then(_hasKeys => setHasIdentityKeys(Boolean(_hasKeys)))
            .catch(err => console.error('Error checking TPM for keys:', err));
        Keychain.hasGenericPassword({ server: API_URL, service: `${user_data.phone_no}-credentials` })
            .then(_hasPwd => setHasPassword(Boolean(_hasPwd)))
            .catch(err => console.error('Error checking TPM for password:', err));
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
        await Promise.all(allKeys.map(key => deleteFromStorage(key)));
        Promise.all([
            Keychain.resetInternetCredentials({ server: API_URL, service: `${user_data?.phone_no}-keys` }),
            Keychain.resetGenericPassword({ server: API_URL, service: `${user_data?.phone_no}-credentials` }),
            dispatch(logOut({ navigation: props.navigation as any })),
        ]);
    }, [user_data, props.navigation, dispatch]);

    const resetValue = useCallback(
        (key: string) => {
            deleteFromStorage(key);
            setKeys(keys.filter(k => k !== key));
        },
        [keys],
    );

    const importKeys = async () => {
        if (!encPassword?.trim()) {
            return;
        }

        try {
            const hasPermission = await getReadExtPermission();
            if (!hasPermission) {
                throw new Error('Permission to read from external storage denied');
            }
            // Read encrypted key file
            console.debug('Reading Encrypted keypair file...');
            const [fileSelected] = await pick({ type: types.plainText, mode: 'open' });
            if (!fileSelected.uri) {
                throw new Error('Failed to pick file:' + fileSelected.error || 'unknown');
            }

            const file = await RNFS.readFile(fileSelected.uri);

            // Parse PBKDF2 no. of iterations, salt, IV and Ciphertext and re-generate encryption key
            console.debug('Deriving key encryption key from password...');
            const [_, iter, salt, iv, ciphertext] = file.split('\n');
            const derivedKEK = await deriveKeyFromPassword(encPassword, Buffer.from(salt, 'base64'), parseInt(iter, 10));

            // Decrypt Keypair
            console.debug('Decrypting keypair file...');
            let Ikeys = new ArrayBuffer();
            try {
                Ikeys = await QuickCrypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: Buffer.from(iv, 'base64') },
                    derivedKEK,
                    Buffer.from(ciphertext, 'base64'),
                );
            } catch (err) {
                console.error('Decryption error: Invalid password or corrupted file:', err);
                throw new Error('Decryption error: Invalid password or corrupted file');
            }

            // Store on device
            console.debug('Saving keys into TPM...');
            await Keychain.setInternetCredentials(API_URL, `${user_data.phone_no}-keys`, Buffer.from(Ikeys).toString(), {
                storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
                server: API_URL,
                service: `${user_data.phone_no}-keys`,
            });

            // Load into redux store
            console.debug('Loading keys into App...');
            const success = await dispatch(loadKeys()).unwrap();
            if (!success) {
                throw new Error('Failed to load imported keys into app');
            }

            // TODO: Validate that public key locally matches public key on Key Server.

            // Reload contacts to re-generate per-conversation encryption keys (ECDH)
            console.debug('Regenerating Conversation encryption keys...');
            await dispatch(loadContacts({ atomic: true }));

            Toast.show({
                type: 'success',
                text1: 'Succesfully imported Keys',
                text2: 'Messaging and Decryption can now be performed',
                visibilityTime: 6000,
            });
        } catch (err: any) {
            console.error('Error importing user keys:', err);
            Alert.alert('Failed to import keys', err.message ?? err.toString(), [{ text: 'OK', onPress: () => {} }]);
        } finally {
            setVisibleDialog('');
            setEncPassword('');
            loadAllDeviceData();
        }
    };

    const exportKeys = async () => {
        if (!encPassword?.trim() || !keypair) {
            return;
        }

        try {
            const IKeys = await exportKeypair(keypair);
            const iter = 100000;
            const salt = QuickCrypto.getRandomValues(new Uint8Array(SaltLenPBKDF2));
            const derivedKEK = await deriveKeyFromPassword(encPassword, salt, iter);

            // Encrypt Keypair
            const iv = QuickCrypto.getRandomValues(new Uint8Array(SaltLenGCM));
            const encryptedIKeys = await QuickCrypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                derivedKEK,
                Buffer.from(JSON.stringify(IKeys)),
            );

            // Store PBKDF2 no. of iterations, salt, IV and Ciphertext
            const file =
                'Foxtrot encrypted keys' +
                '\n' +
                iter +
                '\n' +
                Buffer.from(salt).toString('base64') +
                '\n' +
                Buffer.from(iv).toString('base64') +
                '\n' +
                Buffer.from(encryptedIKeys).toString('base64');
            console.debug('File: \n', file);

            const hasPermission = await getWriteExtPermission();
            if (!hasPermission) {
                console.error('Permission to write to external storage denied');
                return;
            }

            const fullPath = RNFS.DownloadDirectoryPath + `/${user_data.phone_no}-keys-${Date.now()}.txt`;
            // Delete file first, RNFS bug causes malformed writes if overwriting: https://github.com/itinance/react-native-fs/issues/700
            await RNFS.writeFile(fullPath, file);

            Toast.show({
                type: 'success',
                text1: 'Succesfully exported Keys',
                text2: `Saved the encrypted keys to ${fullPath}`,
                visibilityTime: 6000,
            });
        } catch (err: any) {
            console.error('Error exporting user keys:', err);
            Alert.alert('Failed to export keys', err.message ?? err.toString(), [{ text: 'OK', onPress: () => {} }]);
        } finally {
            setVisibleDialog('');
            setEncPassword('');
        }
    };

    return (
        <View style={globalStyle.wrapper}>
            <ScrollView contentContainerStyle={{ padding: 30, paddingBottom: 30 + insets.bottom }}>
                <Text variant="titleSmall" style={{ marginBottom: 10, color: PRIMARY }}>
                    Security
                </Text>
                <View style={{ marginBottom: 10 }}>
                    <Text variant="bodyLarge">Identity Keys</Text>
                    <Text variant="bodySmall" style={{ color: '#999', marginBottom: 10 }}>
                        Your cryptographic identity. Export to back up, import to restore on a new device.
                    </Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Button
                            mode="contained"
                            icon="upload-circle"
                            onPress={() => setVisibleDialog('import')}
                            loading={visibleDialog === 'import'}
                        >
                            Import Keys
                        </Button>
                        <Button
                            mode="contained"
                            icon="download-circle"
                            onPress={() => setVisibleDialog('export')}
                            loading={visibleDialog === 'export'}
                        >
                            Export Keys
                        </Button>
                    </View>
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
                            writeToStorage('always-relay-calls', String(val));
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
                            writeToStorage('screen-security', String(val));
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
                    Storage
                </Text>
                <View style={{ marginBottom: 10 }}>
                    <Text variant="bodyLarge">App Data</Text>
                    <Text variant="bodySmall" style={{ color: '#999', marginBottom: 10 }}>
                        Locally stored data including credentials, keys, and cached values. Tap X to remove individual
                        entries.
                    </Text>
                    <View style={{ gap: 5 }}>
                        {/* KeyChain values */}
                        {hasIdentityKeys && (
                            <Chip selected icon="key" style={{ backgroundColor: DARKHEADER }}>
                                {user_data?.phone_no}-keys
                            </Chip>
                        )}
                        {hasPassword && (
                            <Chip selected icon="account-key" style={{ backgroundColor: DARKHEADER }}>
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

                <Dialog visible={visibleDialog === 'import'} onDismiss={() => setVisibleDialog('')}>
                    <Dialog.Icon icon="file-import" />
                    <Dialog.Title style={{ textAlign: 'center' }}>Import Identity Keys</Dialog.Title>
                    <Dialog.Content>
                        <Text style={globalStyle.dialogText}>
                            File selection will be prompted after decryption password is provided
                        </Text>
                        <PasswordInput
                            label="Keypair decryption password"
                            autoCapitalize="none"
                            onChangeText={setEncPassword}
                            value={encPassword}
                        />
                    </Dialog.Content>
                    <Dialog.Actions style={globalStyle.spaceBetween}>
                        <Button mode="contained-tonal" onPress={() => setVisibleDialog('')}>
                            Cancel
                        </Button>
                        <Button mode="contained" onPress={importKeys} icon="upload" disabled={!encPassword?.trim()}>
                            Import
                        </Button>
                    </Dialog.Actions>
                </Dialog>

                <Dialog visible={visibleDialog === 'export'} onDismiss={() => setVisibleDialog('')}>
                    <Dialog.Icon icon="file-export" />
                    <Dialog.Title style={{ textAlign: 'center' }}>Export Identity Keys</Dialog.Title>
                    <Dialog.Content>
                        <Text style={globalStyle.dialogText}>A weak password can result in account takeover!</Text>
                        <PasswordInput
                            label="Keypair encryption password"
                            autoCapitalize="none"
                            onChangeText={setEncPassword}
                            value={encPassword}
                        />
                    </Dialog.Content>
                    <Dialog.Actions style={globalStyle.spaceBetween}>
                        <Button mode="contained-tonal" onPress={() => setVisibleDialog('')}>
                            Cancel
                        </Button>
                        <Button
                            mode="contained"
                            onPress={exportKeys}
                            icon="download"
                            disabled={!encPassword?.trim() || !keypair}
                        >
                            Export
                        </Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
        </View>
    );
}
