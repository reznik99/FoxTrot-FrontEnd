import React, { useState, useCallback } from 'react';
import { View, ScrollView, Text, Alert } from 'react-native';
import { Divider, Button, Icon } from 'react-native-paper';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import CallHistoryItem from '~/components/CallHistoryItem';
import { dbGetCallHistory, dbClearCallHistory, dbMarkAllCallsSeen } from '~/global/database';
import { CallRecord } from '~/store/reducers/user';
import { SECONDARY_LITE } from '~/global/variables';
import globalStyle from '~/global/style';

export default function CallHistory() {
    const navigation = useNavigation<any>();
    const [records, setRecords] = useState<CallRecord[]>([]);
    const loadHistory = useCallback(() => {
        try {
            const history = dbGetCallHistory();
            setRecords(history);
        } catch (err) {
            console.error('Failed to load call history:', err);
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            loadHistory();
            dbMarkAllCallsSeen();
        }, [loadHistory]),
    );

    const onClearHistory = useCallback(() => {
        Alert.alert('Clear Call History', 'Are you sure you want to delete all call records?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Clear',
                style: 'destructive',
                onPress: () => {
                    try {
                        dbClearCallHistory();
                        setRecords([]);
                    } catch (err) {
                        console.error('Failed to clear call history:', err);
                    }
                },
            },
        ]);
    }, []);

    return (
        <View style={globalStyle.wrapper}>
            <ScrollView>
                {records.length > 0 ? (
                    <>
                        {records.map((record, index) => (
                            <View key={record.id ?? index}>
                                <CallHistoryItem record={record} navigation={navigation} />
                                <Divider />
                            </View>
                        ))}
                        <Button mode="text" textColor="#e53935" onPress={onClearHistory} style={{ marginVertical: 20 }}>
                            Clear Call History
                        </Button>
                    </>
                ) : (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 }}>
                        <Icon source="phone-off" size={48} color={SECONDARY_LITE} />
                        <Text style={[globalStyle.errorMsg, { color: '#fff' }]}>No calls yet.</Text>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}
