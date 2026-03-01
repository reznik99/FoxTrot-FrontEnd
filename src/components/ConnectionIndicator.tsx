import React from 'react';
import { View } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
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
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16 }}>
            {isReconnecting && <ActivityIndicator size={12} color={STATUS_COLORS.reconnecting} style={{ marginRight: 6 }} />}
            <View
                style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: STATUS_COLORS[socketStatus] || STATUS_COLORS.disconnected,
                }}
            />
        </View>
    );
};

export default ConnectionIndicator;
