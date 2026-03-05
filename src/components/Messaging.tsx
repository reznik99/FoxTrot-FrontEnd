import React, { useCallback, useRef, useState } from 'react';
// Recording modes: tap mic → "locked" recording (tap stop to finish), hold mic → stop on release
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import Sound, { AudioEncoderAndroidType, AudioSet } from 'react-native-nitro-sound';
import { ActivityIndicator, Icon, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import CustomKeyboardAvoidingView from '~/components/CustomKeyboardAvoidingView';
import { logger } from '~/global/logger';
import { getMicrophoneRecordingPermission, getReadExtPermission } from '~/global/permissions';
import { DARKHEADER, ERROR_RED, SECONDARY_LITE, TEXT_SECONDARY } from '~/global/variables';

const TAP_THRESHOLD_MS = 500;

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
    const [recordLocked, setRecordLocked] = useState(false);
    const recordStartRef = useRef(0);

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
        setPlayingAudio(false);
        setRecording(false);
        setRecordLocked(false);
        Sound.removeRecordBackListener();
        Sound.removePlayBackListener();
        Sound.removePlaybackEndListener();
    }, []);

    const stopRecording = useCallback(async () => {
        await Sound.stopRecorder();
        Sound.removeRecordBackListener();
        setRecording(false);
        setRecordLocked(false);
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
            recordStartRef.current = Date.now();
            const result = await Sound.startRecorder(undefined, audioConfig);
            setAudioFilePath(result);
            setRecording(true);
            logger.info('Recording started:', result);
        } catch (err) {
            logger.error(err);
        }
    }, [resetAudio]);

    const onMicRelease = useCallback(async () => {
        // Quick tap → lock recording mode (user taps stop to finish)
        if (Date.now() - recordStartRef.current < TAP_THRESHOLD_MS) {
            setRecordLocked(true);
            return;
        }
        // Normal hold-and-release → stop recording
        try {
            await stopRecording();
        } catch (err) {
            logger.error(err);
            resetAudio();
            setRecording(false);
        }
    }, [stopRecording, resetAudio]);

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
            {/* Audio bar — above the input row */}
            {!!audioFilePath && (
                <View style={styles.audioContainer}>
                    {recording ? (
                        <View style={styles.audioRow}>
                            <Icon source="microphone" color="#e53935" size={18} />
                            <Text style={styles.recordingLabel}>
                                {recordLocked ? 'Tap stop to finish' : 'Release to stop'}
                            </Text>
                            <Text style={styles.audioDuration}>{Sound.mmssss(~~audioRecordTime)}</Text>
                            {recordLocked && (
                                <TouchableOpacity onPress={stopRecording} hitSlop={8}>
                                    <Icon source="stop-circle-outline" color={ERROR_RED} size={20} />
                                </TouchableOpacity>
                            )}
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
                                <Icon source="delete-outline" color={ERROR_RED} size={18} />
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            )}
            {/* Input row — never changes layout */}
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
                        placeholder={audioFilePath ? 'Send audio message' : 'Type a message'}
                        multiline={true}
                        value={props.inputMessage}
                        onChangeText={setInputMessage}
                        style={[styles.input, audioFilePath && styles.inputDisabled]}
                        clearButtonMode="always"
                        editable={!audioFilePath}
                    />
                </View>

                {props.loading ? (
                    <ActivityIndicator style={{ marginHorizontal: 5 }} />
                ) : (
                    <TouchableOpacity
                        style={styles.button}
                        onPress={audioFilePath && !recording ? sendAudio : !audioFilePath ? props.handleSend : undefined}
                    >
                        <Icon source="send-lock" color={recording ? SECONDARY_LITE : colors.primary} size={20} />
                    </TouchableOpacity>
                )}
            </View>
        </CustomKeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    audioContainer: {
        paddingVertical: 6,
        paddingHorizontal: 14,
        marginHorizontal: 40,
        marginBottom: 4,
        backgroundColor: DARKHEADER,
        borderRadius: 20,
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
        minWidth: 58,
        textAlign: 'right',
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
    inputDisabled: {
        opacity: 0.4,
    },
    button: {
        padding: 10,
    },
});
