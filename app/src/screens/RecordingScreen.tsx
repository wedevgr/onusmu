import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { recorder } from '../lib/recorder';
import { stopRemoteSession } from '../lib/sync';
import { useRecordingStore } from '../stores/recording';
import { useSyncStore, selectSyncStatus } from '../stores/sync';
import { useShallow } from 'zustand/react/shallow';
import { formatClock, formatDurationMs } from '../lib/time';
import { Icon, IconButton } from '../components/Icon';
import { RecordingDot } from '../components/RecordingDot';
import { Screen } from '../components/Screen';
import { radius, spacing, typography, useTheme } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Recording'>;

export default function RecordingScreen({ navigation }: Props): React.JSX.Element {
  const theme = useTheme();
  const recording = useRecordingStore();
  const syncStatus = useSyncStore(useShallow(selectSyncStatus));
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

  // The recorder stops itself when the plan's allowance runs out; leave the screen with it.
  const leaving = useRef(false);
  useEffect(() => {
    if (recording.active || leaving.current) return;
    leaving.current = true;
    navigation.goBack();
  }, [recording.active, navigation]);

  const stop = async (): Promise<void> => {
    leaving.current = true;
    setStopping(true);
    try {
      await recorder.stop();
      const { sessionLocalId } = useRecordingStore.getState();
      if (sessionLocalId) {
        stopRemoteSession(sessionLocalId, new Date().toISOString());
      }
      useRecordingStore.getState().markStopped();
      useRecordingStore.getState().reset();
      navigation.goBack();
    } finally {
      setStopping(false);
    }
  };

  const stats: { label: string; value: number; alert?: boolean }[] = [
    { label: 'Τμήματα', value: recording.chunkCount },
    { label: 'Σε αναμονή', value: syncStatus.pending },
    { label: 'Ανέβασμα', value: syncStatus.uploading ? 1 : 0 },
  ];
  if (syncStatus.failed > 0) {
    stats.push({ label: 'Απέτυχαν', value: syncStatus.failed, alert: true });
  }

  return (
    <Screen>
      <View style={styles.topBar}>
        <IconButton
          name="chevron-down"
          label="Απόκρυψη, η καταγραφή συνεχίζεται"
          onPress={() => navigation.goBack()}
        />
        <View style={[styles.live, theme.glass]}>
          <RecordingDot size={6} />
          <Text style={[typography.caption, styles.liveLabel, { color: theme.colors.text }]}>
            Μικρόφωνο ενεργό
          </Text>
        </View>
        <View style={styles.topSpacer} />
      </View>

      <View style={styles.center}>
        <Text
          style={[styles.timer, { color: theme.colors.text }]}
          adjustsFontSizeToFit
          numberOfLines={1}
        >
          {formatDurationMs(elapsedMs)}
        </Text>
        {recording.startedAt ? (
          <Text style={[typography.label, styles.started, { color: theme.colors.textMuted }]}>
            Ξεκίνησε στις {formatClock(recording.startedAt)}
          </Text>
        ) : null}

        <View style={[styles.stats, theme.glass]}>
          {stats.map((stat) => (
            <View key={stat.label} style={styles.stat}>
              <Text
                style={[
                  styles.statValue,
                  { color: stat.alert ? theme.colors.danger : theme.colors.text },
                ]}
              >
                {stat.value}
              </Text>
              <Text
                style={[
                  typography.caption,
                  { color: stat.alert ? theme.colors.danger : theme.colors.textMuted },
                ]}
              >
                {stat.label}
              </Text>
            </View>
          ))}
        </View>

        {recording.error ? (
          <Text style={[typography.label, styles.errorLine, { color: theme.colors.danger }]}>
            {recording.error}
          </Text>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Διακοπή καταγραφής"
          onPress={() => void stop()}
          disabled={stopping}
          style={({ pressed }) => [
            styles.stopButton,
            { backgroundColor: theme.colors.recording, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          {stopping ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View style={styles.stopSquare} />
          )}
        </Pressable>
        <Text style={[typography.heading, styles.stopLabel, { color: theme.colors.text }]}>
          {stopping ? 'Αποθήκευση' : 'Διακοπή και αποθήκευση'}
        </Text>
        <Text style={[typography.caption, styles.hint, { color: theme.colors.textMuted }]}>
          Η καταγραφή συνεχίζεται στο παρασκήνιο όσο χρησιμοποιείς άλλες εφαρμογές. Στο iOS, κράτα
          την εφαρμογή ανοιχτή για καλύτερα αποτελέσματα.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  topSpacer: {
    width: 40,
  },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingLeft: 6,
    paddingRight: 14,
    height: 34,
  },
  liveLabel: {
    fontWeight: '500',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timer: {
    fontSize: 64,
    lineHeight: 76,
    fontWeight: '700',
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  started: {
    fontWeight: '400',
  },
  stats: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.xl,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  statValue: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  errorLine: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  footer: {
    alignItems: 'center',
    paddingBottom: spacing.lg,
  },
  stopButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSquare: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
  },
  stopLabel: {
    marginTop: spacing.md,
  },
  hint: {
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 300,
  },
});
