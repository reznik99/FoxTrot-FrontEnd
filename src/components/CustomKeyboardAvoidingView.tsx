import { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, StyleSheet } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';

function CustomKeyboardAvoidingView({ children, style }: any) {
    const headerHeight = useHeaderHeight();
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const showSub = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
        const hideSub = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

    return (
        <KeyboardAvoidingView
            style={StyleSheet.compose(style, {})}
            behavior="padding"
            enabled={true}
            keyboardVerticalOffset={open ? headerHeight : 0}
        >
            {children}
        </KeyboardAvoidingView>
    );
}

export default CustomKeyboardAvoidingView;
