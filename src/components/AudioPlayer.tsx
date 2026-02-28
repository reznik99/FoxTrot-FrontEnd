import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import Sound from 'react-native-nitro-sound';
import RNFS, { CachesDirectoryPath } from 'react-native-fs';

import { DARKHEADER, PRIMARY } from '~/global/variables';

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
            console.error(err);
        }
    }, [props.audioUri, props.audioData, props.messageId]);

    const stopAudio = useCallback(async () => {
        try {
            await Sound.stopPlayer();
            setPlayingAudio(false);
            Sound.removePlayBackListener();
            Sound.removePlaybackEndListener();
        } catch (err) {
            console.error(err);
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
