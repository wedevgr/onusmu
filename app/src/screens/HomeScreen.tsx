import React, { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  CompositeNavigationProp,
  useNavigation,
} from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '../api/client';
import type { SessionSummary } from '../api/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { beginRecording } from '../lib/recordingSession';
import {
  formatClock,
  formatDayLabel,
  formatDurationSeconds,
  startOfTodayIso,
} from '../lib/time';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';
import { useAuthStore } from '../stores/auth';
import { useRecordingStore } from '../stores/recording';
import { selectSyncStatus, useSyncStore } from '../stores/sync';
import { spacing, typography, useTheme } from '../theme';

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

function formatHM(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function HomeScreen(): React.JSX.Element {
  const theme = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const user = useAuthStore((s) => s.user);
  const { active, chunkCount } = useRecordingStore();
  const syncStatus = useSyncStore(selectSyncStatus);
  const [todaySeconds, setTodaySeconds] = useState(0);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [askText, setAskText] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const { sessions: todaySessions } = await api.listSessions({ from: startOfTodayIso() });
        const { sessions: recent } = await api.listSessions();
        if (cancelled) return;
        setTodaySeconds(
          todaySessions.reduce((sum, s) => sum + Math.max(0, s.durationSeconds ?? 0), 0),
        );
        setSessions(recent.slice(0, 5));
      } catch {
        // Backend unreachable: keep previous values.
      }
    }
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function handleStart(): Promise<void> {
    if (active) {
      navigation.navigate('Recording');
      return;
    }
    setStarting(true);
    try {
      await beginRecording();
      navigation.navigate('Recording');
    } catch (err) {
      Alert.alert('Could not start recording', err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  function handleAsk(): void {
    const text = askText.trim();
    if (!text) return;
    setAskText('');
    navigation.navigate('Chat', { initialMessage: text });
  }

  return (
    <Screen>
      <Text style={[typography.title, { color: theme.colors.text }]}>AI Memory</Text>
      <Text style={[typography.body, styles.subtitle, { color: theme.colors.textMuted }]}>
        {user?.email ?? ''}
      </Text>

      <Card style={styles.statusCard}>
        <Text style={[typography.label, { color: theme.colors.textMuted }]}>
          Recording: {active ? 'ON' : 'OFF'}
        </Text>
        {active ? (
          <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
            {chunkCount} chunks captured
          </Text>
        ) : null}
        <View style={styles.startWrap}>
          <Button
            title={active ? 'Return to recording' : 'Start Recording'}
            variant={active ? 'danger' : 'primary'}
            onPress={() => void handleStart()}
            loading={starting}
          />
        </View>
      </Card>

      <Text style={[typography.label, styles.section, { color: theme.colors.textMuted }]}>
        Today · {formatHM(todaySeconds)} recorded
      </Text>

      <TextInput
        style={[styles.ask, { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.surface }]}
        placeholder="Ask your memory..."
        placeholderTextColor={theme.colors.textMuted}
        value={askText}
        onChangeText={setAskText}
        onSubmitEditing={handleAsk}
        returnKeyType="send"
      />

      <Text style={[typography.label, styles.section, { color: theme.colors.textMuted }]}>
        Recent sessions
      </Text>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        style={styles.list}
        ListEmptyComponent={
          <Text style={[typography.body, { color: theme.colors.textMuted }]}>
            No recordings yet. Press Start Recording to capture your first memory.
          </Text>
        }
        renderItem={({ item }) => (
          <Card>
            <Text style={[typography.label, { color: theme.colors.text }]} onPress={() => navigation.navigate('Timeline', { sessionId: item.id })}>
              {formatDayLabel(item.startedAt)} · {formatClock(item.startedAt)}
            </Text>
            <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
              {formatDurationSeconds(item.durationSeconds ?? 0)} · {item.chunkCount} chunks
            </Text>
          </Card>
        )}
      />

      <Text style={[typography.caption, styles.syncLine, { color: theme.colors.textMuted }]}>
        {syncStatus.pending} waiting to upload · {syncStatus.failed} failed
        {syncStatus.uploading ? ' · uploading…' : ''}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs },
  statusCard: { marginTop: spacing.lg },
  startWrap: { marginTop: spacing.md },
  section: { marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.6 },
  ask: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
  },
  list: { flex: 1, marginTop: spacing.xs },
  syncLine: { textAlign: 'center', paddingVertical: spacing.sm },
});
