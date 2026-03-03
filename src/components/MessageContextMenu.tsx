import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, ToastAndroid, TouchableOpacity, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import RNFS from 'react-native-fs';
import { Dialog, Icon, Portal } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { formatBytes } from '~/global/helper';
import { logger } from '~/global/logger';
import { getWriteExtPermission } from '~/global/permissions';
import { SECONDARY_LITE } from '~/global/variables';
import { downloadMedia } from '~/store/actions/media';
import { DELETE_MESSAGE } from '~/store/reducers/user';
import { store } from '~/store/store';

import { MessageContextMenuData } from './Message';

type Props = {
    data: MessageContextMenuData;
    onDismiss: () => void;
};

const REACTIONS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F525}'];

export default function MessageContextMenu({ data, onDismiss }: Props) {
    const [infoVisible, setInfoVisible] = useState(false);

    const handleCopy = useCallback(() => {
        Clipboard.setString(data.text || '');
        ToastAndroid.show('Message copied', ToastAndroid.SHORT);
        onDismiss();
    }, [data.text, onDismiss]);

    const handleSave = useCallback(async () => {
        if (!data.objectKey || !data.fileKey || !data.fileIv) return;
        try {
            const granted = await getWriteExtPermission();
            if (!granted) return;

            const fileUri = await store
                .dispatch(downloadMedia({ objectKey: data.objectKey, keyBase64: data.fileKey, ivBase64: data.fileIv }))
                .unwrap();

            const extension = data.objectKey.split('.').pop() || 'bin';
            const destPath = `${RNFS.DownloadDirectoryPath}/foxtrot-${Date.now()}.${extension}`;
            await RNFS.copyFile(fileUri.replace('file://', ''), destPath);
            ToastAndroid.show(`Saved to ${destPath}`, ToastAndroid.SHORT);
        } catch (err: any) {
            logger.error('Error saving media:', err);
            Toast.show({ type: 'error', text1: 'Failed to save media', text2: err?.message });
        }
        onDismiss();
    }, [data.objectKey, data.fileKey, data.fileIv, onDismiss]);

    const handleDelete = useCallback(() => {
        store.dispatch(DELETE_MESSAGE({ conversationId: data.conversationId, messageId: data.messageId }));
        onDismiss();
    }, [data.conversationId, data.messageId, onDismiss]);

    const handleInfo = useCallback(() => {
        setInfoVisible(true);
    }, []);

    const showCopy = data.type === 'MSG';
    const showSave = data.type !== 'MSG' && !!data.objectKey;

    return (
        <View style={styles.container}>
            {/* Reaction row */}
            <View style={styles.reactionRow}>
                {REACTIONS.map(emoji => (
                    <TouchableOpacity key={emoji} style={styles.reactionButton} onPress={onDismiss}>
                        <Text style={styles.reactionEmoji}>{emoji}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* Menu items */}
            <View style={styles.menu}>
                <Pressable style={styles.menuItem} onPress={handleInfo} android_ripple={{ color: '#ffffff20' }}>
                    <Icon source="information-outline" size={20} color="#fff" />
                    <Text style={styles.menuText}>Info</Text>
                </Pressable>
                {showCopy && (
                    <Pressable style={styles.menuItem} onPress={handleCopy} android_ripple={{ color: '#ffffff20' }}>
                        <Icon source="content-copy" size={20} color="#fff" />
                        <Text style={styles.menuText}>Copy</Text>
                    </Pressable>
                )}
                {showSave && (
                    <Pressable style={styles.menuItem} onPress={handleSave} android_ripple={{ color: '#ffffff20' }}>
                        <Icon source="download" size={20} color="#fff" />
                        <Text style={styles.menuText}>Save</Text>
                    </Pressable>
                )}
                {/* TODO: support legacy inline media download (no objectKey) */}
                <Pressable style={styles.menuItem} onPress={handleDelete} android_ripple={{ color: '#ffffff20' }}>
                    <Icon source="delete" size={20} color="#ff5252" />
                    <Text style={[styles.menuText, { color: '#ff5252' }]}>Delete</Text>
                </Pressable>
            </View>

            {/* Info dialog */}
            <Portal>
                <Dialog visible={infoVisible} onDismiss={() => setInfoVisible(false)} style={styles.dialog}>
                    <Dialog.Title style={styles.dialogTitle}>Message Info</Dialog.Title>
                    <Dialog.Content>
                        <Text style={styles.infoLabel}>Direction</Text>
                        <Text style={styles.infoValue}>{data.isSent ? 'Sent' : 'Received'}</Text>

                        <Text style={styles.infoLabel}>Sent at</Text>
                        <Text style={styles.infoValue}>{new Date(data.sentAt).toLocaleString()}</Text>

                        <Text style={styles.infoLabel}>Message size</Text>
                        <Text style={styles.infoValue}>{formatBytes(data.rawMessageLength)}</Text>

                        <Text style={styles.infoLabel}>Media</Text>
                        <Text style={styles.infoValue}>
                            {data.objectKey ? data.objectKey.split('/').pop() || data.objectKey : 'None'}
                        </Text>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Pressable onPress={() => setInfoVisible(false)} style={styles.dialogAction}>
                            <Text style={styles.dialogActionText}>Close</Text>
                        </Pressable>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#2a2a2a',
        borderRadius: 16,
        padding: 12,
        marginHorizontal: 20,
    },
    reactionRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginBottom: 12,
        paddingHorizontal: 8,
    },
    reactionButton: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: '#3a3a3a',
        justifyContent: 'center',
        alignItems: 'center',
    },
    reactionEmoji: {
        fontSize: 20,
    },
    menu: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#444',
        paddingTop: 4,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    menuText: {
        color: '#fff',
        fontSize: 15,
    },
    dialog: {
        backgroundColor: '#2a2a2a',
    },
    dialogTitle: {
        color: '#fff',
    },
    infoLabel: {
        color: SECONDARY_LITE,
        fontSize: 12,
        marginTop: 10,
    },
    infoValue: {
        color: '#fff',
        fontSize: 14,
        marginTop: 2,
    },
    dialogAction: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    dialogActionText: {
        color: '#82B1FF',
        fontSize: 14,
    },
});
