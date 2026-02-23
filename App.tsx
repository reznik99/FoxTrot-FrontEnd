import 'react-native-gesture-handler';
import 'react-native-quick-base64';
import React, { useState, useCallback } from 'react';
import { StatusBar } from 'react-native';
import { Provider } from 'react-redux';
import { Provider as PaperProvider, MD3DarkTheme, Icon } from 'react-native-paper';
import { NavigationContainer, DarkTheme as NavDarkTheme, RouteProp } from '@react-navigation/native';
import {
    createStackNavigator,
    CardStyleInterpolators,
    StackNavigationOptions,
    StackHeaderProps,
} from '@react-navigation/stack';
import { createDrawerNavigator, DrawerContentComponentProps, DrawerNavigationOptions } from '@react-navigation/drawer';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Toast from 'react-native-toast-message';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging'; // Push Notifications
import RNNotificationCall, { DeclinePayload } from 'react-native-full-screen-notification-incoming-call';
import InCallManager from 'react-native-incall-manager';
import PushNotification from 'react-native-push-notification';
import QuickCrypto from 'react-native-quick-crypto';
import { Buffer } from 'buffer';

global.Buffer = global.Buffer || Buffer;

// App
import { store } from '~/store/store';
import {
    Login,
    Signup,
    Home,
    Conversation,
    NewConversation,
    AddContact,
    Call,
    CameraView,
    Settings,
    CallHistory,
} from './src';
import { PRIMARY, SECONDARY, SECONDARY_LITE, ACCENT, DARKHEADER, VibratePattern } from '~/global/variables';
import Drawer from '~/components/Drawer';
import HeaderConversation from '~/components/HeaderConversation';
import { UserData } from '~/store/reducers/user';
import { deleteFromStorage, writeToStorage } from '~/global/storage';
import { getDb, dbSaveCallRecord, dbGetUnseenCallCount } from '~/global/database';
import { getAvatar } from '~/global/helper';
import { SocketMessage } from '~/store/actions/websocket';

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
export type HomeTabParamList = {
    Messages: undefined;
    Calls: undefined;
};
const Tab = createBottomTabNavigator<HomeTabParamList>();
const renderMessagesIcon = ({ color, size }: { color: string; size: number }) => (
    <Icon source="message-text" color={color} size={size} />
);
const renderCallsIcon = ({ color, size }: { color: string; size: number }) => (
    <Icon source="phone" color={color} size={size} />
);
const HomeTabs = () => {
    const [unseenCount, setUnseenCount] = useState(0);
    const refreshBadge = useCallback(() => {
        try {
            setUnseenCount(dbGetUnseenCallCount());
        } catch {
            setUnseenCount(0);
        }
    }, []);
    return (
        <Tab.Navigator
            screenOptions={{
                headerShown: false,
                tabBarStyle: { backgroundColor: DARKHEADER, borderTopColor: '#333' },
                tabBarActiveTintColor: PRIMARY,
                tabBarInactiveTintColor: SECONDARY_LITE,
                tabBarBadgeStyle: { backgroundColor: '#e53935' },
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

export type RootDrawerParamList = {
    FoxTrot: undefined;
};
const AppNavigator = createDrawerNavigator<RootDrawerParamList>();
const AppDrawer = () => {
    return (
        <AppNavigator.Navigator screenOptions={{ swipeEdgeWidth: 200 }} drawerContent={renderDrawerContent}>
            <AppNavigator.Screen name="FoxTrot" component={HomeTabs} options={defaultHeaderOptions} />
        </AppNavigator.Navigator>
    );
};
const renderDrawerContent = (props: DrawerContentComponentProps) => <Drawer {...props} />;

export type HomeStackParamList = {
    Home: undefined;
    Conversation: { data: { peer_user: UserData } };
    NewConversation: undefined;
    AddContact: undefined;
    Call: { data: { peer_user: UserData; video_enabled: boolean } };
    CameraView: { data: { peer: UserData; picturePath: string } };
    Settings: undefined;
};
const HomeStack = createStackNavigator<HomeStackParamList>();
const HomeNavigator = () => {
    return (
        <HomeStack.Navigator initialRouteName="Home" screenOptions={{ ...defaultHeaderOptions, ...animationDefaults }}>
            <HomeStack.Screen name="Home" component={AppDrawer} options={{ headerShown: false }} />
            <HomeStack.Screen name="Conversation" component={Conversation} options={renderHeaderConversation} />
            <HomeStack.Screen name="NewConversation" component={NewConversation} options={{ title: 'My Contacts' }} />
            <HomeStack.Screen name="AddContact" component={AddContact} options={{ title: 'Search New Users' }} />
            <HomeStack.Screen name="Call" component={Call as any} options={renderHeaderConversation} />
            <HomeStack.Screen name="CameraView" component={CameraView} options={{ title: 'Camera' }} />
            <HomeStack.Screen name="Settings" component={Settings} options={{ title: 'Settings' }} />
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

export type AuthStackParamList = {
    Login: { data: { errorMsg: string; loggedOut: boolean } };
    Signup: undefined;
    App: undefined;
};
const AuthStack = createStackNavigator<AuthStackParamList>();
const AuthNavigator = () => {
    return (
        <NavigationContainer theme={NavDarkTheme}>
            <AuthStack.Navigator screenOptions={{ ...defaultHeaderOptions, ...animationDefaults }}>
                <AuthStack.Screen name="Login" component={Login} options={{ headerShown: false }} />
                <AuthStack.Screen name="Signup" component={Signup} />
                <AuthStack.Screen name="App" component={HomeNavigator} options={{ headerShown: false }} />
            </AuthStack.Navigator>
        </NavigationContainer>
    );
};

const darkTheme = {
    ...MD3DarkTheme,
    colors: {
        ...MD3DarkTheme.colors,
        primary: PRIMARY,
        onPrimary: '#fff',
        background: SECONDARY,
        accent: ACCENT,
    },
};

// Register background handler
const messaging = getMessaging();
setBackgroundMessageHandler(messaging, async remoteMessage => {
    InCallManager.stopRingtone();
    console.log('Message handled in the background!', remoteMessage);
    const callerRaw = remoteMessage.data?.caller as string;
    if (!callerRaw) {
        return console.error('Caller data is not defined');
    }

    RNNotificationCall.addEventListener('answer', async info => {
        console.debug('RNNotificationCall: User answered call', info.callUUID);
        RNNotificationCall.backToApp();
        if (!info.payload) {
            console.error('Background notification data is not defined after call-screen passthrough:', info);
            return;
        }
        // Write caller info to special storage key that is checked after app login
        await writeToStorage('call_answered_in_background', info.payload);
        // User will be opening app and authenticating after this...
    });
    RNNotificationCall.addEventListener('endCall', async info => {
        console.debug('RNNotificationCall: User ended call', info.callUUID);
        InCallManager.stopRingtone();
        const data = info as DeclinePayload;
        // If call was missed, show push notification of missed call
        PushNotification.createChannel(
            {
                channelId: 'Calls',
                channelName: 'Notifications for missed calls',
                channelDescription: 'Notifications for missed calls',
            },
            () => {},
        );
        if (data.endAction === 'ACTION_HIDE_CALL') {
            PushNotification.localNotification({
                channelId: 'Calls',
                title: 'Missed Call',
                message: `You missed a call from ${caller.phone_no}`,
                when: Date.now() - 20000,
                visibility: 'private',
                picture: caller.pic || getAvatar(caller.id),
                largeIcon: 'foxtrot',
                smallIcon: 'foxtrot',
            });
        }
        // endCall only fires when the call is declined or times out (never after answer)
        try {
            await getDb();
            dbSaveCallRecord({
                peer_phone: caller.phone_no,
                peer_id: String(caller.id),
                peer_pic: caller.pic,
                direction: 'incoming',
                call_type: eventData.type || 'audio',
                status: 'missed',
                duration: 0,
                started_at: new Date().toISOString(),
            });
        } catch (err) {
            console.error('Failed to save missed call record in background:', err);
        }
        // Delete storage info about caller so they don't get routed to call screen on next app open
        await deleteFromStorage('call_answered_in_background');
    });
    InCallManager.startRingtone('_DEFAULT_', VibratePattern, '', 20);

    const eventData = JSON.parse((remoteMessage.data?.data as string) || '{}') as SocketMessage;
    const caller = JSON.parse(callerRaw) as UserData;
    RNNotificationCall.displayNotification(QuickCrypto.randomUUID(), caller.pic || getAvatar(caller.id), 20000, {
        channelId: 'com.foxtrot.callNotifications',
        channelName: 'Notifications for incoming calls',
        notificationIcon: '@mipmap/foxtrot', // mipmap
        notificationTitle: caller.phone_no || 'Unknown User',
        notificationBody: `Incoming ${eventData.type || 'audio'} call`,
        answerText: 'Answer',
        declineText: 'Decline',
        notificationColor: 'colorAccent',
        payload: { caller: caller, data: eventData },
        isVideo: eventData.type === 'video',
        // notificationSound: 'skype_ring',
        // mainComponent: "CallScreen"
    });
});

export default function App() {
    return (
        <Provider store={store}>
            <PaperProvider theme={darkTheme}>
                <StatusBar backgroundColor={DARKHEADER} barStyle="light-content" />
                <AuthNavigator />
                <Toast />
            </PaperProvider>
        </Provider>
    );
}
