import React, { useState } from 'react';
import { View, ScrollView } from 'react-native';
import { Button, TextInput, Text } from 'react-native-paper';
import { useSelector, useDispatch } from 'react-redux';
import { StackScreenProps } from '@react-navigation/stack';

import PasswordInput from '~/components/PasswordInput';
import { AppDispatch, RootState } from '~/store/store';
import { signUp } from '~/store/actions/auth';
import { logger } from '~/global/logger';
import { AuthStackParamList } from '~/../App';
import styles from './style';

export default function Signup(props: StackScreenProps<AuthStackParamList, 'Signup'>) {
    const loading = useSelector((state: RootState) => state.userReducer.loading);
    const signupErr = useSelector((state: RootState) => state.userReducer.signupErr);
    const dispatch = useDispatch<AppDispatch>();

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [rePassword, setRePassword] = useState('');

    const signup = async () => {
        if (loading) {
            return;
        }
        try {
            const success = await dispatch(signUp({ username, password, rePassword })).unwrap();
            if (success) {
                return props.navigation.navigate('Login', { data: { errorMsg: '', loggedOut: false } });
            }
        } catch (err) {
            logger.error('Signup error:', err);
        }
    };

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <View style={styles.wrapper}>
                <View style={styles.titleContainer}>
                    <Text style={styles.title}>FoxTrot</Text>
                    <Text style={styles.subTitle}>secure communications</Text>
                </View>
                {signupErr && <Text style={styles.errorMsg}>{signupErr}</Text>}

                <View style={{ gap: 8 }}>
                    <TextInput
                        mode="outlined"
                        onChangeText={val => setUsername(val.trim())}
                        value={username}
                        label="Username"
                        outlineColor={signupErr && !username ? 'red' : undefined}
                    />
                    <PasswordInput
                        mode="outlined"
                        autoCapitalize="none"
                        onChangeText={val => setPassword(val.trim())}
                        value={password}
                        label="Password"
                        outlineColor={signupErr && !password ? 'red' : undefined}
                    />
                    <PasswordInput
                        mode="outlined"
                        autoCapitalize="none"
                        onChangeText={val => setRePassword(val.trim())}
                        value={rePassword}
                        label="Repeat Password"
                        outlineColor={signupErr && (!rePassword || rePassword !== password) ? 'red' : undefined}
                    />
                </View>

                {/* Actions */}
                <View style={{ marginTop: 30, display: 'flex', alignItems: 'center' }}>
                    <Button mode="contained" icon="account-plus" style={styles.button} onPress={signup} loading={loading}>
                        Signup
                    </Button>
                </View>
            </View>
        </ScrollView>
    );
}
