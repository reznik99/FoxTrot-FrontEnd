/**
 * WebSocket and push wire contract. Kept byte-identical in Foxtrot-Backend/src/protocol.ts and Foxtrot-Frontend/src/global/protocol.ts.
 * Every websocket frame is `{ cmd, data }`; `cmd` selects the shape of `data`.
 */

/** Fields every peer-to-peer frame carries. The server stamps sender and sender_id from the JWT. */
interface Routed {
    sender: string;
    sender_id: number;
    reciever: string;
    reciever_id: number;
}

/** Shape of react-native-webrtc's RTCSessionDescriptionInit */
export interface SessionDescription {
    sdp: string;
    type: string | null;
}
/** Shape of react-native-webrtc's RTCIceCandidate.toJSON() */
export interface IceCandidate {
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
}

export interface ChatMessage extends Routed {
    id: number;
    message: string;
    sent_at: string;
    seen: boolean;
}
export interface CallOffer extends Routed {
    offer: SessionDescription;
    type: 'video' | 'audio';
    /** False when the server replays a cached offer to a client that just connected */
    ring?: boolean;
}
export interface CallAnswer extends Routed {
    answer: SessionDescription;
}
export interface CallIceCandidate extends Routed {
    candidate: IceCandidate;
}
export interface ContactStatus {
    user_id: number;
    phone_no: string;
    online: boolean;
    last_seen: string;
}
export interface KeyRotation {
    user_id: number;
    phone_no: string;
    public_key: string;
}

export interface MsgFrame {
    cmd: 'MSG';
    data: ChatMessage;
}
export interface CallOfferFrame {
    cmd: 'CALL_OFFER';
    data: CallOffer;
}
export interface CallAnswerFrame {
    cmd: 'CALL_ANSWER';
    data: CallAnswer;
}
export interface CallIceCandidateFrame {
    cmd: 'CALL_ICE_CANDIDATE';
    data: CallIceCandidate;
}
export interface ContactStatusFrame {
    cmd: 'CONTACT_STATUS';
    data: ContactStatus;
}
export interface KeyRotatedFrame {
    cmd: 'KEY_ROTATED';
    data: KeyRotation;
}

/** Frames a client may send. The server proxies these between peers. */
export type CallSignalFrame = CallOfferFrame | CallAnswerFrame | CallIceCandidateFrame;
/** Every frame the server sends. */
export type SocketFrame = MsgFrame | ContactStatusFrame | KeyRotatedFrame | CallSignalFrame;

/** `data` field of the FCM call push, and of the incoming-call notification payload built from it */
export interface CallPushData {
    type: CallOffer['type'];
}
