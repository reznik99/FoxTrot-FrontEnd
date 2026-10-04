import { Icon } from 'react-native-paper';
import type { RTCIceCandidate, RTCPeerConnection } from 'react-native-webrtc';

import { TURNCredentials } from '~/store/reducers/user';

/**
 * One entry of the W3C webrtc-stats report (https://www.w3.org/TR/webrtc-stats/). react-native-webrtc has no
 * types for this: getStats() resolves to `any`, built from libwebrtc's stats members passed through verbatim,
 * with only `timestamp` converted from microseconds to milliseconds. Units are the spec's.
 */
export interface NativeStatsReport {
    id: string;
    type: string;
    timestamp: number; // ms
    selectedCandidatePairId?: string;
    bytesSent?: number; // bytes
    bytesReceived?: number; // bytes
    localCandidateId?: string;
    remoteCandidateId?: string;
    currentRoundTripTime?: number; // seconds
    availableOutgoingBitrate?: number; // bits per second
    candidateType?: 'host' | 'srflx' | 'prflx' | 'relay';
    protocol?: string;
    relayProtocol?: string;
    address?: string;
    port?: number;
}

export type NativeStatsReportMap = Map<string, NativeStatsReport>;

export interface CallPath {
    transport: NativeStatsReport;
    pair?: NativeStatsReport;
    local?: NativeStatsReport;
    remote?: NativeStatsReport;
    connType?: NativeStatsReport['candidateType'];
    rttMs?: number; // ICE round-trip time, ms
    sendRate?: number; // bytes per second, between the last two polls
    receiveRate?: number; // bytes per second, between the last two polls
    availableOutgoingBandwidth?: number; // estimated, bytes per second
}

export interface CallDiagnostics {
    paths: CallPath[];
    raw: string; // the entire native stats report, pretty-printed JSON
}

export function calculateCallDiagnostics(reports: NativeStatsReportMap, previous?: NativeStatsReportMap): CallDiagnostics {
    const all = Array.from(reports.values());
    const paths = all
        .filter(report => report.type === 'transport')
        .map((transport): CallPath => {
            const pair = reports.get(transport.selectedCandidatePairId ?? '');
            const local = reports.get(pair?.localCandidateId ?? '');
            const remote = reports.get(pair?.remoteCandidateId ?? '');
            const old = previous?.get(transport.id);
            const elapsed = transport.timestamp - (old?.timestamp ?? NaN);
            const rates = (['bytesSent', 'bytesReceived'] as const).map(field => {
                const delta = (transport[field] ?? NaN) - (old?.[field] ?? NaN);
                // Native timestamps are milliseconds; convert byte deltas to bytes per second.
                return elapsed > 0 && delta >= 0 ? (delta * 1000) / elapsed : undefined;
            });
            return {
                transport,
                pair,
                local,
                remote,
                connType:
                    local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : local?.candidateType,
                // seconds -> ms
                rttMs: pair?.currentRoundTripTime !== undefined ? pair.currentRoundTripTime * 1000 : undefined,
                sendRate: rates[0],
                receiveRate: rates[1],
                // bits -> bytes
                availableOutgoingBandwidth:
                    pair?.availableOutgoingBitrate !== undefined ? pair.availableOutgoingBitrate / 8 : undefined,
            };
        });
    return { paths, raw: JSON.stringify(all, null, 2) };
}

/** Summary lines for one transport path; used for both the diagnostics dialog and clipboard export. */
export function formatCallPath(path: CallPath, dataChannelRttMs?: number): string[] {
    return [
        `Transport: ${path.transport.id}`,
        `Selected pair: ${path.pair?.id ?? 'n/a'}`,
        `ICE RTT: ${formatMs(path.rttMs)} · Data-channel RTT: ${formatMs(dataChannelRttMs)}`,
        `Sent: ${formatBytes(path.transport.bytesSent)}`,
        `Received: ${formatBytes(path.transport.bytesReceived)}`,
        `Send rate: ${formatBytesPerSecond(path.sendRate)}`,
        `Receive rate: ${formatBytesPerSecond(path.receiveRate)}`,
        `Available outgoing bandwidth: ${formatBytesPerSecond(path.availableOutgoingBandwidth)}`,
        `Local candidate: ${JSON.stringify(path.local, null, 2) ?? 'n/a'}`,
        `Remote candidate: ${JSON.stringify(path.remote, null, 2) ?? 'n/a'}`,
    ];
}

const isFiniteNumber = (value?: number): value is number => Number.isFinite(value);
const formatNumber = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });

export const formatMs = (ms?: number) => (isFiniteNumber(ms) ? `${formatNumber(ms)} ms` : 'n/a');

/** 1000-based KB/MB, like Android's own file sizes. */
export const formatBytes = (bytes?: number) => {
    if (!isFiniteNumber(bytes)) return 'n/a';
    return bytes >= 1e6 ? `${formatNumber(bytes / 1e6)} MB` : `${formatNumber(bytes / 1e3)} KB`;
};

export const formatBytesPerSecond = (bytes?: number) => (isFiniteNumber(bytes) ? `${formatBytes(bytes)}/s` : 'n/a');

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

// react-native-webrtc does not export its RTCConfiguration type, and the DOM global of the same name
// (from tsconfig lib "dom") is not assignable to it, so derive it from the constructor instead.
export type RNRTCConfiguration = NonNullable<ConstructorParameters<typeof RTCPeerConnection>[0]>;
export type RNRTCIceCandidateInit = ConstructorParameters<typeof RTCIceCandidate>[0];

export const getRTCConfiguration = (turnCredentials: TURNCredentials, relayOnly = false): RNRTCConfiguration => {
    const iceServers: RNRTCConfiguration['iceServers'] = [
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
