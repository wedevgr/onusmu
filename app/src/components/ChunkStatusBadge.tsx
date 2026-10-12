import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, typography, useTheme, type ThemeColors } from '../theme';

interface ChunkStatusBadgeProps {
  status: string;
}

interface BadgeStyle {
  label: string;
  color: keyof ThemeColors;
}

function resolve(status: string): BadgeStyle | null {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'done':
    case 'transcribed':
      return null;
    case 'processing':
    case 'transcribing':
      return { label: 'Επεξεργασία', color: 'warning' };
    case 'failed':
    case 'error':
      return { label: 'Απέτυχε', color: 'danger' };
    default:
      return { label: 'Σε αναμονή', color: 'textMuted' };
  }
}

// Finished chunks are the normal case and stay unmarked; only exceptions get a status.
export function ChunkStatusBadge({ status }: ChunkStatusBadgeProps): React.JSX.Element | null {
  const theme = useTheme();
  const badge = resolve(status);
  if (badge === null) return null;
  const color = theme.colors[badge.color];
  return (
    <View style={styles.badge}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[typography.overline, { color }]}>{badge.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
