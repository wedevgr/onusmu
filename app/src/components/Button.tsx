import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { radius, spacing, useTheme, typography } from '../theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  compact = false,
}: ButtonProps): React.JSX.Element {
  const theme = useTheme();

  const backgroundColor =
    variant === 'primary'
      ? theme.colors.primary
      : variant === 'danger'
        ? theme.colors.dangerSurface
        : 'transparent';

  const borderColor = variant === 'secondary' ? theme.colors.border : backgroundColor;

  const textColor =
    variant === 'primary'
      ? theme.colors.onPrimary
      : variant === 'danger'
        ? theme.colors.danger
        : theme.colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        { backgroundColor, borderColor, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[typography.label, compact ? styles.compactLabel : styles.label, { color: textColor }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginVertical: spacing.xs,
  },
  compact: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
  compactLabel: {
    fontWeight: '600',
  },
});
