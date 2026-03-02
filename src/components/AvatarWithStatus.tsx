import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Avatar, Badge } from 'react-native-paper';

import { onlineStatus } from '~/global/helper';
import { DARKHEADER } from '~/global/variables';
import { UserData } from '~/store/reducers/user';

interface Props {
    user: Partial<UserData>;
    size: number;
    borderColor: string;
}

export default function AvatarWithStatus({ user, size, borderColor }: Props) {
    return (
        <View>
            <Avatar.Image size={size} source={{ uri: user.pic }} style={styles.pic} />
            <Badge size={12} style={[styles.dot, { backgroundColor: onlineStatus(user).color, borderColor }]} />
        </View>
    );
}

const styles = StyleSheet.create({
    pic: {
        backgroundColor: DARKHEADER,
    },
    dot: {
        position: 'absolute',
        bottom: 2,
        right: 2,
        borderWidth: 2,
    },
});
