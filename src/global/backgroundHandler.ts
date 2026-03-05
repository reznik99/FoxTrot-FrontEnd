import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import RNNotificationCall, { DeclinePayload } from 'react-native-full-screen-notification-incoming-call';
import InCallManager from 'react-native-incall-manager';
import PushNotification from 'react-native-push-notification';
import QuickCrypto from 'react-native-quick-crypto';

import { dbSaveCallRecord, getDb } from '~/global/database';
import { getAvatar } from '~/global/helper';
import { logger } from '~/global/logger';
import { deleteFromStorage, StorageKeys, writeToStorage } from '~/global/storage';
import { VibratePattern } from '~/global/variables';
import { SocketMessage } from '~/global/websocketManager';
import { UserData } from '~/store/reducers/user';

const messaging = getMessaging();
setBackgroundMessageHandler(messaging, async remoteMessage => {
    logger.info('Message handled in the background!', remoteMessage);
    // Stop duplicate ringtones
    InCallManager.stopRingtone();
    // Parse event & caller data
    const caller = JSON.parse((remoteMessage.data?.caller as string) || '{}') as UserData;
    if (Object.keys(caller).length === 0) {
        return logger.error('Caller data is not defined');
    }
    const eventData = JSON.parse((remoteMessage.data?.data as string) || '{}') as SocketMessage;
    if (Object.keys(eventData).length === 0) {
        return logger.error('Event data is not defined');
    }
    // Register call event listeners
    RNNotificationCall.addEventListener('answer', async info => {
        logger.debug('RNNotificationCall: User answered call', info.callUUID);
        RNNotificationCall.backToApp();
        if (!info.payload) {
            logger.error('Background notification data is not defined after call-screen passthrough:', info);
            return;
        }
        // Write caller info to special storage key that is checked after app login
        await writeToStorage(StorageKeys.CALL_ANSWERED_IN_BACKGROUND, info.payload);
        // User will be opening app and authenticating after this...
    });
    RNNotificationCall.addEventListener('endCall', async info => {
        logger.debug('RNNotificationCall: User ended call', info.callUUID);
        // Stop ringing
        InCallManager.stopRingtone();

        const data = info as DeclinePayload;
        if (data.endAction === 'ACTION_HIDE_CALL') {
            // If call was missed, show push notification of missed call
            const callChannelOpts = {
                channelId: 'Calls',
                channelName: 'Notifications for missed calls',
                channelDescription: 'Notifications for missed calls',
            };
            PushNotification.createChannel(callChannelOpts, () => {});
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
            logger.error('Failed to save missed call record to db:', err);
        }
        // Delete storage info about caller so they don't get routed to call screen on next app open
        await deleteFromStorage(StorageKeys.CALL_ANSWERED_IN_BACKGROUND);
    });
    InCallManager.startRingtone('_DEFAULT_', VibratePattern, '', 20);

    RNNotificationCall.displayNotification(QuickCrypto.randomUUID(), caller.pic || getAvatar(caller.id), 20000, {
        channelId: 'com.foxtrot.callNotifications',
        channelName: 'Notifications for incoming calls',
        notificationIcon: 'foxtrot',
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
