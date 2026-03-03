import React, { useEffect, useRef, useState } from 'react';
import { Text, View, ScrollView } from 'react-native';
import { Divider, Searchbar, ActivityIndicator, Icon } from 'react-native-paper';
import { useSelector } from 'react-redux';
import { StackScreenProps } from '@react-navigation/stack';

import { searchUsers, addContact } from '~/store/actions/user';
import globalStyle from '~/global/style';
import { DARKHEADER, SECONDARY_LITE } from '~/global/variables';
import { RootState, store } from '~/store/store';
import { UserData } from '~/store/reducers/user';
import ContactPeek from '~/components/ContactPeek';
import { HomeStackParamList } from '~/global/navigation';

export default function AddContact(props: StackScreenProps<HomeStackParamList, 'AddContact'>) {
    const { navigation } = props;
    const contact_ids = useSelector<RootState, UserData[]>(state => state.userReducer.contacts).map(c => c.id);

    const [results, setResults] = useState<UserData[] | undefined>(undefined);
    const [addingContact, setAddingContact] = useState<UserData | undefined>(undefined);
    const [searching, setSearching] = useState(false);
    const [prefix, setPrefix] = useState('');
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const handleSearch = async () => {
            const users = await store.dispatch(searchUsers({ prefix: prefix })).unwrap();
            setResults(users.sort((u1, u2) => (u1.phone_no > u2.phone_no ? 1 : -1)));
            setSearching(false);
        };
        if (timer.current) {
            clearTimeout(timer.current);
        }
        if (prefix.length > 2) {
            setSearching(true);
            timer.current = setTimeout(handleSearch, 250);
        } else {
            setResults(undefined);
            setSearching(false);
        }
    }, [prefix]);

    const handleAddContact = async (user: UserData) => {
        setAddingContact(user);
        const success = await store.dispatch(addContact({ user: user })).unwrap();
        if (success) {
            navigation.replace('Conversation', { data: { peer_user: user } });
        }

        setAddingContact(undefined);
    };

    return (
        <View style={globalStyle.wrapper}>
            {/* Search */}
            <View style={{ backgroundColor: DARKHEADER, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Searchbar
                    icon="magnify"
                    style={{ backgroundColor: '#3a3d45', borderRadius: 24 }}
                    placeholder="Find new contacts"
                    onChangeText={val => setPrefix(val)}
                    value={prefix}
                />
            </View>

            {searching && (
                <View style={{ flex: 1, justifyContent: 'center' }}>
                    <ActivityIndicator size="large" />
                </View>
            )}

            {/* Contact List */}
            {!searching && (
                <ScrollView>
                    {results?.length ? (
                        results.map((user, index) => {
                            const isContact = contact_ids.includes(user.id);
                            return (
                                <View key={index}>
                                    <ContactPeek
                                        data={user}
                                        loading={addingContact?.phone_no === user.phone_no}
                                        onSelect={() =>
                                            isContact
                                                ? navigation.navigate('Conversation', { data: { peer_user: user } })
                                                : handleAddContact(user)
                                        }
                                        isContact={isContact}
                                    />
                                    <Divider />
                                </View>
                            );
                        })
                    ) : (
                        <View style={{ alignItems: 'center', marginTop: 80 }}>
                            <Icon source="account-search-outline" size={64} color={SECONDARY_LITE} />
                            <Text style={{ color: SECONDARY_LITE, fontSize: 16, marginTop: 12 }}>
                                {prefix.length > 2 ? 'No users found' : 'Search for users to add'}
                            </Text>
                        </View>
                    )}
                </ScrollView>
            )}
        </View>
    );
}
