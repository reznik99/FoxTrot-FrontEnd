import InCallManager from 'react-native-incall-manager';
import Toast from 'react-native-toast-message';
import { mediaDevices, MediaStream, RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';
import MessageEvent from 'react-native-webrtc/lib/typescript/MessageEvent';
import RTCDataChannel from 'react-native-webrtc/lib/typescript/RTCDataChannel';
import { RTCSessionDescriptionInit } from 'react-native-webrtc/lib/typescript/RTCSessionDescription';
import { RTCOfferOptions } from 'react-native-webrtc/lib/typescript/RTCUtil';

import { dbSaveCallRecord } from '~/global/database';
import { logger } from '~/global/logger';
import { readFromStorage, StorageKeys } from '~/global/storage';
import { CandidatePair, getConnStats, getRTCConfiguration, LocalCandidate, WebRTCMessage } from '~/global/webrtc';
import { SocketData, wsSendMessage } from '~/global/websocketManager';
import { TURNCredentials, UserData } from '~/store/reducers/user';
import { store } from '~/store/store';

// ============================================================================
// Types & State
// ============================================================================

export enum CallPhase {
    IDLE = 'idle',
    STARTING = 'starting',
    DIALING = 'dialing',
    RINGING = 'ringing',
    CONNECTING = 'connecting',
    CONNECTED = 'connected',
    ENDING = 'ending',
}

export interface CallManagerState {
    phase: CallPhase;
    peerUser: UserData | null;
    isOutgoing: boolean;
    videoEnabled: boolean;
    voiceEnabled: boolean;
    loudSpeaker: boolean;
    isFrontCamera: boolean;
    mirrorPeerStream: boolean;
    showPeerStream: boolean;
    callTime: number;
    startTime: number;
    callDelay: number;
    callStatus: string;
    connectionInfo:
        | {
              localCandidate: LocalCandidate;
              candidatePair: CandidatePair;
              isRelayed: boolean;
          }
        | undefined;
}

const initialState: CallManagerState = {
    phase: CallPhase.IDLE,
    peerUser: null,
    isOutgoing: false,
    videoEnabled: false,
    voiceEnabled: true,
    loudSpeaker: false,
    isFrontCamera: true,
    mirrorPeerStream: true,
    showPeerStream: false,
    callTime: 0,
    startTime: Date.now(),
    callDelay: 0,
    callStatus: '',
    connectionInfo: undefined,
};

const internal = {
    peerConnection: null as RTCPeerConnection | null,
    peerChannel: null as RTCDataChannel | null,
    localStream: null as MediaStream | null,
    peerStream: null as MediaStream | null,
    callTimer: null as ReturnType<typeof setInterval> | null,
    callStatsTimer: null as ReturnType<typeof setInterval> | null,
    userData: null as UserData | null,
    callOffer: null as RTCSessionDescriptionInit | null,
    pendingIceCandidates: [] as any[],
    listeners: new Set<(state: CallManagerState) => void>(),
    state: { ...initialState },
};

// ============================================================================
// Public API — Subscriptions & Getters
// ============================================================================

export function subscribe(listener: (state: CallManagerState) => void): () => void {
    internal.listeners.add(listener);
    return () => {
        internal.listeners.delete(listener);
    };
}

export function getState(): Readonly<CallManagerState> {
    return { ...internal.state };
}

export function getLocalStream(): MediaStream | null {
    return internal.localStream;
}

export function getPeerStream(): MediaStream | null {
    return internal.peerStream;
}

export function isActive(): boolean {
    return internal.state.phase !== CallPhase.IDLE;
}

export function hasStream(): boolean {
    return internal.localStream !== null;
}

// ============================================================================
// Public API — Call Lifecycle (start → connect → end)
// ============================================================================

export function startCall(params: {
    peerUser: UserData;
    videoEnabled: boolean;
    userData: UserData;
    turnCreds: TURNCredentials;
}) {
    if (isActive()) {
        logger.warn('[CallManager] startCall called while call is active');
        return;
    }
    setupStream(params);
}

export function answerCall(params: {
    peerUser: UserData;
    videoEnabled: boolean;
    userData: UserData;
    turnCreds: TURNCredentials;
    callOffer: RTCSessionDescriptionInit;
}) {
    if (isActive()) {
        logger.warn('[CallManager] answerCall called while call is active');
        return;
    }
    setupStream(params);
}

export function endCall(isRemoteHangup: boolean = false) {
    if (internal.state.phase === CallPhase.IDLE || internal.state.phase === CallPhase.ENDING) {
        return;
    }

    const prevPhase = internal.state.phase;
    internal.state.phase = CallPhase.ENDING;

    // Persist call record
    if (internal.state.peerUser && prevPhase !== CallPhase.STARTING) {
        try {
            dbSaveCallRecord({
                peer_phone: internal.state.peerUser.phone_no,
                peer_id: String(internal.state.peerUser.id),
                peer_pic: internal.state.peerUser.pic,
                direction: internal.callOffer ? 'incoming' : 'outgoing',
                call_type: internal.state.videoEnabled ? 'video' : 'audio',
                status: 'answered',
                duration: Math.floor(internal.state.callTime),
                started_at: new Date(internal.state.startTime).toISOString(),
            });
        } catch (err) {
            logger.error('Failed to save call record:', err);
        }
    }

    if (!isRemoteHangup) {
        // Notify peer we hung up
        try {
            const closeMsg: WebRTCMessage = { type: 'CLOSE' };
            internal.peerChannel?.send(JSON.stringify(closeMsg));
        } catch (err) {
            logger.warn('[WebRTC] Failed to send CLOSE to peer:', err);
        }
    } else {
        // Peer hung up, show toast
        const callTimeStr = formatCallTime(internal.state.callTime);
        Toast.show({
            type: 'info',
            text1: `${internal.state.peerUser?.phone_no || 'User'} hanged up the call`,
            text2: `Call lasted ${callTimeStr}`,
        });
    }

    // Stop InCallManager
    InCallManager.stop();

    // Stop timers
    stopTimers();

    // Release WebRTC resources
    internal.localStream?.release?.();
    internal.peerConnection?.close?.();
    internal.peerChannel?.close?.();

    // Reset all internal state
    internal.peerConnection = null;
    internal.peerChannel = null;
    internal.localStream = null;
    internal.peerStream = null;
    internal.userData = null;
    internal.callOffer = null;
    internal.pendingIceCandidates = [];
    internal.state = { ...initialState };

    // Reset Redux call offer so next Call screen mount doesn't see stale offer
    store.dispatch({ type: 'user/RECV_CALL_OFFER', payload: undefined });

    emitState();
}

// ============================================================================
// Public API — In-Call Controls
// ============================================================================

export function toggleVideo() {
    if (!internal.localStream) {
        return;
    }
    const newVideoEnabled = !internal.state.videoEnabled;
    const videoTrack = internal.localStream.getVideoTracks()[0];
    videoTrack.enabled = newVideoEnabled;
    setState({ videoEnabled: newVideoEnabled });
    try {
        const muteCamMsg: WebRTCMessage = { type: 'MUTE_CAM' };
        internal.peerChannel?.send(JSON.stringify(muteCamMsg));
    } catch (err) {
        logger.warn('[WebRTC] toggleVideo send failed:', err);
    }
}

export function toggleAudio() {
    if (!internal.localStream) {
        return;
    }
    const newVoiceEnabled = !internal.state.voiceEnabled;
    const audioTrack = internal.localStream.getAudioTracks()[0];
    audioTrack.enabled = newVoiceEnabled;
    InCallManager.setMicrophoneMute(newVoiceEnabled);
    setState({ voiceEnabled: newVoiceEnabled });
}

export function toggleCamera() {
    if (!internal.localStream) {
        return;
    }
    const newIsFrontCamera = !internal.state.isFrontCamera;
    const videoTrack = internal.localStream.getVideoTracks()[0];
    videoTrack.applyConstraints({ facingMode: newIsFrontCamera ? 'user' : 'environment' });
    setState({ isFrontCamera: newIsFrontCamera });
    try {
        const switchCamMsg: WebRTCMessage = { type: 'SWITCH_CAM' };
        internal.peerChannel?.send(JSON.stringify(switchCamMsg));
    } catch (err) {
        logger.warn('[WebRTC] toggleCamera send failed:', err);
    }
}

export function toggleSpeaker() {
    if (!internal.localStream) {
        return;
    }
    const newLoudSpeaker = !internal.state.loudSpeaker;
    InCallManager.setSpeakerphoneOn(newLoudSpeaker);
    setState({ loudSpeaker: newLoudSpeaker });
}

// ============================================================================
// Public API — WebSocket Signal Handlers
// (Called by websocket.ts when signaling messages arrive)
// ============================================================================

/** Called when peer answers our outgoing call */
export function onCallAnswer(answer: RTCSessionDescriptionInit) {
    if (!internal.peerConnection || !answer) {
        return;
    }
    const offerDescription = new RTCSessionDescription(answer);
    internal.peerConnection.setRemoteDescription(offerDescription).then(() => {
        // Flush any ICE candidates that arrived before remote description was set
        internal.pendingIceCandidates.forEach(candidate => {
            internal.peerConnection?.addIceCandidate(candidate);
        });
        internal.pendingIceCandidates = [];
    });
    setState({ phase: CallPhase.CONNECTING });
}

/** Called when we receive an ICE candidate from the peer */
export function onIceCandidate(candidate: any) {
    if (!candidate) {
        return;
    }
    if (!internal.peerConnection) {
        // Buffer until connection is ready
        internal.pendingIceCandidates.push(candidate);
        return;
    }
    internal.peerConnection.addIceCandidate(candidate);
}

// ============================================================================
// Internal — Stream Setup & WebRTC Connection
// ============================================================================

async function setupStream(params: {
    peerUser: UserData;
    videoEnabled: boolean;
    userData: UserData;
    turnCreds: TURNCredentials;
    callOffer?: RTCSessionDescriptionInit;
}) {
    const { peerUser, videoEnabled, userData, turnCreds, callOffer } = params;

    // Store references
    internal.userData = userData;
    internal.callOffer = callOffer || null;

    setState({
        phase: CallPhase.STARTING,
        peerUser,
        isOutgoing: !callOffer,
        videoEnabled,
        voiceEnabled: true,
        loudSpeaker: videoEnabled,
        isFrontCamera: true,
        mirrorPeerStream: true,
        showPeerStream: videoEnabled,
        callTime: 0,
        startTime: Date.now(),
        callDelay: 0,
        callStatus: '',
        connectionInfo: undefined,
    });

    try {
        logger.debug('startStream - Loading local MediaStreams');
        const newStream = await mediaDevices.getUserMedia({ video: true, audio: true });

        logger.debug('startStream - RTCPeerConnection Init');
        const alwaysRelay = (await readFromStorage(StorageKeys.ALWAYS_RELAY_CALLS)) === 'true';
        const newConnection = new RTCPeerConnection(getRTCConfiguration(turnCreds, alwaysRelay));

        // Event handlers
        newConnection.addEventListener('error', onWebrtcError);
        newConnection.addEventListener('icecandidateerror', onWebrtcError);
        newConnection.addEventListener('icecandidate', (event: any) => {
            if (!event.candidate) {
                logger.debug('[WebRTC] onIceCandidate finished');
            }
            const message: SocketData = {
                cmd: 'CALL_ICE_CANDIDATE',
                data: {
                    sender_id: userData.id,
                    sender: userData.phone_no,
                    reciever_id: peerUser.id,
                    reciever: peerUser.phone_no,
                    candidate: event.candidate?.toJSON() || event.candidate,
                },
            };
            wsSendMessage(message);
        });
        newConnection.addEventListener('connectionstatechange', _event => {
            logger.debug('[WebRTC] connection state change:', newConnection?.connectionState);
            setState({ callStatus: `${peerUser?.phone_no} : ${newConnection?.connectionState}` });
            if (newConnection?.connectionState === 'disconnected' || newConnection?.connectionState === 'failed') {
                endCall(true);
            }
            checkConnectionType();
        });
        newConnection.addEventListener('iceconnectionstatechange', _event => {
            logger.debug('[WebRTC] ICE connection state change:', newConnection?.iceConnectionState);
            checkConnectionType();
        });
        newConnection.addEventListener('track', event => {
            const newPeerStream = event.streams[0];
            newPeerStream.addTrack(event.track!);
            internal.peerStream = newPeerStream;
            setState({ phase: CallPhase.CONNECTED });
        });
        newConnection.addEventListener('datachannel', event => {
            internal.peerChannel = event.channel;
            event.channel.addEventListener('open', e => logger.info('[WebRTC] Channel opened:', e.channel.label));
            event.channel.addEventListener('error', onWebrtcError);
            event.channel.addEventListener('close', e => logger.info('[WebRTC] Channel closed:', e));
            event.channel.addEventListener('message', onChannelMessage);
            emitState();
        });

        InCallManager.start({ media: videoEnabled ? 'video' : 'audio', auto: true });

        logger.debug('startStream - Loading tracks');
        newStream.getTracks().forEach(track => newConnection.addTrack(track, newStream));
        newStream.getVideoTracks()[0].enabled = videoEnabled;

        internal.localStream = newStream;
        internal.peerConnection = newConnection;

        startTimers();

        if (!callOffer) {
            await initiateCall(peerUser, userData, videoEnabled);
        } else {
            await answerIncomingCall(callOffer, peerUser, userData);
        }
    } catch (err: any) {
        logger.error('startStream error:', err);
        endCall(false);
    }
}

async function initiateCall(peerUser: UserData, userData: UserData, videoEnabled: boolean) {
    if (!internal.peerConnection) {
        return logger.error('call: Unable to initiate call with null peerConnection');
    }
    // Create data channel
    const peerChannel = internal.peerConnection.createDataChannel(userData.phone_no);
    peerChannel.addEventListener('open', e => logger.info('[WebRTC] Channel opened:', e.channel.label));
    peerChannel.addEventListener('error', onWebrtcError);
    peerChannel.addEventListener('close', e => logger.info('[WebRTC] Channel closed:', e));
    peerChannel.addEventListener('message', onChannelMessage);
    internal.peerChannel = peerChannel;
    // Create offer
    let sessionConstraints: RTCOfferOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        voiceActivityDetection: true,
    };
    let offerDescription = (await internal.peerConnection.createOffer(sessionConstraints)) as RTCSessionDescriptionInit;
    await internal.peerConnection.setLocalDescription(offerDescription as RTCSessionDescription);
    // Send offer via WebSocket
    const message: SocketData = {
        cmd: 'CALL_OFFER',
        data: {
            sender_id: userData.id,
            sender: userData.phone_no,
            reciever_id: peerUser.id,
            reciever: peerUser.phone_no,
            offer: offerDescription,
            type: videoEnabled ? 'video' : 'audio',
        },
    };
    wsSendMessage(message);
    setState({ callStatus: `${peerUser?.phone_no} : Dialing`, phase: CallPhase.DIALING });
}

