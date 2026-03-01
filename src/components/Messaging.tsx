import React, { useCallback, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Sound, { AudioSet, AudioEncoderAndroidType } from 'react-native-nitro-sound';

import CustomKeyboardAvoidingView from '~/components/CustomKeyboardAvoidingView';
import { getMicrophoneRecordingPermission, getReadExtPermission } from '~/global/permissions';
import { DARKHEADER, PRIMARY, SECONDARY_LITE } from '~/global/variables';
import { logger } from '~/global/logger';

type IProps = {
    inputMessage: string;
    loading: boolean;
    setInputMessage: (text: string) => void;
    handleCameraSelect: () => Promise<void>;
    handleImageSelect: () => Promise<void>;
    handleSend: () => Promise<void>;
    handleSendAudio: (filePath: string, duration: number) => Promise<void>;
};

export default function Messaging(props: IProps) {
    const edgeInsets = useSafeAreaInsets();
    const [expandActions, setExpandActions] = useState(false);
    const [audioFilePath, setAudioFilePath] = useState('');
    const [audioRecordTime, setAudioRecordTime] = useState(0);
    const [audioPlaybackTime, setAudioPlaybackTime] = useState(0);
    const [playingAudio, setPlayingAudio] = useState(false);

    const setInputMessage = useCallback(
        (text: string) => {
            props.setInputMessage(text);
            if (expandActions) {
                setExpandActions(false);
            }
        },
        [expandActions, props],
    );

    const resetAudio = useCallback(() => {
        setAudioFilePath('');
        setAudioRecordTime(0);
        setAudioPlaybackTime(0);
        Sound.removeRecordBackListener();
        Sound.removePlayBackListener();
        Sound.removePlaybackEndListener();
    }, []);

    const onMicPress = useCallback(async () => {
        try {
            resetAudio();
            // Get permissions if necessary
            const hasPermission = await getMicrophoneRecordingPermission();
            if (!hasPermission) {
                return;
            }
            const hasPermission2 = await getReadExtPermission();
            if (!hasPermission2) {
                return;
            }
            // Start recording
            Sound.addRecordBackListener(e => setAudioRecordTime(e.currentPosition));
            await Sound.setVolume(1.0);
            const audioConfig: AudioSet = {
                AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
                AudioSamplingRate: 22050,
                AudioEncodingBitRate: 32000,
                AudioChannels: 1,
            };
            const result = await Sound.startRecorder(undefined, audioConfig);
            setAudioFilePath(result);
            logger.info('Recording started:', result);
        } catch (err) {
            logger.error(err);
        }
    }, [resetAudio]);

    const onMicRelease = useCallback(async () => {
        try {
            // Stop recording
            await Sound.stopRecorder();
            Sound.removeRecordBackListener();
        } catch (err) {
            logger.error(err);
        }
    }, []);

    const playAudio = useCallback(async () => {
        try {
            await Sound.startPlayer(audioFilePath);
            Sound.addPlayBackListener(e => setAudioPlaybackTime(e.currentPosition));
            Sound.addPlaybackEndListener(() => setPlayingAudio(false));
            setPlayingAudio(true);
        } catch (err) {
            logger.error(err);
        }
    }, [audioFilePath]);

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

    const sendAudio = useCallback(async () => {
        try {
            await props.handleSendAudio(audioFilePath, audioRecordTime);
            resetAudio();
        } catch (err) {
            logger.error(err);
        }
    }, [audioFilePath, audioRecordTime, resetAudio, props]);

    return (
        <CustomKeyboardAvoidingView>
            {/* Audio data controls */}
            {audioFilePath && (
                <View style={styles.audioContainer}>
                    <View style={styles.inputContainer}>
                        <TouchableOpacity style={styles.button} onPress={resetAudio}>
                            <Icon source="close" color={SECONDARY_LITE} size={20} />
                        </TouchableOpacity>
                        <Text>Duration: {Sound.mmssss(audioPlaybackTime ? ~~audioPlaybackTime : ~~audioRecordTime)}</Text>
                        {playingAudio ? (
                            <TouchableOpacity style={styles.button} onPress={stopAudio}>
                                <Icon source="pause" color={PRIMARY} size={20} />
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity style={styles.button} onPress={playAudio}>
                                <Icon source="play" color={PRIMARY} size={20} />
                            </TouchableOpacity>
                        )}
                    </View>
                    {/* Audio playback indicator */}
                    <View style={{ width: '75%' }}>
                        <View
                            style={{
                                width: `${(audioPlaybackTime / audioRecordTime) * 100}%`,
                                height: 2,
                                backgroundColor: playingAudio ? PRIMARY : 'transparent',
                            }}
                        />
                    </View>
                </View>
            )}
            {/* Messaging controls */}
            <View style={[styles.inputContainer, { paddingBottom: edgeInsets.bottom, paddingHorizontal: edgeInsets.left }]}>
                <TouchableOpacity style={styles.button} onPress={props.handleCameraSelect}>
                    <Icon source="camera" color={PRIMARY} size={20} />
                </TouchableOpacity>
                {expandActions && (
                    <TouchableOpacity style={styles.button} onPress={props.handleImageSelect}>
                        <Icon source="image" color={PRIMARY} size={20} />
                    </TouchableOpacity>
                )}
                {expandActions && (
                    <TouchableOpacity style={styles.button} onPressIn={onMicPress} onPressOut={onMicRelease}>
                        <Icon source="microphone" color={PRIMARY} size={20} />
                    </TouchableOpacity>
                )}
                {!expandActions && (
                    <TouchableOpacity style={styles.button} onPress={() => setExpandActions(true)}>
                        <Icon source="chevron-right" color={PRIMARY} size={20} />
                    </TouchableOpacity>
                )}
                <View style={{ flex: 1 }}>
                    <TextInput
                        placeholder="Type a message"
                        multiline={true}
                        value={props.inputMessage}
                        onChangeText={setInputMessage}
                        style={styles.input}
                        clearButtonMode="always"
                    />
                </View>

                {props.loading ? (
                    <ActivityIndicator style={{ marginHorizontal: 5 }} />
                ) : (
                    <TouchableOpacity style={styles.button} onPress={audioFilePath ? sendAudio : props.handleSend}>
                        <Icon source="send-lock" color={PRIMARY} size={20} />
                    </TouchableOpacity>
                )}
            </View>
        </CustomKeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    audioContainer: {
        flexDirection: 'column',
        alignItems: 'center',
        paddingVertical: 2,
        backgroundColor: DARKHEADER,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
    },
    input: {
        maxHeight: 100,
        borderRadius: 20,
        paddingVertical: 10,
        paddingHorizontal: 12,
        backgroundColor: '#faf1e6',
    },
    button: {
        padding: 10,
    },
});
