import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { TabParamList, TimelineParams } from '../navigation/RootNavigator';
import { api } from '../api/client';
import type { Chunk, SessionSummary } from '../api/types';
import { dayBoundsIso, formatClock, formatDateHeader, formatDurationHuman } from '../lib/time';
import { ChunkStatusBadge } from '../components/ChunkStatusBadge';
import { InsightList } from '../components/InsightList';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { Icon, IconButton } from '../components/Icon';
import { Screen, SCREEN_GUTTER } from '../components/Screen';
import { radius, spacing, typography, useTheme } from '../theme';

type Props = BottomTabScreenProps<TabParamList, 'Timeline'>;

type TimelineRow =
  | { kind: 'session'; key: string; session: SessionSummary }
  | { kind: 'chunk'; key: string; chunk: Chunk; session: SessionSummary | null };

export default function TimelineScreen({ navigation, route }: Props): React.JSX.Element {
  const theme = useTheme();
  const listRef = useRef<FlatList<TimelineRow>>(null);

  const [dayOffset, setDayOffset] = useState(Math.max(route.params?.dayOffset ?? 0, 0));
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    route.params?.sessionId ?? null,
  );
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const highlightChunkId = route.params?.highlightChunkId;

  useEffect(() => {
    const params = route.params;
    if (params?.dayOffset !== undefined && params.dayOffset !== dayOffset) {
      setDayOffset(Math.max(params.dayOffset, 0));
    }
    if (params?.sessionId !== undefined) {
      setSelectedClientId(params.sessionId);
    }
  }, [route.params]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // dayOffset counts days back from today; the time helpers count forward.
      const { from, to } = dayBoundsIso(-dayOffset);
      const [sessionsResponse, chunksResponse] = await Promise.all([
        api.listSessions({ from, to }),
        (async () => {
          const params: { from: string; to: string; limit: number; offset: number; sessionId?: string } = {
            from,
            to,
            limit: 200,
            offset: 0,
          };
          if (selectedClientId) {
            const sessionsNow = await api.listSessions({ from, to });
            const match = sessionsNow.sessions.find(
              (s) => s.clientId === selectedClientId || s.id === selectedClientId,
            );
            if (match) params.sessionId = match.id;
          }
          return api.listChunks(params);
        })(),
      ]);
      const sortedSessions = [...sessionsResponse.sessions].sort((a, b) =>
        a.startedAt.localeCompare(b.startedAt),
      );
      setSessions(sortedSessions);
      setChunks(
        [...chunksResponse.chunks].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Δεν φορτώθηκε το χρονολόγιο.');
    } finally {
      setLoading(false);
    }
  }, [dayOffset, selectedClientId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => void load());
    return unsubscribe;
  }, [navigation, load]);

  const rows = useMemo<TimelineRow[]>(() => {
    const sessionById = new Map<string, SessionSummary>();
    for (const session of sessions) {
      sessionById.set(session.id, session);
    }
    const chunksBySession = new Map<string, Chunk[]>();
    for (const chunk of chunks) {
      const list = chunksBySession.get(chunk.sessionId) ?? [];
      list.push(chunk);
      chunksBySession.set(chunk.sessionId, list);
    }
    const orderedSessions =
      selectedClientId !== null
        ? sessions.filter(
            (session) => session.clientId === selectedClientId || session.id === selectedClientId,
          )
        : sessions;
    const result: TimelineRow[] = [];
    for (const session of orderedSessions) {
      const sessionChunks = chunksBySession.get(session.id) ?? [];
      if (selectedClientId === null && sessionChunks.length === 0) continue;
      result.push({ kind: 'session', key: `session-${session.id}`, session });
      for (const chunk of sessionChunks) {
        result.push({
          kind: 'chunk',
          key: `chunk-${chunk.id}`,
          chunk,
          session: sessionById.get(chunk.sessionId) ?? null,
        });
      }
    }
    return result;
  }, [sessions, chunks, selectedClientId]);

  const highlightIndex = useMemo(
    () => rows.findIndex((row) => row.kind === 'chunk' && row.chunk.id === highlightChunkId),
    [rows, highlightChunkId],
  );

  useEffect(() => {
    if (highlightIndex >= 0 && !loading) {
      const timer = setTimeout(() => {
        listRef.current?.scrollToIndex({ index: highlightIndex, animated: true, viewPosition: 0.35 });
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [highlightIndex, loading]);

  const deleteSession = (session: SessionSummary): void => {
    Alert.alert(
      'Διαγραφή καταγραφής;',
      `Η καταγραφή των ${formatClock(session.startedAt)} και όλες οι μνήμες της θα διαγραφούν οριστικά.`,
      [
        { text: 'Άκυρο', style: 'cancel' },
        {
          text: 'Διαγραφή',
          style: 'destructive',
          onPress: () => {
            api
              .deleteSession(session.id)
              .then(() => {
                if (selectedClientId === session.clientId) setSelectedClientId(null);
                return load();
              })
              .catch((e: unknown) =>
                Alert.alert('Η διαγραφή απέτυχε', e instanceof Error ? e.message : 'Δοκίμασε ξανά.'),
              );
          },
        },
      ],
    );
  };

  const renderItem = ({ item }: ListRenderItemInfo<TimelineRow>): React.JSX.Element => {
    if (item.kind === 'session') {
      const session = item.session;
      return (
        <View style={styles.sessionHeader}>
          <View style={[styles.sessionIcon, theme.glass]}>
            <Icon name="mic" size={18} color={theme.colors.text} />
          </View>
          <View style={styles.flex}>
            <Text style={[typography.heading, { color: theme.colors.text }]}>
              {formatClock(session.startedAt)}
            </Text>
            <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
              Διάρκεια {formatDurationHuman(session.durationSeconds)}
            </Text>
          </View>
          <IconButton
            name="trash-2"
            label="Διαγραφή καταγραφής"
            filled={false}
            color={theme.colors.textMuted}
            onPress={() => deleteSession(session)}
          />
        </View>
      );
    }
    const chunk = item.chunk;
    const highlighted = highlightChunkId !== undefined && chunk.id === highlightChunkId;
    const pending = chunk.text.length === 0;
    return (
      <View
        style={[
          styles.chunk,
          highlighted && theme.glass,
        ]}
      >
        <Text style={[typography.caption, styles.chunkTime, { color: theme.colors.textFaint }]}>
          {formatClock(chunk.startedAt)}
        </Text>
        <Text
          style={[
            typography.body,
            { color: pending ? theme.colors.textFaint : theme.colors.text },
          ]}
        >
          {pending ? 'Αναμονή μεταγραφής' : chunk.text}
        </Text>
        <ChunkStatusBadge status={chunk.processingStatus} />
        {chunk.insights && chunk.insights.length > 0 ? (
          <InsightList
            chunkId={chunk.id}
            items={chunk.insights}
            onChange={(items) =>
              setChunks((current) => current.map((c) => (c.id === chunk.id ? { ...c, insights: items } : c)))
            }
          />
        ) : null}
      </View>
    );
  };

  return (
    <Screen bottomInset={false}>
      <Header title="Χρονολόγιο" />

      <View style={[styles.dateBar, theme.glass]}>
        <IconButton
          name="chevron-left"
          label="Προηγούμενη μέρα"
          filled={false}
          onPress={() => setDayOffset(dayOffset + 1)}
        />
        <Pressable onPress={() => setDayOffset(0)} style={styles.dateTitle}>
          <Text style={[typography.label, styles.dateText, { color: theme.colors.text }]}>
            {formatDateHeader(-dayOffset)}
          </Text>
        </Pressable>
        <IconButton
          name="chevron-right"
          label="Επόμενη μέρα"
          filled={false}
          disabled={dayOffset <= 0}
          onPress={() => setDayOffset(Math.max(dayOffset - 1, 0))}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chipsRow}
      >
        <Chip
          label="Σήμερα"
          active={dayOffset === 0}
          onPress={() => setDayOffset(0)}
        />
        <Chip
          label="Χθες"
          active={dayOffset === 1}
          onPress={() => setDayOffset(1)}
        />
        {sessions.map((session) => (
          <Chip
            key={session.id}
            label={formatClock(session.startedAt)}
            active={selectedClientId === session.clientId || selectedClientId === session.id}
            onPress={() =>
              setSelectedClientId(
                selectedClientId === session.clientId || selectedClientId === session.id
                  ? null
                  : session.clientId,
              )
            }
          />
        ))}
        {selectedClientId !== null ? (
          <Chip label="Όλες" active={false} onPress={() => setSelectedClientId(null)} />
        ) : null}
      </ScrollView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.textMuted} />
        </View>
      ) : error !== null ? (
        <EmptyState
          icon="cloud-off"
          title="Δεν φορτώθηκε το χρονολόγιο"
          message={error}
          actionLabel="Δοκίμασε ξανά"
          onAction={() => void load()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="Τίποτα ακόμα"
          message={dayOffset === 0 ? 'Κατάγραψε κάτι και θα εμφανιστεί εδώ.' : 'Δεν υπάρχουν μνήμες για αυτή τη μέρα.'}
        />
      ) : (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void load()}
              tintColor={theme.colors.textMuted}
            />
          }
          onScrollToIndexFailed={({ index }) => {
            setTimeout(
              () =>
                listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.35 }),
              400,
            );
          }}
        />
      )}
    </Screen>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? theme.colors.primary : 'transparent',
          borderColor: active ? theme.colors.primary : theme.colors.border,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Text
        style={[
          typography.caption,
          styles.chipLabel,
          { color: active ? theme.colors.onPrimary : theme.colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const CHUNK_INSET = 12;

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xs,
    height: 48,
  },
  dateTitle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  dateText: {
    fontWeight: '600',
  },
  chipsScroll: {
    // A ScrollView shrinks by default, which let the list below squash the pills.
    flexGrow: 0,
    flexShrink: 0,
    height: 42,
    marginTop: 12,
    marginBottom: spacing.xs,
    marginHorizontal: -SCREEN_GUTTER,
  },
  chipsRow: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: SCREEN_GUTTER,
  },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 34,
    flexShrink: 0,
    justifyContent: 'center',
  },
  chipLabel: {
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sessionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chunk: {
    borderRadius: radius.md,
    paddingHorizontal: CHUNK_INSET,
    paddingVertical: 10,
    marginHorizontal: -CHUNK_INSET,
  },
  chunkTime: {
    fontVariant: ['tabular-nums'],
    marginBottom: 2,
  },
});
