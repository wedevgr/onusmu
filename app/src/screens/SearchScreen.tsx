import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
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
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
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
          setError(e instanceof Error ? e.message : 'Η αναζήτηση απέτυχε.');
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
    <Screen bottomInset={false}>
      <Header title="Αναζήτηση" />

      <View style={[styles.field, theme.glass]}>
        <Icon name="search" size={20} color={theme.colors.textMuted} />
        <TextInput
          style={[styles.input, { color: theme.colors.text }]}
          placeholder="Αναζήτηση στις μνήμες σου"
          placeholderTextColor={theme.colors.textFaint}
          autoCapitalize="none"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
        {searching ? (
          <ActivityIndicator color={theme.colors.textMuted} />
        ) : query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Καθαρισμός"
            onPress={() => setQuery('')}
            hitSlop={10}
          >
            <Icon name="x-circle" size={20} color={theme.colors.textFaint} />
          </Pressable>
        ) : null}
      </View>

      {error !== null ? (
        <EmptyState icon="alert-circle" title="Η αναζήτηση απέτυχε" message={error} />
      ) : results.length === 0 ? (
        searching ? null : (
          <EmptyState
            icon="search"
            title={hasSearched ? 'Κανένα αποτέλεσμα' : 'Βρες ό,τι έχεις πει'}
            message={
              hasSearched
                ? 'Τίποτα στις μνήμες σου δεν ταιριάζει.'
                : 'Ψάξε σε όλα όσα έχεις καταγράψει.'
            }
          />
        )
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Text style={[typography.caption, styles.count, { color: theme.colors.textMuted }]}>
              {results.length} {results.length === 1 ? 'αποτέλεσμα' : 'αποτελέσματα'}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => openResult(item)}
              style={({ pressed }) => [
                styles.result,
                {
                  backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
                },
              ]}
            >
              <Text
                style={[typography.body, { color: theme.colors.text }]}
                numberOfLines={4}
              >
                {item.text}
              </Text>
              <View style={styles.meta}>
                <Icon name="clock" size={14} color={theme.colors.textMuted} />
                <Text style={[typography.caption, styles.metaText, { color: theme.colors.textMuted }]}>
                  {formatDayLabel(item.startedAt)} στις {formatClock(item.startedAt)}
                </Text>
                <Icon name="chevron-right" size={16} color={theme.colors.textFaint} />
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    minHeight: 52,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  count: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  result: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  metaText: {
    flex: 1,
  },
});
