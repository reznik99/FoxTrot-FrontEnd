import React, { useCallback, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Icon, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Sound, { AudioSet, AudioEncoderAndroidType } from 'react-native-nitro-sound';

import CustomKeyboardAvoidingView from '~/components/CustomKeyboardAvoidingView';
import { getMicrophoneRecordingPermission, getReadExtPermission } from '~/global/permissions';
import { DARKHEADER, ERROR_RED, SECONDARY_LITE, TEXT_SECONDARY } from '~/global/variables';
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
    const { colors } = useTheme();
    const edgeInsets = useSafeAreaInsets();
    const [expandActions, setExpandActions] = useState(false);
    const [audioFilePath, setAudioFilePath] = useState('');
    const [audioRecordTime, setAudioRecordTime] = useState(0);
    const [audioPlaybackTime, setAudioPlaybackTime] = useState(0);
    const [playingAudio, setPlayingAudio] = useState(false);
    const [recording, setRecording] = useState(false);

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
            setRecording(true);
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
            setRecording(false);
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
                    {recording ? (
                        <View style={styles.audioRow}>
                            <Icon source="microphone" color="#e53935" size={18} />
                            <Text style={styles.recordingLabel}>Recording</Text>
                            <Text style={styles.audioDuration}>{Sound.mmssss(~~audioRecordTime)}</Text>
                        </View>
                    ) : (
                        <View style={styles.audioRow}>
                            <TouchableOpacity onPress={playingAudio ? stopAudio : playAudio} hitSlop={8}>
                                <Icon source={playingAudio ? 'pause' : 'play'} color={colors.primary} size={20} />
                            </TouchableOpacity>
                            <View style={styles.audioTrack}>
                                <View
                                    style={[
                                        styles.audioFill,
                                        {
                                            backgroundColor: colors.primary,
                                            width:
                                                audioRecordTime > 0
                                                    ? `${(audioPlaybackTime / audioRecordTime) * 100}%`
                                                    : '0%',
                                        },
                                    ]}
                                />
                            </View>
                            <Text style={styles.audioDuration}>
                                {Sound.mmssss(audioPlaybackTime ? ~~audioPlaybackTime : ~~audioRecordTime)}
                            </Text>
                            <TouchableOpacity onPress={resetAudio} hitSlop={8}>
                                <Icon source="close" color={SECONDARY_LITE} size={18} />
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            )}
            {/* Messaging controls */}
            <View style={[styles.inputContainer, { paddingBottom: edgeInsets.bottom, paddingHorizontal: edgeInsets.left }]}>
                <TouchableOpacity style={styles.button} onPress={props.handleCameraSelect}>
                    <Icon source="camera" color={colors.primary} size={20} />
                </TouchableOpacity>
                {expandActions && (
                    <TouchableOpacity style={styles.button} onPress={props.handleImageSelect}>
                        <Icon source="image" color={colors.primary} size={20} />
                    </TouchableOpacity>
                )}
                {expandActions && (
                    <TouchableOpacity style={styles.button} onPressIn={onMicPress} onPressOut={onMicRelease}>
                        <Icon source="microphone" color={colors.primary} size={20} />
                    </TouchableOpacity>
                )}
                {!expandActions && (
                    <TouchableOpacity style={styles.button} onPress={() => setExpandActions(true)}>
                        <Icon source="chevron-right" color={colors.primary} size={20} />
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
                        <Icon source="send-lock" color={colors.primary} size={20} />
                    </TouchableOpacity>
                )}
            </View>
        </CustomKeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    audioContainer: {
        paddingVertical: 8,
        paddingHorizontal: 26,
        backgroundColor: DARKHEADER,
    },
    audioRow: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 28,
        gap: 10,
    },
    recordingLabel: {
        flex: 1,
        color: ERROR_RED,
        fontSize: 13,
    },
    audioTrack: {
        flex: 1,
        height: 3,
        borderRadius: 1.5,
        backgroundColor: '#ffffff30',
    },
    audioFill: {
        height: 3,
        borderRadius: 1.5,
    },
    audioDuration: {
        color: TEXT_SECONDARY,
        fontSize: 12,
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
