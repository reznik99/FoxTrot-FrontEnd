import axios, { AxiosError } from 'axios';
import * as Keychain from 'react-native-keychain';
import Toast from 'react-native-toast-message';
import { createAsyncThunk } from '@reduxjs/toolkit';
import { Alert } from 'react-native';

import { API_URL, KeychainOpts } from '~/global/variables';
import { getAvatar } from '~/global/helper';
import { deleteFromStorage, StorageKeys, writeToStorage } from '~/global/storage';
import { logger } from '~/global/logger';
import { LOGGED_IN, LOGIN_ERROR_MSG, LOGOUT, SET_LOADING, SIGNED_UP, SIGNUP_ERROR_MSG } from '../reducers/user';
import { AuthStackParamList, HomeStackParamList, RootDrawerParamList } from '~/../App';
import { StackNavigationProp } from '@react-navigation/stack';

type logInParams = { username: string; password: string };
export const logIn = createAsyncThunk('logIn', async ({ username, password }: logInParams, thunkAPI) => {
    if (username === '' || password === '') {
        thunkAPI.dispatch(LOGIN_ERROR_MSG('Textfields cannot be blank!'));
        return false;
    }
    try {
        thunkAPI.dispatch(SET_LOADING(true));

        const res = await axios.post(`${API_URL}/login`, {
            phone_no: username,
            password: password,
        });

        logger.debug('Saving user in storage');
        // Save user_data in phone storage
        const user_data = { pic: getAvatar(res.data.user_data?.id), ...res.data.user_data };
        writeToStorage(StorageKeys.USER_DATA, JSON.stringify(user_data));

        // Save password and JWT auth token in secure storage
        const secrets = {
            password: password,
            auth_token: res.data.token,
            time: Date.now(),
        };
        await Keychain.setGenericPassword(username, JSON.stringify(secrets), {
            server: API_URL,
            service: `${username}-credentials`,
            accessControl: KeychainOpts.accessControl,
            storage: Keychain.STORAGE_TYPE.AES_GCM,
        });

        // Save data in redux store
        thunkAPI.dispatch(LOGGED_IN({ token: res.data.token, user_data: user_data }));
        return true;
    } catch (err: any) {
        logger.error('Error logging in:', err);
        thunkAPI.dispatch(LOGIN_ERROR_MSG(err.response?.data?.message || err.message));
        Alert.alert('Unable to Login', err.response?.data?.message || err.message, [{ text: 'OK', onPress: () => {} }]);
        return false;
    } finally {
        thunkAPI.dispatch(SET_LOADING(false));
    }
});

type signUpParams = { username: string; password: string; rePassword: string };
export const signUp = createAsyncThunk(
    'signUp',
    async ({ username, password, rePassword }: signUpParams, thunkAPI): Promise<boolean> => {
        if (!username || !password || !rePassword) {
            thunkAPI.dispatch(SIGNUP_ERROR_MSG('Textfields cannot be blank!'));
            return false;
        } else if (password !== rePassword) {
            thunkAPI.dispatch(SIGNUP_ERROR_MSG('Passwords do not match!'));
            return false;
        } else if (username.length <= 3) {
            thunkAPI.dispatch(SIGNUP_ERROR_MSG('Username too short!'));
            return false;
        }
        thunkAPI.dispatch(SIGNUP_ERROR_MSG(''));
        try {
            thunkAPI.dispatch(SET_LOADING(true));

            const response = await axios.post(`${API_URL}/signup`, {
                phone_no: username,
                password: password,
            });
            // Save data in phone storage
            writeToStorage(StorageKeys.USER_DATA, JSON.stringify(response.data?.user_data || { phone_no: username }));
            thunkAPI.dispatch(SIGNED_UP(response.data?.user_data || { phone_no: username }));

            Toast.show({
                type: 'success',
                text1: 'Signed up successfully',
                text2: `As ${username}`,
                visibilityTime: 6000,
            });
            return true;
        } catch (err: any) {
            logger.error('Error signing up:', err);
            thunkAPI.dispatch(SIGNUP_ERROR_MSG(err.response?.data?.message || err.message));
            return false;
        } finally {
            thunkAPI.dispatch(SET_LOADING(false));
        }
    },
);

export type RootNavigation = StackNavigationProp<
    HomeStackParamList & AuthStackParamList & RootDrawerParamList,
    'FoxTrot',
    undefined
>;
export const logOut = createAsyncThunk('logOut', async ({ navigation }: { navigation: RootNavigation }, thunkAPI) => {
    logger.debug('Logging out');
    // Clear redux state
    thunkAPI.dispatch(LOGOUT(undefined));
    // Clear storage
    await deleteFromStorage(StorageKeys.USER_DATA);

    navigation.replace('Login', { data: { loggedOut: true, errorMsg: '' } });
});

export function setupInterceptors(navigation: RootNavigation) {
    axios.interceptors.response.use(
        response => response,
        (error: AxiosError) => {
            if (error.response?.status === 403) {
                // TODO: Re-authenticate instead of signing out
                navigation.replace('Login', {
                    data: { loggedOut: true, errorMsg: 'Session expired. Please re-authenticate.' },
                });
            }
            return Promise.reject(error);
        },
    );
}