async function answerIncomingCall(callOffer: RTCSessionDescriptionInit, peerUser: UserData, userData: UserData) {
    if (!internal.peerConnection) {
        return logger.debug('answerCall: Unable to answer call with null peerConnection');
    }

    const offerDescription = new RTCSessionDescription(callOffer);
    await internal.peerConnection.setRemoteDescription(offerDescription);

    const answerDescription = await internal.peerConnection.createAnswer();
    await internal.peerConnection.setLocalDescription(answerDescription as RTCSessionDescription);

    InCallManager.stopRingtone();

    const message: SocketData = {
        cmd: 'CALL_ANSWER',
        data: {
            sender_id: userData.id,
            sender: userData.phone_no,
            reciever_id: peerUser.id,
            reciever: peerUser.phone_no,
            answer: answerDescription,
        },
    };
    wsSendMessage(message);

    // Flush any buffered ICE candidates
    internal.pendingIceCandidates.forEach(candidate => {
        internal.peerConnection?.addIceCandidate(candidate);
    });
    internal.pendingIceCandidates = [];

    setState({ phase: CallPhase.CONNECTING });
}

// ============================================================================
// Internal — Data Channel Message Handler
// ============================================================================

function onChannelMessage(event: MessageEvent<'message'>) {
    try {
        if (typeof event.data !== 'string') {
            return logger.warn('[WebRTC] Received a non string message in channel:', event.data);
        }
        if (!internal.peerChannel) {
            return logger.warn('[WebRTC] Received a message in channel but channel is undefined:');
        }

        const message: WebRTCMessage = JSON.parse(event.data || '{}');
        switch (message.type) {
            case 'PING':
                const pingReply: WebRTCMessage = { type: 'PING_REPLY', data: message.data };
                internal.peerChannel.send(JSON.stringify(pingReply));
                break;
            case 'PING_REPLY':
                const pingInMs = Date.now() - message.data;
                setState({ callDelay: pingInMs });
                break;
            case 'SWITCH_CAM':
                setState({ mirrorPeerStream: !internal.state.mirrorPeerStream });
                break;
            case 'MUTE_CAM':
                setState({ showPeerStream: !internal.state.showPeerStream });
                break;
            case 'CLOSE':
                endCall(true);
                break;
            default:
                logger.warn('[WebRTC] unhandled channel message of type:', message.type);
                break;
        }
    } catch (err) {
        logger.warn('[WebRTC] onChannelMessage failed:', err);
    }
}

