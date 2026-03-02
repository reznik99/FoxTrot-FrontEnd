import { StyleSheet } from 'react-native';
import { SECONDARY, ERROR_RED } from './variables';

const globalStyle = StyleSheet.create({
    wrapper: {
        flex: 1,
        width: '100%',
        height: '100%',
        backgroundColor: SECONDARY,
    },
    textInfo: {
        color: '#e3e1e1',
    },
    searchContainer: {
        alignItems: 'center',
    },
    errorMsg: {
        color: ERROR_RED,
        textAlign: 'center',
        fontSize: 20,
        paddingVertical: 20,
    },
    fab: {
        position: 'absolute',
        margin: 20,
        right: 0,
        bottom: 0,
    },
    dialogText: {
        marginBottom: 5,
    },
    spaceBetween: {
        justifyContent: 'space-between',
    },
});

export default globalStyle;
