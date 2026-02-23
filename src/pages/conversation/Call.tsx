import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Image } from 'react-native';
import { connect, ConnectedProps } from 'react-redux';
import { Icon } from 'react-native-paper';
import { mediaDevices, MediaStream, RTCPeerConnection, RTCSessionDescription, RTCView } from 'react-native-webrtc';
import RTCDataChannel from 'react-native-webrtc/lib/typescript/RTCDataChannel';
import { RTCOfferOptions } from 'react-native-webrtc/lib/typescript/RTCUtil';
import MessageEvent from 'react-native-webrtc/lib/typescript/MessageEvent';
import InCallManager from 'react-native-incall-manager';
import Toast from 'react-native-toast-message';
import { StackScreenProps } from '@react-navigation/stack';
import { withSafeAreaInsets, WithSafeAreaInsetsProps } from 'react-native-safe-area-context';

import {
    CandidatePair,
    LocalCandidate,
    WebRTCMessage,
    getConnStats,
    getIconForConnType,
    getRTCConfiguration,
} from '~/global/webrtc';
import { DARKHEADER } from '~/global/variables';
import { dbSaveCallRecord } from '~/global/database';
import { resetCallState, SocketData } from '~/store/actions/websocket';
import { UserData } from '~/store/reducers/user';
import { RootState } from '~/store/store';
import { HomeStackParamList } from '~/../App';

class Call extends React.Component<Props, State> {
    callTimer: NodeJS.Timeout | undefined;
    callStatsTimer: NodeJS.Timeout | undefined;

    constructor(props: Props) {
        super(props);
        this.state = {
            peerUser: props.route.params.data?.peer_user || this.props.caller,
            peerConnection: undefined,
            peerChannel: undefined,
            stream: undefined,
            peerStream: undefined,
            videoEnabled: props.route.params.data?.video_enabled,
            voiceEnabled: true,
            loudSpeaker: props.route.params.data?.video_enabled,
            isFrontCamera: true,
            mirrorPeerStream: true,
            showPeerStream: props.route.params.data?.video_enabled,
            minimizeLocalStream: true,
            callStatus: '',
            callDelay: 0,
            connectionInfo: undefined,
            callTime: Date.now(),
            startTime: Date.now(),
        };
        this.callTimer = undefined;
        this.callStatsTimer = undefined;
    }

    componentDidMount = () => {
        this.callTimer = setInterval(() => this.setState({ callTime: (Date.now() - this.state.startTime) / 1000 }), 1000);
        this.callStatsTimer = setInterval(this.calculatePing, 2500);

        InCallManager.start({ media: this.state.videoEnabled ? 'video' : 'audio', auto: true });
        this.checkCallStatus(undefined);
    };

    componentWillUnmount = () => {
        InCallManager.stop();
        // If call is active then let peer know we closed the call page
        const callIsActive = !this.state.peerStream;
        this.endCall(callIsActive);
        if (this.callTimer) {
            clearInterval(this.callTimer);
        }
        if (this.callStatsTimer) {
            clearInterval(this.callStatsTimer);
        }
    };

    componentDidUpdate = async (prevProps: Readonly<Props>, _prevState: Readonly<State>) => {
        await this.checkCallStatus(prevProps);
    };

    checkCallStatus = async (prevProps: Readonly<Props> | undefined) => {
        // Check if peer has answered our call
        if (this.props.callAnswer && !prevProps?.callAnswer) {
            if (this.state.peerConnection) {
                // User answered our call, set remote description on webrtc connection and add recieved ice candidates
                const offerDescription = new RTCSessionDescription(this.props.callAnswer);
                await this.state.peerConnection.setRemoteDescription(offerDescription);
                this.props.iceCandidates.forEach(iceCandidate => {
                    // console.debug('Got ICE candidate after peer answered, adding to peerConnection:', iceCandidate);
                    this.state.peerConnection?.addIceCandidate(iceCandidate);
                });
            }
        }
        // Check if peer is calling us
        if (this.props.callOffer && !prevProps?.callOffer) {
            // Attempt to start local stream and answer the peer's call
            await this.startStream();
        }
    };

