import 'react-native-gesture-handler';
import '~/global/buffer';
import '~/global/backgroundHandler';

import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createDrawerNavigator, DrawerContentComponentProps, DrawerNavigationOptions } from '@react-navigation/drawer';
import { DarkTheme as NavDarkTheme, NavigationContainer, RouteProp } from '@react-navigation/native';
import {
    CardStyleInterpolators,
    createStackNavigator,
    StackHeaderProps,
    StackNavigationOptions,
} from '@react-navigation/stack';
import { Icon, MD3DarkTheme, Provider as PaperProvider, useTheme } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { Provider } from 'react-redux';

import ActiveCallBanner from '~/components/ActiveCallBanner';
import ConnectionIndicator from '~/components/ConnectionIndicator';
import Drawer from '~/components/Drawer';
import ErrorBoundary from '~/components/ErrorBoundary';
import ErrorPortal from '~/components/ErrorPortal';
import HeaderConversation from '~/components/HeaderConversation';
import { dbGetUnseenCallCount } from '~/global/database';
import { logger, showErrorPortal } from '~/global/logger';
import { FlagSecure } from '~/global/native';
import {
    AuthStackParamList,
    HomeStackParamList,
    HomeTabParamList,
    navigationRef,
    RootDrawerParamList,
} from '~/global/navigation';
import { readFromStorage, StorageKeys } from '~/global/storage';
// App
import { ACCENT, DARKHEADER, DIVIDER, ERROR_RED, PRIMARY, SECONDARY, SECONDARY_LITE } from '~/global/variables';
import * as websocketManager from '~/global/websocketManager';
import { store } from '~/store/store';

import {
    AddContact,
    Call,
    CallHistory,
    CameraView,
    Conversation,
    Home,
    KeySetup,
    Login,
    NewConversation,
    Settings,
    Signup,
} from './src';

const defaultHeaderOptions: StackNavigationOptions & DrawerNavigationOptions = {
    headerStyle: {
        backgroundColor: DARKHEADER,
    },
    headerTintColor: '#fff',
    headerTitleStyle: {
        fontWeight: 'bold',
    },
    drawerIcon: ({ color }) => <Icon source="home" color={color} size={20} />,
};
const animationDefaults: StackNavigationOptions = {
    cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
    gestureEnabled: true,
    gestureDirection: 'horizontal',
};

// Bottom tabs inside the drawer
const Tab = createBottomTabNavigator<HomeTabParamList>();
const renderMessagesIcon = ({ color, size }: { color: string; size: number }) => (
    <Icon source="message-text" color={color} size={size} />
);
const renderCallsIcon = ({ color, size }: { color: string; size: number }) => (
    <Icon source="phone" color={color} size={size} />
);
const HomeTabs = () => {
    const { colors } = useTheme();
    const [unseenCount, setUnseenCount] = useState(0);
    const refreshBadge = useCallback(() => {
        try {
            setUnseenCount(dbGetUnseenCallCount());
        } catch {
            setUnseenCount(0);
        }
    }, []);
    useEffect(() => {
        refreshBadge();
    }, [refreshBadge]);
    return (
        <Tab.Navigator
            screenOptions={{
                headerShown: false,
                tabBarStyle: { backgroundColor: DARKHEADER, borderTopColor: DIVIDER },
                tabBarActiveTintColor: colors.primary,
                tabBarInactiveTintColor: SECONDARY_LITE,
                tabBarBadgeStyle: { backgroundColor: ERROR_RED },
            }}
            screenListeners={{ state: refreshBadge }}
        >
            <Tab.Screen
                name="Messages"
                component={Home}
                options={{
                    tabBarIcon: renderMessagesIcon,
                }}
            />
            <Tab.Screen
                name="Calls"
                component={CallHistory}
                options={{
                    tabBarIcon: renderCallsIcon,
                    tabBarBadge: unseenCount > 0 ? unseenCount : undefined,
                }}
            />
        </Tab.Navigator>
    );
};

const renderConnectionIndicator = () => <ConnectionIndicator />;

