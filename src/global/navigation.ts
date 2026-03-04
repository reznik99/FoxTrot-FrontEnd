import type { NavigatorScreenParams } from '@react-navigation/native';
import { createNavigationContainerRef } from '@react-navigation/native';
import type { StackNavigationProp, StackScreenProps } from '@react-navigation/stack';

import type { UserData } from '~/store/reducers/user';

export type HomeTabParamList = {
    Messages: undefined;
    Calls: undefined;
};

export type RootDrawerParamList = {
    FoxTrot: NavigatorScreenParams<HomeTabParamList> | undefined;
};

export type HomeStackParamList = {
    Home: NavigatorScreenParams<RootDrawerParamList> | undefined;
    Conversation: { data: { peer_user: UserData } };
    NewConversation: undefined;
    AddContact: undefined;
    Call: { data: { peer_user: UserData; video_enabled: boolean } };
    CameraView: { data: { peer: UserData; mediaPath: string; mediaType?: 'image' | 'video' } };
    Settings: undefined;
    KeySetup: undefined;
};

export type AuthStackParamList = {
    Login: { data: { errorMsg: string; loggedOut: boolean } };
    Signup: undefined;
    App: NavigatorScreenParams<HomeStackParamList> | undefined;
};

// Enables type-safe useNavigation() everywhere without manual generics
declare global {
    namespace ReactNavigation {
        interface RootParamList extends AuthStackParamList {}
    }
}

// Navigation type for components that navigate across both auth and home stacks.
// React Navigation resolves nested screens at runtime, so this flat union
// lets us call navigate('Call', ...) or navigate('Login', ...) from anywhere.
export type RootNavigation = StackNavigationProp<HomeStackParamList & AuthStackParamList>;

// Re-export for screen component props
export type HomeStackScreenProps<T extends keyof HomeStackParamList> = StackScreenProps<HomeStackParamList, T>;
export type AuthStackScreenProps<T extends keyof AuthStackParamList> = StackScreenProps<AuthStackParamList, T>;

// Global navigation ref for components outside the navigation tree (e.g. ActiveCallBanner)
export const navigationRef = createNavigationContainerRef<AuthStackParamList>();