    answerCall = async () => {
        if (!this.state.peerConnection) {
            return console.debug('answerCall: Unable to answer call with null peerConnection');
        }

        // Use the received offerDescription
        let offerDescription = new RTCSessionDescription(this.props.callOffer);
        await this.state.peerConnection.setRemoteDescription(offerDescription);

        const answerDescription = await this.state.peerConnection.createAnswer();
        await this.state.peerConnection.setLocalDescription(answerDescription as RTCSessionDescription);

        InCallManager.stopRingtone();

        // Send the answerDescription back as a response to the offerDescription. Using websockets
        const message: SocketData = {
            cmd: 'CALL_ANSWER',
            data: {
                sender_id: this.props.userData.id,
                sender: this.props.userData.phone_no,
                reciever_id: this.state.peerUser.id,
                reciever: this.state.peerUser.phone_no,
                answer: answerDescription,
            },
        };
        this.props.socketConn?.send(JSON.stringify(message));

        this.props.iceCandidates.forEach(iceCandidate => {
            // console.debug('Got ICE candidate after we answered, adding to peerConnection:', iceCandidate);
            this.state.peerConnection?.addIceCandidate(iceCandidate);
        });
    };

    call = async () => {
        if (!this.state.peerConnection) {
            return console.error('call: Unable to initiate call with null peerConnection');
        }
        // Create data channel
        const peerChannel = this.state.peerConnection.createDataChannel(this.props.userData.phone_no);
        peerChannel.addEventListener('open', e => console.log('[WebRTC] Channel opened:', e.channel.label));
        peerChannel.addEventListener('error', this.onWebrtcError);
        peerChannel.addEventListener('close', e => console.log('[WebRTC] Channel closed:', e));
        peerChannel.addEventListener('message', this.onChannelMessage);
        // Create offer
        let sessionConstraints: RTCOfferOptions = {
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
            voiceActivityDetection: true,
        };
        let offerDescription = (await this.state.peerConnection.createOffer(
            sessionConstraints,
        )) as RTCSessionDescriptionInit;
        await this.state.peerConnection.setLocalDescription(offerDescription as RTCSessionDescription);
        // Send the offerDescription to the other participant. Using websockets
        const message: SocketData = {
            cmd: 'CALL_OFFER',
            data: {
                sender_id: this.props.userData.id,
                sender: this.props.userData.phone_no,
                reciever_id: this.state.peerUser.id,
                reciever: this.state.peerUser.phone_no,
                offer: offerDescription,
                type: this.state.videoEnabled ? 'video' : 'audio',
            },
        };
        this.props.socketConn?.send(JSON.stringify(message));
        // Update state
        this.setState({ callStatus: `${this.state.peerUser?.phone_no} : Dialing`, peerChannel: peerChannel });
    };

    startStream = async () => {
        if (this.state.stream) {
            return;
        }

        try {
            console.debug('startStream - Loading local MediaStreams');
            const newStream = await mediaDevices.getUserMedia({ video: true, audio: true });

            console.debug('startStream - RTCPeerConnection Init');
            const newConnection = new RTCPeerConnection(getRTCConfiguration(this.props.turnServerCreds));

            // Event handlers
            newConnection.addEventListener('error', this.onWebrtcError);
            newConnection.addEventListener('icecandidateerror', this.onWebrtcError);
            newConnection.addEventListener('icecandidate', (event: any) => {
                if (!event.candidate) {
                    console.debug('[WebRTC] onIceCandidate finished');
                }
                // Send the iceCandidate to the peer using websockets
                const message: SocketData = {
                    cmd: 'CALL_ICE_CANDIDATE',
                    data: {
                        sender_id: this.props.userData.id,
                        sender: this.props.userData.phone_no,
                        reciever_id: this.state.peerUser.id,
                        reciever: this.state.peerUser.phone_no,
                        candidate: event.candidate?.toJSON() || event.candidate,
                    },
                };
                this.props.socketConn?.send(JSON.stringify(message));
            });
            newConnection.addEventListener('connectionstatechange', _event => {
                console.debug('[WebRTC] connection state change:', newConnection?.connectionState);
                this.setState({ callStatus: `${this.state.peerUser?.phone_no} : ${newConnection?.connectionState}` });
                if (newConnection?.connectionState === 'disconnected') {
                    this.endCall(true);
                }
                this.checkConnectionType();
            });
            newConnection.addEventListener('iceconnectionstatechange', _event => {
                console.debug('[WebRTC] ICE connection state change:', newConnection?.iceConnectionState);
                this.checkConnectionType();
            });
            newConnection.addEventListener('track', event => {
                const newPeerStream = event.streams[0];
                newPeerStream.addTrack(event.track!);
                this.setState({ peerStream: newPeerStream });
            });
            newConnection.addEventListener('datachannel', event => {
                this.setState({ peerChannel: event.channel }, () => {
                    event.channel.addEventListener('open', e => console.log('[WebRTC] Channel opened:', e.channel.label));
                    event.channel.addEventListener('error', this.onWebrtcError);
                    event.channel.addEventListener('close', e => console.log('[WebRTC] Channel closed:', e));
                    event.channel.addEventListener('message', this.onChannelMessage);
                });
            });

            console.debug('startStream - Loading tracks');
            newStream.getTracks().forEach(track => newConnection.addTrack(track, newStream));
            // Disable video if it's an audio call (can be enabled later)
            newStream.getVideoTracks()[0].enabled = this.state.videoEnabled;

            this.setState(
                {
                    startTime: Date.now(),
                    stream: newStream,
                    peerConnection: newConnection,
                },
                () => {
                    if (!this.props.callOffer) {
                        this.call();
                    } else {
                        this.answerCall();
                    }
                },
            );
        } catch (err: any) {
            console.error('startStream error:', err);
        }
    };

