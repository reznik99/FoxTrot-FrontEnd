import React, { useState, useCallback, useMemo } from 'react';
import { View, SectionList, BackHandler, StyleSheet } from 'react-native';
import { Divider, Button, Dialog, FAB, Icon, Portal, Text } from 'react-native-paper';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import CallHistoryItem from '~/components/CallHistoryItem';
import { dbGetCallHistory, dbClearCallHistory, dbDeleteCalls, dbMarkAllCallsSeen } from '~/global/database';
import { CallRecord } from '~/store/reducers/user';
import { DARKHEADER, SECONDARY_LITE } from '~/global/variables';
import { milliseconds } from '~/global/helper';
import { logger } from '~/global/logger';
import globalStyle from '~/global/style';

function groupByDay(records: CallRecord[]): { title: string; data: CallRecord[] }[] {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - milliseconds.day;

    const groups: Map<string, CallRecord[]> = new Map();

    for (const record of records) {
        const ts = new Date(record.started_at).getTime();
        let label: string;
        if (ts >= todayStart) {
            label = 'Today';
        } else if (ts >= yesterdayStart) {
            label = 'Yesterday';
        } else {
            label = 'Older';
        }
        const group = groups.get(label);
        if (group) {
            group.push(record);
        } else {
            groups.set(label, [record]);
        }
    }

    // Map preserves insertion order; records are already sorted DESC so order is Today → Yesterday → Older
    return Array.from(groups, ([title, data]) => ({ title, data }));
}

export default function CallHistory() {
    const navigation = useNavigation<any>();
    const insets = useSafeAreaInsets();
    const [records, setRecords] = useState<CallRecord[]>([]);
    const [showDialog, setShowDialog] = useState(false);
    const [dialogMode, setDialogMode] = useState<'clear' | 'selected'>('clear');
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    const selectionMode = selectedIds.size > 0;
    const dialogTitle =
        dialogMode === 'selected'
            ? `Delete ${selectedIds.size} Call${selectedIds.size > 1 ? 's' : ''}`
            : 'Clear Call History';
    const dialogBody =
        dialogMode === 'selected'
            ? `Are you sure you want to delete ${selectedIds.size} selected call${selectedIds.size > 1 ? 's' : ''}?`
            : 'Are you sure you want to delete all call records?';

    const loadHistory = useCallback(() => {
        try {
            const history = dbGetCallHistory();
            setRecords(history);
        } catch (err) {
            logger.error('Failed to load call history:', err);
        }
    }, []);

    const sections = useMemo(() => groupByDay(records), [records]);

    useFocusEffect(
        useCallback(() => {
            requestAnimationFrame(() => {
                loadHistory();
                dbMarkAllCallsSeen();
            });
        }, [loadHistory]),
    );

    // Back button exits selection mode instead of navigating away
    useFocusEffect(
        useCallback(() => {
            const onBackPress = () => {
                if (selectedIds.size > 0) {
                    setSelectedIds(new Set());
                    return true;
                }
                return false;
            };
            const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
            return () => sub.remove();
        }, [selectedIds.size]),
    );

    const onLongPress = useCallback((id: number) => {
        setSelectedIds(prev => new Set(prev).add(id));
    }, []);

    const onToggleSelect = useCallback((id: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const onFabPress = useCallback(() => {
        if (selectionMode) {
            setDialogMode('selected');
        } else {
            setDialogMode('clear');
        }
        setShowDialog(true);
    }, [selectionMode]);

    const onConfirmDelete = useCallback(() => {
        setShowDialog(false);
        try {
            if (dialogMode === 'selected') {
                dbDeleteCalls([...selectedIds]);
                setRecords(prev => prev.filter(r => !selectedIds.has(r.id)));
                setSelectedIds(new Set());
            } else {
                dbClearCallHistory();
                setRecords([]);
                setSelectedIds(new Set());
            }
        } catch (err) {
            logger.error('Failed to delete calls:', err);
        }
    }, [dialogMode, selectedIds]);

    return (
        <View style={globalStyle.wrapper}>
            <SectionList
                sections={sections}
                keyExtractor={(item, index) => String(item.id ?? index)}
                renderItem={({ item }) => (
                    <CallHistoryItem
                        record={item}
                        navigation={navigation}
                        selectionMode={selectionMode}
                        selected={selectedIds.has(item.id)}
                        onToggleSelect={onToggleSelect}
                        onLongPress={onLongPress}
                    />
                )}
                renderSectionHeader={({ section: { title } }) => <Text style={localStyles.sectionHeader}>{title}</Text>}
                ItemSeparatorComponent={Divider}
                ListEmptyComponent={
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 }}>
                        <Icon source="phone-off" size={48} color={SECONDARY_LITE} />
                        <Text style={[globalStyle.errorMsg, { color: '#fff' }]}>No calls yet.</Text>
                    </View>
                }
            />
            <FAB
                icon="delete-outline"
                color="#fff"
                label={selectionMode ? `${selectedIds.size}` : undefined}
                style={[
                    globalStyle.fab,
                    { backgroundColor: '#e53935', marginBottom: globalStyle.fab.margin + insets.bottom },
                ]}
                onPress={onFabPress}
                size="small"
                disabled={records.length === 0}
            />
            <Portal>
                <Dialog visible={showDialog} onDismiss={() => setShowDialog(false)}>
                    <Dialog.Icon icon="delete-alert" />
                    <Dialog.Title style={{ textAlign: 'center' }}>{dialogTitle}</Dialog.Title>
                    <Dialog.Content>
                        <Text style={{ textAlign: 'center' }}>{dialogBody}</Text>
                    </Dialog.Content>
                    <Dialog.Actions style={{ justifyContent: 'space-evenly' }}>
                        <Button
                            mode="contained-tonal"
                            onPress={() => setShowDialog(false)}
                            style={{ paddingHorizontal: 15 }}
                        >
                            Cancel
                        </Button>
                        <Button
                            mode="contained"
                            buttonColor="#e53935"
                            onPress={onConfirmDelete}
                            style={{ paddingHorizontal: 15 }}
                        >
                            Delete
                        </Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
        </View>
    );
}

const localStyles = StyleSheet.create({
    sectionHeader: {
        color: SECONDARY_LITE,
        fontSize: 13,
        fontWeight: '600',
        paddingHorizontal: 14,
        paddingVertical: 8,
        backgroundColor: DARKHEADER,
    },
});
