import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../components/Button';
import { RecordingDot } from '../components/RecordingDot';
import { Screen } from '../components/Screen';
import { endRecording } from '../lib/recordingSession';
import { formatDurationMs } from '../lib/time';
import type { RootStackParamList } from '../navigation/types';
import { useRecordingStore } from '../stores/recording';
import { selectSyncStatus, useSyncStore } from '../stores/sync';
import { spacing, typography, useTheme } from '../theme';

export function RecordingScreen(): React.JSX.Element {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { active, startedAt, chunkCount, error } = useRecordingStore();
  const syncStatus = useSyncStore(selectSyncStatus);
  const [nowMs, setNowMs] = useState(Date.now());
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const startedAtMs = startedAt ? Date.parse(startedAt) : nowMs;
  const elapsed = formatDurationMs(Math.max(0, nowMs - startedAtMs));

  async function handleStop(): Promise<void> {
    setStopping(true);
    try {
      await endRecording();
      navigation.goBack();
    } finally {
      setStopping(false);
    }
  }

  return (
    <Screen style={styles.screen}>
      <View style={styles.center}>
        <RecordingDot />
        <Text style={[styles.timer, typography.title, { color: theme.colors.text }]}>{elapsed}</Text>
        <Text style={[typography.body, { color: theme.colors.textMuted }]}>
          {active ? 'Recording in progress' : 'Finishing…'}
        </Text>
      </View>

      <View style={styles.stats}>
        <Stat label="Chunks captured" value={String(chunkCount)} />
        <Stat label="Waiting to upload" value={String(syncStatus.pending)} />
        <Stat label="Failed" value={String(syncStatus.failed)} highlight={syncStatus.failed > 0} />
      </View>

      {error ? (
        <Text style={[typography.label, styles.error, { color: theme.colors.danger }]}>{error}</Text>
      ) : null}

      <Text style={[typography.caption, styles.note, { color: theme.colors.textMuted }]}>
        Recording continues while the app is in the background or your screen is locked. Nothing is
        recorded unless you start it yourself.
      </Text>

      <Button title="Stop Recording" variant="danger" onPress={() => void handleStop()} loading={stopping} />
    </Screen>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[typography.heading, { color: highlight ? theme.colors.danger : theme.colors.text }]}>{value}</Text>
      <Text style={[typography.caption, { color: theme.colors.textMuted, textAlign: 'center' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingBottom: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  timer: { fontSize: 56, fontVariant: ['tabular-nums'] },
  stats: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: spacing.lg },
  stat: { alignItems: 'center', gap: 2 },
  error: { textAlign: 'center', marginBottom: spacing.sm },
  note: { textAlign: 'center', marginBottom: spacing.lg, paddingHorizontal: spacing.sm },
});
