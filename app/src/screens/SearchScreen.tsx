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

// Characters shown before the first match when it sits deep inside a long chunk.
const SNIPPET_LEAD = 60;

/** The text from shortly before the first match, with highlight ranges shifted to fit. */
function snippetOf(result: SearchResult): { text: string; highlights: Array<[number, number]> } {
  const highlights = result.highlights ?? [];
  const first = highlights[0];
  if (!first || first[0] <= SNIPPET_LEAD * 2) return { text: result.text, highlights };
  // Start at a word boundary so the snippet does not open mid-word.
  let start = result.text.lastIndexOf(' ', first[0] - SNIPPET_LEAD) + 1;
  if (start <= 0) start = first[0] - SNIPPET_LEAD;
  const prefix = '… ';
  const shift = prefix.length - start;
  return {
    text: prefix + result.text.slice(start),
    highlights: highlights.filter(([from]) => from >= start).map(([from, to]) => [from + shift, to + shift]),
  };
}

function HighlightedText({
  result,
  color,
  strongColor,
}: {
  result: SearchResult;
  color: string;
  strongColor: string;
}): React.JSX.Element {
  const { text, highlights } = snippetOf(result);
  const parts: React.ReactNode[] = [];
  let at = 0;
  highlights.forEach(([from, to], i) => {
    if (from > at) parts.push(text.slice(at, from));
    parts.push(
      <Text key={i} style={[styles.mark, { color: strongColor }]}>
        {text.slice(from, to)}
      </Text>,
    );
    at = to;
  });
  if (at < text.length) parts.push(text.slice(at));
  return (
    <Text style={[typography.body, { color }]} numberOfLines={4}>
      {parts}
    </Text>
  );
}

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
  const [exact, setExact] = useState<SearchResult[]>([]);
  const [related, setRelated] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [findingRelated, setFindingRelated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmed.length === 0) {
      requestSeq.current += 1;
      setExact([]);
      setRelated([]);
      setSearching(false);
      setFindingRelated(false);
      setError(null);
      setHasSearched(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      const seq = ++requestSeq.current;
      setRelated([]);
      setFindingRelated(true);
      // Exact matches come back fast; matches by meaning take a moment longer.
      api
        .search({ q: trimmed, limit: 30, mode: 'exact' })
        .then((response) => {
          if (seq !== requestSeq.current) return;
          setExact(response.results);
          setError(null);
          setHasSearched(true);
        })
        .catch((e: unknown) => {
          if (seq !== requestSeq.current) return;
          setExact([]);
          setError(e instanceof Error ? e.message : 'Η αναζήτηση απέτυχε.');
          setHasSearched(true);
        })
        .finally(() => {
          if (seq === requestSeq.current) setSearching(false);
        });
      api
        .search({ q: trimmed, limit: 10, mode: 'related' })
        .then((response) => {
          if (seq !== requestSeq.current) return;
          // Only results the server marks as related; an older server returns exact ones too.
          setRelated(response.results.filter((r) => r.match === 'related'));
        })
        .catch(() => {
          // Related results are a bonus; the exact ones still stand.
        })
        .finally(() => {
          if (seq === requestSeq.current) setFindingRelated(false);
        });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const exactIds = new Set(exact.map((r) => r.id));
  const results = [...exact, ...related.filter((r) => !exactIds.has(r.id))];

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
        searching || findingRelated ? (
          findingRelated && !searching ? (
            <View style={styles.section}>
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
              <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
                Ψάχνω και με άλλα λόγια…
              </Text>
            </View>
          ) : null
        ) : (
          <EmptyState
            icon="search"
            title={hasSearched ? 'Κανένα αποτέλεσμα' : 'Βρες ό,τι έχεις πει'}
            message={
              hasSearched
                ? 'Τίποτα στις μνήμες σου δεν ταιριάζει.'
                : 'Ψάξε λέξεις ή θέματα, π.χ. «αμάξι» ή «φαγητό».'
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
          ListFooterComponent={
            findingRelated ? (
              <View style={styles.section}>
                <ActivityIndicator size="small" color={theme.colors.textMuted} />
                <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
                  Ψάχνω και με άλλα λόγια…
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item, index }) => (
            <>
              {item.match === 'related' && results[index - 1]?.match !== 'related' ? (
                <View style={styles.section}>
                  <Icon name="zap" size={14} color={theme.colors.textMuted} />
                  <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
                    {index === 0 ? 'Σχετικά με αυτό που ψάχνεις' : 'Σχετικά, με άλλα λόγια'}
                  </Text>
                </View>
              ) : null}
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
                <HighlightedText
                  result={item}
                  color={item.highlights?.length ? theme.colors.textMuted : theme.colors.text}
                  strongColor={theme.colors.text}
                />
                <View style={styles.meta}>
                  <Icon name="clock" size={14} color={theme.colors.textMuted} />
                  <Text style={[typography.caption, styles.metaText, { color: theme.colors.textMuted }]}>
                    {formatDayLabel(item.startedAt)} στις {formatClock(item.startedAt)}
                  </Text>
                  <Icon name="chevron-right" size={16} color={theme.colors.textFaint} />
                </View>
              </Pressable>
            </>
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
  mark: {
    fontWeight: '600',
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
});
