import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, typography, useTheme } from '../theme';

const LABELS: Record<string, string> = {
  pending: 'Queued',
  transcribing: 'Transcribing',
  embedding: 'Embedding',
  completed: 'Done',
  failed: 'Failed',
};

export function ChunkStatusBadge({ status }: { status: string }): React.JSX.Element | null {
  const theme = useTheme();
  const color =
    status === 'completed'
      ? theme.colors.success
      : status === 'failed'
        ? theme.colors.danger
        : status === 'pending'
          ? theme.colors.warning
          : theme.colors.primary;
  const label = LABELS[status] ?? status;
  if (status === 'completed') return null;

  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[typography.caption, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 6,
  },
});
