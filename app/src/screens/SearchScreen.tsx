import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { RootStackParamList, TabParamList } from '../navigation/RootNavigator';
import { api } from '../api/client';
import type { SearchResult } from '../api/types';
import { formatClock, formatDayLabel } from '../lib/time';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';
import { radius, spacing, typography, useTheme } from '../theme';

type Props = BottomTabScreenProps<TabParamList, 'Search'>;

function dayOffsetFor(iso: string): number {
  const day = new Date(iso);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - day.getTime()) / 86400000);
}

export default function SearchScreen(_props: Props): React.JSX.Element {
  const theme = useTheme();
  const rootNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmed.length === 0) {
      setResults([]);
      setSearching(false);
      setError(null);
      setHasSearched(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      const seq = ++requestSeq.current;
      api
        .search({ q: trimmed, limit: 30 })
        .then((response) => {
          if (seq !== requestSeq.current) return;
          setResults(response.results);
          setError(null);
          setHasSearched(true);
        })
        .catch((e: unknown) => {
          if (seq !== requestSeq.current) return;
          setResults([]);
          setError(e instanceof Error ? e.message : 'Search failed.');
          setHasSearched(true);
        })
        .finally(() => {
          if (seq === requestSeq.current) setSearching(false);
        });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const openResult = (result: SearchResult): void => {
    rootNav.navigate('Main', {
      screen: 'Timeline',
      params: {
        highlightChunkId: result.id,
        dayOffset: dayOffsetFor(result.startedAt),
        sessionId: result.sessionId,
      },
    });
  };

  return (
    <Screen>
      <TextInput
        style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.text }]}
        placeholder="Search your memories…"
        placeholderTextColor={theme.colors.textMuted}
        autoCapitalize="none"
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
      />

      {searching ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : error !== null ? (
        <EmptyState title="Search failed" message={error} />
      ) : results.length === 0 ? (
        <EmptyState
          title={hasSearched ? 'No matches' : 'Search'}
          message={
            hasSearched
              ? 'Nothing in your memories matches that query.'
              : 'Type to search across everything you have recorded.'
          }
        />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <Text style={[typography.label, styles.count, { color: theme.colors.textMuted }]}>
              {results.length} result{results.length === 1 ? '' : 's'}
            </Text>
          }
          renderItem={({ item }) => (
            <Card>
              <Text style={[typography.label, styles.meta, { color: theme.colors.primary }]}>
                {formatDayLabel(item.startedAt)} · {formatClock(item.startedAt)}
              </Text>
              <Text
                style={[typography.body, styles.snippet, { color: theme.colors.text }]}
                numberOfLines={4}
              >
                {item.text}
              </Text>
              <View style={styles.footer}>
                <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
                  Tap to view in timeline
                </Text>
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginTop: spacing.sm,
    fontSize: 16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  meta: {
    marginBottom: spacing.xs,
  },
  snippet: {
    lineHeight: 22,
  },
  footer: {
    marginTop: spacing.sm,
  },
});
