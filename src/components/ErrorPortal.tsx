import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, View, ScrollView, StyleSheet, ToastAndroid } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Clipboard from '@react-native-clipboard/clipboard';
import DeviceInfo from 'react-native-device-info';

import { getEntries, getFormattedLogs, registerPortalCallback, LogEntry } from '~/global/logger';
import { DARKHEADER } from '~/global/variables';

const LEVEL_COLORS: Record<string, string> = {
    error: '#f44336',
    warn: '#ff9800',
    info: '#fff',
    debug: '#888',
};

function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    return (
        d.getHours().toString().padStart(2, '0') +
        ':' +
        d.getMinutes().toString().padStart(2, '0') +
        ':' +
        d.getSeconds().toString().padStart(2, '0') +
        '.' +
        d.getMilliseconds().toString().padStart(3, '0')
    );
}

export default function ErrorPortal() {
    const [visible, setVisible] = useState(false);
    const [title, setTitle] = useState('Error');
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const scrollRef = useRef<ScrollView>(null);

    useEffect(() => {
        registerPortalCallback((portalTitle?: string) => {
            setTitle(portalTitle || 'Error');
            setLogs(getEntries());
            setVisible(true);
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
        });
        return () => registerPortalCallback(null);
    }, []);

    const handleCopy = useCallback(() => {
        Clipboard.setString(getFormattedLogs());
        ToastAndroid.show('Logs copied to clipboard', ToastAndroid.SHORT);
    }, []);

    const handleClose = useCallback(() => {
        setVisible(false);
        setLogs([]);
    }, []);

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
            <View style={styles.overlay}>
                <View style={styles.container}>
                    <View style={styles.header}>
                        <Text variant="titleMedium" style={styles.title}>
                            {title}
                        </Text>
                        <Text variant="bodySmall" style={styles.meta}>
                            v{DeviceInfo.getVersion()} ({DeviceInfo.getBuildNumber()}) — {new Date().toLocaleString()}
                        </Text>
                    </View>

                    <ScrollView ref={scrollRef} style={styles.logContainer} contentContainerStyle={styles.logContent}>
                        {logs.length === 0 ? (
                            <Text style={styles.emptyText}>No logs captured</Text>
                        ) : (
                            logs.map((entry, idx) => (
                                <Text
                                    key={idx}
                                    style={[styles.logEntry, { color: LEVEL_COLORS[entry.level] || '#fff' }]}
                                    selectable
                                >
                                    [{formatTimestamp(entry.timestamp)}] [{entry.level.toUpperCase().padEnd(5)}]{' '}
                                    {entry.message}
                                </Text>
                            ))
                        )}
                    </ScrollView>

                    <View style={styles.footer}>
                        <Button mode="contained-tonal" onPress={handleClose} style={styles.button}>
                            Close
                        </Button>
                        <Button mode="contained" onPress={handleCopy} icon="content-copy" style={styles.button}>
                            Copy Logs
                        </Button>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        justifyContent: 'center',
        padding: 16,
    },
    container: {
        backgroundColor: DARKHEADER,
        borderRadius: 12,
        maxHeight: '90%',
        overflow: 'hidden',
    },
    header: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#444',
    },
    title: {
        color: '#fff',
        fontWeight: 'bold',
    },
    meta: {
        color: '#999',
        marginTop: 4,
    },
    logContainer: {
        maxHeight: 400,
    },
    logContent: {
        padding: 12,
    },
    emptyText: {
        color: '#666',
        textAlign: 'center',
        paddingVertical: 20,
    },
    logEntry: {
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 16,
        marginBottom: 2,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'space-evenly',
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: '#444',
    },
    button: {
        paddingHorizontal: 12,
    },
});
