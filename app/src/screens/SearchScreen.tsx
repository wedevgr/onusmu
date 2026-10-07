import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '../api/client';
import type { SearchResult } from '../api/types';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';
import { formatClock, formatDayLabel } from '../lib/time';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';
import { spacing, typography, useTheme } from '../theme';

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Search'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export function SearchScreen(): React.JSX.Element {
  const theme = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setError(null);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      setError(null);
      api
        .search({ q: trimmed, limit: 100 })
        .then((res) => setResults(res.results))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <Screen>
      <Text style={[typography.title, { color: theme.colors.text }]}>Search</Text>
      <TextInput
        style={[
          styles.input,
          { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.surface },
        ]}
        placeholder='Try "George", "contract", "5000"...'
        placeholderTextColor={theme.colors.textMuted}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        returnKeyType="search"
      />

      {error ? <Text style={[typography.label, { color: theme.colors.danger }]}>{error}</Text> : null}

      <FlatList
        data={results ?? []}
        keyExtractor={(item) => item.id}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query.trim().length === 0 ? (
            <EmptyState title="Search your memory" message="Find anything you said, by word or phrase." />
          ) : searching ? null : (
            <EmptyState title="No matches" message="Nothing in your memories matches that search." />
          )
        }
        renderItem={({ item }) => (
          <Card>
            <Text
              style={[typography.label, { color: theme.colors.primary }]}
              onPress={() => navigation.navigate('Timeline', { highlightChunkId: item.id, sessionId: item.sessionId })}
            >
              {formatDayLabel(item.startedAt)} · {formatClock(item.startedAt)}
            </Text>
            <Text style={[typography.body, { color: theme.colors.text }]}>{item.text}</Text>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  list: { flex: 1, marginTop: spacing.xs },
});
