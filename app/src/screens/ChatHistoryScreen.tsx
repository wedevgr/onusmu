import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { api } from '../api/client';
import type { Conversation } from '../api/types';
import { formatClock, formatDayLabel } from '../lib/time';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { IconButton } from '../components/Icon';
import { Screen } from '../components/Screen';
import { spacing, typography, useTheme } from '../theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

function when(conversation: Conversation): string {
  return conversation.updatedAt ?? conversation.createdAt ?? '';
}

export default function ChatHistoryScreen(): React.JSX.Element {
  const theme = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((): void => {
    setLoading(true);
    api
      .listConversations()
      .then(({ conversations: list }) => {
        const sorted = [...list].sort((a, b) => when(b).localeCompare(when(a)));
        setConversations(sorted);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Δεν φορτώθηκε το ιστορικό.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  const open = (conversation: Conversation): void => {
    navigation.navigate('Main', {
      screen: 'Chat',
      params: { conversationId: conversation.id },
    });
    navigation.goBack();
  };

  const remove = (conversation: Conversation): void => {
    Alert.alert('Διαγραφή συνομιλίας;', 'Η συνομιλία θα διαγραφεί οριστικά.', [
      { text: 'Άκυρο', style: 'cancel' },
      {
        text: 'Διαγραφή',
        style: 'destructive',
        onPress: () => {
          api
            .deleteConversation(conversation.id)
            .then(load)
            .catch(() => Alert.alert('Η διαγραφή απέτυχε', 'Η συνομιλία δεν διαγράφηκε.'));
        },
      },
    ]);
  };

  return (
    <Screen>
      <Header
        title="Ιστορικό"
        right={<IconButton name="x" label="Κλείσιμο" onPress={() => navigation.goBack()} />}
      />
      {error ? (
        <EmptyState title="Δεν φορτώθηκε το ιστορικό" message={error} />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            loading ? null : (
              <EmptyState
                title="Καμία συνομιλία ακόμα"
                message="Ρώτα κάτι τη μνήμη σου για να ξεκινήσεις."
              />
            )
          }
          renderItem={({ item }) => {
            const stamp = when(item);
            return (
              <Card>
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={[typography.label, { color: theme.colors.text }]} numberOfLines={1}>
                      {item.title?.trim() || 'Συνομιλία'}
                    </Text>
                    <Text
                      style={[typography.body, styles.muted, { color: theme.colors.textMuted }]}
                    >
                      {stamp ? `${formatDayLabel(stamp)} στις ${formatClock(stamp)}` : ''}
                    </Text>
                  </View>
                  <IconButton
                    name="trash-2"
                    label="Διαγραφή συνομιλίας"
                    filled={false}
                    color={theme.colors.danger}
                    onPress={() => remove(item)}
                  />
                </View>
                <View style={styles.openRow}>
                  <IconButton
                    name="message-circle"
                    label="Άνοιγμα συνομιλίας"
                    filled={false}
                    onPress={() => open(item)}
                  />
                </View>
              </Card>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: spacing.md,
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  muted: {
    marginTop: spacing.xs,
  },
  openRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
  },
});
