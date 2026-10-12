import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, typography, useTheme } from '../theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  title,
  message,
  icon,
  actionLabel,
  onAction,
}: EmptyStateProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      {icon ? (
        <View style={[styles.icon, theme.glass]}>
          <Icon name={icon} size={24} color={theme.colors.text} />
        </View>
      ) : null}
      <Text style={[typography.heading, styles.title, { color: theme.colors.text }]}>{title}</Text>
      {message ? (
        <Text style={[typography.label, styles.message, { color: theme.colors.textMuted }]}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button title={actionLabel} variant="secondary" compact onPress={onAction} />
        </View>
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
  icon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
    fontWeight: '400',
    marginTop: 6,
    maxWidth: 280,
  },
  action: {
    marginTop: spacing.md,
  },
});
