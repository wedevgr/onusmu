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
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { api } from '../api/client';
import type { Term, TermKind } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { Icon, IconButton, type IconName } from '../components/Icon';
import { ListGroup } from '../components/List';
import { Screen, SCREEN_GUTTER } from '../components/Screen';
import { radius, spacing, typography, useTheme } from '../theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const KINDS: { kind: TermKind; label: string; group: string; icon: IconName }[] = [
  { kind: 'person', label: 'Άτομο', group: 'Άτομα', icon: 'user' },
  { kind: 'business', label: 'Επιχείρηση', group: 'Επιχειρήσεις', icon: 'briefcase' },
  { kind: 'place', label: 'Μέρος', group: 'Μέρη', icon: 'map-pin' },
  { kind: 'thing', label: 'Πράγμα', group: 'Πράγματα', icon: 'package' },
  { kind: 'other', label: 'Άλλο', group: 'Άλλα', icon: 'tag' },
];

function kindInfo(kind: TermKind) {
  return KINDS.find((k) => k.kind === kind) ?? KINDS[KINDS.length - 1]!;
}

function failed(title: string) {
  return (e: unknown): void => {
    Alert.alert(title, e instanceof Error ? e.message : 'Δοκίμασε ξανά.');
  };
}

function KindChips({ value, onChange }: { value: TermKind; onChange: (kind: TermKind) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.chips}>
      {KINDS.map((k) => {
        const selected = k.kind === value;
        return (
          <Pressable
            key={k.kind}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(k.kind)}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? theme.colors.primary : 'transparent',
                borderColor: selected ? theme.colors.primary : theme.colors.border,
              },
            ]}
          >
            <Text
              style={[
                typography.caption,
                styles.chipLabel,
                { color: selected ? theme.colors.onPrimary : theme.colors.textMuted },
              ]}
            >
              {k.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface EditorProps {
  initial?: Term;
  saving: boolean;
  onSave: (values: { term: string; kind: TermKind; note: string }) => void;
  onCancel?: () => void;
  onRemove?: () => void;
}

// Name, type and a short note; used both for adding and for editing a name.
function TermEditor({ initial, saving, onSave, onCancel, onRemove }: EditorProps): React.JSX.Element {
  const theme = useTheme();
  const [term, setTerm] = useState(initial?.term ?? '');
  const [kind, setKind] = useState<TermKind>(initial?.kind ?? 'person');
  const [note, setNote] = useState(initial?.note ?? '');
  const canSave = !saving && term.trim().length >= 2;

  return (
    <View style={styles.editor}>
      <TextInput
        style={[styles.input, theme.glass, { color: theme.colors.text }]}
        placeholder="Όνομα, π.χ. Πατάρας"
        placeholderTextColor={theme.colors.textFaint}
        value={term}
        onChangeText={setTerm}
        maxLength={80}
        autoFocus={initial !== undefined}
      />
      <KindChips value={kind} onChange={setKind} />
      <TextInput
        style={[styles.input, theme.glass, { color: theme.colors.text }]}
        placeholder="Τι είναι, π.χ. συνεργείο αυτοκινήτου"
        placeholderTextColor={theme.colors.textFaint}
        value={note}
        onChangeText={setNote}
        maxLength={120}
        onSubmitEditing={() => canSave && onSave({ term: term.trim(), kind, note: note.trim() })}
        returnKeyType="done"
      />
      <View style={styles.editorActions}>
        {onRemove ? (
          <Pressable onPress={onRemove} hitSlop={8} style={styles.textButton}>
            <Text style={[typography.label, { color: theme.colors.danger }]}>Αφαίρεση</Text>
          </Pressable>
        ) : null}
        <View style={styles.flex} />
        {onCancel ? (
          <Pressable onPress={onCancel} hitSlop={8} style={styles.textButton}>
            <Text style={[typography.label, { color: theme.colors.textMuted }]}>Άκυρο</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => onSave({ term: term.trim(), kind, note: note.trim() })}
          disabled={!canSave}
          style={({ pressed }) => [
            styles.saveButton,
            {
              backgroundColor: canSave ? theme.colors.primary : theme.colors.surfaceMuted,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={theme.colors.onPrimary} />
          ) : (
            <Text
              style={[
                typography.label,
                styles.saveLabel,
                { color: canSave ? theme.colors.onPrimary : theme.colors.textFaint },
              ]}
            >
              {initial ? 'Αποθήκευση' : 'Προσθήκη'}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

export default function TermsScreen(): React.JSX.Element {
  const theme = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback((): void => {
    api
      .listTerms()
      .then((response) => {
        setTerms(response.terms);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Δεν φορτώθηκαν τα ονόματα.'));
  }, []);

  useEffect(load, [load]);

  const create = (values: { term: string; kind: TermKind; note: string }): void => {
    setSaving(true);
    api
      .createTerm(values)
      .then(({ term }) => {
        if (term) setTerms((current) => [term, ...(current ?? [])]);
        setAdding(false);
      })
      .catch(failed('Δεν αποθηκεύτηκε'))
      .finally(() => setSaving(false));
  };

  const update = (id: string, values: { term: string; kind: TermKind; note: string }): void => {
    setSaving(true);
    api
      .updateTerm(id, values)
      .then(({ term }) => {
        if (term) setTerms((current) => (current ?? []).map((t) => (t.id === id ? term : t)));
        setEditingId(null);
      })
      .catch(failed('Η αλλαγή απέτυχε'))
      .finally(() => setSaving(false));
  };

  const remove = (term: Term): void => {
    Alert.alert(
      `Αφαίρεση «${term.term}»;`,
      'Δεν θα χρησιμοποιείται πια και δεν θα ξαναπροστεθεί από τις καταγραφές.',
      [
        { text: 'Άκυρο', style: 'cancel' },
        {
          text: 'Αφαίρεση',
          style: 'destructive',
          onPress: () => {
            api
              .deleteTerm(term.id)
              .then(() => {
                setTerms((current) => (current ?? []).filter((t) => t.id !== term.id));
                setEditingId(null);
              })
              .catch(failed('Η αφαίρεση απέτυχε'));
          },
        },
      ],
    );
  };

  const groups = KINDS.map((k) => ({ ...k, items: (terms ?? []).filter((t) => t.kind === k.kind) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Header
          title="Ονόματα"
          right={<IconButton name="x" label="Κλείσιμο" onPress={() => navigation.goBack()} />}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[typography.caption, styles.intro, { color: theme.colors.textMuted }]}>
          Άτομα, μέρη και επιχειρήσεις από τις καταγραφές σου. Βοηθούν τη μεταγραφή να γράφει σωστά
          τα ονόματα και τη συνομιλία να ξέρει ποιος είναι ποιος.
        </Text>

        {adding ? (
          <View style={[styles.addPanel, theme.glass]}>
            <TermEditor saving={saving} onSave={create} onCancel={() => setAdding(false)} />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setAdding(true);
              setEditingId(null);
            }}
            style={({ pressed }) => [styles.addRow, theme.glass, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Icon name="plus" size={20} color={theme.colors.text} />
            <Text style={[typography.body, { color: theme.colors.text }]}>Προσθήκη ονόματος</Text>
          </Pressable>
        )}

        {error !== null ? (
          <EmptyState icon="alert-circle" title="Δεν φορτώθηκαν" message={error} />
        ) : terms === null ? (
          <ActivityIndicator style={styles.loading} color={theme.colors.textMuted} />
        ) : terms.length === 0 ? (
          <EmptyState
            icon="users"
            title="Κανένα όνομα ακόμα"
            message="Όταν αναφέρεις κάποιον ή κάπου σε μια καταγραφή, θα εμφανιστεί εδώ."
          />
        ) : (
          groups.map((group) => (
            <View key={group.kind}>
              <Text style={[typography.caption, styles.section, { color: theme.colors.textMuted }]}>
                {group.group}
              </Text>
              <ListGroup>
                {group.items.map((term, index) => (
                  <View key={term.id}>
                    {index > 0 ? (
                      <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
                    ) : null}
                    {editingId === term.id ? (
                      <View style={styles.inlineEditor}>
                        <TermEditor
                          initial={term}
                          saving={saving}
                          onSave={(values) => update(term.id, values)}
                          onCancel={() => setEditingId(null)}
                          onRemove={() => remove(term)}
                        />
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityHint="Επεξεργασία"
                        onPress={() => {
                          setEditingId(term.id);
                          setAdding(false);
                        }}
                        style={({ pressed }) => [
                          styles.row,
                          pressed && { backgroundColor: theme.colors.surfaceMuted },
                        ]}
                      >
                        <Icon name={kindInfo(term.kind).icon} size={20} color={theme.colors.textMuted} />
                        <View style={styles.flex}>
                          <Text style={[typography.body, { color: theme.colors.text }]}>{term.term}</Text>
                          <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
                            {[
                              term.note,
                              term.mentions === 1 ? '1 αναφορά' : `${term.mentions} αναφορές`,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                          {term.variants.length > 0 ? (
                            <Text style={[typography.caption, { color: theme.colors.textFaint }]}>
                              Ακούστηκε και ως {term.variants.join(', ')}
                            </Text>
                          ) : null}
                        </View>
                        <Icon name="edit-2" size={16} color={theme.colors.textFaint} />
                      </Pressable>
                    )}
                  </View>
                ))}
              </ListGroup>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    paddingHorizontal: SCREEN_GUTTER,
  },
  content: {
    paddingHorizontal: SCREEN_GUTTER,
    paddingBottom: spacing.xxl,
  },
  intro: {
    marginBottom: spacing.md,
    marginHorizontal: spacing.xs,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 52,
  },
  addPanel: {
    borderRadius: radius.md,
    padding: spacing.md,
  },
  loading: {
    marginTop: spacing.xl,
  },
  section: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.md + 20 + 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  inlineEditor: {
    padding: spacing.md,
  },
  editor: {
    gap: 10,
  },
  input: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    fontSize: 16,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 30,
    justifyContent: 'center',
  },
  chipLabel: {
    fontWeight: '500',
  },
  editorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  textButton: {
    paddingVertical: 8,
  },
  saveButton: {
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveLabel: {
    fontWeight: '600',
  },
});
