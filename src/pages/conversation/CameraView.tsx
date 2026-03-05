import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { Image as ImageCompressor, Video as VideoCompressor } from 'react-native-compressor';
import { createThumbnail } from 'react-native-create-thumbnail';
import RNFS from 'react-native-fs';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import Video from 'react-native-video';
import { Camera, Templates, useCameraDevice, useCameraFormat } from 'react-native-vision-camera';
import { useDispatch } from 'react-redux';

import { logger } from '~/global/logger';
import { HomeStackParamList } from '~/global/navigation';
import { getCameraAndMicrophonePermissions } from '~/global/permissions';
import { DARKHEADER, SECONDARY } from '~/global/variables';
import { uploadMedia } from '~/store/actions/media';
import { sendMessage } from '~/store/actions/user';
import { AppDispatch } from '~/store/store';

export default function CameraView(props: StackScreenProps<HomeStackParamList, 'CameraView'>) {
    const dispatch = useDispatch<AppDispatch>();
    const edgeInsets = useSafeAreaInsets();
    const isActive = useIsFocused();
    const [initialized, setInitialized] = useState(false);
    const cameraRef = useRef<Camera>(null);
    const [cameraType, setCameraType] = useState<'front' | 'back'>('front');
    const frontDevice = useCameraDevice('front');
    const backDevice = useCameraDevice('back');
    const device = cameraType === 'front' ? frontDevice || backDevice : backDevice || frontDevice;
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
            logger.debug('Requesting camera permissions');
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
            logger.error('Error requesting camera permissions:', err);
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
            logger.error('Error taking image:', err);
        } finally {
            setLoading(false);
        }
    }, [cameraRef]);

    const generateThumbnail = useCallback(async (sourcePath: string, isVideoFile: boolean): Promise<string> => {
        let thumbPath: string;

        if (isVideoFile) {
            // Extract first frame from video
            const { path } = await createThumbnail({ url: sourcePath, timeStamp: 0 });
            thumbPath = path;
        } else {
            thumbPath = sourcePath;
        }

        // Compress to a tiny JPEG thumbnail
        const compressedPath = await ImageCompressor.compress(thumbPath, {
            maxWidth: 200,
            quality: 0.3,
            output: 'jpg',
        });

        // Read as base64
        const base64 = await RNFS.readFile(compressedPath, 'base64');
        return base64;
    }, []);

    const send = useCallback(async () => {
        setLoading(true);
        try {
            let filePath = media;
            let contentType = 'image/jpeg';

            if (isVideo) {
                // Compress video before upload
                logger.debug('Compressing video...');
                filePath = await VideoCompressor.compress(media, {
                    compressionMethod: 'auto',
                });
                contentType = 'video/mp4';
                logger.debug('Video compressed:', filePath);
            }

            // Generate thumbnail and upload encrypted file in parallel
            const thumbnailPromise = generateThumbnail(media, isVideo).catch(err => {
                logger.warn('Failed to generate thumbnail, sending without preview:', err);
                return undefined;
            });
            const uploadPromise = dispatch(uploadMedia({ filePath, contentType })).unwrap();

            const [thumbnail, { objectKey, keyBase64, ivBase64 }] = await Promise.all([thumbnailPromise, uploadPromise]);

            // Build E2EE message with S3 metadata (no raw file data)
            const toSend = JSON.stringify({
                type: isVideo ? 'VIDEO' : 'IMG',
                objectKey,
                fileKey: keyBase64,
                fileIv: ivBase64,
                mimeType: contentType,
                thumbnail,
            });

            const success = await dispatch(
                sendMessage({ message: toSend, to_user: props.route.params?.data?.peer }),
            ).unwrap();
            if (success) {
                props.navigation.goBack();
            }
        } catch (err: any) {
            logger.error('Error sending media:', err);
            Toast.show({
                type: 'error',
                text1: 'Failed to send media',
                text2: err?.message || 'Please try again',
            });
        } finally {
            setLoading(false);
        }
    }, [media, isVideo, props.navigation, props.route.params?.data?.peer, dispatch, generateThumbnail]);

    return (
        <View style={styles.container}>
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
                <View style={styles.fullScreen}>
                    {loading ? (
                        <>
                            <Image style={styles.mediaPreview} source={{ uri: media }} resizeMode="cover" blurRadius={3} />
                            <ActivityIndicator size="large" style={StyleSheet.absoluteFill} />
                        </>
                    ) : isVideo ? (
                        <Video
                            source={{ uri: media }}
                            style={styles.mediaPreview}
                            resizeMode="cover"
                            controls={true}
                            paused={false}
                            repeat={true}
                            bufferConfig={{
                                minBufferMs: 2000,
                                maxBufferMs: 5000,
                                bufferForPlaybackMs: 1000,
                                bufferForPlaybackAfterRebufferMs: 2000,
                            }}
                        />
                    ) : (
                        <Image style={styles.mediaPreview} source={{ uri: media }} resizeMode="cover" />
                    )}
                    <View style={[styles.buttonContainer, { paddingBottom: edgeInsets.bottom + 16 }]}>
                        <Button
                            style={styles.button}
                            buttonColor="rgba(255,255,255,0.25)"
                            icon={isVideo ? 'close' : 'camera-retake'}
                            mode="contained"
                            onPress={reset}
                        >
                            {isVideo ? 'Cancel' : 'Retake'}
                        </Button>
                        <Button
                            style={styles.button}
                            icon="send-lock"
                            mode="contained"
                            onPress={send}
                            loading={loading}
                            disabled={loading}
                        >
                            Send
                        </Button>
                    </View>
                </View>
            )}
            {/* Camera View and actions */}
            {device && hasPermission && !media && (
                <View style={styles.fullScreen}>
                    <Camera
                        style={initialized && styles.mediaPreview}
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
                    <View style={[styles.buttonContainer, { paddingBottom: edgeInsets.bottom + 16 }]}>
                        <Button
                            style={styles.button}
                            buttonColor="rgba(255,255,255,0.25)"
                            icon="camera-flip"
                            mode="contained"
                            onPress={swapCamera}
                        >
                            Flip
                        </Button>
                        <Button
                            style={styles.button}
                            icon="camera"
                            mode="contained"
                            onPress={takePic}
                            loading={loading}
                            disabled={loading}
                        >
                            Capture
                        </Button>
                    </View>
                </View>
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
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
    },
    fullScreen: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: DARKHEADER,
    },
    mediaPreview: {
        width: '100%',
        height: '100%',
    },
    buttonContainer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'space-evenly',
        paddingTop: 16,
    },
    button: {
        borderRadius: 100,
    },
});
