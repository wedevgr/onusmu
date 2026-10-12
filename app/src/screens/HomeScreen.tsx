import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import * as Crypto from 'expo-crypto';
import type { RootStackParamList, TabParamList } from '../navigation/RootNavigator';
import { api } from '../api/client';
import type { SessionSummary } from '../api/types';
import { recorder } from '../lib/recorder';
import * as outbox from '../lib/outbox';
import { stopRemoteSession, triggerSync } from '../lib/sync';
import {
  limitReachedMessage,
  remainingLine,
  remainingRecordingMs,
  useBillingStore,
} from '../stores/billing';
import { useRecordingStore } from '../stores/recording';
import { useSyncStore, selectSyncStatus } from '../stores/sync';
import {
  formatClock,
  formatDayLabel,
  formatDurationHuman,
  formatDurationMs,
  formatLongDate,
  greetingFor,
  startOfTodayIso,
} from '../lib/time';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { ListGroup, ListRow } from '../components/List';
import { RecordingDot } from '../components/RecordingDot';
import { Screen, SCREEN_GUTTER } from '../components/Screen';
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
  const recording = useRecordingStore();
  const syncStatus = useSyncStore(useShallow(selectSyncStatus));
  const billing = useBillingStore((state) => state.status);

  const [starting, setStarting] = useState(false);
  const [question, setQuestion] = useState('');
  const [todaySeconds, setTodaySeconds] = useState<number | null>(null);
  const [recent, setRecent] = useState<SessionSummary[]>([]);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const startedAtMs = recording.startedAt ? new Date(recording.startedAt).getTime() : null;

  useEffect(() => {
    if (!recording.active || startedAtMs === null) return;
    const tick = () => setElapsedMs(Date.now() - startedAtMs);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [recording.active, startedAtMs]);

  const load = useCallback(() => {
    void useBillingStore.getState().refresh();
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
        setRecentError(e instanceof Error ? e.message : 'Δεν φορτώθηκαν οι καταγραφές.');
      });
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [load, navigation]);

  // After a recording stops, the server session appears only once chunks finish
  // uploading — retry a few times so it shows up fast.
  const lastStoppedAt = useRecordingStore((state) => state.lastStoppedAt);
  useEffect(() => {
    if (!lastStoppedAt) return;
    const timers = [1500, 4000, 8000].map((ms) => setTimeout(load, ms));
    return () => timers.forEach(clearTimeout);
  }, [lastStoppedAt, load]);

  const startRecording = async (): Promise<void> => {
    setStarting(true);
    const sessionLocalId = Crypto.randomUUID();
    try {
      const status = await useBillingStore.getState().refresh();
      const remainingMs = await remainingRecordingMs(status);
      if (status && remainingMs !== null && remainingMs <= 0) {
        Alert.alert('Όριο καταγραφής', limitReachedMessage(status));
        return;
      }
      const startedAt = new Date().toISOString();
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
              useRecordingStore.getState().setError('Ένα τμήμα της καταγραφής δεν αποθηκεύτηκε.');
            });
        },
        (message) => useRecordingStore.getState().setError(message),
        status && remainingMs !== null
          ? {
              maxMs: remainingMs,
              onLimit: () => {
                void stopRemoteSession(sessionLocalId, new Date().toISOString());
                useRecordingStore.getState().markStopped();
                useRecordingStore.getState().reset();
                Alert.alert('Όριο καταγραφής', `${limitReachedMessage(status)} Η καταγραφή σταμάτησε και αποθηκεύτηκε.`);
              },
            }
          : undefined,
      );
      useRecordingStore.getState().begin(sessionLocalId, startedAt);
      rootNav.navigate('Recording');
    } catch (e) {
      useRecordingStore.getState().reset();
      Alert.alert('Η καταγραφή απέτυχε', e instanceof Error ? e.message : 'Δοκίμασε ξανά.');
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

  const canAsk = question.trim().length > 0;
  const syncing = syncStatus.pending + (syncStatus.uploading ? 1 : 0);

  const todayLine =
    todaySeconds === null
      ? 'Οι μνήμες σου μένουν ιδιωτικές'
      : todaySeconds === 0
        ? 'Καμία καταγραφή σήμερα'
        : `${formatDurationHuman(todaySeconds)} καταγραφής σήμερα`;

  return (
    <Screen padded={false} bottomInset={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[typography.label, { color: theme.colors.textMuted }]}>{formatLongDate()}</Text>
        <Text style={[typography.display, styles.greeting, { color: theme.colors.text }]}>
          {greetingFor()}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={recording.active ? 'Άνοιγμα καταγραφής' : 'Έναρξη καταγραφής'}
          onPress={handlePrimary}
          disabled={starting}
          style={({ pressed }) => [
            styles.recorder,
            theme.glass,
            { opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <View
            style={[
              styles.micButton,
              {
                backgroundColor: recording.active ? theme.colors.recording : theme.colors.primary,
              },
            ]}
          >
            {starting ? (
              <ActivityIndicator color={theme.colors.onPrimary} />
            ) : (
              <Icon
                name="mic"
                size={36}
                color={recording.active ? '#FFFFFF' : theme.colors.onPrimary}
              />
            )}
          </View>

          {recording.active ? (
            <>
              <Text style={[styles.timer, { color: theme.colors.text }]}>
                {formatDurationMs(elapsedMs)}
              </Text>
              <View style={styles.liveRow}>
                <RecordingDot size={6} />
                <Text style={[typography.label, { color: theme.colors.recording }]}>
                  Γίνεται καταγραφή
                </Text>
              </View>
              <Text style={[typography.caption, styles.recorderNote, { color: theme.colors.textMuted }]}>
                {recording.chunkCount} τμήματα, {syncing} σε συγχρονισμό. Πάτα για άνοιγμα.
              </Text>
            </>
          ) : (
            <>
              <Text style={[typography.heading, styles.recorderTitle, { color: theme.colors.text }]}>
                {starting ? 'Εκκίνηση' : 'Πάτα για καταγραφή'}
              </Text>
              <Text style={[typography.caption, styles.recorderNote, { color: theme.colors.textMuted }]}>
                {todayLine}
              </Text>
              {billing && remainingLine(billing) ? (
                <Text style={[typography.caption, styles.recorderNote, { color: theme.colors.textMuted }]}>
                  {remainingLine(billing)}
                </Text>
              ) : null}
            </>
          )}
        </Pressable>
        {recording.error ? (
          <Text style={[typography.caption, styles.errorLine, { color: theme.colors.danger }]}>
            {recording.error}
          </Text>
        ) : null}

        <View style={[styles.askField, theme.glass]}>
          <TextInput
            style={[styles.askInput, { color: theme.colors.text }]}
            placeholder="Ρώτα τη μνήμη σου"
            placeholderTextColor={theme.colors.textFaint}
            value={question}
            onChangeText={setQuestion}
            onSubmitEditing={ask}
            returnKeyType="send"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ερώτηση"
            onPress={ask}
            disabled={!canAsk}
            hitSlop={8}
            style={({ pressed }) => [
              styles.askSend,
              {
                backgroundColor: canAsk ? theme.colors.primary : theme.colors.surfaceMuted,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Icon
              name="arrow-up"
              size={20}
              color={canAsk ? theme.colors.onPrimary : theme.colors.textFaint}
            />
          </Pressable>
        </View>

        <Text style={[typography.heading, styles.sectionLabel, { color: theme.colors.text }]}>
          Πρόσφατες καταγραφές
        </Text>
        {recentError ? (
          <EmptyState
            icon="cloud-off"
            title="Δεν φορτώθηκαν οι καταγραφές"
            message={recentError}
            actionLabel="Δοκίμασε ξανά"
            onAction={load}
          />
        ) : recent.length === 0 ? (
          <EmptyState
            icon="mic"
            title="Καμία καταγραφή ακόμα"
            message="Πάτα το μικρόφωνο για να καταγράψεις την πρώτη σου μνήμη."
          />
        ) : (
          <ListGroup>
            {recent.map((item, index) => (
              <ListRow
                key={item.id}
                first={index === 0}
                icon="mic"
                title={`${formatDayLabel(item.startedAt)} στις ${formatClock(item.startedAt)}`}
                subtitle={`${formatDurationHuman(item.durationSeconds)}, ${item.chunkCount} ${
                  item.chunkCount === 1 ? 'τμήμα' : 'τμήματα'
                }`}
                chevron
                onPress={() =>
                  rootNav.navigate('Main', {
                    screen: 'Timeline',
                    params: { dayOffset: dayOffsetFor(item.startedAt), sessionId: item.clientId },
                  })
                }
              />
            ))}
          </ListGroup>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SCREEN_GUTTER,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  greeting: {
    marginTop: 2,
    marginBottom: spacing.lg,
  },
  recorder: {
    alignItems: 'center',
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  micButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recorderTitle: {
    marginTop: spacing.md,
  },
  recorderNote: {
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  timer: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
    marginTop: spacing.md,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  errorLine: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  askField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingLeft: 20,
    paddingRight: spacing.sm,
    minHeight: 54,
    marginTop: 12,
  },
  askInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
  },
  askSend: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: 12,
  },
});
