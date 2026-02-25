import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { Camera, Templates, useCameraDevice, useCameraFormat } from 'react-native-vision-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { View, Image, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Video from 'react-native-video';
import { Video as VideoCompressor } from 'react-native-compressor';
import Toast from 'react-native-toast-message';
import { useDispatch } from 'react-redux';

import { getCameraAndMicrophonePermissions } from '~/global/permissions';
import { DARKHEADER, SECONDARY, SECONDARY_LITE } from '~/global/variables';
import { sendMessage } from '~/store/actions/user';
import { uploadMedia } from '~/store/actions/media';
import { HomeStackParamList } from '~/../App';
import { AppDispatch } from '~/store/store';

export default function CameraView(props: StackScreenProps<HomeStackParamList, 'CameraView'>) {
    const dispatch = useDispatch<AppDispatch>();
    const edgeInsets = useSafeAreaInsets();
    const isActive = useIsFocused();
    const [initialized, setInitialized] = useState(false);
    const cameraRef = useRef<Camera>(null);
    const [cameraType, setCameraType] = useState<'front' | 'back'>('front');
    const device = useCameraDevice(cameraType);
    const format = useCameraFormat(device, Templates.Snapchat);

    const [hasPermission, setHasPermission] = useState(false);
    const [media, setMedia] = useState(props.route.params?.data?.mediaPath || '');
    const [loading, setLoading] = useState(false);
    const mediaType = props.route.params?.data?.mediaType || 'image';
    const isVideo = mediaType === 'video';

    useEffect(() => {
        if (props.route.params?.data?.mediaPath) {
            return;
        }
        requestPermissions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const requestPermissions = useCallback(async () => {
        try {
            console.debug('Requesting camera permissions');
            const permission = await getCameraAndMicrophonePermissions();
            if (!permission) {
                Toast.show({
                    type: 'error',
                    text1: 'Camera permissions denied',
                    text2: "Unable to use phone's camera",
                });
                return false;
            }
            setHasPermission(true);
            return true;
        } catch (err) {
            console.error('Error requesting camera permissions:', err);
            return false;
        }
    }, []);

    const reset = useCallback(() => {
        setMedia('');
        setInitialized(false);
        if (!hasPermission) {
            requestPermissions();
        }
    }, [hasPermission, requestPermissions]);

    const swapCamera = useCallback(() => {
        if (!device) {
            return;
        }
        if (device.position === 'front') {
            setCameraType('back');
        } else {
            setCameraType('front');
        }
    }, [device]);

    const takePic = useCallback(async () => {
        if (!cameraRef.current) {
            return;
        }
        setLoading(true);
        try {
            const pic = await cameraRef.current.takePhoto({ enableAutoDistortionCorrection: true });
            setMedia(`file://${pic.path}`);
        } catch (err) {
            console.error('Error taking image:', err);
        } finally {
            setLoading(false);
        }
    }, [cameraRef]);

    const send = useCallback(async () => {
        setLoading(true);
        try {
            let filePath = media;
            let contentType = 'image/jpeg';

            if (isVideo) {
                // Compress video before upload
                console.debug('Compressing video...');
                filePath = await VideoCompressor.compress(media, {
                    compressionMethod: 'auto',
                });
                contentType = 'video/mp4';
                console.debug('Video compressed:', filePath);
            }

            // Upload encrypted file to S3
            const { objectKey, keyBase64, ivBase64 } = await dispatch(uploadMedia({ filePath, contentType })).unwrap();

            // Build E2EE message with S3 metadata (no raw file data)
            const toSend = JSON.stringify({
                type: isVideo ? 'VIDEO' : 'IMG',
                objectKey,
                fileKey: keyBase64,
                fileIv: ivBase64,
                mimeType: contentType,
            });

            const success = await dispatch(
                sendMessage({ message: toSend, to_user: props.route.params?.data?.peer }),
            ).unwrap();
            if (success) {
                props.navigation.goBack();
            }
        } catch (err: any) {
            console.error('Error sending media:', err);
            Toast.show({
                type: 'error',
                text1: 'Failed to send media',
                text2: err?.message || 'Please try again',
            });
        } finally {
            setLoading(false);
        }
    }, [media, isVideo, props.navigation, props.route.params?.data?.peer, dispatch]);

    return (
        <View style={[styles.container, { paddingTop: edgeInsets.top, paddingBottom: edgeInsets.bottom }]}>
            {/* Loading screen */}
            {!device && !media && (
                <View style={styles.loaderContainer}>
                    <ActivityIndicator size="large" />
                </View>
            )}
            {/* Permission error screen */}
            {device && !media && !hasPermission && (
                <View style={styles.loaderContainer}>
                    <Text variant="titleLarge">Permission to use camera denied</Text>
                </View>
            )}
            {/* Media preview and actions */}
            {media && (
                <>
                    <View style={{ flex: 1, backgroundColor: DARKHEADER }}>
                        {isVideo ? (
                            <Video
                                source={{ uri: media }}
                                style={{ width: '100%', height: '100%' }}
                                resizeMode="contain"
                                controls={true}
                                paused={false}
                                repeat={true}
                            />
                        ) : (
                            <Image style={{ width: '100%', height: '100%' }} source={{ uri: media }} resizeMode="cover" />
                        )}
                    </View>
                    <View style={[styles.buttonContainer, { marginBottom: edgeInsets.bottom }]}>
                        <Button
                            style={styles.button}
                            buttonColor={SECONDARY_LITE}
                            icon="refresh"
                            mode="contained"
                            onPress={reset}
                        >
                            {isVideo ? 'Cancel' : 'Take again'}
                        </Button>
                        <Button
                            style={styles.button}
                            icon="send"
                            mode="contained"
                            onPress={send}
                            loading={loading}
                            disabled={loading}
                        >
                            Send
                        </Button>
                    </View>
                </>
            )}
            {/* Camera View and actions */}
            {device && hasPermission && !media && (
                <>
                    <View style={{ flex: 1, backgroundColor: DARKHEADER }}>
                        <Camera
                            style={initialized && { width: '100%', height: '100%' }}
                            ref={cameraRef}
                            device={device}
                            isActive={isActive}
                            isMirrored={device.position === 'front'}
                            enableZoomGesture={true}
                            photoQualityBalance={'speed'}
                            resizeMode={'cover'}
                            format={format}
                            photo={true}
                            onPreviewStarted={() => setInitialized(true)}
                            onPreviewStopped={() => setInitialized(false)}
                        />
                    </View>
                    <View style={[styles.buttonContainer, { marginBottom: edgeInsets.bottom }]}>
                        <Button
                            style={styles.button}
                            buttonColor={SECONDARY_LITE}
                            icon="camera-party-mode"
                            mode="contained"
                            onPress={swapCamera}
                        >
                            Swap Camera
                        </Button>
                        <Button
                            style={styles.button}
                            icon="camera"
                            mode="contained"
                            onPress={takePic}
                            loading={loading}
                            disabled={loading}
                        >
                            Take pic
                        </Button>
                    </View>
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        backgroundColor: SECONDARY,
    },
    loaderContainer: {
        position: 'absolute',
        width: '100%',
        height: '100%',
        justifyContent: 'center',
    },
    buttonContainer: {
        width: '100%',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-evenly',
        paddingVertical: 10,
    },
    button: {
        borderRadius: 100,
    },
});
