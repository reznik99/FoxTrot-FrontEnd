import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Icon } from 'react-native-paper';

const SWIPE_THRESHOLD = 60;
const MAX_TRANSLATE = 80;

type Props = {
    isSent: boolean;
    isSystem: boolean;
    onSwipeReply: () => void;
    children: React.ReactNode;
};

export default function SwipeableMessage({ isSent, isSystem, onSwipeReply, children }: Props) {
    const translateX = useSharedValue(0);

    const triggerReply = useCallback(() => {
        onSwipeReply();
    }, [onSwipeReply]);

    const pan = Gesture.Pan()
        .enabled(!isSystem)
        .activeOffsetX(isSent ? [-15, 0] : [0, 15])
        .failOffsetY([-10, 10])
        .onUpdate(e => {
            if (isSent) {
                // Sent: swipe left (negative)
                translateX.value = Math.max(-MAX_TRANSLATE, Math.min(0, e.translationX));
            } else {
                // Received: swipe right (positive)
                translateX.value = Math.min(MAX_TRANSLATE, Math.max(0, e.translationX));
            }
        })
        .onEnd(() => {
            const triggered = isSent
                ? translateX.value <= -SWIPE_THRESHOLD
                : translateX.value >= SWIPE_THRESHOLD;

            if (triggered) {
                runOnJS(triggerReply)();
            }
            translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
        });

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: translateX.value }],
    }));

    const iconStyle = useAnimatedStyle(() => {
        const progress = isSent
            ? Math.abs(translateX.value) / SWIPE_THRESHOLD
            : translateX.value / SWIPE_THRESHOLD;
        return {
            opacity: Math.min(progress, 1),
        };
    });

    return (
        <GestureDetector gesture={pan}>
            <View style={styles.wrapper}>
                {/* Reply icon behind the message */}
                <Animated.View
                    style={[
                        styles.iconContainer,
                        isSent ? styles.iconRight : styles.iconLeft,
                        iconStyle,
                    ]}
                >
                    <Icon source="reply" size={22} color="#999" />
                </Animated.View>
                <Animated.View style={animatedStyle}>{children}</Animated.View>
            </View>
        </GestureDetector>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        position: 'relative',
    },
    iconContainer: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        width: 40,
    },
    iconLeft: {
        left: 0,
    },
    iconRight: {
        right: 0,
    },
});
