import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import Sound from 'react-native-nitro-sound';
import RNFS, { CachesDirectoryPath } from 'react-native-fs';

import { PRIMARY } from '~/global/variables';
import { logger } from '~/global/logger';

type IProps = {
    messageId: number;
    audioData?: string;
    audioUri?: string;
    audioDuration: number;
};

export default function AudioPlayer(props: IProps) {
    const [audioPlaybackTime, setAudioPlaybackTime] = useState(0);
    const [playingAudio, setPlayingAudio] = useState(false);
    const audioFilePathRef = useRef('');

    const playAudio = useCallback(async () => {
        try {
            if (!audioFilePathRef.current) {
                if (props.audioUri) {
                    // S3-backed: file already on disk
                    audioFilePathRef.current = props.audioUri.replace('file://', '');
                } else if (props.audioData) {
                    // Legacy inline: write base64 to deterministic cache path
                    const filePath = `${CachesDirectoryPath}/audio-${props.messageId}.m4a`;
                    if (!(await RNFS.exists(filePath))) {
                        await RNFS.writeFile(filePath, props.audioData, 'base64');
                    }
                    audioFilePathRef.current = filePath;
                }
            }

            await Sound.setVolume(1.0);
            await Sound.startPlayer(audioFilePathRef.current);
            Sound.addPlayBackListener(e => setAudioPlaybackTime(e.currentPosition));
            Sound.addPlaybackEndListener(() => setPlayingAudio(false));
            setPlayingAudio(true);
        } catch (err) {
            logger.error(err);
        }
    }, [props.audioUri, props.audioData, props.messageId]);

    const stopAudio = useCallback(async () => {
        try {
            await Sound.stopPlayer();
            setPlayingAudio(false);
            Sound.removePlayBackListener();
            Sound.removePlaybackEndListener();
        } catch (err) {
            logger.error(err);
        }
    }, []);

    const progress = props.audioDuration > 0 ? (audioPlaybackTime / props.audioDuration) * 100 : 0;

    return (
        <View style={styles.audioContainer}>
            <View style={styles.inputContainer}>
                {playingAudio ? (
                    <TouchableOpacity style={styles.button} onPress={stopAudio}>
                        <Icon source="pause" color={PRIMARY} size={28} />
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity style={styles.button} onPress={playAudio}>
                        <Icon source="play" color={PRIMARY} size={28} />
                    </TouchableOpacity>
                )}
                <View style={styles.progressContainer}>
                    <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${progress}%` }]} />
                    </View>
                    <Text style={styles.duration}>
                        {Sound.mmssss(audioPlaybackTime ? ~~audioPlaybackTime : ~~props.audioDuration)}
                    </Text>
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
    progressTrack: {
        height: 4,
        borderRadius: 2,
        backgroundColor: '#ffffff30',
    },
    progressFill: {
        height: 4,
        borderRadius: 2,
        backgroundColor: PRIMARY,
    },
    duration: {
        color: '#ccc',
        fontSize: 12,
    },
});
