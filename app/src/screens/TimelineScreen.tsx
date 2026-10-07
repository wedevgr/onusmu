import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { TabParamList, TimelineParams } from '../navigation/RootNavigator';
import { api } from '../api/client';
import type { Chunk, SessionSummary } from '../api/types';
import { dayBoundsIso, formatClock, formatDateHeader } from '../lib/time';
import { ChunkStatusBadge } from '../components/ChunkStatusBadge';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';
import { radius, spacing, typography, useTheme } from '../theme';

type Props = BottomTabScreenProps<TabParamList, 'Timeline'>;

type TimelineRow =
  | { kind: 'session'; key: string; session: SessionSummary }
  | { kind: 'chunk'; key: string; chunk: Chunk; session: SessionSummary | null };

export default function TimelineScreen({ navigation, route }: Props): React.JSX.Element {
  const theme = useTheme();
  const listRef = useRef<FlatList<TimelineRow>>(null);

  const [dayOffset, setDayOffset] = useState(route.params?.dayOffset ?? 0);
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
      setDayOffset(params.dayOffset);
    }
    if (params?.sessionId !== undefined) {
      setSelectedClientId(params.sessionId);
    }
  }, [route.params]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = dayBoundsIso(dayOffset);
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
      setError(e instanceof Error ? e.message : 'Could not load the timeline.');
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
      'Delete session?',
      `This removes the session from ${formatClock(session.startedAt)} and all of its memories. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            api
              .deleteSession(session.id)
              .then(() => {
                if (selectedClientId === session.clientId) setSelectedClientId(null);
                return load();
              })
              .catch((e: unknown) =>
                Alert.alert('Delete failed', e instanceof Error ? e.message : 'Please try again.'),
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
          <Text style={[typography.label, styles.sessionTitle, { color: theme.colors.textMuted }]}>
            Session · {formatClock(session.startedAt)}
          </Text>
          <Pressable onPress={() => deleteSession(session)} hitSlop={8}>
            <Text style={[typography.label, { color: theme.colors.danger }]}>Delete</Text>
          </Pressable>
        </View>
      );
    }
    const chunk = item.chunk;
    const highlighted = highlightChunkId !== undefined && chunk.id === highlightChunkId;
    return (
      <View
        style={[
          styles.chunkRow,
          {
            backgroundColor: highlighted ? theme.colors.surfaceMuted : theme.colors.surface,
            borderColor: highlighted ? theme.colors.primary : theme.colors.border,
          },
        ]}
      >
        <Text style={[typography.label, styles.chunkTime, { color: theme.colors.primary }]}>
          {formatClock(chunk.startedAt)}
        </Text>
        <Text style={[typography.body, { color: theme.colors.text }]}>
          {chunk.text.length > 0 ? chunk.text : 'Transcription pending…'}
        </Text>
        <ChunkStatusBadge status={chunk.processingStatus} />
      </View>
    );
  };

  return (
    <Screen>
      <View style={styles.dateBar}>
        <Pressable onPress={() => setDayOffset(dayOffset + 1)} hitSlop={8} style={styles.arrow}>
          <Text style={[typography.heading, { color: theme.colors.primary }]}>‹</Text>
        </Pressable>
        <Pressable onPress={() => setDayOffset(0)}>
          <Text style={[typography.heading, { color: theme.colors.text }]}>
            {formatDateHeader(dayOffset)}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setDayOffset(Math.max(dayOffset - 1, 0))}
          hitSlop={8}
          style={styles.arrow}
          disabled={dayOffset <= 0}
        >
          <Text
            style={[
              typography.heading,
              { color: dayOffset <= 0 ? theme.colors.border : theme.colors.primary },
            ]}
          >
            ›
          </Text>
        </Pressable>
      </View>

      <View style={styles.chipsRow}>
        <Chip
          label="Today"
          active={dayOffset === 0}
          onPress={() => setDayOffset(0)}
        />
        <Chip
          label="Yesterday"
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
          <Chip label="All sessions" active={false} onPress={() => setSelectedClientId(null)} />
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : error !== null ? (
        <EmptyState title="Could not load the timeline" message={`${error}\nPull down to retry.`} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          message={dayOffset === 0 ? 'Record something and it will appear here.' : 'No memories were recorded on this day.'}
        />
      ) : (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void load()}
              tintColor={theme.colors.primary}
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
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.colors.primary : theme.colors.surfaceMuted,
        },
      ]}
    >
      <Text
        style={[
          typography.label,
          { color: active ? theme.colors.onPrimary : theme.colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  arrow: {
    paddingHorizontal: spacing.md,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginVertical: spacing.md,
  },
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sessionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chunkRow: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  chunkTime: {
    marginBottom: spacing.xs,
  },
});
