import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, StyleSheet, TouchableOpacity, View } from 'react-native';
import RNFS, { CachesDirectoryPath } from 'react-native-fs';
import Sound from 'react-native-nitro-sound';
import { Icon, Text, useTheme } from 'react-native-paper';

import { logger } from '~/global/logger';
import { TEXT_SECONDARY } from '~/global/variables';

const THUMB_SIZE = 14;
const TRACK_HEIGHT = 6;

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
    const isSeeking = useRef(false);

    const { audioDuration } = props;

    const cleanup = useCallback(() => {
        Sound.removePlayBackListener();
        Sound.removePlaybackEndListener();
    }, []);

    useEffect(() => {
        return () => {
            cleanup();
            Sound.stopPlayer().catch(() => {});
        };
    }, [cleanup]);

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
            if (playbackState === 'paused') {
                await Sound.resumePlayer();
                setPlaybackState('playing');
                return;
            }
            await resolveFilePath();
            cleanup();
            Sound.setSubscriptionDuration(0.05);
            await Sound.setVolume(1.0);
            await Sound.startPlayer(audioFilePathRef.current);
            Sound.addPlayBackListener(e => {
                if (!isSeeking.current) setCurrentTime(e.currentPosition);
            });
            Sound.addPlaybackEndListener(() => {
                cleanup();
                setPlaybackState('idle');
                setCurrentTime(0);
            });
            setPlaybackState('playing');
        } catch (err) {
            logger.error(err);
        }
    }, [playbackState, resolveFilePath, cleanup]);

    const pauseAudio = useCallback(async () => {
        try {
            await Sound.pausePlayer();
            setPlaybackState('paused');
        } catch (err) {
            logger.error(err);
        }
    }, []);

    // Seek from a touch/drag event on the track
    const seekFromEvent = useCallback(
        (e: GestureResponderEvent) => {
            if (trackWidthRef.current <= 0) return;
            const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / trackWidthRef.current));
            const ms = ratio * audioDuration;
            setCurrentTime(ms);
            if (playbackState !== 'idle') {
                Sound.seekToPlayer(ms).catch(err => logger.error(err));
            }
        },
        [audioDuration, playbackState],
    );

    const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
        trackWidthRef.current = e.nativeEvent.layout.width;
    }, []);

    const progress = audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0;
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
                    <View
                        style={styles.seekArea}
                        onLayout={onTrackLayout}
                        onStartShouldSetResponder={() => true}
                        onMoveShouldSetResponder={() => true}
                        onResponderGrant={e => {
                            isSeeking.current = true;
                            seekFromEvent(e);
                        }}
                        onResponderMove={seekFromEvent}
                        onResponderRelease={() => {
                            isSeeking.current = false;
                        }}
                    >
                        <View style={styles.progressTrack}>
                            <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: iconColor }]} />
                        </View>
                        {showThumb && <View style={[styles.thumb, { left: `${progress}%`, backgroundColor: iconColor }]} />}
                    </View>
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