const AppNavigator = createDrawerNavigator<RootDrawerParamList>();
const AppDrawer = () => {
    return (
        <AppNavigator.Navigator screenOptions={{ swipeEdgeWidth: 200 }} drawerContent={renderDrawerContent}>
            <AppNavigator.Screen
                name="FoxTrot"
                component={HomeTabs}
                options={{ ...defaultHeaderOptions, headerRight: renderConnectionIndicator }}
            />
        </AppNavigator.Navigator>
    );
};
const renderDrawerContent = (props: DrawerContentComponentProps) => <Drawer {...props} />;

const HomeStack = createStackNavigator<HomeStackParamList>();
const HomeNavigator = () => {
    useEffect(() => {
        websocketManager.start();
        return () => {
            websocketManager.stop();
        };
    }, []);

    return (
        <HomeStack.Navigator initialRouteName="Home" screenOptions={{ ...defaultHeaderOptions, ...animationDefaults }}>
            <HomeStack.Screen name="Home" component={AppDrawer} options={{ headerShown: false }} />
            <HomeStack.Screen name="Conversation" component={Conversation} options={renderHeaderConversation} />
            <HomeStack.Screen name="NewConversation" component={NewConversation} options={{ title: 'My Contacts' }} />
            <HomeStack.Screen name="AddContact" component={AddContact} options={{ title: 'Search New Users' }} />
            <HomeStack.Screen name="Call" component={Call as any} options={renderHeaderConversation} />
            <HomeStack.Screen name="CameraView" component={CameraView} options={{ title: 'Camera' }} />
            <HomeStack.Screen name="Settings" component={Settings} options={{ title: 'Settings' }} />
            <HomeStack.Screen
                name="KeySetup"
                component={KeySetup}
                options={{ title: 'Set Up Encryption', headerLeft: () => null }}
            />
        </HomeStack.Navigator>
    );
};
const renderHeaderConversation = ({
    route,
}: {
    route: RouteProp<HomeStackParamList, 'Call' | 'Conversation'>;
}): StackNavigationOptions => ({
    header: (props: StackHeaderProps) => (
        <HeaderConversation navigation={props.navigation as any} data={route.params.data} allowBack={true} />
    ),
});

const AuthStack = createStackNavigator<AuthStackParamList>();
const AuthNavigator = () => {
    return (
        <NavigationContainer ref={navigationRef} theme={NavDarkTheme}>
            <AuthStack.Navigator screenOptions={{ ...defaultHeaderOptions, ...animationDefaults }}>
                <AuthStack.Screen name="Login" component={Login} options={{ headerShown: false }} />
                <AuthStack.Screen name="Signup" component={Signup} />
                <AuthStack.Screen name="App" component={HomeNavigator} options={{ headerShown: false }} />
            </AuthStack.Navigator>
        </NavigationContainer>
    );
};

export const PrimaryColorContext = createContext<(color: string) => void>(() => {});

export default function App() {
    const [primaryColor, setPrimaryColor] = useState(PRIMARY);

    const darkTheme = useMemo(
        () => ({
            ...MD3DarkTheme,
            colors: {
                ...MD3DarkTheme.colors,
                primary: primaryColor,
                onPrimary: '#fff',
                background: SECONDARY,
                accent: ACCENT,
            },
        }),
        [primaryColor],
    );

    useEffect(() => {
        readFromStorage(StorageKeys.SCREEN_SECURITY).then(val => {
            if (val === 'true') {
                FlagSecure.enable();
            }
        });
        readFromStorage(StorageKeys.PRIMARY_COLOR).then(val => {
            if (val) {
                setPrimaryColor(val);
            }
        });

        const defaultHandler = ErrorUtils.getGlobalHandler();
        ErrorUtils.setGlobalHandler((error, isFatal) => {
            logger.error(`Unhandled ${isFatal ? 'fatal ' : ''}error:`, error?.message, error?.stack);
            showErrorPortal('Unhandled Error');
            defaultHandler(error, isFatal);
        });
    }, []);

    return (
        <Provider store={store}>
            <PaperProvider theme={darkTheme}>
                <PrimaryColorContext.Provider value={setPrimaryColor}>
                    <StatusBar backgroundColor={DARKHEADER} barStyle="light-content" />
                    <ErrorBoundary>
                        <AuthNavigator />
                    </ErrorBoundary>
                    <ActiveCallBanner />
                    <ErrorPortal />
                    <Toast />
                </PrimaryColorContext.Provider>
            </PaperProvider>
        </Provider>
    );
}
