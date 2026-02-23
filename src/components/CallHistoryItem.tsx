import React from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Avatar, Icon } from 'react-native-paper';

import { humanTime } from '~/global/helper';
import globalStyle from '~/global/style';
import { DARKHEADER, SECONDARY_LITE } from '~/global/variables';
import { CallRecord } from '~/store/reducers/user';
import { RootNavigation } from '~/store/actions/auth';

function getDirectionIcon(record: CallRecord): { icon: string; color: string } {
    if (record.status === 'missed') {
        return { icon: 'phone-missed', color: '#e53935' };
    }
    if (record.direction === 'incoming') {
        return { icon: 'phone-incoming', color: '#43a047' };
    }
    return { icon: 'phone-outgoing', color: '#1e88e5' };
}

function formatDuration(seconds: number): string {
    if (seconds <= 0) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface IProps {
    record: CallRecord;
    navigation: RootNavigation;
}

export default function CallHistoryItem({ record, navigation }: IProps) {
    const { icon, color } = getDirectionIcon(record);
    const duration = formatDuration(record.duration);

    const onPress = () => {
        navigation.navigate('Conversation', {
            data: {
                peer_user: {
                    id: record.peer_id,
                    phone_no: record.peer_phone,
                    pic: record.peer_pic,
                    last_seen: new Date(record.started_at).getTime(),
                    online: false,
                },
            },
        });
    };

    return (
        <TouchableOpacity style={styles.container} onPress={onPress}>
            <Avatar.Image size={45} source={{ uri: record.peer_pic }} style={styles.avatar} />
            <View style={styles.info}>
                <Text style={[globalStyle.textInfo, record.status === 'missed' && styles.missedText]}>
                    {record.peer_phone}
                </Text>
                <View style={styles.detailRow}>
                    <Icon source={icon} size={14} color={color} />
                    <Text style={styles.detailText}>
                        {record.call_type === 'video' ? 'Video' : 'Audio'}
                        {duration ? ` - ${duration}` : ''}
                    </Text>
                </View>
            </View>
            <Text style={styles.timestamp}>{humanTime(record.started_at)}</Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
    },
    avatar: {
        marginRight: 10,
        backgroundColor: DARKHEADER,
    },
    info: {
        flex: 1,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 2,
    },
    detailText: {
        color: SECONDARY_LITE,
        fontSize: 13,
    },
    missedText: {
        color: '#e53935',
    },
    timestamp: {
        color: SECONDARY_LITE,
        fontSize: 12,
        marginHorizontal: 5,
    },
});
