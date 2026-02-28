import React, { useCallback, useState } from 'react';
import { StyleSheet, ToastAndroid, View } from 'react-native';
import { Divider, IconButton, Menu } from 'react-native-paper';
import { ImageZoom } from '@likashefqet/react-native-image-zoom';
import Video from 'react-native-video';
import RNFS from 'react-native-fs';

import { DARKHEADER } from '~/global/variables';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { getWriteExtPermission } from '~/global/permissions';

interface IProps {
    media: string;
    onDismiss: () => void;
}

const FullScreenMedia = (props: IProps) => {
    const [showMenu, setShowMenu] = useState(false);

    const isFileUri = props.media.startsWith('file://');
    const isVideo = isFileUri && /\.(mp4|webm|mov)$/i.test(props.media);
    const mediaUri = isFileUri ? props.media : `data:image/jpeg;base64,${props.media}`;

    const download = useCallback(async () => {
        const granted = await getWriteExtPermission();
        if (!granted) {
            return;
        }

        const extension = isVideo ? 'mp4' : 'jpeg';
        const fullPath = RNFS.DownloadDirectoryPath + `/foxtrot-${Date.now()}.${extension}`;

        if (isFileUri) {
            await RNFS.copyFile(props.media.replace('file://', ''), fullPath);
        } else {
            await RNFS.writeFile(fullPath, props.media, 'base64');
        }

        setShowMenu(false);
        ToastAndroid.show(`${isVideo ? 'Video' : 'Image'} saved to ${fullPath}`, ToastAndroid.SHORT);
    }, [props.media, isFileUri, isVideo]);

    return (
        <View style={styles.container}>
            {isVideo ? (
                <Video
                    source={{ uri: props.media }}
                    style={{ flex: 1, paddingBottom: 50 }}
                    resizeMode="contain"
                    controls={true}
                    paused={false}
                    bufferConfig={{
                        minBufferMs: 2000,
                        maxBufferMs: 5000,
                        bufferForPlaybackMs: 1000,
                        bufferForPlaybackAfterRebufferMs: 2000,
                    }}
                />
            ) : (
                <GestureHandlerRootView style={{ flex: 1 }}>
                    <ImageZoom
                        uri={mediaUri}
                        resizeMode="contain"
                        resizeMethod="auto"
                        isDoubleTapEnabled={true}
                        doubleTapScale={3}
                    />
                </GestureHandlerRootView>
            )}
            <View style={styles.surface}>
                <IconButton icon="arrow-left-circle" size={25} onPress={props.onDismiss} />
                <Menu
                    visible={showMenu}
                    onDismiss={() => setShowMenu(false)}
                    anchor={<IconButton icon="dots-vertical" size={25} onPress={() => setShowMenu(true)} />}
                >
                    <Menu.Item title="Report" leadingIcon="information" />
                    <Divider />
                    <Menu.Item onPress={download} title="Download" leadingIcon="download" />
                </Menu>
            </View>
        </View>
    );
};

export default FullScreenMedia;

const styles = StyleSheet.create({
    container: {
        width: '100%',
        height: '100%',
    },
    surface: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'absolute',
        bottom: 0,
        zIndex: 1,
        width: '100%',
        paddingHorizontal: 10,
        paddingVertical: 5,
        backgroundColor: DARKHEADER + 'f0',
    },
});
