import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { api } from '../api/client';
import type { SessionSummary } from '../api/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { clearAll } from '../lib/outbox';
import { hydrateOutbox, processOutbox } from '../lib/sync';
import { formatClock, formatDayLabel, formatDurationSeconds } from '../lib/time';
import { supabase } from '../supabase';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { selectSyncStatus, useSyncStore } from '../stores/sync';
import { spacing, typography, useTheme } from '../theme';

export function SettingsScreen(): React.JSX.Element {
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const { keepAudio, loaded, setKeepAudio, setLoaded } = useSettingsStore();
  const syncStatus = useSyncStore(selectSyncStatus);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const loadSessions = useCallback(async (): Promise<void> => {
    try {
      const { sessions: list } = await api.listSessions();
      setSessions(list);
    } catch {
      // Backend unreachable.
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    if (!loaded) {
      api
        .getSettings()
        .then((res) => {
          setKeepAudio(res.keepAudio);
          setLoaded(true);
        })
        .catch(() => setLoaded(true));
    }
  }, [loaded, setKeepAudio, setLoaded, loadSessions]);

  async function toggleKeepAudio(value: boolean): Promise<void> {
    setKeepAudio(value);
    try {
      await api.updateSettings(value);
    } catch (err) {
      setKeepAudio(!value);
      Alert.alert('Could not save setting', err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteSession(session: SessionSummary): Promise<void> {
    try {
      await api.deleteSession(session.id);
      await loadSessions();
    } catch (err) {
      Alert.alert('Delete failed', err instanceof Error ? err.message : String(err));
    }
  }

  function confirmDeleteSession(session: SessionSummary): void {
    Alert.alert('Delete session?', 'This recording session and its transcripts will be permanently deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteSession(session) },
    ]);
  }

  function confirmDeleteAll(): void {
    Alert.alert('Delete all memories?', 'Every transcript chunk and recording session will be permanently deleted. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete everything',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void (async () => {
            try {
              for (const session of sessions) {
                await api.deleteSession(session.id);
              }
              await clearAll();
              await hydrateOutbox();
              await loadSessions();
              Alert.alert('Done', 'All memories were deleted.');
            } catch (err) {
              Alert.alert('Delete failed', err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }

  function confirmDeleteAccount(): void {
    Alert.alert('Delete account?', 'Your account, all transcripts and all stored audio will be permanently deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete my account',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void (async () => {
            try {
              await api.deleteAccount();
              await clearAll();
              await supabase.auth.signOut();
            } catch (err) {
              Alert.alert('Deletion failed', err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[typography.title, { color: theme.colors.text }]}>Settings</Text>
        <Text style={[typography.body, styles.subtitle, { color: theme.colors.textMuted }]}>
          {user?.email ?? ''}
        </Text>

        <Card>
          <Text style={[typography.heading, { color: theme.colors.text }]}>Storage</Text>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={[typography.label, { color: theme.colors.text }]}>Keep original audio</Text>
              <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
                Off: audio is deleted after transcription. Only text, timestamps and embeddings stay.
              </Text>
            </View>
            <Switch value={keepAudio} onValueChange={(v) => void toggleKeepAudio(v)} trackColor={{ true: theme.colors.primary }} />
          </View>
        </Card>

        <Card>
          <Text style={[typography.heading, { color: theme.colors.text }]}>Sync</Text>
          <Text style={[typography.body, { color: theme.colors.textMuted }]}>
            {syncStatus.pending} chunks waiting to upload · {syncStatus.failed} failed
            {syncStatus.uploading ? ' · uploading now' : ''}
          </Text>
          <View style={styles.retryWrap}>
            <Button
              title="Retry now"
              variant="ghost"
              onPress={() => {
                void processOutbox().then(() => hydrateOutbox());
              }}
            />
          </View>
        </Card>

        <Card>
          <Text style={[typography.heading, styles.cardTitle, { color: theme.colors.text }]}>Recording sessions</Text>
          {sessions.length === 0 ? (
            <Text style={[typography.body, { color: theme.colors.textMuted }]}>No sessions yet.</Text>
          ) : (
            sessions.slice(0, 20).map((session) => (
              <View key={session.id} style={styles.sessionRow}>
                <View style={styles.sessionText}>
                  <Text style={[typography.label, { color: theme.colors.text }]}>
                    {formatDayLabel(session.startedAt)} · {formatClock(session.startedAt)}
                  </Text>
                  <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
                    {formatDurationSeconds(session.durationSeconds ?? 0)} · {session.chunkCount} chunks
                  </Text>
                </View>
                <Text style={[typography.label, { color: theme.colors.danger }]} onPress={() => confirmDeleteSession(session)}>
                  Delete
                </Text>
              </View>
            ))
          )}
          <View style={styles.deleteAllWrap}>
            <Button title="Delete all memories" variant="danger" onPress={confirmDeleteAll} loading={busy} />
          </View>
        </Card>

        <Card>
          <Text style={[typography.heading, styles.cardTitle, { color: theme.colors.text }]}>Privacy</Text>
          <Text style={[typography.body, { color: theme.colors.textMuted }]}>
            Recording only starts when you press Start, and the recording screen always shows a clear indicator.
            Your transcripts are private to your account and never shared between users. You can permanently delete
            any chunk, session, or your entire account at any time.
          </Text>
        </Card>

        <View style={styles.actions}>
          <Button title="Log out" variant="ghost" onPress={() => void supabase.auth.signOut()} />
          <View style={styles.spacer} />
          <Button title="Delete account" variant="danger" onPress={confirmDeleteAccount} loading={busy} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xl },
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  cardTitle: { marginBottom: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  switchText: { flex: 1, gap: 4 },
  retryWrap: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  sessionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  sessionText: { flex: 1, gap: 2 },
  deleteAllWrap: { marginTop: spacing.md },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
  spacer: { height: spacing.xs },
});
