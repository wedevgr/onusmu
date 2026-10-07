import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { api } from '../api/client';
import type { Chunk, SessionSummary } from '../api/types';
import { Card } from '../components/Card';
import { ChunkStatusBadge } from '../components/ChunkStatusBadge';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';
import { dayBoundsIso, formatClock, formatDateHeader, formatDurationSeconds } from '../lib/time';
import type { MainTabParamList } from '../navigation/types';
import { spacing, typography, useTheme } from '../theme';

type TimelineRouteProp = RouteProp<MainTabParamList, 'Timeline'>;

export function TimelineScreen(): React.JSX.Element {
  const theme = useTheme();
  const route = useRoute<TimelineRouteProp>();
  const [offsetDays, setOffsetDays] = useState(0);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<FlatList<Chunk>>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const { from, to } = dayBoundsIso(offsetDays);
      const [sessionRes, chunkRes] = await Promise.all([
        api.listSessions({ from, to }),
        api.listChunks({
          from,
          to,
          sessionId: selectedSessionId ?? undefined,
          limit: 500,
        }),
      ]);
      setSessions(sessionRes.sessions);
      setChunks([...chunkRes.chunks].reverse());
    } catch {
      // Keep previous content on error.
    } finally {
      setLoading(false);
    }
  }, [offsetDays, selectedSessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Incoming deep links from chat citations / search / home. The ref guards
  // against re-applying the same params on re-renders.
  const handledParamKey = useRef<string | null>(null);
  useEffect(() => {
    const params = route.params;
    const key = params?.highlightChunkId ?? params?.sessionId ?? null;
    if (key && handledParamKey.current !== key) {
      handledParamKey.current = key;
      setOffsetDays(0);
      setSelectedSessionId(params?.sessionId ?? null);
      setHighlightId(params?.highlightChunkId ?? null);
    }
  }, [route.params]);

  // Scroll to the highlighted chunk once data is loaded.
  useEffect(() => {
    if (!highlightId || chunks.length === 0) return;
    const index = chunks.findIndex((c) => c.id === highlightId);
    if (index >= 0) {
      const target = chunks[index];
      if (target) setSelectedSessionId((prev) => prev ?? target.sessionId);
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index, viewPosition: 0.4, animated: true });
      }, 350);
    }
  }, [highlightId, chunks]);

  function confirmDeleteSession(session: SessionSummary): void {
    Alert.alert('Delete session?', 'The session and all its transcript chunks will be permanently deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void api
            .deleteSession(session.id)
            .then(() => {
              if (selectedSessionId === session.id) setSelectedSessionId(null);
              return load();
            })
            .catch((err: unknown) => Alert.alert('Delete failed', err instanceof Error ? err.message : String(err)));
        },
      },
    ]);
  }

  function confirmDeleteChunk(chunk: Chunk): void {
    Alert.alert('Delete this memory?', 'This transcript chunk will be permanently deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void api
            .deleteChunk(chunk.id)
            .then(() => load())
            .catch((err: unknown) => Alert.alert('Delete failed', err instanceof Error ? err.message : String(err)));
        },
      },
    ]);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={[typography.heading, { color: theme.colors.text }]} onPress={() => setOffsetDays((d) => d + 1)}>
          ‹
        </Text>
        <View style={styles.headerCenter}>
          <Text style={[typography.heading, { color: theme.colors.text }]}>{formatDateHeader(offsetDays)}</Text>
          {offsetDays !== 0 ? (
            <Text style={[typography.caption, { color: theme.colors.primary }]} onPress={() => setOffsetDays(0)}>
              Jump to today
            </Text>
          ) : null}
        </View>
        <Text
          style={[typography.heading, { color: theme.colors.text, opacity: offsetDays === 0 ? 0.3 : 1 }]}
          onPress={() => offsetDays < 0 && setOffsetDays((d) => d - 1)}
        >
          ›
        </Text>
      </View>

      <View style={styles.chips}>
        <Chip label="All" active={selectedSessionId === null} onPress={() => setSelectedSessionId(null)} />
        {sessions.map((session) => (
          <Chip
            key={session.id}
            label={`${formatClock(session.startedAt)} · ${formatDurationSeconds(session.durationSeconds ?? 0)}`}
            active={selectedSessionId === session.id}
            onPress={() => setSelectedSessionId((prev) => (prev === session.id ? null : session.id))}
            onLongPress={() => confirmDeleteSession(session)}
          />
        ))}
      </View>

      <FlatList
        ref={listRef}
        data={chunks}
        keyExtractor={(item) => item.id}
        style={styles.list}
        onScrollToIndexFailed={({ index }) => {
          setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.4 }), 300);
        }}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              title="No memories this day"
              message={offsetDays === 0 ? 'Record something and it will appear here within a minute.' : undefined}
            />
          )
        }
        renderItem={({ item }) => {
          const highlighted = item.id === highlightId;
          return (
            <Card
              style={highlighted ? { borderColor: theme.colors.primary, borderWidth: 1.5 } : undefined}
            >
              <Text style={[typography.label, { color: theme.colors.primary }]}>{formatClock(item.startedAt)}</Text>
              <Text style={[typography.body, { color: theme.colors.text }]} onLongPress={() => confirmDeleteChunk(item)}>
                {item.text.length > 0 ? item.text : '—'}
              </Text>
              <ChunkStatusBadge status={item.processingStatus} />
            </Card>
          );
        }}
      />
    </Screen>
  );
}

function Chip({
  label,
  active,
  onPress,
  onLongPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Text
      style={[
        styles.chip,
        typography.label,
        {
          color: active ? theme.colors.onPrimary : theme.colors.text,
          backgroundColor: active ? theme.colors.primary : theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  headerCenter: { alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  list: { flex: 1 },
});
