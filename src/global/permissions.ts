import { PermissionsAndroid, Platform } from 'react-native';
import { Camera } from 'react-native-vision-camera';

import { readFromStorage, StorageKeys, writeToStorage } from '~/global/storage';

export async function getPushNotificationPermission() {
    // Notifications need no runtime permission before Android 13
    if (Number(Platform.Version) < 33) {
        return true;
    }
    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    if (await PermissionsAndroid.check(permission)) {
        return true;
    }
    // Ask once per install. Asking again after a refusal shows no dialog, but Android still opens and closes
    // its permission activity, which pauses the app on every launch. The user re-enables it in Settings instead.
    if (await readFromStorage(StorageKeys.NOTIFICATION_PERMISSION_ASKED)) {
        return false;
    }
    await writeToStorage(StorageKeys.NOTIFICATION_PERMISSION_ASKED, 'true');
    const status = await PermissionsAndroid.request(permission);
    return status === PermissionsAndroid.RESULTS.GRANTED;
}

export async function getWriteExtPermission() {
    if (Number(Platform.Version) >= 33) {
        return true;
    }
    const permission = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;

    const hasPermission = await PermissionsAndroid.check(permission);
    if (hasPermission) {
        return true;
    }

    const status = await PermissionsAndroid.request(permission);
    return status === PermissionsAndroid.RESULTS.GRANTED;
}

export async function getReadExtPermission() {
    if (Number(Platform.Version) >= 33) {
        return true;
    }
    const permission = PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;

    const hasPermission = await PermissionsAndroid.check(permission);
    if (hasPermission) {
        return true;
    }

    const status = await PermissionsAndroid.request(permission);
    return status === PermissionsAndroid.RESULTS.GRANTED;
}

export async function getCameraAndMicrophonePermissions() {
    const cameraPermission = Camera.getCameraPermissionStatus();
    if (cameraPermission !== 'granted') {
        const newCameraPermission = await Camera.requestCameraPermission();
        if (newCameraPermission !== 'granted') {
            return false;
        }
    }
    const microphonePermission = Camera.getMicrophonePermissionStatus();
    if (microphonePermission !== 'granted') {
        const newMicrophonePermission = await Camera.requestMicrophonePermission();
        if (newMicrophonePermission !== 'granted') {
            return false;
        }
    }

    return true;
}

export async function getMicrophoneRecordingPermission() {
    const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;

    const hasPermission = await PermissionsAndroid.check(permission);
    if (hasPermission) {
        return true;
    }

    const status = await PermissionsAndroid.request(permission);
    return status === PermissionsAndroid.RESULTS.GRANTED;
}

// Required for InCallManager to route call audio to a Bluetooth headset on Android 12+.
// Pre-31 the legacy BLUETOOTH permission is install-time, so there's nothing to request.
export async function getBluetoothConnectPermission() {
    if (Number(Platform.Version) < 31) {
        return true;
    }
    const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;

    const hasPermission = await PermissionsAndroid.check(permission);
    if (hasPermission) {
        return true;
    }

    const status = await PermissionsAndroid.request(permission);
    return status === PermissionsAndroid.RESULTS.GRANTED;
}
