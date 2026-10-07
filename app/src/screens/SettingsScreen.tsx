import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { api } from '../api/client';
import type { SessionSummary } from '../api/types';
import * as outbox from '../lib/outbox';
import { triggerSync } from '../lib/sync';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { useSyncStore, selectSyncStatus } from '../stores/sync';
import { supabase } from '../supabase';
import { formatClock, formatDayLabel, formatDurationSeconds } from '../lib/time';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';
import { spacing, typography, useTheme } from '../theme';

export default function SettingsScreen(): React.JSX.Element {
  const theme = useTheme();
  const user = useAuthStore((state) => state.user);
  const syncStatus = useSyncStore(selectSyncStatus);
  const keepAudio = useSettingsStore((state) => state.keepAudio);
  const setKeepAudio = useSettingsStore((state) => state.setKeepAudio);
  const setLoaded = useSettingsStore((state) => state.setLoaded);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const loadSessions = useCallback(() => {
    api
      .listSessions()
      .then((response) => {
        const sorted = [...response.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        setSessions(sorted);
        setSessionsError(null);
      })
      .catch((e: unknown) => {
        setSessionsError(e instanceof Error ? e.message : 'Could not load sessions.');
      });
  }, []);

  useEffect(() => {
    loadSessions();
    api
      .getSettings()
      .then((response) => {
        setKeepAudio(response.keepAudio);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [loadSessions, setKeepAudio, setLoaded]);

  const toggleKeepAudio = (value: boolean): void => {
    setKeepAudio(value);
    api.updateSettings(value).catch(() => {
      setKeepAudio(!value);
      Alert.alert('Could not save', 'The setting was not updated. Please try again.');
    });
  };

  const deleteSession = (session: SessionSummary): void => {
    Alert.alert(
      'Delete session?',
      `The session from ${formatDayLabel(session.startedAt)} ${formatClock(session.startedAt)} will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            api
              .deleteSession(session.id)
              .then(loadSessions)
              .catch((e: unknown) =>
                Alert.alert('Delete failed', e instanceof Error ? e.message : 'Please try again.'),
              );
          },
        },
      ],
    );
  };

  const deleteAllMemories = (): void => {
    Alert.alert(
      'Delete all memories?',
      'Every recorded session and transcription will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you absolutely sure?',
              'This cannot be undone. All of your memories will be gone forever.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete everything',
                  style: 'destructive',
                  onPress: () => {
                    void (async () => {
                      try {
                        const { sessions: all } = await api.listSessions();
                        await Promise.allSettled(all.map((session) => api.deleteSession(session.id)));
                        await outbox.clearAll();
                        useSyncStore.getState().hydrate([]);
                        triggerSync();
                        loadSessions();
                      } catch {
                        Alert.alert('Delete failed', 'Some memories may not have been deleted.');
                      }
                    })();
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  const deleteAccount = (): void => {
    Alert.alert(
      'Delete account?',
      'Your account and all data on the server will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete my account',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await api.deleteAccount();
              } catch (e) {
                Alert.alert('Delete failed', e instanceof Error ? e.message : 'Please try again.');
                return;
              }
              await supabase.auth.signOut();
            })();
          },
        },
      ],
    );
  };

  const logout = (): void => {
    void supabase.auth.signOut();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[typography.title, styles.title, { color: theme.colors.text }]}>Settings</Text>

        <Card>
          <Text style={[typography.label, styles.label, { color: theme.colors.textMuted }]}>
            Signed in as
          </Text>
          <Text style={[typography.body, { color: theme.colors.text }]}>{user?.email ?? '—'}</Text>
        </Card>

        <Card>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={[typography.body, { color: theme.colors.text }]}>
                Keep original audio
              </Text>
              <Text
                style={[typography.caption, styles.mutedLine, { color: theme.colors.textMuted }]}
              >
                Store the raw recordings alongside transcripts.
              </Text>
            </View>
            <Switch value={keepAudio} onValueChange={toggleKeepAudio} />
          </View>
        </Card>

        <Card>
          <Text style={[typography.label, styles.label, { color: theme.colors.textMuted }]}>
            Sync status
          </Text>
          <Text style={[typography.body, { color: theme.colors.text }]}>
            {syncStatus.pending} pending · {syncStatus.uploading ? 'uploading now' : 'idle'} ·{' '}
            {syncStatus.failed} failed
          </Text>
          {syncStatus.failed > 0 ? (
            <Text style={[typography.caption, styles.mutedLine, { color: theme.colors.danger }]}>
              Failed items keep their audio on this device and can be retried by the server later.
            </Text>
          ) : null}
        </Card>

        <Text style={[typography.heading, styles.section, { color: theme.colors.text }]}>
          Delete a recording session
        </Text>
        {sessionsError !== null ? (
          <EmptyState title="Could not load sessions" message={sessionsError} />
        ) : sessions.length === 0 ? (
          <EmptyState title="No sessions" message="Nothing has been recorded yet." />
        ) : (
          sessions.map((session) => (
            <Card key={session.id}>
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <Text style={[typography.label, { color: theme.colors.text }]}>
                    {formatDayLabel(session.startedAt)} {formatClock(session.startedAt)}
                  </Text>
                  <Text
                    style={[typography.caption, styles.mutedLine, { color: theme.colors.textMuted }]}
                  >
                    {formatDurationSeconds(session.durationSeconds)} · {session.chunkCount} chunk
                    {session.chunkCount === 1 ? '' : 's'}
                  </Text>
                </View>
                <Button title="Delete" variant="ghost" compact onPress={() => deleteSession(session)} />
              </View>
            </Card>
          ))
        )}

        <View style={styles.dangerZone}>
          <Button title="Delete all memories" variant="secondary" onPress={deleteAllMemories} />
          <Button title="Delete account" variant="secondary" onPress={deleteAccount} />
          <Button title="Log out" variant="danger" onPress={logout} />
        </View>

        <Card>
          <Text style={[typography.heading, styles.privacyTitle, { color: theme.colors.text }]}>
            Privacy
          </Text>
          <Text style={[typography.body, styles.privacyLine, { color: theme.colors.textMuted }]}>
            • Recordings start only when you press Start.
          </Text>
          <Text style={[typography.body, styles.privacyLine, { color: theme.colors.textMuted }]}>
            • Your microphone indicator shows whenever audio is being captured.
          </Text>
          <Text style={[typography.body, styles.privacyLine, { color: theme.colors.textMuted }]}>
            • Your data belongs to you and can be deleted at any time.
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xl,
  },
  title: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  label: {
    marginBottom: spacing.xs,
  },
  mutedLine: {
    marginTop: spacing.xs,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  flex: {
    flex: 1,
  },
  section: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  dangerZone: {
    marginTop: spacing.lg,
  },
  privacyTitle: {
    marginBottom: spacing.sm,
  },
  privacyLine: {
    marginBottom: spacing.xs,
  },
});
