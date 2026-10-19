import React, { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useShallow } from 'zustand/react/shallow';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { Reminder, RepeatFrequency, UpdateReminderRequest } from '../api/types';
import { formatDueLabel } from '../lib/time';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { Icon, IconButton } from '../components/Icon';
import { ListGroup } from '../components/List';
import { Screen, SCREEN_GUTTER } from '../components/Screen';
import { selectDone, selectOpen, selectSuggested, useRemindersStore } from '../stores/reminders';
import { radius, spacing, typography, useTheme } from '../theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface Preset {
  label: string;
  date: () => Date | null;
}

function at(daysAhead: number, hour: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(hour, 0, 0, 0);
  return date;
}

function presets(): Preset[] {
  const list: Preset[] = [
    { label: 'Χωρίς ώρα', date: () => null },
    { label: 'Σε 1 ώρα', date: () => new Date(Date.now() + 60 * 60 * 1000) },
  ];
  if (new Date().getHours() < 19) list.push({ label: 'Απόψε 20:00', date: () => at(0, 20) });
  list.push({ label: 'Αύριο 09:00', date: () => at(1, 9) });
  return list;
}

const REPEATS: { freq: RepeatFrequency | null; label: string }[] = [
  { freq: null, label: 'Χωρίς επανάληψη' },
  { freq: 'daily', label: 'Κάθε μέρα' },
  { freq: 'weekly', label: 'Κάθε εβδομάδα' },
  { freq: 'monthly', label: 'Κάθε μήνα' },
];

function failed(title: string) {
  return (e: unknown): void => {
    Alert.alert(title, e instanceof Error ? e.message : 'Δοκίμασε ξανά.');
  };
}

