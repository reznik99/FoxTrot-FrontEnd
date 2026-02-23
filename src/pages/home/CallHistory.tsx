import React, { useState, useCallback } from 'react';
import { View, ScrollView } from 'react-native';
import { Divider, Button, Dialog, Icon, Portal, Text } from 'react-native-paper';
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

    const [showClearDialog, setShowClearDialog] = useState(false);

    const onConfirmClear = useCallback(() => {
        setShowClearDialog(false);
        try {
            dbClearCallHistory();
            setRecords([]);
        } catch (err) {
            console.error('Failed to clear call history:', err);
        }
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
                        <Button
                            mode="text"
                            textColor="#e53935"
                            onPress={() => setShowClearDialog(true)}
                            style={{ marginVertical: 20 }}
                        >
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
            <Portal>
                <Dialog visible={showClearDialog} onDismiss={() => setShowClearDialog(false)}>
                    <Dialog.Icon icon="delete-alert" />
                    <Dialog.Title style={{ textAlign: 'center' }}>Clear Call History</Dialog.Title>
                    <Dialog.Content>
                        <Text style={{ textAlign: 'center' }}>Are you sure you want to delete all call records?</Text>
                    </Dialog.Content>
                    <Dialog.Actions style={{ justifyContent: 'space-evenly' }}>
                        <Button
                            mode="contained-tonal"
                            onPress={() => setShowClearDialog(false)}
                            style={{ paddingHorizontal: 15 }}
                        >
                            Cancel
                        </Button>
                        <Button
                            mode="contained"
                            buttonColor="#e53935"
                            onPress={onConfirmClear}
                            style={{ paddingHorizontal: 15 }}
                        >
                            Clear
                        </Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
        </View>
    );
}
