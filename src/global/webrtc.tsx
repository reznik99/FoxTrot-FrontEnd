import { Icon } from 'react-native-paper';
import { RTCPeerConnection } from 'react-native-webrtc';
import { TURNCredentials } from '~/store/reducers/user';

export interface WebRTCMessage {
    type: 'PING' | 'PING_REPLY' | 'SWITCH_CAM' | 'MUTE_CAM' | 'CLOSE';
    data?: any;
}
export interface LocalCandidate {
    timestamp: number;
    type: 'local-candidate';
    id: string;
    transportId: string;

    isRemote: boolean;
    networkType: 'bluetooth' | 'cellular' | 'ethernet' | 'wifi' | 'wimax' | 'vpn' | 'unknown';

    ip: string;
    address: string;
    port: number;

    protocol: 'udp' | 'tcp';
    relayProtocol: 'udp' | 'tcp';
    candidateType: 'host' | 'srflx' | 'prflx' | 'relay';
    priority: number;
    foundation: string;

    relatedAddress?: string;
    relatedPort?: number;

    usernameFragment: string;

    vpn: boolean;
    networkAdapterType: string;
}

export interface CandidatePair {
    timestamp: number;
    type: 'candidate-pair';
    id: string;
    transportId: string;

    localCandidateId: string;
    remoteCandidateId: string;

    state: 'succeeded' | 'waiting';
    priority: number;
    nominated: boolean;
    writable: boolean;

    packetsSent: number;
    packetsReceived: number;
    bytesSent: number;
    bytesReceived: number;

    totalRoundTripTime: number;
    currentRoundTripTime: number;
    availableOutgoingBitrate: number;

    requestsReceived: number;
    requestsSent: number;
    responsesReceived: number;
    responsesSent: number;
    consentRequestsSent: number;

    packetsDiscardedOnSend: number;
    bytesDiscardedOnSend: number;

    lastPacketReceivedTimestamp: number;
    lastPacketSentTimestamp: number;
}

export const getConnStats = async (peerConnection: RTCPeerConnection) => {
    const stats = (await peerConnection.getStats()) as RTCStatsReport;
    const reports: Array<CandidatePair | LocalCandidate> = [];
    stats.forEach(report => {
        reports.push(report);
    });
    return reports;
};

export const getIconForConnType = (connType: 'host' | 'srflx' | 'prflx' | 'relay' | '') => {
    switch (connType) {
        case '':
            return <Icon source="connection" color="#6f6f6fff" size={20} />;
        case 'host':
            return <Icon source="lan" color="#02cb09ff" size={20} />;
        // "host" The candidate is a host candidate, whose IP address as specified in the RTCIceCandidate.address property is in fact the true address of the remote peer.
        case 'srflx':
            return <Icon source="wan" color="#03b272ff" size={20} />;
        // "srflx" The candidate is a server reflexive candidate; the ip and port are a binding allocated by a NAT for an agent when it sent a packet through the NAT to a server. They can be learned by the STUN server and TURN server to represent the candidate's peer anonymously.
        case 'prflx':
            return <Icon source="web" color="#04b5c8ff" size={20} />;
        // "prflx" The candidate is a peer reflexive candidate; the ip and port are a binding allocated by a NAT when it sent a STUN request to represent the candidate's peer anonymously.
        case 'relay':
            return <Icon source="server" color="#380793" size={20} />;
        // "relay" The candidate is a relay candidate, obtained from a TURN server. The relay candidate's IP address is an address the TURN server uses to forward the media between the two peers.
    }
};

export const getRTCConfiguration = (turnCredentials: TURNCredentials): RTCConfiguration => {
    if (!turnCredentials.credential) {
        return {
            iceTransportPolicy: 'all',
            iceCandidatePoolSize: 0,
            iceServers: [
                // STUN peer-to-peer
                { urls: 'stun:turn.francescogorini.com:3478' },
                { urls: 'stun:stun.l.google.com:19302' },
            ],
        };
    }
    const username = turnCredentials.username;
    const credential = turnCredentials.credential;
    return {
        iceTransportPolicy: 'all',
        iceCandidatePoolSize: 0,
        iceServers: [
            // STUN peer-to-peer
            { urls: 'stun:turn.francescogorini.com:3478' },
            { urls: 'stun:stun.l.google.com:19302' },
            // TURN over UDP (fastest)
            { urls: ['turn:turn.francescogorini.com:3478?transport=udp'], username, credential },
            // TURN over TCP (fallback for UDP-restricted networks)
            { urls: ['turn:turn.francescogorini.com:3478?transport=tcp'], username, credential },
            // TURN over TLS (best for strict firewalls/proxies)
            { urls: ['turn:turn.francescogorini.com:5349?transport=tcp'], username, credential },
        ],
    };
};