export default function RemindersScreen(): React.JSX.Element {
  const theme = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const suggested = useRemindersStore(useShallow(selectSuggested));
  const open = useRemindersStore(useShallow(selectOpen));
  const done = useRemindersStore(useShallow(selectDone));
  const loaded = useRemindersStore((state) => state.loaded);
  const error = useRemindersStore((state) => state.error);

  const [text, setText] = useState('');
  const [due, setDue] = useState<Date | null>(null);
  const [presetLabel, setPresetLabel] = useState('Χωρίς ώρα');
  const [repeatFreq, setRepeatFreq] = useState<RepeatFrequency | null>(null);
  const [iosPickerOpen, setIosPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void useRemindersStore.getState().refresh();
  }, []);

  const choosePreset = (preset: Preset): void => {
    setPresetLabel(preset.label);
    setDue(preset.date());
    setIosPickerOpen(false);
  };

  const chooseCustom = (): void => {
    const start = due ?? at(1, 9);
    if (Platform.OS === 'ios') {
      setDue(start);
      setPresetLabel('custom');
      setIosPickerOpen(true);
      return;
    }
    // Android has no combined picker: pick the day, then the time.
    DateTimePickerAndroid.open({
      value: start,
      mode: 'date',
      minimumDate: new Date(),
      onChange: (dayEvent, day) => {
        if (dayEvent.type !== 'set' || !day) return;
        DateTimePickerAndroid.open({
          value: start,
          mode: 'time',
          is24Hour: true,
          onChange: (timeEvent, time) => {
            if (timeEvent.type !== 'set' || !time) return;
            const picked = new Date(day);
            picked.setHours(time.getHours(), time.getMinutes(), 0, 0);
            setDue(picked);
            setPresetLabel('custom');
          },
        });
      },
    });
  };

  const add = (): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (due && due.getTime() <= Date.now()) {
      Alert.alert('Η ώρα έχει περάσει', 'Διάλεξε μια ώρα στο μέλλον.');
      return;
    }
    // A repeating reminder needs a time to repeat at; without one it starts tomorrow at 09:00.
    const when = repeatFreq && !due ? at(1, 9) : due;
    setSaving(true);
    useRemindersStore
      .getState()
      .create(trimmed, when ? when.toISOString() : null, repeatFreq ? { freq: repeatFreq } : null)
      .then(() => {
        setText('');
        setDue(null);
        setPresetLabel('Χωρίς ώρα');
        setRepeatFreq(null);
        setIosPickerOpen(false);
      })
      .catch(failed('Δεν αποθηκεύτηκε'))
      .finally(() => setSaving(false));
  };

  const update = (id: string, body: UpdateReminderRequest): void => {
    void useRemindersStore.getState().update(id, body).catch(failed('Η αλλαγή απέτυχε'));
  };

  const remove = (reminder: Reminder): void => {
    Alert.alert('Διαγραφή υπενθύμισης;', reminder.text, [
      { text: 'Άκυρο', style: 'cancel' },
      {
        text: 'Διαγραφή',
        style: 'destructive',
        onPress: () => {
          void useRemindersStore.getState().remove(reminder.id).catch(failed('Η διαγραφή απέτυχε'));
        },
      },
    ]);
  };

  const canAdd = !saving && text.trim().length > 0;
  const nothingYet = loaded && suggested.length === 0 && open.length === 0 && done.length === 0;

  const stopRepeating = (reminder: Reminder): void => {
    Alert.alert('Σταμάτημα επανάληψης;', `${reminder.text}\n${reminder.repeatLabel ?? ''}`, [
      { text: 'Άκυρο', style: 'cancel' },
      { text: 'Σταμάτα', onPress: () => update(reminder.id, { repeat: null }) },
    ]);
  };

  const dueText = (reminder: Reminder): React.JSX.Element | null => {
    if (reminder.repeat && reminder.repeatLabel) {
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Σταμάτημα επανάληψης"
          onPress={() => stopRepeating(reminder)}
          hitSlop={6}
          style={styles.repeatRow}
        >
          <Icon name="repeat" size={12} color={theme.colors.textMuted} />
          <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
            {reminder.repeatLabel}
            {reminder.dueAt && reminder.status === 'pending' ? ` · επόμενη ${formatDueLabel(reminder.dueAt)}` : ''}
          </Text>
        </Pressable>
      );
    }
    if (!reminder.dueAt) return null;
    const overdue = reminder.status === 'pending' && new Date(reminder.dueAt).getTime() < Date.now();
    return (
      <Text
        style={[
          typography.caption,
          styles.due,
          { color: overdue ? theme.colors.danger : theme.colors.textMuted },
        ]}
      >
        {formatDueLabel(reminder.dueAt)}
      </Text>
    );
  };

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Header
          title="Υπενθυμίσεις"
          right={<IconButton name="x" label="Κλείσιμο" onPress={() => navigation.goBack()} />}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.composer, theme.glass]}>
          <TextInput
            style={[styles.input, { color: theme.colors.text }]}
            placeholder="Νέα υπενθύμιση"
            placeholderTextColor={theme.colors.textFaint}
            value={text}
            onChangeText={setText}
            onSubmitEditing={add}
            returnKeyType="done"
            maxLength={200}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chips}
          >
            {presets().map((preset) => (
              <Chip
                key={preset.label}
                label={preset.label}
                selected={presetLabel === preset.label}
                onPress={() => choosePreset(preset)}
              />
            ))}
            <Chip
              label={presetLabel === 'custom' && due ? formatDueLabel(due.toISOString()) : 'Άλλη ώρα'}
              icon="calendar"
              selected={presetLabel === 'custom'}
              onPress={chooseCustom}
            />
          </ScrollView>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chips}
          >
            {REPEATS.map((option) => (
              <Chip
                key={option.label}
                label={option.label}
                icon={option.freq ? 'repeat' : undefined}
                selected={repeatFreq === option.freq}
                onPress={() => setRepeatFreq(option.freq)}
              />
            ))}
          </ScrollView>
          {Platform.OS === 'ios' && iosPickerOpen && due ? (
            <DateTimePicker
              value={due}
              mode="datetime"
              display="spinner"
              minimumDate={new Date()}
              themeVariant={theme.dark ? 'dark' : 'light'}
              onChange={(_event, picked) => picked && setDue(picked)}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={add}
            disabled={!canAdd}
            style={({ pressed }) => [
              styles.addButton,
              {
                backgroundColor: canAdd ? theme.colors.primary : theme.colors.surfaceMuted,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text
              style={[
                typography.label,
                styles.addLabel,
                { color: canAdd ? theme.colors.onPrimary : theme.colors.textFaint },
              ]}
            >
              Προσθήκη
            </Text>
          </Pressable>
        </View>

        {error ? (
          <Text style={[typography.caption, styles.error, { color: theme.colors.danger }]}>{error}</Text>
        ) : null}

        {suggested.length > 0 ? (
          <>
            <SectionLabel
              title="Από τις καταγραφές σου"
              note="Πράγματα που είπες ότι πρέπει να κάνεις. Κράτησε όσα θέλεις."
            />
            <ListGroup>
              {suggested.map((reminder, index) => (
                <View
                  key={reminder.id}
                  style={[styles.row, index > 0 && { borderTopColor: theme.colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
                >
                  <Icon name="mic" size={18} color={theme.colors.textMuted} />
                  <View style={styles.rowText}>
                    <Text style={[typography.body, { color: theme.colors.text }]}>{reminder.text}</Text>
                    {dueText(reminder)}
                  </View>
                  <IconButton
                    name="x"
                    label="Απόρριψη"
                    filled={false}
                    color={theme.colors.textMuted}
                    onPress={() => update(reminder.id, { status: 'dismissed' })}
                  />
                  <IconButton
                    name="check"
                    label="Κράτησε την υπενθύμιση"
                    onPress={() => update(reminder.id, { status: 'pending' })}
                  />
                </View>
              ))}
            </ListGroup>
          </>
        ) : null}

        {open.length > 0 ? (
          <>
            <SectionLabel title="Επόμενες" />
            <ListGroup>
              {open.map((reminder, index) => (
                <Pressable
                  key={reminder.id}
                  onLongPress={() => remove(reminder)}
                  style={[styles.row, index > 0 && { borderTopColor: theme.colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
                >
                  <CheckCircle checked={false} onPress={() => update(reminder.id, { status: 'done' })} />
                  <View style={styles.rowText}>
                    <Text style={[typography.body, { color: theme.colors.text }]}>{reminder.text}</Text>
                    {dueText(reminder)}
                  </View>
                  <IconButton
                    name="trash-2"
                    label="Διαγραφή"
                    filled={false}
                    color={theme.colors.textFaint}
                    onPress={() => remove(reminder)}
                  />
                </Pressable>
              ))}
            </ListGroup>
          </>
        ) : null}

        {done.length > 0 ? (
          <>
            <SectionLabel title="Ολοκληρώθηκαν" />
            <ListGroup>
              {done.map((reminder, index) => (
                <View
                  key={reminder.id}
                  style={[styles.row, index > 0 && { borderTopColor: theme.colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
                >
                  <CheckCircle checked onPress={() => update(reminder.id, { status: 'pending' })} />
                  <Text
                    style={[
                      typography.body,
                      styles.rowText,
                      styles.doneText,
                      { color: theme.colors.textFaint },
                    ]}
                  >
                    {reminder.text}
                  </Text>
                </View>
              ))}
            </ListGroup>
          </>
        ) : null}

        {nothingYet ? (
          <EmptyState
            icon="bell"
            title="Καμία υπενθύμιση"
            message="Πρόσθεσε μία παραπάνω ή πες «θύμισέ μου…» ενώ καταγράφεις."
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function SectionLabel({ title, note }: { title: string; note?: string }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[typography.heading, { color: theme.colors.text }]}>{title}</Text>
      {note ? (
        <Text style={[typography.caption, styles.sectionNote, { color: theme.colors.textMuted }]}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: 'calendar' | 'repeat';
}): React.JSX.Element {
  const theme = useTheme();
  const color = selected ? theme.colors.onPrimary : theme.colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.colors.primary : 'transparent',
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={color} /> : null}
      <Text style={[typography.caption, styles.chipLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

function CheckCircle({ checked, onPress }: { checked: boolean; onPress: () => void }): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={checked ? 'Επαναφορά' : 'Ολοκλήρωση'}
      onPress={onPress}
      hitSlop={10}
      style={[
        styles.check,
        {
          borderColor: checked ? theme.colors.textFaint : theme.colors.textMuted,
          backgroundColor: checked ? theme.colors.surfaceMuted : 'transparent',
        },
      ]}
    >
      {checked ? <Icon name="check" size={14} color={theme.colors.textMuted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: SCREEN_GUTTER,
  },
  content: {
    paddingHorizontal: SCREEN_GUTTER,
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  composer: {
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  input: {
    fontSize: 16,
    paddingVertical: spacing.sm,
  },
  chips: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipLabel: {
    fontWeight: '600',
  },
  addButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: radius.pill,
    marginTop: spacing.xs,
  },
  addLabel: {
    fontWeight: '600',
  },
  error: {
    marginTop: spacing.md,
  },
  section: {
    marginTop: spacing.xl,
    marginBottom: 12,
  },
  sectionNote: {
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowText: {
    flex: 1,
  },
  due: {
    marginTop: 2,
  },
  repeatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  doneText: {
    textDecorationLine: 'line-through',
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