    endCall = (isEvent: boolean = false) => {
        if (!this.state.stream && !this.state.peerConnection && !this.state.peerChannel) {
            return;
        }

        // Persist call record
        try {
            dbSaveCallRecord({
                peer_phone: this.state.peerUser.phone_no,
                peer_id: String(this.state.peerUser.id),
                peer_pic: this.state.peerUser.pic,
                direction: this.props.callOffer ? 'incoming' : 'outgoing',
                call_type: this.props.route.params.data?.video_enabled ? 'video' : 'audio',
                status: 'answered',
                duration: Math.floor(this.state.callTime),
                started_at: new Date(this.state.startTime).toISOString(),
            });
        } catch (err) {
            console.error('Failed to save call record:', err);
        }

        if (!isEvent) {
            // Notify peer know we hung up, through webrtc channel
            const closeMsg: WebRTCMessage = { type: 'CLOSE' };
            this.state.peerChannel?.send(JSON.stringify(closeMsg));
        } else {
            // Peer hung up, show a toast to user
            Toast.show({
                type: 'info',
                text1: `${this.state.peerUser.phone_no || 'User'} hanged up the call`,
                text2: `Call lasted ${this.calculateCallTime()}`,
            });
        }
        // Close networking
        this.state.stream?.release?.();
        this.state.peerConnection?.close?.();
        this.state.peerChannel?.close?.();
        // Reset local state
        this.setState({
            peerConnection: undefined,
            stream: undefined,
            peerStream: undefined,
            peerChannel: undefined,
            callDelay: 0,
            callStatus: '',
        });
        // Reset redux state
        this.props.resetCallState();
    };

    onChannelMessage = (event: MessageEvent<'message'>) => {
        if (typeof event.data !== 'string') {
            return console.warn('[WebRTC] Received a non string message in channel:', event.data);
        }
        if (!this.state.peerChannel) {
            return console.warn('[WebRTC] Received a message in channel but channel is undefined:');
        }

        const message: WebRTCMessage = JSON.parse(event.data || '{}');
        console.debug('[WebRTC] Received channel message', message.type);
        switch (message.type) {
            case 'PING':
                const pingReply: WebRTCMessage = { type: 'PING_REPLY', data: message.data };
                this.state.peerChannel.send(JSON.stringify(pingReply));
                break;
            case 'PING_REPLY':
                const pingInMs = Date.now() - message.data;
                this.setState({ callDelay: pingInMs });
                break;
            case 'SWITCH_CAM':
                this.setState({ mirrorPeerStream: !this.state.mirrorPeerStream });
                break;
            case 'MUTE_CAM':
                this.setState({ showPeerStream: !this.state.showPeerStream });
                break;
            case 'CLOSE':
                this.endCall(true);
                break;
            default:
                console.warn('[WebRTC] unhandled channel message of type:', message.type);
                break;
        }
    };

    onWebrtcError = (e: any) => {
        console.error('[WebRTC] error:', e);
        Toast.show({
            type: 'error',
            text1: 'Error occoured during call',
            text2: e.toString(),
        });
    };

