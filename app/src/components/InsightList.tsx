import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import type { Insight, InsightType } from '../api/types';
import { useRemindersStore } from '../stores/reminders';
import { typography, useTheme } from '../theme';
import { Icon, type IconName } from './Icon';

const ICONS: Record<InsightType, IconName> = {
  task: 'clipboard',
  done: 'check-circle',
  stopped: 'bell-off',
  settled: 'check-circle',
  expense: 'credit-card',
  income: 'arrow-down-left',
  debt: 'alert-circle',
  receivable: 'arrow-down-left',
  measure: 'activity',
};

interface InsightListProps {
  chunkId: string;
  items: Insight[];
  compact?: boolean;
  onChange?: (items: Insight[]) => void;
}

// What a recording was understood as, one line each, with an undo for mistakes.
export function InsightList({ chunkId, items, compact = false, onChange }: InsightListProps): React.JSX.Element {
  const theme = useTheme();
  const [busy, setBusy] = useState<number | null>(null);

  const undo = (index: number): void => {
    setBusy(index);
    api
      .undoInsight(chunkId, index)
      .then(({ items: updated }) => {
        onChange?.(updated);
        // Tasks were created, closed or reopened: the reminders list changed.
        const type = items[index]?.type;
        if (type === 'task' || type === 'done' || type === 'stopped') void useRemindersStore.getState().refresh();
      })
      .catch((e: unknown) => Alert.alert('Η αναίρεση απέτυχε', e instanceof Error ? e.message : 'Δοκίμασε ξανά.'))
      .finally(() => setBusy(null));
  };

  return (
    <View style={[styles.list, compact && styles.compact]}>
      {items.map((item, index) => {
        const positive = item.type === 'done' || item.type === 'settled';
        const color = item.undone
          ? theme.colors.textFaint
          : positive
            ? theme.colors.success
            : theme.colors.textMuted;
        return (
          <View key={`${item.refId}-${index}`} style={styles.row}>
            <Icon name={ICONS[item.type] ?? 'info'} size={14} color={color} />
            <Text
              style={[
                typography.caption,
                styles.label,
                { color: item.undone ? theme.colors.textFaint : theme.colors.text },
                item.undone && styles.struck,
              ]}
            >
              {item.label}
            </Text>
            {item.undone ? (
              <Text style={[typography.caption, { color: theme.colors.textFaint }]}>Αναιρέθηκε</Text>
            ) : busy === index ? (
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Αναίρεση: ${item.label}`}
                onPress={() => undo(index)}
                hitSlop={8}
              >
                <Text style={[typography.caption, styles.undo, { color: theme.colors.textMuted }]}>Αναίρεση</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
    marginTop: 10,
  },
  compact: {
    marginTop: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    flex: 1,
  },
  struck: {
    textDecorationLine: 'line-through',
  },
  undo: {
    fontWeight: '600',
  },
});
