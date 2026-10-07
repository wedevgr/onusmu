import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { recorder } from '../lib/recorder';
import { stopRemoteSession } from '../lib/sync';
import { useRecordingStore } from '../stores/recording';
import { useSyncStore, selectSyncStatus } from '../stores/sync';
import { formatDurationMs } from '../lib/time';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { RecordingDot } from '../components/RecordingDot';
import { Screen } from '../components/Screen';
import { spacing, typography, useTheme } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Recording'>;

export default function RecordingScreen({ navigation }: Props): React.JSX.Element {
  const theme = useTheme();
  const recording = useRecordingStore();
  const syncStatus = useSyncStore(selectSyncStatus);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stopping, setStopping] = useState(false);

  const startedAtMs = recording.startedAt ? new Date(recording.startedAt).getTime() : null;

  useEffect(() => {
    if (startedAtMs === null) return;
    const tick = () => setElapsedMs(Date.now() - startedAtMs);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAtMs]);

  const stop = async (): Promise<void> => {
    setStopping(true);
    try {
      await recorder.stop();
      const { sessionLocalId } = useRecordingStore.getState();
      if (sessionLocalId) {
        stopRemoteSession(sessionLocalId, new Date().toISOString());
      }
      useRecordingStore.getState().reset();
      navigation.goBack();
    } finally {
      setStopping(false);
    }
  };

  return (
    <Screen>
      <View style={styles.center}>
        <View style={styles.indicatorRow}>
          <RecordingDot size={14} />
          <Text style={[typography.heading, { color: theme.colors.text }]}>
            Microphone active
          </Text>
        </View>

        <Text style={[styles.timer, { color: theme.colors.text }]}>
          {formatDurationMs(elapsedMs)}
        </Text>

        <Card style={styles.countsCard}>
          <Text style={[typography.body, { color: theme.colors.text }]}>
            {recording.chunkCount} chunk{recording.chunkCount === 1 ? '' : 's'} captured
          </Text>
          <Text style={[typography.body, styles.countLine, { color: theme.colors.textMuted }]}>
            {syncStatus.pending} waiting to upload · {syncStatus.uploading ? 1 : 0} uploading
            {syncStatus.failed > 0 ? ` · ${syncStatus.failed} failed` : ''}
          </Text>
          {recording.error ? (
            <Text style={[typography.label, styles.errorLine, { color: theme.colors.danger }]}>
              {recording.error}
            </Text>
          ) : null}
        </Card>

        <Text
          style={[typography.body, styles.hint, { color: theme.colors.textMuted }]}
        >
          Recording continues in the background while you use other apps. On iOS this uses the
          audio background mode; keep the app open for best results.
        </Text>

        <View style={styles.stopWrap}>
          <Button
            title="Stop"
            variant="danger"
            onPress={() => void stop()}
            loading={stopping}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  timer: {
    fontSize: 56,
    fontWeight: '700',
    marginTop: spacing.md,
    fontVariant: ['tabular-nums'],
  },
  countsCard: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  countLine: {
    marginTop: spacing.xs,
  },
  errorLine: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  hint: {
    textAlign: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  stopWrap: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
  },
});