    toggleVideoEnabled = async () => {
        if (!this.state.stream) {
            return;
        }

        const newVideoEnabled = !this.state.videoEnabled;
        const videoTrack = this.state.stream.getVideoTracks()[0];
        videoTrack.enabled = newVideoEnabled;
        this.setState({ videoEnabled: newVideoEnabled });
        // Notify peer
        const muteCamMsg: WebRTCMessage = { type: 'MUTE_CAM' };
        this.state.peerChannel?.send(JSON.stringify(muteCamMsg));
    };

    toggleCamera = () => {
        if (!this.state.stream) {
            return;
        }

        const newIsFrontCamera = !this.state.isFrontCamera;
        const videoTrack = this.state.stream.getVideoTracks()[0];
        videoTrack.applyConstraints({ facingMode: newIsFrontCamera ? 'user' : 'environment' });
        this.setState({ isFrontCamera: newIsFrontCamera });
        // Notify peer
        const switchCamMsg: WebRTCMessage = { type: 'SWITCH_CAM' };
        this.state.peerChannel?.send(JSON.stringify(switchCamMsg));
    };

    toggleVoiceEnabled = () => {
        if (!this.state.stream) {
            return;
        }

        const newVoiceEnabled = !this.state.voiceEnabled;
        const audioTrack = this.state.stream.getAudioTracks()[0];
        audioTrack.enabled = newVoiceEnabled;
        InCallManager.setMicrophoneMute(newVoiceEnabled);
        this.setState({ voiceEnabled: newVoiceEnabled });
    };

    toggleLoudSpeaker = () => {
        if (!this.state.stream) {
            return;
        }

        const newLoudSpeaker = !this.state.loudSpeaker;
        InCallManager.setSpeakerphoneOn(newLoudSpeaker);
        this.setState({ loudSpeaker: newLoudSpeaker });
    };

    toggleMinimizedStream = () => {
        this.setState({ minimizeLocalStream: !this.state.minimizeLocalStream });
    };

    checkConnectionType = async () => {
        if (!this.state.peerConnection) {
            return;
        }
        // Get all WebRTC connection stats
        const reports = await getConnStats(this.state.peerConnection);
        // Filter what we want
        const candidatePair = reports.find(rp => rp.type === 'candidate-pair' && rp.state === 'succeeded') as
            | CandidatePair
            | undefined;
        const localCandidate = reports.find(
            rp => rp.type === 'local-candidate' && rp.id === candidatePair?.localCandidateId,
        ) as LocalCandidate | undefined;

        if (!candidatePair || !localCandidate) {
            return console.log('[WebRTC] Failed to load reports');
        }
        this.setState({
            connectionInfo: { localCandidate, candidatePair },
        });
    };

    calculatePing = () => {
        if (!this.state.peerChannel) {
            return;
        }
        // Ping peer to calculate delay
        console.debug('[WebRTC] pinging peer...');
        const pingMsg: WebRTCMessage = { type: 'PING', data: Date.now() };
        this.state.peerChannel.send(JSON.stringify(pingMsg));
        // Reload connection info if not already loaded
        if (!this.state.connectionInfo) {
            this.checkConnectionType();
        }
    };

    calculateCallTime = () => {
        // ~~ = fast Math.floor
        const hours = ~~(this.state.callTime / (60 * 60));
        const minutes = ~~(this.state.callTime / 60);
        const seconds = ~~(this.state.callTime - minutes * 60);

        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    };

    renderCallInfo = () => {
        const localCandidate = this.state.connectionInfo?.localCandidate;
        return (
            this.state.stream && (
                <View>
                    <Text>
                        {this.calculateCallTime()} : {localCandidate?.protocol}({localCandidate?.networkType})
                    </Text>
                    <Text>
                        Connection : {localCandidate?.candidateType}{' '}
                        {getIconForConnType(localCandidate?.candidateType || '')}
                    </Text>
                    <Text>Ping : {this.state.callDelay}ms</Text>
                </View>
            )
        );
    };

