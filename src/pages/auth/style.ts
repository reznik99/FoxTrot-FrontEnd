import { StyleSheet } from 'react-native';
import { DARKHEADER, DIVIDER, ERROR_RED, SECONDARY, SECONDARY_LITE } from '~/global/variables';

const styles = StyleSheet.create({
    container: {
        flexGrow: 1,
        justifyContent: 'center',
        backgroundColor: SECONDARY,
        padding: 32,
    },
    titleContainer: {
        alignItems: 'center',
        marginBottom: 32,
    },
    title: {
        fontSize: 38,
        fontWeight: 'bold',
        color: '#fff',
        marginTop: 16,
    },
    subTitle: {
        fontSize: 16,
        letterSpacing: 2,
        textTransform: 'uppercase',
        marginTop: 4,
    },
    button: {
        width: '100%',
        paddingVertical: 4,
    },
    buttonSecondary: {
        width: '100%',
        paddingVertical: 4,
        backgroundColor: DARKHEADER,
    },
    dividerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 16,
    },
    dividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: DIVIDER,
    },
    dividerText: {
        color: SECONDARY_LITE,
        marginHorizontal: 12,
        fontSize: 13,
    },
    errorMsg: {
        color: ERROR_RED,
        textAlign: 'center',
        marginBottom: 8,
    },
    biometricContainer: {
        alignItems: 'center',
        marginTop: 24,
    },
    biometricHint: {
        color: SECONDARY_LITE,
        fontSize: 13,
        marginTop: 4,
    },
});

export default styles;
