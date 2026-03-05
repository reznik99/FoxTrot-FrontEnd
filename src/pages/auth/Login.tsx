import React, { useEffect, useState } from 'react';
import { Alert, Image, Keyboard, ScrollView, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import BootSplash from 'react-native-bootsplash';
import * as Keychain from 'react-native-keychain';
import { ActivityIndicator, Button, IconButton, Text, TextInput, useTheme } from 'react-native-paper';
import { useSelector } from 'react-redux';

import PasswordInput from '~/components/PasswordInput';
import { milliseconds, millisecondsSince } from '~/global/helper';
import { logger } from '~/global/logger';
import { AuthStackParamList } from '~/global/navigation';
import { API_URL, KeychainOpts } from '~/global/variables';
import { logIn } from '~/store/actions/auth';
import { syncFromStorage, validateToken } from '~/store/actions/user';
import { RootState, store } from '~/store/store';

import styles from './style';

type Credentials = {
    username: string;
    password: string;
    auth_token: string;
    time: number;
};

export default function Login(props: StackScreenProps<AuthStackParamList, 'Login'>) {
    const { colors } = useTheme();
    const user_data = useSelector((state: RootState) => state.userReducer.user_data);
    const loading = useSelector((state: RootState) => state.userReducer.loading);
    const loginErr = useSelector((state: RootState) => state.userReducer.loginErr);

    const [globalLoading, setGlobalLoading] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [hasCreds, setHasCreds] = useState(false);

    const loggedOut = props.route.params?.data?.loggedOut;

    useEffect(() => {
        BootSplash.hide({ fade: true });

        if (loggedOut && props.route.params?.data?.errorMsg) {
            Alert.alert('Unable to Login', props.route.params.data.errorMsg, [{ text: 'OK', onPress: () => {} }]);
        }

        initLogin();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const initLogin = async () => {
        setGlobalLoading(true);
        try {
            // 1. Resolve username: Redux → storage → give up
            let user_name = user_data?.phone_no || undefined;
            if (!user_name) {
                const stored = await store.dispatch(syncFromStorage()).unwrap();
                user_name = stored?.phone_no;
            }
            if (user_name) {
                setUsername(user_name);
            } else {
                return;
            }
            // 2. Check if we have stored credentials (for fingerprint button)
            const credsFound = await Keychain.hasGenericPassword({
                server: API_URL,
                service: `${user_name}-credentials`,
            });
            setHasCreds(credsFound);

            // 3. Auto-login if we have creds and weren't explicitly logged out
            if (credsFound && !loggedOut) {
                await attemptAutoLogin(user_name!);
            }
        } catch (err) {
            logger.error('Error on auto-login:', err);
        } finally {
            setGlobalLoading(false);
        }
    };

    const attemptAutoLogin = async (user_name: string) => {
        const creds = await loadCredentials(user_name);
        if (!creds) {
            return;
        }

        // If auth token is recent (<30min) then validate it
        if (millisecondsSince(new Date(creds.time)) < milliseconds.hour / 2) {
            const tokenIsValid = await store.dispatch(validateToken(creds.auth_token)).unwrap();
            if (tokenIsValid) {
                logger.debug('JWT auth token still valid, skipping login...');
                props.navigation.replace('App');
                return;
            }
        }
        // Auth token expired, use password
        await handleLogin(user_name, creds.password);
    };

    const loadCredentials = async (user_name: string) => {
        try {
            logger.debug('Loading credentials from secure storage');
            const res = await Keychain.getGenericPassword({
                server: API_URL,
                service: `${user_name}-credentials`,
                accessControl: KeychainOpts.accessControl,
                authenticationPrompt: KeychainOpts.authenticationPrompt,
            });
            if (!res || res.username !== user_name) {
                return undefined;
            }

            const creds = JSON.parse(res.password);
            return { username: res.username, ...creds } as Credentials;
        } catch (err: any) {
            const msg = err?.message || '';
            if (msg.includes('code: 10') || msg.includes('code: 13')) {
                logger.debug('Biometric authentication cancelled');
                return undefined;
            }
            logger.error('Failed to load creds:', err);
            return undefined;
        }
    };

    const handleLogin = async (user_name: string, password_: string) => {
        if (loading) {
            return;
        }

        Keyboard.dismiss();
        const loggedIn = await store.dispatch(logIn({ username: user_name, password: password_ })).unwrap();
        if (loggedIn) {
            logger.debug('Routing to home page');
            props.navigation.replace('App');
        }
    };

    return (
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
            <View style={styles.titleContainer}>
                <Image source={require('../../../assets/bootsplash/logo.png')} style={{ width: 80, height: 80 }} />
                <Text style={styles.title}>FoxTrot</Text>
                <Text style={[styles.subTitle, { color: colors.primary }]}>secure communications</Text>
            </View>

            {loginErr && <Text style={styles.errorMsg}>{loginErr}</Text>}

            {globalLoading ? (
                <ActivityIndicator size="large" />
            ) : (
                <>
                    <View style={{ gap: 8 }}>
                        <TextInput
                            mode="outlined"
                            autoCapitalize="none"
                            onChangeText={val => setUsername(val.trim())}
                            value={username}
                            label="Username"
                            outlineColor={loginErr ? 'red' : undefined}
                        />
                        <PasswordInput
                            mode="outlined"
                            autoCapitalize="none"
                            onChangeText={val => setPassword(val.trim())}
                            value={password}
                            label="Password"
                            outlineColor={loginErr ? 'red' : undefined}
                        />
                    </View>

                    <Button
                        mode="contained"
                        icon="login"
                        style={[styles.button, { marginTop: 20 }]}
                        loading={loading}
                        onPress={() => handleLogin(username, password)}
                    >
                        Login
                    </Button>

                    <View style={styles.dividerRow}>
                        <View style={styles.dividerLine} />
                        <Text style={styles.dividerText}>or</Text>
                        <View style={styles.dividerLine} />
                    </View>

                    <Button
                        mode="contained"
                        icon="account-plus"
                        style={styles.buttonSecondary}
                        onPress={() => props.navigation.navigate('Signup')}
                    >
                        Create Account
                    </Button>

                    {hasCreds && (
                        <View style={styles.biometricContainer}>
                            <IconButton
                                icon="fingerprint"
                                size={50}
                                iconColor={colors.primary}
                                onPress={() => attemptAutoLogin(username)}
                                accessibilityLabel="Retry biometric authentication"
                            />
                            <Text style={styles.biometricHint}>Quick login with biometrics</Text>
                        </View>
                    )}
                </>
            )}
        </ScrollView>
    );
}
