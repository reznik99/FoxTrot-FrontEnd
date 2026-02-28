import { NativeModules } from 'react-native';

interface FlagSecureModule {
    enable(): void;
    disable(): void;
}

export const FlagSecure: FlagSecureModule = NativeModules.FlagSecure;
