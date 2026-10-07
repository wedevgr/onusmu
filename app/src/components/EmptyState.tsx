import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, typography, useTheme } from '../theme';

interface EmptyStateProps {
  title: string;
  message?: string;
}

export function EmptyState({ title, message }: EmptyStateProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[typography.heading, styles.title, { color: theme.colors.text }]}>{title}</Text>
      {message ? (
        <Text style={[typography.body, styles.message, { color: theme.colors.textMuted }]}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  title: {
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
