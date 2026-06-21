import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, useTheme } from 'react-native-paper';

import { allDevTests, type TestCase, type TestResult, type TestStatus } from '~/global/devTests';
import { logger } from '~/global/logger';

export default function DevTests() {
    const theme = useTheme();
    const [results, setResults] = useState<Record<string, TestResult>>({});
    const [running, setRunning] = useState(false);

    const grouped = useMemo(() => {
        const out: Record<string, TestCase[]> = {};
        for (const t of allDevTests) {
            (out[t.category] ||= []).push(t);
        }
        return out;
    }, []);

    const runAll = useCallback(async () => {
        setRunning(true);
        setResults({});
        logger.info('──── INTEGRATION TESTS START ────');
        let passed = 0;
        for (const test of allDevTests) {
            setResults(r => ({ ...r, [test.id]: { status: 'running' } }));
            const start = performance.now();
            try {
                await test.run();
                passed++;
                setResults(r => ({
                    ...r,
                    [test.id]: { status: 'pass', durationMs: performance.now() - start },
                }));
            } catch (err) {
                logger.error(`[DevTests] ${test.id} failed:`, err);
                // Capture into plain locals — Hermes drops the catch binding for the
                // deferred setResults updater closure, throwing "Property 'err' doesn't exist".
                const durationMs = performance.now() - start;
                const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
                setResults(r => ({
                    ...r,
                    [test.id]: { status: 'fail', durationMs, error: message },
                }));
            }
        }
        logger.info(`──── INTEGRATION TESTS FINISH (${passed}/${allDevTests.length} passed) ────`);
        setRunning(false);
    }, []);

    const passCount = Object.values(results).filter(r => r.status === 'pass').length;
    const failCount = Object.values(results).filter(r => r.status === 'fail').length;
    const total = allDevTests.length;

    return (
        <View style={[styles.body, { backgroundColor: theme.colors.background }]}>
            <View style={styles.summaryRow}>
                <Button mode="contained" onPress={runAll} disabled={running} style={{ flex: 1 }}>
                    {running ? 'Running…' : `Run ${total} integration tests`}
                </Button>
            </View>
            <View style={styles.summaryRow}>
                <Text style={{ color: 'green' }}>{passCount} pass</Text>
                <Text style={{ color: failCount > 0 ? 'red' : theme.colors.onSurface }}>{failCount} fail</Text>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>{total - passCount - failCount} pending</Text>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
                {Object.entries(grouped).map(([category, tests]) => (
                    <View key={category} style={styles.section}>
                        <Text variant="titleMedium" style={styles.sectionTitle}>
                            {category}
                        </Text>
                        {tests.map(t => (
                            <TestRow key={t.id} test={t} result={results[t.id]} />
                        ))}
                    </View>
                ))}
            </ScrollView>
        </View>
    );
}

function TestRow({ test, result }: { test: TestCase; result: TestResult | undefined }) {
    const status = result?.status ?? 'idle';
    return (
        <View style={styles.row}>
            <View style={styles.statusIcon}>
                <StatusGlyph status={status} />
            </View>
            <View style={{ flex: 1 }}>
                <Text>{test.name}</Text>
                {result?.durationMs != null && <Text style={styles.muted}>{result.durationMs.toFixed(0)} ms</Text>}
                {result?.error && <Text style={styles.errorText}>{result.error}</Text>}
            </View>
        </View>
    );
}

function StatusGlyph({ status }: { status: TestStatus }) {
    if (status === 'running') return <ActivityIndicator size={18} />;
    if (status === 'pass') return <Icon source="check-circle" size={20} color="#2e7d32" />;
    if (status === 'fail') return <Icon source="close-circle" size={20} color="#c62828" />;
    return <Icon source="circle-outline" size={20} color="#888" />;
}

const styles = StyleSheet.create({
    body: {
        flex: 1,
        padding: 12,
    },
    summaryRow: {
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
        marginBottom: 8,
    },
    section: {
        marginTop: 16,
    },
    sectionTitle: {
        textTransform: 'capitalize',
        marginBottom: 6,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 8,
        gap: 10,
    },
    statusIcon: {
        width: 22,
        alignItems: 'center',
        paddingTop: 2,
    },
    muted: {
        color: '#888',
        fontSize: 12,
        marginTop: 2,
    },
    errorText: {
        color: '#c62828',
        fontSize: 12,
        marginTop: 4,
        fontFamily: 'monospace',
    },
});
