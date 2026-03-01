import React from 'react';
import { View } from 'react-native';
import { ActivityIndicator, Icon } from 'react-native-paper';
import { useSelector } from 'react-redux';
import { RootState } from '~/store/store';

const STATUS_COLORS: Record<string, string> = {
    connected: '#4caf50',
    connecting: '#ff9800',
    reconnecting: '#ff9800',
    disconnected: '#f44336',
};

const ConnectionIndicator = () => {
    const socketStatus = useSelector((state: RootState) => state.userReducer.socketStatus);
    const isReconnecting = socketStatus === 'reconnecting' || socketStatus === 'connecting';
    const color = STATUS_COLORS[socketStatus] || STATUS_COLORS.disconnected;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16, gap: 4 }}>
            {isReconnecting && <ActivityIndicator size={12} color={color} />}
            <Icon source="server-network" size={14} color={color} />
            <View
                style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: color,
                }}
            />
        </View>
    );
};

export default ConnectionIndicator;
