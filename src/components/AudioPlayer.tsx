import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, TouchableOpacity, View } from 'react-native';
import RNFS, { CachesDirectoryPath } from 'react-native-fs';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import InCallManager from 'react-native-incall-manager';
import Sound, { createSound } from 'react-native-nitro-sound';
import { Icon, Text, useTheme } from 'react-native-paper';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { logger } from '~/global/logger';
import { TEXT_SECONDARY } from '~/global/variables';

const THUMB_SIZE = 14;
const TRACK_HEIGHT = 6;

// Each player owns its own Sound instance. Starting one stops whichever was active.
let stopActivePlayer: (() => void) | null = null;

type IProps = {
    messageId: number;
    audioData?: string;
    audioUri?: string;
    audioDuration: number;
    isSent?: boolean;
};

type PlaybackState = 'idle' | 'playing' | 'paused';

export default function AudioPlayer(props: IProps) {
    const { colors } = useTheme();
    const iconColor = props.isSent ? '#ffffffcc' : colors.primary;
    const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
    const [currentTime, setCurrentTime] = useState(0);
    const audioFilePathRef = useRef('');
    const trackWidthRef = useRef(0);
    const progress = useSharedValue(0);
    const isSeeking = useRef(false);
    const soundRef = useRef<ReturnType<typeof createSound> | null>(null);

    const { audioDuration } = props;

    // Stop our player and reset the UI to idle (stable identity — all deps are stable)
    const stopSelf = useCallback(() => {
        const sound = soundRef.current;
        if (sound) {
            sound.removePlayBackListener();
            sound.removePlaybackEndListener();
            sound.stopPlayer().catch(() => {});
        }
        setPlaybackState('idle');
        setCurrentTime(0);
        progress.value = 0;
        InCallManager.setKeepScreenOn(false);
    }, [progress]);

    useEffect(() => {
        return () => {
            if (stopActivePlayer === stopSelf) stopActivePlayer = null;
            stopSelf();
        };
    }, [stopSelf]);

    const resolveFilePath = useCallback(async () => {
        if (audioFilePathRef.current) return;
        if (props.audioUri) {
            audioFilePathRef.current = props.audioUri.replace('file://', '');
        } else if (props.audioData) {
            const filePath = `${CachesDirectoryPath}/audio-${props.messageId}.m4a`;
            if (!(await RNFS.exists(filePath))) {
                await RNFS.writeFile(filePath, props.audioData, 'base64');
            }
            audioFilePathRef.current = filePath;
        }
    }, [props.audioUri, props.audioData, props.messageId]);

    const playAudio = useCallback(async () => {
        try {
            const sound = (soundRef.current ??= createSound());
            if (playbackState === 'paused') {
                await sound.resumePlayer();
                setPlaybackState('playing');
                InCallManager.setKeepScreenOn(true);
                return;
            }
            // Start fresh, stopping whichever player was active
            await resolveFilePath();
            if (stopActivePlayer !== stopSelf) stopActivePlayer?.();
            stopActivePlayer = stopSelf;
            sound.setSubscriptionDuration(0.1);
            await sound.setVolume(1.0);
            await sound.startPlayer(audioFilePathRef.current);
            sound.addPlayBackListener(e => {
                if (!isSeeking.current) {
                    setCurrentTime(e.currentPosition);
                    progress.value = withTiming(audioDuration > 0 ? e.currentPosition / audioDuration : 0, {
                        duration: 100,
                    });
                }
            });
            sound.addPlaybackEndListener(() => {
                if (stopActivePlayer === stopSelf) stopActivePlayer = null;
                stopSelf();
            });
            setPlaybackState('playing');
            InCallManager.setKeepScreenOn(true);
        } catch (err) {
            logger.error(err);
        }
    }, [playbackState, resolveFilePath, stopSelf, audioDuration, progress]);

    const pauseAudio = useCallback(async () => {
        try {
            await soundRef.current?.pausePlayer();
            setPlaybackState('paused');
            InCallManager.setKeepScreenOn(false);
        } catch (err) {
            logger.error(err);
        }
    }, []);

    const touchRatio = (x: number) => Math.max(0, Math.min(1, x / trackWidthRef.current));

    const seekGesture = useMemo(
        () =>
            Gesture.Pan()
                .runOnJS(true)
                .activeOffsetX([-5, 5])
                .failOffsetY([-20, 20])
                .onBegin(e => {
                    isSeeking.current = true;
                    if (trackWidthRef.current > 0) {
                        progress.value = touchRatio(e.x);
                        setCurrentTime(touchRatio(e.x) * audioDuration);
                    }
                })
                .onUpdate(e => {
                    if (trackWidthRef.current > 0) {
                        progress.value = touchRatio(e.x);
                        setCurrentTime(touchRatio(e.x) * audioDuration);
                    }
                })
                .onFinalize(e => {
                    isSeeking.current = false;
                    if (trackWidthRef.current > 0 && playbackState !== 'idle') {
                        soundRef.current?.seekToPlayer(touchRatio(e.x) * audioDuration).catch(err => logger.error(err));
                    }
                }),
        [audioDuration, playbackState, progress],
    );

    const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
    const thumbStyle = useAnimatedStyle(() => ({ left: `${progress.value * 100}%` }));
    const showThumb = playbackState !== 'idle';

    return (
        <View style={styles.audioContainer}>
            <View style={styles.inputContainer}>
                {playbackState === 'playing' ? (
                    <TouchableOpacity style={styles.button} onPress={pauseAudio}>
                        <Icon source="pause" color={iconColor} size={28} />
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity style={styles.button} onPress={playAudio}>
                        <Icon source="play" color={iconColor} size={28} />
                    </TouchableOpacity>
                )}
                <View style={styles.progressContainer}>
                    <GestureDetector gesture={seekGesture}>
                        <View
                            style={styles.seekArea}
                            onLayout={(e: LayoutChangeEvent) => {
                                trackWidthRef.current = e.nativeEvent.layout.width;
                            }}
                        >
                            <View style={styles.progressTrack}>
                                <Animated.View style={[styles.progressFill, { backgroundColor: iconColor }, fillStyle]} />
                            </View>
                            {showThumb && (
                                <Animated.View style={[styles.thumb, { backgroundColor: iconColor }, thumbStyle]} />
                            )}
                        </View>
                    </GestureDetector>
                    <Text style={styles.duration}>{Sound.mmssss(currentTime ? ~~currentTime : ~~audioDuration)}</Text>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    audioContainer: {
        minWidth: 200,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    button: {
        padding: 4,
    },
    progressContainer: {
        flex: 1,
        gap: 4,
    },
    seekArea: {
        justifyContent: 'center',
        paddingVertical: 12,
    },
    progressTrack: {
        height: TRACK_HEIGHT,
        borderRadius: TRACK_HEIGHT / 2,
        backgroundColor: '#ffffff30',
        overflow: 'hidden',
    },
    progressFill: {
        height: TRACK_HEIGHT,
        borderRadius: TRACK_HEIGHT / 2,
    },
    thumb: {
        position: 'absolute',
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        borderRadius: THUMB_SIZE / 2,
        marginLeft: -THUMB_SIZE / 2,
    },
    duration: {
        color: TEXT_SECONDARY,
        fontSize: 12,
    },
});
