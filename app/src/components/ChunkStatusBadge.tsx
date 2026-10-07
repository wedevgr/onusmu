import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing, typography, useTheme } from '../theme';

interface ChunkStatusBadgeProps {
  status: string;
}

interface BadgeStyle {
  label: string;
  foreground: keyof ReturnType<typeof useTheme>['colors'];
  background: keyof ReturnType<typeof useTheme>['colors'];
}

function resolve(status: string): BadgeStyle {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'done':
    case 'transcribed':
      return { label: 'Transcribed', foreground: 'success', background: 'surfaceMuted' };
    case 'processing':
    case 'transcribing':
      return { label: 'Processing', foreground: 'warning', background: 'surfaceMuted' };
    case 'failed':
    case 'error':
      return { label: 'Failed', foreground: 'danger', background: 'dangerSurface' };
    default:
      return { label: 'Pending', foreground: 'textMuted', background: 'surfaceMuted' };
  }
}

export function ChunkStatusBadge({ status }: ChunkStatusBadgeProps): React.JSX.Element {
  const theme = useTheme();
  const badge = resolve(status);
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: theme.colors[badge.background] },
      ]}
    >
      <Text style={[typography.caption, styles.label, { color: theme.colors[badge.foreground] }]}>
        {badge.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: spacing.xs,
  },
  label: {
    fontWeight: '600',
  },
});
