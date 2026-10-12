import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, typography, useTheme } from '../theme';

interface HeaderProps {
  title: string;
  right?: React.ReactNode;
}

export function Header({ title, right }: HeaderProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <Text style={[typography.title, styles.title, { color: theme.colors.text }]} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    marginBottom: spacing.sm,
  },
  title: {
    flex: 1,
  },
});