// ============================================================================
// Internal — Connection Stats & Ping
// ============================================================================

function calculatePing() {
    try {
        if (!internal.peerChannel || internal.peerChannel.readyState !== 'open') {
            return;
        }
        const pingMsg: WebRTCMessage = { type: 'PING', data: Date.now() };
        internal.peerChannel.send(JSON.stringify(pingMsg));
        if (!internal.state.connectionInfo) {
            checkConnectionType();
        }
    } catch (err) {
        logger.warn('[WebRTC] calculatePing failed:', err);
    }
}

async function checkConnectionType() {
    if (!internal.peerConnection) {
        return;
    }
    const reports = await getConnStats(internal.peerConnection);
    const candidatePair = reports.find(rp => rp.type === 'candidate-pair' && rp.state === 'succeeded') as
        | CandidatePair
        | undefined;
    const localCandidate = reports.find(rp => rp.type === 'local-candidate' && rp.id === candidatePair?.localCandidateId) as
        | LocalCandidate
        | undefined;
    const remoteCandidate = reports.find(
        rp => rp.type === 'remote-candidate' && rp.id === candidatePair?.remoteCandidateId,
    ) as LocalCandidate | undefined;

    if (!candidatePair || !localCandidate) {
        return;
    }
    const isRelayed = localCandidate.candidateType === 'relay' || remoteCandidate?.candidateType === 'relay';
    setState({ connectionInfo: { localCandidate, candidatePair, isRelayed } });
}

