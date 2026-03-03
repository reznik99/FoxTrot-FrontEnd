import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, MD2Colors as Colors, IconButton, useTheme } from 'react-native-paper';

import AvatarWithStatus from '~/components/AvatarWithStatus';
import globalStyle from '~/global/style';
import { SECONDARY } from '~/global/variables';
import { UserData } from '~/store/reducers/user';

interface IProps {
    data: UserData;
    loading?: boolean;
    isContact?: boolean;
    onSelect: () => void;
}

export default function ContactPeek({ data, onSelect, loading, isContact }: IProps) {
    const { colors } = useTheme();

    return (
        <TouchableOpacity style={styles.profilePeek} onPress={onSelect}>
            <View style={{ marginRight: 20 }}>
                <AvatarWithStatus user={data} size={55} borderColor={SECONDARY} />
            </View>

            <View style={{ flex: 1 }}>
                <Text style={globalStyle.textInfo}>{data.phone_no}</Text>
            </View>
            {loading && <ActivityIndicator />}
            {isContact ? (
                <IconButton size={25} icon="account" iconColor={colors.primary} />
            ) : (
                <IconButton size={25} icon="account-plus" iconColor={Colors.lightGreen300} />
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    profilePeek: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 10,
    },
});
