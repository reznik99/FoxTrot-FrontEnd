import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as callManager from '~/global/callManager';
import { CallManagerState, CallPhase, formatCallTime } from '~/global/callManager';
import { navigationRef } from '~/global/navigation';

function getCurrentRouteName(): string | undefined {
    if (!navigationRef.isReady()) {
        return undefined;
    }
    let state = navigationRef.getState();
    if (!state) {
        return undefined;
    }
    // Walk nested navigators to find the deepest route
    let route = state.routes[state.index];
    while (route.state) {
        const nestedState = route.state as any;
        route = nestedState.routes[nestedState.index];
    }
    return route.name;
}

export default function ActiveCallBanner() {
    const [cm, setCm] = useState<CallManagerState>(callManager.getState);
    const insets = useSafeAreaInsets();

    useEffect(() => {
        return callManager.subscribe(setCm);
    }, []);

    if (cm.phase === CallPhase.IDLE || getCurrentRouteName() === 'Call') {
        return null;
    }

    const handlePress = () => {
        if (navigationRef.isReady() && cm.peerUser) {
            navigationRef.navigate('App', {
                screen: 'Call',
                params: { data: { peer_user: cm.peerUser, video_enabled: cm.videoEnabled } },
            } as any);
        }
    };

    return (
        <TouchableOpacity style={[styles.banner, { top: insets.top }]} onPress={handlePress} activeOpacity={0.8}>
            <View style={styles.content}>
                <Icon source="phone" size={16} color="#fff" />
                <Text style={styles.text} numberOfLines={1}>
                    {cm.peerUser?.phone_no || 'Active call'}
                </Text>
                <Text style={styles.timer}>{formatCallTime(cm.callTime)}</Text>
                <Text style={styles.tapHint}>Tap to return</Text>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    banner: {
        position: 'absolute',
        left: 0,
        right: 0,
        zIndex: 999,
        backgroundColor: '#4caf50',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 8,
    },
    text: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
        flex: 1,
    },
    timer: {
        color: '#ffffffcc',
        fontSize: 13,
        fontFamily: 'monospace',
    },
    tapHint: {
        color: '#ffffffaa',
        fontSize: 12,
    },
});
