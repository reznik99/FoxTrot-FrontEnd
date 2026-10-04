import React from 'react';
import { Image, ScrollView, StyleSheet, Text, ToastAndroid, TouchableOpacity, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { StackScreenProps } from '@react-navigation/stack';
import { ActivityIndicator, Button, Dialog, Icon, IconButton, Text as PaperText, Portal } from 'react-native-paper';
import { withSafeAreaInsets, WithSafeAreaInsetsProps } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';
import { connect, ConnectedProps } from 'react-redux';

import * as callManager from '~/global/callManager';
import { CallManagerState } from '~/global/callManager';
import { formatCallTime } from '~/global/helper';
import { logger } from '~/global/logger';
import { HomeStackParamList } from '~/global/navigation';
import { DARKHEADER, DIVIDER, ERROR_RED } from '~/global/variables';
import { formatCallPath, formatMs, getIconForConnType } from '~/global/webrtc';
import { RootState } from '~/store/store';

interface State {
    cm: CallManagerState;
    minimizeLocalStream: boolean;
    showDiagnostics: boolean;
    showRawStats: boolean;
}

class Call extends React.Component<Props, State> {
    unsubscribe: (() => void) | undefined;

    constructor(props: Props) {
        super(props);
        this.state = {
            cm: callManager.getState(),
            minimizeLocalStream: true,
            showDiagnostics: false,
            showRawStats: false,
        };
    }

    componentDidMount = () => {
        // Subscribe to callManager state changes
        this.unsubscribe = callManager.subscribe(cm => this.setState({ cm }));

        if (callManager.isActive()) {
            // Call already in progress — user returned to the screen, just subscribe
            logger.debug('[CallScreen] Reconnecting to active call');
            return;
        }

        // Answer only when this screen was opened for an incoming call; a leftover offer in Redux
        // must never hijack an outgoing call (that path waits for the user to tap the call button)
        if (this.props.route.params.data?.is_incoming && this.props.callOffer) {
            this.answerIncomingCall(this.props.callOffer);
        }
        // For outgoing calls, user taps the call button (handled in render)
    };

    componentDidUpdate = (prevProps: Props) => {
        const isIncomingCall = !!this.props.route.params.data?.is_incoming;
        const offerJustArrived = !!this.props.callOffer && prevProps.callOffer !== this.props.callOffer;
        const userJustAnswered = !prevProps.route.params.data?.is_incoming && isIncomingCall;

        // Only answer incoming calls, and never while a call is already running
        if (!isIncomingCall || callManager.isActive()) {
            return;
        }
        // Answering needs both the offer and the user's Answer tap. Whichever arrived last triggers it:
        // the offer or the user's Answer tap (they were already on this screen when the call rang)
        if (this.props.callOffer && (offerJustArrived || userJustAnswered)) {
            this.answerIncomingCall(this.props.callOffer);
        }
    };

    answerIncomingCall = (callOffer: NonNullable<Props['callOffer']>) => {
        const { data } = this.props.route.params;
        // A leftover offer from someone else must not be answered on behalf of this screen's caller
        if (this.props.caller?.id !== data?.peer_user?.id) {
            logger.warn('[CallScreen] Ignoring offer from another caller', this.props.caller?.id, data?.peer_user?.id);
            return;
        }
        callManager.answerCall({
            peerUser: data?.peer_user || this.props.caller,
            videoEnabled: data?.video_enabled ?? false,
            userData: this.props.userData,
            turnCreds: this.props.turnServerCreds,
            callOffer: callOffer,
        });
        // Clear is_incoming, so this screen cannot auto-answer a later unrelated offer while it stays mounted
        this.props.navigation.setParams({ data: { ...data, is_incoming: false } });
    };

    componentWillUnmount = () => {
        // Just unsubscribe — do NOT end the call
        this.unsubscribe?.();
    };

    handleStartCall = () => {
        const peerUser = this.props.route.params.data?.peer_user || this.props.caller;
        callManager.startCall({
            peerUser,
            videoEnabled: this.props.route.params.data?.video_enabled ?? false,
            userData: this.props.userData,
            turnCreds: this.props.turnServerCreds,
        });
    };

    toggleMinimizedStream = () => {
        this.setState({ minimizeLocalStream: !this.state.minimizeLocalStream });
    };

    calculateCallTime = () => {
        return formatCallTime(this.state.cm.callTime);
    };

    copyDiagnostics = () => {
        const { cm } = this.state;
        const sections = (cm.diagnostics?.paths ?? []).map(path => formatCallPath(path, cm.callDelay).join('\n'));
        Clipboard.setString([...sections, `Raw stats:\n${cm.diagnostics?.raw ?? 'n/a'}`].join('\n\n'));
        ToastAndroid.show('Diagnostics copied', ToastAndroid.SHORT);
    };

    renderCallInfo = () => {
        const { cm } = this.state;
        const path = cm.diagnostics?.paths[0];
        const connType = path?.connType || '';
        return (
            callManager.hasStream() && (
                <View style={{ alignItems: 'center', gap: 2 }}>
                    <Text style={styles.headerText}>{this.calculateCallTime()}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {getIconForConnType(connType)}
                        <Text style={styles.headerTextSmall}>
                            {connType || 'connecting'} · {path?.local?.protocol || '...'} · {formatMs(path?.rttMs)}
                        </Text>
                        <IconButton
                            icon="information-outline"
                            iconColor="#fff"
                            size={20}
                            accessibilityLabel="Open call diagnostics"
                            onPress={() => this.setState({ showDiagnostics: true })}
                        />
                    </View>
                </View>
            )
        );
    };

    render = () => {
        const { cm, minimizeLocalStream } = this.state;
        const localStream = callManager.getLocalStream();
        const peerStream = callManager.getPeerStream();
        const peerUser = cm.peerUser || this.props.route.params.data?.peer_user || this.props.caller;

        const showPeerStream = peerStream && cm.showPeerStream;
        const showLocalStream = localStream && cm.videoEnabled;

        return (
            <View style={styles.body}>
                <Portal>
                    <Dialog
                        visible={this.state.showDiagnostics}
                        onDismiss={() => this.setState({ showDiagnostics: false })}
                        style={{ maxHeight: '85%' }}
                    >
                        <Dialog.Title>Call diagnostics</Dialog.Title>
                        <Dialog.ScrollArea style={{ flexShrink: 1 }}>
                            <ScrollView contentContainerStyle={{ paddingVertical: 16, gap: 8 }}>
                                {!cm.diagnostics?.paths.length && <PaperText>Diagnostics unavailable</PaperText>}
                                {!cm.diagnostics?.paths.length && (
                                    <PaperText>ICE RTT: n/a · Data-channel RTT: {formatMs(cm.callDelay)}</PaperText>
                                )}
                                {cm.diagnostics?.paths.map(path => (
                                    <View key={path.transport.id} style={{ gap: 4 }}>
                                        {formatCallPath(path, cm.callDelay).map((line, idx) => (
                                            <PaperText key={idx} selectable>
                                                {line}
                                            </PaperText>
                                        ))}
                                    </View>
                                ))}
                                <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
                                    <Button onPress={() => this.setState({ showRawStats: !this.state.showRawStats })}>
                                        {this.state.showRawStats ? 'Hide raw stats' : 'Show raw stats'}
                                    </Button>
                                    <Button icon="content-copy" onPress={this.copyDiagnostics}>
                                        Copy
                                    </Button>
                                </View>
                                {this.state.showRawStats && (
                                    <>
                                        <PaperText>Native stats may contain network addresses.</PaperText>
                                        <PaperText selectable>{cm.diagnostics?.raw ?? 'n/a'}</PaperText>
                                    </>
                                )}
                            </ScrollView>
                        </Dialog.ScrollArea>
                        <Dialog.Actions>
                            <Button onPress={() => this.setState({ showDiagnostics: false })}>Close</Button>
                        </Dialog.Actions>
                    </Dialog>
                </Portal>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.headerText}>{cm.callStatus}</Text>
                    {this.renderCallInfo()}
                </View>
                {/* Remote camera view or placeholder */}
                <View style={{ width: '100%', flex: 1 }}>
                    {showPeerStream ? (
                        <RTCView
                            style={styles.stream}
                            streamURL={peerStream!.toURL()}
                            mirror={cm.mirrorPeerStream}
                            objectFit={'cover'}
                            zOrder={this.state.showDiagnostics ? 0 : 1}
                        />
                    ) : (
                        <View style={[styles.stream, styles.peerPlaceholder]}>
                            <Image style={styles.peerAvatar} source={{ uri: peerUser?.pic }} />
                            <Text style={styles.peerName}>{peerUser?.phone_no}</Text>
                            {!localStream ? (
                                <Text style={[styles.peerStatus, { marginTop: 8 }]}>Tap call to start</Text>
                            ) : !peerStream ? (
                                <View style={styles.peerStatusRow}>
                                    <ActivityIndicator size={14} color="#ffffffaa" />
                                    <Text style={styles.peerStatus}>Calling...</Text>
                                </View>
                            ) : (
                                <View style={styles.peerStatusRow}>
                                    <Icon source="video-off" size={16} color="#ffffffaa" />
                                    <Text style={styles.peerStatus}>Camera off</Text>
                                </View>
                            )}
                        </View>
                    )}
                </View>
                <View style={[styles.footer]}>
                    {/* Local camera view or placeholder */}
                    {showLocalStream ? (
                        <RTCView
                            style={[styles.userCamera, minimizeLocalStream && styles.userCameraSmall]}
                            streamURL={localStream!.toURL()}
                            mirror={cm.isFrontCamera}
                            objectFit={'cover'}
                            zOrder={this.state.showDiagnostics ? 0 : 2}
                            onTouchEnd={this.toggleMinimizedStream}
                        />
                    ) : (
                        <View style={styles.localPlaceholder}>
                            <Image style={styles.localAvatar} source={{ uri: this.props.userData.pic }} />
                        </View>
                    )}
                    <View style={[styles.actionContainer, { paddingBottom: this.props.insets.bottom + 8 }]}>
                        {/* Inactive call controls */}
                        {!localStream && (
                            <TouchableOpacity onPress={this.handleStartCall} style={[styles.actionButton, styles.bgGreen]}>
                                <Icon source="phone" size={24} color="#fff" />
                            </TouchableOpacity>
                        )}
                        {/* Active call controls */}
                        {localStream && (
                            <>
                                <TouchableOpacity
                                    onPress={callManager.toggleSpeaker}
                                    style={[styles.actionButton, cm.loudSpeaker && styles.bgWhite]}
                                >
                                    <Icon source="volume-high" size={24} color={cm.loudSpeaker ? '#000' : '#fff'} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={callManager.toggleAudio}
                                    style={[styles.actionButton, !cm.voiceEnabled && styles.bgWhite]}
                                >
                                    <Icon
                                        source={cm.voiceEnabled ? 'microphone' : 'microphone-off'}
                                        size={24}
                                        color={cm.voiceEnabled ? '#fff' : '#000'}
                                    />
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={callManager.toggleVideo}
                                    style={[styles.actionButton, !cm.videoEnabled && styles.bgWhite]}
                                >
                                    <Icon
                                        source={cm.videoEnabled ? 'video' : 'video-off'}
                                        size={24}
                                        color={cm.videoEnabled ? '#fff' : '#000'}
                                    />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={callManager.toggleCamera} style={styles.actionButton}>
                                    <Icon source="camera-switch" size={24} color="#fff" />
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={() => callManager.endCall(false)}
                                    style={[styles.actionButton, styles.bgRed]}
                                >
                                    <Icon source="phone-hangup" size={24} color="#fff" />
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                </View>
            </View>
        );
    };
}

const mapStateToProps = (state: RootState) => ({
    callOffer: state.userReducer.callOffer,
    userData: state.userReducer.user_data,
    caller: state.userReducer.caller,
    turnServerCreds: state.userReducer.turnServerCredentials,
});

const connector = connect(mapStateToProps);
type PropsFromRedux = ConnectedProps<typeof connector>;
export default withSafeAreaInsets(connector(Call));

type Props = PropsFromRedux & StackScreenProps<HomeStackParamList, 'Call'> & WithSafeAreaInsetsProps;

const styles = StyleSheet.create({
    header: {
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#00000080',
        position: 'absolute',
        width: '100%',
        top: 0,
        zIndex: 2,
        paddingVertical: 8,
    },
    headerText: {
        color: '#fff',
        fontSize: 14,
    },
    headerTextSmall: {
        color: '#ffffffcc',
        fontSize: 12,
    },
    body: {
        backgroundColor: DARKHEADER,
        justifyContent: 'center',
        width: '100%',
        height: '100%',
    },
    stream: {
        flex: 1,
        width: '100%',
    },
    footer: {
        flexDirection: 'column',
        justifyContent: 'center',
        position: 'absolute',
        width: '100%',
        bottom: -1,
    },
    actionContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        width: '100%',
        backgroundColor: '#00000080',
    },
    peerPlaceholder: {
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: DARKHEADER,
    },
    peerAvatar: {
        width: 160,
        height: 160,
        borderRadius: 80,
        backgroundColor: DIVIDER,
    },
    peerName: {
        color: '#fff',
        fontSize: 20,
        marginTop: 16,
    },
    peerStatus: {
        color: '#ffffffaa',
        fontSize: 14,
    },
    peerStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 8,
    },
    localPlaceholder: {
        width: 125,
        aspectRatio: 9 / 16,
        alignSelf: 'flex-end',
        borderRadius: 5,
        backgroundColor: '#333333f0',
        justifyContent: 'center',
        alignItems: 'center',
    },
    localAvatar: {
        width: 120,
        height: 120,
        borderRadius: 80,
        backgroundColor: '#555',
    },
    actionButton: {
        borderRadius: 50,
        padding: 15,
        margin: 5,
        backgroundColor: '#555',
    },
    userCamera: {
        width: 225,
        aspectRatio: 9 / 16,
        alignSelf: 'flex-end',
        borderRadius: 5,
        backgroundColor: '#333333f0',
    },
    userCameraSmall: {
        width: 125,
        aspectRatio: 9 / 16,
    },
    bgRed: {
        backgroundColor: ERROR_RED,
    },
    bgGreen: {
        backgroundColor: '#4caf50',
    },
    bgWhite: {
        backgroundColor: 'white',
    },
});