// ============================================================================
// Internal — Timers & State Helpers
// ============================================================================

function startTimers() {
    stopTimers();
    internal.callTimer = setInterval(() => {
        internal.state.callTime = (Date.now() - internal.state.startTime) / 1000;
        emitState();
    }, 1000);
    internal.callStatsTimer = setInterval(calculatePing, 2500);
}

function stopTimers() {
    if (internal.callTimer) {
        clearInterval(internal.callTimer);
        internal.callTimer = null;
    }
    if (internal.callStatsTimer) {
        clearInterval(internal.callStatsTimer);
        internal.callStatsTimer = null;
    }
}

function emitState() {
    const snapshot = { ...internal.state };
    internal.listeners.forEach(fn => {
        try {
            fn(snapshot);
        } catch (err) {
            logger.error('[CallManager] listener error:', err);
        }
    });
}

function setState(partial: Partial<CallManagerState>) {
    Object.assign(internal.state, partial);
    emitState();
}

function onWebrtcError(e: any) {
    logger.error('[WebRTC] error:', e);
    Toast.show({
        type: 'error',
        text1: 'Error occoured during call',
        text2: e.toString(),
    });
}

export function formatCallTime(callTime: number): string {
    const hours = ~~(callTime / (60 * 60));
    const minutes = ~~(callTime / 60);
    const seconds = ~~(callTime - minutes * 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
