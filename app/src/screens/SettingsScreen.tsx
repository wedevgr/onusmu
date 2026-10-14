import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { api } from '../api/client';
import type { SessionSummary } from '../api/types';
import { ensureNotificationPermission } from '../lib/notifications';
import * as outbox from '../lib/outbox';
import { triggerSync } from '../lib/sync';
import { useAuthStore } from '../stores/auth';
import { PLAN_NAMES, usageLine, useBillingStore } from '../stores/billing';
import { useSettingsStore } from '../stores/settings';
import { useSyncStore, selectSyncStatus } from '../stores/sync';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../supabase';
import { formatClock, formatDayLabel, formatDurationHuman } from '../lib/time';
import { Header } from '../components/Header';
import { Icon, IconButton } from '../components/Icon';
import { ListGroup, ListRow } from '../components/List';
import { Screen, SCREEN_GUTTER } from '../components/Screen';
import { spacing, typography, useTheme } from '../theme';

export default function SettingsScreen(): React.JSX.Element {
  const theme = useTheme();
  const user = useAuthStore((state) => state.user);
  const syncStatus = useSyncStore(useShallow(selectSyncStatus));
  const keepAudio = useSettingsStore((state) => state.keepAudio);
  const setKeepAudio = useSettingsStore((state) => state.setKeepAudio);
  const autoReminders = useSettingsStore((state) => state.autoReminders);
  const setAutoReminders = useSettingsStore((state) => state.setAutoReminders);
  const setLoaded = useSettingsStore((state) => state.setLoaded);
  const billing = useBillingStore((state) => state.status);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadSessions = useCallback(() => {
    api
      .listSessions()
      .then((response) => {
        const sorted = [...response.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        setSessions(sorted);
        setSessionsError(null);
      })
      .catch((e: unknown) => {
        setSessionsError(e instanceof Error ? e.message : 'Δεν φορτώθηκαν οι καταγραφές.');
      });
  }, []);

  useEffect(() => {
    loadSessions();
    void useBillingStore.getState().refresh();
    api
      .getSettings()
      .then((response) => {
        setKeepAudio(response.keepAudio);
        setAutoReminders(response.autoReminders);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [loadSessions, setKeepAudio, setAutoReminders, setLoaded]);

  const toggleKeepAudio = (value: boolean): void => {
    setKeepAudio(value);
    api.updateSettings({ keepAudio: value }).catch(() => {
      setKeepAudio(!value);
      Alert.alert('Δεν αποθηκεύτηκε', 'Η ρύθμιση δεν ενημερώθηκε. Δοκίμασε ξανά.');
    });
  };

  const toggleAutoReminders = (value: boolean): void => {
    setAutoReminders(value);
    // Reminders will now arrive without a tap from the user, so ask for notifications up front.
    if (value) void ensureNotificationPermission().catch(() => false);
    api.updateSettings({ autoReminders: value }).catch(() => {
      setAutoReminders(!value);
      Alert.alert('Δεν αποθηκεύτηκε', 'Η ρύθμιση δεν ενημερώθηκε. Δοκίμασε ξανά.');
    });
  };

  const deleteSession = (session: SessionSummary): void => {
    Alert.alert(
      'Διαγραφή καταγραφής;',
      `Η καταγραφή ${formatDayLabel(session.startedAt)} ${formatClock(session.startedAt)} θα διαγραφεί οριστικά.`,
      [
        { text: 'Άκυρο', style: 'cancel' },
        {
          text: 'Διαγραφή',
          style: 'destructive',
          onPress: () => {
            api
              .deleteSession(session.id)
              .then(loadSessions)
              .catch((e: unknown) =>
                Alert.alert('Η διαγραφή απέτυχε', e instanceof Error ? e.message : 'Δοκίμασε ξανά.'),
              );
          },
        },
      ],
    );
  };

  const deleteAllMemories = (): void => {
    Alert.alert(
      'Διαγραφή όλων των μνημών;',
      'Όλες οι καταγραφές και οι μεταγραφές θα διαγραφούν οριστικά.',
      [
        { text: 'Άκυρο', style: 'cancel' },
        {
          text: 'Συνέχεια',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Είσαι απολύτως σίγουρος;',
              'Δεν υπάρχει αναίρεση. Όλες οι μνήμες σου θα χαθούν για πάντα.',
              [
                { text: 'Άκυρο', style: 'cancel' },
                {
                  text: 'Διαγραφή όλων',
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
                        Alert.alert('Η διαγραφή απέτυχε', 'Κάποιες μνήμες ίσως δεν διαγράφηκαν.');
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
      'Διαγραφή λογαριασμού;',
      'Ο λογαριασμός σου και όλα τα δεδομένα στον διακομιστή θα διαγραφούν οριστικά.',
      [
        { text: 'Άκυρο', style: 'cancel' },
        {
          text: 'Διαγραφή λογαριασμού',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await api.deleteAccount();
              } catch (e) {
                Alert.alert('Η διαγραφή απέτυχε', e instanceof Error ? e.message : 'Δοκίμασε ξανά.');
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

  const syncSummary =
    syncStatus.failed > 0
      ? `${syncStatus.failed} απέτυχαν. Ο ήχος μένει στη συσκευή μέχρι την επόμενη προσπάθεια.`
      : syncStatus.uploading
        ? 'Ανέβασμα τώρα'
        : syncStatus.pending > 0
          ? `${syncStatus.pending} σε αναμονή`
          : 'Όλα έχουν ανέβει';

  const syncColor =
    syncStatus.failed > 0
      ? theme.colors.danger
      : syncStatus.uploading || syncStatus.pending > 0
        ? theme.colors.warning
        : theme.colors.success;

  const sectionLabel = [typography.caption, styles.section, { color: theme.colors.textMuted }];

  return (
    <Screen padded={false} bottomInset={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Header title="Ρυθμίσεις" />

        <ListGroup>
          <ListRow
            first
            icon="user"
            title={user?.email ?? 'Άγνωστος λογαριασμός'}
            subtitle="Συνδεδεμένος λογαριασμός"
          />
        </ListGroup>

        {billing ? (
          <>
            <Text style={sectionLabel}>Πλάνο</Text>
            <ListGroup>
              <ListRow
                first
                icon="award"
                title={PLAN_NAMES[billing.plan]}
                subtitle={usageLine(billing)}
              />
            </ListGroup>
          </>
        ) : null}

        <Text style={sectionLabel}>Καταγραφή</Text>
        <ListGroup>
          <ListRow
            first
            icon="music"
            title="Διατήρηση αρχικού ήχου"
            subtitle="Αποθήκευση του ήχου μαζί με τις μεταγραφές."
            right={
              <Switch
                value={keepAudio}
                onValueChange={toggleKeepAudio}
                trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.success }}
                thumbColor="#FFFFFF"
                ios_backgroundColor={theme.colors.surfaceMuted}
              />
            }
          />
          <ListRow
            icon="upload-cloud"
            title="Συγχρονισμός"
            subtitle={syncSummary}
            right={<View style={[styles.syncDot, { backgroundColor: syncColor }]} />}
          />
        </ListGroup>

        <Text style={sectionLabel}>Υπενθυμίσεις</Text>
        <ListGroup>
          <ListRow
            first
            icon="bell"
            title="Αυτόματες υπενθυμίσεις"
            subtitle={
              autoReminders
                ? 'Ό,τι λες ότι πρέπει να κάνεις γίνεται υπενθύμιση αμέσως.'
                : 'Ό,τι λες ότι πρέπει να κάνεις εμφανίζεται ως πρόταση για επιβεβαίωση.'
            }
            right={
              <Switch
                value={autoReminders}
                onValueChange={toggleAutoReminders}
                trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.success }}
                thumbColor="#FFFFFF"
                ios_backgroundColor={theme.colors.surfaceMuted}
              />
            }
          />
        </ListGroup>

        <Text style={sectionLabel}>Καταγραφές</Text>
        <ListGroup>
          <ListRow
            first
            icon="archive"
            title="Ιστορικό καταγραφών"
            subtitle={
              sessionsError !== null
                ? 'Δεν φορτώθηκαν οι καταγραφές'
                : sessions.length === 0
                  ? 'Δεν υπάρχει καμία καταγραφή ακόμα'
                  : `${sessions.length} ${sessions.length === 1 ? 'καταγραφή' : 'καταγραφές'}`
            }
            onPress={() => setHistoryOpen(!historyOpen)}
            right={
              <Icon
                name={historyOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={theme.colors.textFaint}
              />
            }
          />
          {historyOpen && sessionsError !== null ? (
            <ListRow icon="refresh-cw" title="Δοκίμασε ξανά" onPress={loadSessions} />
          ) : null}
          {historyOpen && sessionsError === null
            ? sessions.map((session) => (
                <ListRow
                  key={session.id}
                  icon="mic"
                  title={`${formatDayLabel(session.startedAt)} στις ${formatClock(session.startedAt)}`}
                  subtitle={`${formatDurationHuman(session.durationSeconds)}, ${session.chunkCount} ${
                    session.chunkCount === 1 ? 'τμήμα' : 'τμήματα'
                  }`}
                  right={
                    <IconButton
                      name="trash-2"
                      label="Διαγραφή καταγραφής"
                      filled={false}
                      color={theme.colors.textMuted}
                      onPress={() => deleteSession(session)}
                    />
                  }
                />
              ))
            : null}
        </ListGroup>

        <Text style={sectionLabel}>Απόρρητο</Text>
        <ListGroup>
          <ListRow
            first
            icon="shield"
            title="Η καταγραφή ξεκινά μόνο όταν το επιλέξεις εσύ."
          />
          <ListRow
            icon="radio"
            title="Η ένδειξη μικροφώνου εμφανίζεται όποτε καταγράφεται ήχος."
          />
          <ListRow
            icon="lock"
            title="Τα δεδομένα σου ανήκουν σε εσένα και διαγράφονται όποτε θέλεις."
          />
        </ListGroup>

        <Text style={sectionLabel}>Λογαριασμός</Text>
        <ListGroup>
          <ListRow first icon="log-out" title="Αποσύνδεση" onPress={logout} />
          <ListRow
            icon="trash-2"
            title="Διαγραφή όλων των μνημών"
            danger
            onPress={deleteAllMemories}
          />
          <ListRow
            icon="user-x"
            title="Διαγραφή λογαριασμού"
            danger
            onPress={deleteAccount}
          />
        </ListGroup>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SCREEN_GUTTER,
    paddingBottom: spacing.xl,
  },
  section: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginLeft: spacing.md,
  },
  syncDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
