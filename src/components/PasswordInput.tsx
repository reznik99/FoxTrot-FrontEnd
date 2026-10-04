import { useState } from 'react';
import { View } from 'react-native';
import { HelperText, ProgressBar, TextInput, useTheme } from 'react-native-paper';
import { TextInputLabelProp } from 'react-native-paper/lib/typescript/components/TextInput/types';

import { checkPasswordStrength } from '~/global/password';
import { SECONDARY_LITE } from '~/global/variables';

type Props = {
    value: string;
    label?: TextInputLabelProp | undefined;
    mode?: 'flat' | 'outlined' | undefined;
    outlineColor?: string | undefined;
    onChangeText?: (((text: string) => void) & Function) | undefined;
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters' | undefined;
    autoComplete?: 'current-password' | 'new-password' | 'off' | undefined;
    /** Show a strength meter under the field (new passwords only): values it must not be built from, and the score it must reach. */
    strength?: { inputs: string[]; minScore: number };
};

const strengthColors = ['#d32f2f', '#d32f2f', '#f0ad4e', '#4caf50', '#4caf50'];

export default function PasswordInput(props: Props) {
    const { colors } = useTheme();
    const [showPassword, setShowPassword] = useState(false);
    const strength =
        props.strength && props.value
            ? checkPasswordStrength(props.value, props.strength.inputs, props.strength.minScore)
            : null;

    const input = (
        <TextInput
            mode={props.mode}
            autoCapitalize={props.autoCapitalize}
            autoComplete={props.autoComplete}
            onChangeText={props.onChangeText}
            value={props.value}
            label={props.label}
            secureTextEntry={showPassword ? false : true}
            outlineColor={props.outlineColor}
            right={
                <TextInput.Icon
                    icon={showPassword ? 'eye-off' : 'eye'}
                    color={showPassword ? colors.primary : SECONDARY_LITE}
                    forceTextInputFocus={false}
                    onPress={() => setShowPassword(!showPassword)}
                />
            }
        />
    );

    if (!props.strength) {
        return input;
    }
    return (
        <View>
            {input}
            {strength && (
                <>
                    <ProgressBar
                        progress={(strength.score + 1) / 5}
                        color={strengthColors[strength.score]}
                        style={{ height: 3 }}
                    />
                    <HelperText type={strength.acceptable ? 'info' : 'error'} visible>
                        {strength.hint ? `${strength.label}: ${strength.hint}` : strength.label}
                    </HelperText>
                </>
            )}
        </View>
    );
}
