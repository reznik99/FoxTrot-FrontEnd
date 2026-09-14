import { Icon } from 'react-native-paper';

import { TURNCredentials } from '~/store/reducers/user';

interface NativeStatsReport {
    id: string;
    type: string;
    timestamp: number;
    selectedCandidatePairId?: string;
    bytesSent?: number;
    bytesReceived?: number;
    localCandidateId?: string;
    remoteCandidateId?: string;
    currentRoundTripTime?: number;
    availableOutgoingBitrate?: number;
    candidateType?: 'host' | 'srflx' | 'prflx' | 'relay';
    protocol?: string;
    relayProtocol?: string;
    address?: string;
    port?: number;
}

export type NativeStatsReportMap = Map<string, NativeStatsReport>;
export type CallDiagnostics = ReturnType<typeof calculateCallDiagnostics>;

export function calculateCallDiagnostics(reports: NativeStatsReportMap, previous?: NativeStatsReportMap) {
    const all = Array.from(reports.values());
    const paths = all
        .filter(report => report.type === 'transport')
        .map(transport => {
            const pair = reports.get(transport.selectedCandidatePairId ?? '');
            const local = reports.get(pair?.localCandidateId ?? '');
            const remote = reports.get(pair?.remoteCandidateId ?? '');
            const old = previous?.get(transport.id);
            const elapsed = transport.timestamp - (old?.timestamp ?? NaN);
            const rates = (['bytesSent', 'bytesReceived'] as const).map(field => {
                const delta = (transport[field] ?? NaN) - (old?.[field] ?? NaN);
                // Native timestamps are milliseconds; convert byte deltas to bits per second.
                return elapsed > 0 && delta >= 0 ? (delta * 8000) / elapsed : undefined;
            });
            return {
                transport,
                pair,
                local,
                remote,
                connType:
                    local?.candidateType === 'relay' || remote?.candidateType === 'relay'
                        ? ('relay' as const)
                        : local?.candidateType,
                rttMs: pair?.currentRoundTripTime !== undefined ? pair.currentRoundTripTime * 1000 : undefined,
                sendBitrate: rates[0],
                receiveBitrate: rates[1],
            };
        });
    return { paths, raw: JSON.stringify(all, null, 2) };
}

export function formatDiagnostic(value: number | undefined, unit: string): string {
    return value === undefined || !Number.isFinite(value)
        ? 'n/a'
        : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

export interface WebRTCMessage {
    type: 'PING' | 'PING_REPLY' | 'SWITCH_CAM' | 'MUTE_CAM' | 'CLOSE';
    data?: any;
}

export const getIconForConnType = (connType: 'host' | 'srflx' | 'prflx' | 'relay' | '') => {
    switch (connType) {
        case '':
            return <Icon source="connection" color="#6f6f6fff" size={20} />;
        // "host" The candidate is a host candidate, whose IP address as specified in the RTCIceCandidate.address property is in fact the true address of the remote peer.
        case 'host':
            return <Icon source="lan" color="#02cb09ff" size={20} />;
        // "srflx" The candidate is a server reflexive candidate; the ip and port are a binding allocated by a NAT for an agent when it sent a packet through the NAT to a server. They can be learned by the STUN server and TURN server to represent the candidate's peer anonymously.
        case 'srflx':
            return <Icon source="wan" color="#03b272ff" size={20} />;
        // "prflx" The candidate is a peer reflexive candidate; the ip and port are a binding allocated by a NAT when it sent a STUN request to represent the candidate's peer anonymously.
        case 'prflx':
            return <Icon source="web" color="#04b5c8ff" size={20} />;
        // "relay" The candidate is a relay candidate, obtained from a TURN server. The relay candidate's IP address is an address the TURN server uses to forward the media between the two peers.
        case 'relay':
            return <Icon source="server" color="#380793" size={20} />;
    }
};

export const getRTCConfiguration = (turnCredentials: TURNCredentials, relayOnly = false): RTCConfiguration => {
    const iceServers: RTCConfiguration['iceServers'] = [
        // STUN peer-to-peer
        { urls: 'stun:turn.francescogorini.com:3478' },
        { urls: 'stun:stun.l.google.com:19302' },
    ];
    if (turnCredentials.credential) {
        const { username, credential } = turnCredentials;
        iceServers.push(
            // TURN over UDP (fastest)
            { urls: ['turn:turn.francescogorini.com:3478?transport=udp'], username, credential },
            // TURN over TCP (fallback for UDP-restricted networks)
            { urls: ['turn:turn.francescogorini.com:3478?transport=tcp'], username, credential },
            // TURN over TLS (best for strict firewalls/proxies)
            { urls: ['turns:turn.francescogorini.com:5349?transport=tcp'], username, credential },
        );
    }
    return {
        iceTransportPolicy: relayOnly && turnCredentials.credential ? 'relay' : 'all',
        iceCandidatePoolSize: 0,
        iceServers,
    };
};
