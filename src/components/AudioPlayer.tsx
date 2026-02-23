import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import Sound from 'react-native-nitro-sound';
import RNFS, { CachesDirectoryPath } from 'react-native-fs';

import { DARKHEADER, PRIMARY } from '~/global/variables';

type IProps = {
    audioData: string;
    audioDuration: number;
};

export default function AudioPlayer(props: IProps) {
    const [audioPlaybackTime, setAudioPlaybackTime] = useState(0);
    const [playingAudio, setPlayingAudio] = useState(false);
    const audioFilePathRef = useRef('');

    // Cleanup temp file on unmount
    useEffect(() => {
        return () => {
            if (audioFilePathRef.current) {
                RNFS.unlink(audioFilePathRef.current)
                    .then(() => console.debug('Cleaned up temp audio message file'))
                    .catch(err => console.error('audio message file cleanup err:', err));
            }
        };
    }, []);

    const playAudio = useCallback(async () => {
        try {
            // Lazy-load: write audio to cache on first play
            if (!audioFilePathRef.current) {
                const filePath = CachesDirectoryPath + Date.now();
                await RNFS.writeFile(filePath, props.audioData, 'base64');
                audioFilePathRef.current = filePath;
            }

            await Sound.setVolume(1.0);
            await Sound.startPlayer(audioFilePathRef.current);
            Sound.addPlayBackListener(e => setAudioPlaybackTime(e.currentPosition));
            Sound.addPlaybackEndListener(() => setPlayingAudio(false));
            setPlayingAudio(true);
        } catch (err) {
            console.error(err); // Show error
        }
    }, [props.audioData]);

    const stopAudio = useCallback(async () => {
        try {
            await Sound.stopPlayer();
            setPlayingAudio(false);
            Sound.removePlayBackListener();
            Sound.removePlaybackEndListener();
        } catch (err) {
            console.error(err); // Show error
        }
    }, []);

    return (
        <View style={styles.audioContainer}>
            {/* Audio data controls */}
            <View style={styles.inputContainer}>
                <Text>{Sound.mmssss(audioPlaybackTime ? ~~audioPlaybackTime : ~~props.audioDuration)}</Text>
                {playingAudio ? (
                    <TouchableOpacity style={styles.button} onPress={stopAudio}>
                        <Icon source="pause" color={PRIMARY} size={25} />
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity style={styles.button} onPress={playAudio}>
                        <Icon source="play" color={PRIMARY} size={25} />
                    </TouchableOpacity>
                )}
            </View>
            {/* Audio playback indicator */}
            <View style={{ flex: 1 }}>
                <View
                    style={{
                        width: `${(audioPlaybackTime / props.audioDuration) * 100}%`,
                        height: 2,
                        backgroundColor: playingAudio ? PRIMARY : 'transparent',
                    }}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    audioContainer: {
        flexDirection: 'column',
        flex: 1,
        paddingHorizontal: 10,
        backgroundColor: DARKHEADER,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        paddingVertical: 0,
    },
    button: {
        padding: 10,
    },
});
