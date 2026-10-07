import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, typography, useTheme } from '../theme';

interface Props {
  title: string;
  message?: string;
}

export function EmptyState({ title, message }: Props): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={styles.glyph}>◎</Text>
      <Text style={[typography.heading, styles.title, { color: theme.colors.text }]}>{title}</Text>
      {message ? (
        <Text style={[typography.body, { color: theme.colors.textMuted, textAlign: 'center' }]}>{message}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  glyph: { fontSize: 40, color: '#9A9AA6' },
  title: { textAlign: 'center' },
});
