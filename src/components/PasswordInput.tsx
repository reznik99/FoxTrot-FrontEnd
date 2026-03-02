import { useState } from 'react';
import { TextInput, useTheme } from 'react-native-paper';
import { TextInputLabelProp } from 'react-native-paper/lib/typescript/components/TextInput/types';
import { SECONDARY_LITE } from '~/global/variables';

type Props = {
    value: string;
    label?: TextInputLabelProp | undefined;
    mode?: 'flat' | 'outlined' | undefined;
    outlineColor?: string | undefined;
    onChangeText?: (((text: string) => void) & Function) | undefined;
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters' | undefined;
};

export default function PasswordInput(props: Props) {
    const { colors } = useTheme();
    const [showPassword, setShowPassword] = useState(false);

    return (
        <TextInput
            mode={props.mode}
            autoCapitalize={props.autoCapitalize}
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
}