    render = () => {
        const showPeerStream = this.state.peerStream && this.state.showPeerStream;
        const showLocalStream = this.state.stream && this.state.videoEnabled;

        return (
            <View style={styles.body}>
                {/* Header */}
                <View style={styles.header}>
                    <Text>{this.state.callStatus}</Text>
                    {this.renderCallInfo()}
                </View>
                {/* Remote camera view or placeholder */}
                <View style={{ width: '100%', flex: 1 }}>
                    {showPeerStream ? (
                        <RTCView
                            style={styles.stream}
                            streamURL={this.state.peerStream!.toURL()}
                            mirror={this.state.mirrorPeerStream}
                            objectFit={'cover'}
                            zOrder={1}
                        />
                    ) : (
                        <Image
                            style={[styles.stream, { backgroundColor: '#333333' }]}
                            source={{ uri: this.state.peerUser?.pic }}
                        />
                    )}
                </View>
                <View style={[styles.footer]}>
                    {/* Local camera view or placeholder */}
                    {showLocalStream ? (
                        <RTCView
                            style={[styles.userCamera, this.state.minimizeLocalStream && styles.userCameraSmall]}
                            streamURL={this.state.stream!.toURL()}
                            mirror={this.state.isFrontCamera}
                            objectFit={'cover'}
                            zOrder={2}
                            onTouchEnd={this.toggleMinimizedStream}
                        />
                    ) : (
                        <Image
                            style={[styles.userCamera, styles.userCameraSmall]}
                            source={{ uri: this.props.userData.pic }}
                        />
                    )}
                    <View style={[styles.actionContainer, { paddingBottom: this.props.insets.bottom }]}>
                        {/* Inactive call controls */}
                        {!this.state.stream && (
                            <TouchableOpacity onPress={this.startStream} style={[styles.actionButton, styles.bgGreen]}>
                                <Icon source="phone" size={20} />
                            </TouchableOpacity>
                        )}
                        {/* Active call controls */}
                        {this.state.stream && (
                            <>
                                <TouchableOpacity
                                    onPress={this.toggleLoudSpeaker}
                                    style={[styles.actionButton, this.state.loudSpeaker && styles.bgWhite]}
                                >
                                    <Icon
                                        source="volume-high"
                                        size={20}
                                        color={this.state.loudSpeaker ? 'black' : undefined}
                                    />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={this.toggleVoiceEnabled} style={styles.actionButton}>
                                    <Icon source={this.state.voiceEnabled ? 'microphone' : 'microphone-off'} size={20} />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={this.toggleVideoEnabled} style={styles.actionButton}>
                                    <Icon source={this.state.videoEnabled ? 'video' : 'video-off'} size={20} />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={this.toggleCamera} style={styles.actionButton}>
                                    <Icon source="camera-switch" size={20} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={() => this.endCall(false)}
                                    style={[styles.actionButton, styles.bgRed]}
                                >
                                    <Icon source="phone" size={20} />
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
    callAnswer: state.userReducer.callAnswer,
    iceCandidates: state.userReducer.iceCandidates,
    userData: state.userReducer.user_data,
    caller: state.userReducer.caller,
    turnServerCreds: state.userReducer.turnServerCredentials,
    socketConn: state.userReducer.socketConn,
});

const mapDispatchToProps = {
    resetCallState,
};

const connector = connect(mapStateToProps, mapDispatchToProps);
type PropsFromRedux = ConnectedProps<typeof connector>;
export default withSafeAreaInsets(connector(Call));

interface State {
    peerUser: UserData;
    peerConnection: RTCPeerConnection | undefined;
    peerChannel: RTCDataChannel | undefined;
    stream: MediaStream | undefined;
    peerStream: MediaStream | undefined;
    videoEnabled: boolean;
    voiceEnabled: boolean;
    loudSpeaker: boolean;
    isFrontCamera: boolean;
    mirrorPeerStream: boolean;
    showPeerStream: boolean;
    minimizeLocalStream: boolean;
    callStatus: string;
    callDelay: number;
    connectionInfo:
        | {
              localCandidate: LocalCandidate;
              candidatePair: CandidatePair;
          }
        | undefined;
    callTime: number;
    startTime: number;
}

type Props = PropsFromRedux & StackScreenProps<HomeStackParamList, 'Call'> & WithSafeAreaInsetsProps;

const styles = StyleSheet.create({
    header: {
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#777777a0',
        position: 'absolute',
        width: '100%',
        top: 0,
        zIndex: 2,
        paddingVertical: 5,
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
        backgroundColor: '#000000a0',
    },
    actionButton: {
        borderRadius: 50,
        padding: 15,
        margin: 5,
        backgroundColor: 'gray',
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
        backgroundColor: 'red',
    },
    bgGreen: {
        backgroundColor: 'green',
    },
    bgWhite: {
        backgroundColor: 'white',
    },
});
