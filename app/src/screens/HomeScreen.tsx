import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import * as Crypto from 'expo-crypto';
import type { RootStackParamList, TabParamList } from '../navigation/RootNavigator';
import { api } from '../api/client';
import type { SessionSummary } from '../api/types';
import { recorder } from '../lib/recorder';
import * as outbox from '../lib/outbox';
import { triggerSync } from '../lib/sync';
import { useAuthStore } from '../stores/auth';
import { useRecordingStore } from '../stores/recording';
import { useSyncStore, selectSyncStatus } from '../stores/sync';
import { formatClock, formatDayLabel, formatDurationSeconds, startOfTodayIso } from '../lib/time';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { RecordingDot } from '../components/RecordingDot';
import { Screen } from '../components/Screen';
import { radius, spacing, typography, useTheme } from '../theme';

type Props = BottomTabScreenProps<TabParamList, 'Home'>;

function dayOffsetFor(iso: string): number {
  const sessionDay = new Date(iso);
  sessionDay.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - sessionDay.getTime()) / 86400000);
}

export default function HomeScreen({ navigation }: Props): React.JSX.Element {
  const theme = useTheme();
  const rootNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const user = useAuthStore((state) => state.user);
  const recording = useRecordingStore();
  const syncStatus = useSyncStore(selectSyncStatus);

  const [starting, setStarting] = useState(false);
  const [question, setQuestion] = useState('');
  const [todaySeconds, setTodaySeconds] = useState<number | null>(null);
  const [recent, setRecent] = useState<SessionSummary[]>([]);
  const [recentError, setRecentError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listSessions({ from: startOfTodayIso() })
      .then((response) => {
        const total = response.sessions.reduce((sum, session) => sum + session.durationSeconds, 0);
        setTodaySeconds(total);
      })
      .catch(() => setTodaySeconds(null));
    api
      .listSessions()
      .then((response) => {
        const sorted = [...response.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        setRecent(sorted.slice(0, 5));
        setRecentError(null);
      })
      .catch((e: unknown) => {
        setRecent([]);
        setRecentError(e instanceof Error ? e.message : 'Could not load sessions.');
      });
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [load, navigation]);

  const startRecording = async (): Promise<void> => {
    setStarting(true);
    const sessionLocalId = Crypto.randomUUID();
    const startedAt = new Date().toISOString();
    try {
      await recorder.start(
        (chunk) => {
          useRecordingStore.getState().incrementChunkCount();
          outbox
            .enqueue({
              sessionLocalId,
              chunkIndex: chunk.index,
              uri: chunk.uri,
              startedAt: chunk.startedAt,
              endedAt: chunk.endedAt,
            })
            .then(() => triggerSync())
            .catch(() => {
              useRecordingStore.getState().setError('A recorded chunk could not be saved.');
            });
        },
        (message) => useRecordingStore.getState().setError(message),
      );
      useRecordingStore.getState().begin(sessionLocalId, startedAt);
      rootNav.navigate('Recording');
    } catch (e) {
      useRecordingStore.getState().reset();
      Alert.alert('Recording failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setStarting(false);
    }
  };

  const handlePrimary = (): void => {
    if (recording.active) {
      rootNav.navigate('Recording');
    } else {
      void startRecording();
    }
  };

  const ask = (): void => {
    const trimmed = question.trim();
    if (trimmed.length === 0) return;
    setQuestion('');
    navigation.navigate('Chat', { initialMessage: trimmed });
  };

  return (
    <Screen>
      <Text style={[typography.title, { color: theme.colors.text }]}>AI Memory</Text>
      <Text style={[typography.body, styles.subtitle, { color: theme.colors.textMuted }]}>
        {user?.email ?? ''}
      </Text>

      <Card style={styles.statusCard}>
        <View style={styles.statusRow}>
          {recording.active ? <RecordingDot size={10} /> : null}
          <Text style={[typography.heading, { color: theme.colors.text }]}>
            Recording: {recording.active ? 'ON' : 'OFF'}
          </Text>
        </View>
        {recording.active ? (
          <Text style={[typography.body, styles.muted, { color: theme.colors.textMuted }]}>
            {recording.chunkCount} chunk{recording.chunkCount === 1 ? '' : 's'} captured ·{' '}
            {syncStatus.pending} waiting · {syncStatus.uploading ? 1 : 0} uploading
          </Text>
        ) : null}
        <Text style={[typography.body, styles.muted, { color: theme.colors.textMuted }]}>
          Today: {todaySeconds === null ? '—' : formatDurationSeconds(todaySeconds)} recorded
        </Text>
        {recording.error ? (
          <Text style={[typography.label, { color: theme.colors.danger }]}>{recording.error}</Text>
        ) : null}
      </Card>

      <Button
        title={recording.active ? 'Stop recording' : 'Start recording'}
        variant={recording.active ? 'danger' : 'primary'}
        onPress={handlePrimary}
        loading={starting}
      />

      <Card>
        <TextInput
          style={[styles.askInput, { borderColor: theme.colors.border, color: theme.colors.text }]}
          placeholder="Ask your memory…"
          placeholderTextColor={theme.colors.textMuted}
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={ask}
          returnKeyType="send"
        />
        <Button title="Ask" variant="secondary" compact onPress={ask} disabled={question.trim().length === 0} />
      </Card>

      <Text style={[typography.heading, styles.sectionTitle, { color: theme.colors.text }]}>
        Recent sessions
      </Text>
      {recentError ? (
        <EmptyState title="Could not load sessions" message={recentError} />
      ) : (
        <FlatList
          data={recent}
          keyExtractor={(item) => item.id}
          style={styles.list}
          ListEmptyComponent={
            <EmptyState
              title="No sessions yet"
              message="Tap Start recording to capture your first memory."
            />
          }
          renderItem={({ item }) => (
            <Card>
              <View style={styles.sessionRow}>
                <View style={styles.flex}>
                  <Text style={[typography.label, { color: theme.colors.text }]}>
                    {formatDayLabel(item.startedAt)} {formatClock(item.startedAt)}
                  </Text>
                  <Text style={[typography.body, styles.muted, { color: theme.colors.textMuted }]}>
                    {formatDurationSeconds(item.durationSeconds)} · {item.chunkCount} chunk
                    {item.chunkCount === 1 ? '' : 's'}
                  </Text>
                </View>
                <Button
                  title="View"
                  variant="ghost"
                  compact
                  onPress={() =>
                    rootNav.navigate('Main', {
                      screen: 'Timeline',
                      params: { dayOffset: dayOffsetFor(item.startedAt), sessionId: item.clientId },
                    })
                  }
                />
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    marginBottom: spacing.md,
  },
  statusCard: {
    marginTop: spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  muted: {
    marginTop: spacing.xs,
  },
  askInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.sm,
    fontSize: 16,
  },
  sectionTitle: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  list: {
    flex: 1,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
  },
});
