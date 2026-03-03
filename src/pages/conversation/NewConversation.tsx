import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { ActivityIndicator, FAB, Icon, Searchbar, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';

import ContactPeek from '~/components/ContactPeek';
import { HomeStackParamList } from '~/global/navigation';
import globalStyle from '~/global/style';
import { DARKHEADER, SECONDARY_LITE } from '~/global/variables';
import { UserData } from '~/store/reducers/user';
import { RootState } from '~/store/store';

export default function NewConversation(props: StackScreenProps<HomeStackParamList, 'NewConversation'>) {
    const { colors } = useTheme();
    const { navigation } = props;
    const contacts = useSelector((state: RootState) => state.userReducer.contacts);
    const [results, setResults] = useState<UserData[]>([]);
    const [loading, setLoading] = useState(true);
    const [prefix, setPrefix] = useState('');
    const insets = useSafeAreaInsets();

    useEffect(() => {
        setLoading(true);

        const newResults = contacts.filter(contact => contact.phone_no?.toLowerCase().startsWith(prefix.toLowerCase()));
        setResults(newResults.sort((r1, r2) => (r1.phone_no > r2.phone_no ? 1 : -1)));

        setLoading(false);
    }, [prefix, contacts]);

    return (
        <View style={globalStyle.wrapper}>
            {/* Search */}
            <View style={{ backgroundColor: DARKHEADER, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Searchbar
                    icon="magnify"
                    style={{ backgroundColor: '#3a3d45', borderRadius: 24 }}
                    placeholder="Search contacts"
                    value={prefix}
                    onChangeText={val => setPrefix(val)}
                />
            </View>

            {loading && <ActivityIndicator size="large" />}

            {!loading && (
                <ScrollView>
                    {results?.length ? (
                        results.map((contact, index) => {
                            return (
                                <ContactPeek
                                    key={index}
                                    data={{ ...contact }}
                                    isContact={true}
                                    onSelect={() => navigation.navigate('Conversation', { data: { peer_user: contact } })}
                                />
                            );
                        })
                    ) : (
                        <View style={{ alignItems: 'center', marginTop: 80 }}>
                            <Icon source="account-group-outline" size={64} color={SECONDARY_LITE} />
                            <Text style={{ color: SECONDARY_LITE, fontSize: 16, marginTop: 12 }}>
                                {prefix.length > 0 ? 'No contacts found' : 'No contacts yet'}
                            </Text>
                        </View>
                    )}
                </ScrollView>
            )}

            <FAB
                color="#fff"
                style={[
                    globalStyle.fab,
                    { backgroundColor: colors.primary, marginBottom: globalStyle.fab.margin + insets.bottom },
                ]}
                onPress={() => navigation.replace('AddContact')}
                icon="account-plus"
            />
        </View>
    );
}
