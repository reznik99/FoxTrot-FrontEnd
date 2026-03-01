import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Button, Text, Icon, ActivityIndicator } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import Toast from 'react-native-toast-message';

import { PRIMARY, SECONDARY, SECONDARY_LITE } from '~/global/variables';
import { importKeysFromFile } from '~/global/keyImport';
import { exportKeysToFile } from '~/global/keyExport';
import { logger } from '~/global/logger';
import { generateAndSyncKeys } from '~/store/actions/user';
import { RootState, store } from '~/store/store';
import { RootNavigation } from '~/store/actions/auth';
import PasswordInput from '~/components/PasswordInput';

export default function KeySetup() {
    const navigation = useNavigation<RootNavigation>();
    const phoneNo = useSelector((state: RootState) => state.userReducer.user_data.phone_no);
    const hasKeys = useSelector((state: RootState) => Boolean(state.userReducer.keys));

    const [mode, setMode] = useState<'choice' | 'import' | 'export'>('choice');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingMsg, setLoadingMsg] = useState('');

    // When keys exist (came from Settings), update header to allow back navigation
    useEffect(() => {
        if (hasKeys) {
            navigation.setOptions({
                title: 'Manage Keys',
                headerLeft: undefined,
            });
        }
    }, [hasKeys, navigation]);

    const navigateAway = useCallback(() => {
        if (navigation.canGoBack()) {
            navigation.goBack();
        } else {
            navigation.replace('Home');
        }
    }, [navigation]);

    const handleGenerate = useCallback(async () => {
        Alert.alert(
            'Generate New Keys',
            'This will create a new identity keypair. If you already have keys on another device, those sessions will no longer work.\n\nContinue?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Generate',
                    onPress: async () => {
                        setLoading(true);
                        setLoadingMsg('Generating cryptographic keys...');
                        try {
                            const success = await store.dispatch(generateAndSyncKeys()).unwrap();
                            if (!success) {
                                Alert.alert('Failed', 'Could not generate keys. Please try again.');
                                return;
                            }
                            Toast.show({
                                type: 'success',
                                text1: 'Keys generated',
                                text2: 'Your identity keypair has been created',
                            });
                            navigateAway();
                        } catch (err: any) {
                            logger.error('Key generation failed:', err);
                            Alert.alert('Error', err.message ?? 'Key generation failed');
                        } finally {
                            setLoading(false);
                            setLoadingMsg('');
                        }
                    },
                },
            ],
        );
    }, [navigateAway]);

    const handleImport = useCallback(async () => {
        if (!password.trim()) {
            return;
        }
        setLoading(true);
        setLoadingMsg('Importing keys...');
        try {
            await importKeysFromFile(password, phoneNo);
            Toast.show({
                type: 'success',
                text1: 'Keys imported',
                text2: 'Messaging and decryption can now be performed',
                visibilityTime: 6000,
            });
            navigateAway();
        } catch (err: any) {
            logger.error('Key import failed:', err);
            Alert.alert('Import Failed', err.message ?? 'Failed to import keys');
        } finally {
            setLoading(false);
            setLoadingMsg('');
            setPassword('');
        }
    }, [password, phoneNo, navigateAway]);

    const handleExport = useCallback(async () => {
        if (!password.trim()) {
            return;
        }
        setLoading(true);
        setLoadingMsg('Exporting keys...');
        try {
            const fullPath = await exportKeysToFile(password, phoneNo);
            Toast.show({
                type: 'success',
                text1: 'Keys exported',
                text2: `Saved to ${fullPath}`,
                visibilityTime: 6000,
            });
        } catch (err: any) {
            logger.error('Key export failed:', err);
            Alert.alert('Export Failed', err.message ?? 'Failed to export keys');
        } finally {
            setLoading(false);
            setLoadingMsg('');
            setPassword('');
            setMode('choice');
        }
    }, [password, phoneNo]);

    if (loading) {
        return (
            <View style={styles.container}>
                <ActivityIndicator size="large" />
                <Text style={styles.loadingText}>{loadingMsg}</Text>
            </View>
        );
    }

    if (mode === 'import') {
        return (
            <View style={styles.container}>
                <Icon source="key-arrow-right" size={64} color={PRIMARY} />
                <Text variant="headlineSmall" style={styles.title}>
                    Import Keys
                </Text>
                <Text variant="bodyMedium" style={styles.subtitle}>
                    Enter the password used when exporting your keys, then select the key file.
                </Text>

                <View style={styles.inputContainer}>
                    <PasswordInput value={password} label="Decryption Password" mode="outlined" onChangeText={setPassword} />
                </View>

                <Button mode="contained" onPress={handleImport} disabled={!password.trim()} style={styles.button}>
                    Select File & Import
                </Button>
                <Button mode="text" onPress={() => setMode('choice')} textColor={SECONDARY_LITE} style={styles.button}>
                    Back
                </Button>
            </View>
        );
    }

    if (mode === 'export') {
        return (
            <View style={styles.container}>
                <Icon source="download-circle" size={64} color={PRIMARY} />
                <Text variant="headlineSmall" style={styles.title}>
                    Export Keys
                </Text>
                <Text variant="bodyMedium" style={styles.subtitle}>
                    Your keys will be encrypted with this password and saved to your Downloads folder.
                    {'\n\n'}A weak password can result in account takeover!
                </Text>

                <View style={styles.inputContainer}>
                    <PasswordInput value={password} label="Encryption Password" mode="outlined" onChangeText={setPassword} />
                </View>

                <Button mode="contained" onPress={handleExport} disabled={!password.trim()} style={styles.button}>
                    Export Keys
                </Button>
                <Button mode="text" onPress={() => setMode('choice')} textColor={SECONDARY_LITE} style={styles.button}>
                    Back
                </Button>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Icon source="shield-lock" size={64} color={PRIMARY} />
            <Text variant="headlineSmall" style={styles.title}>
                {hasKeys ? 'Manage Keys' : 'Set Up Encryption'}
            </Text>
            <Text variant="bodyMedium" style={styles.subtitle}>
                {hasKeys
                    ? 'Your cryptographic identity. Generate new keys, import from a backup, or export for safekeeping.'
                    : 'Your messages are end-to-end encrypted. You need an identity keypair to send and receive messages.'}
            </Text>

            <Button mode="contained" icon="key-plus" onPress={handleGenerate} style={styles.button}>
                Generate New Keys
            </Button>
            <Text variant="bodySmall" style={styles.hint}>
                {hasKeys ? 'Warning: replaces your current keys' : 'For new accounts or first-time setup'}
            </Text>

            <Button mode="contained-tonal" icon="key-arrow-right" onPress={() => setMode('import')} style={styles.button}>
                Import Existing Keys
            </Button>
            <Text variant="bodySmall" style={styles.hint}>
                If you already have keys on another device
            </Text>

            <Button
                mode="contained-tonal"
                icon="download-circle"
                onPress={() => setMode('export')}
                disabled={!hasKeys}
                style={styles.button}
            >
                Export Keys
            </Button>
            <Text variant="bodySmall" style={styles.hint}>
                {hasKeys ? 'Back up your keys to a file' : 'Export requires existing keys'}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: SECONDARY,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
    },
    title: {
        color: '#fff',
        fontWeight: 'bold',
        marginTop: 20,
        marginBottom: 8,
    },
    subtitle: {
        color: SECONDARY_LITE,
        textAlign: 'center',
        marginBottom: 32,
        lineHeight: 22,
    },
    button: {
        width: '100%',
        marginTop: 12,
    },
    hint: {
        color: SECONDARY_LITE,
        marginTop: 4,
        marginBottom: 8,
    },
    inputContainer: {
        width: '100%',
        marginBottom: 16,
    },
    loadingText: {
        color: '#fff',
        marginTop: 16,
    },
});
