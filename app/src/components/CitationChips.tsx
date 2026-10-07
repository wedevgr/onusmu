import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import type { Citation } from '../api/types';
import { formatTimeRange } from '../lib/time';
import { radius, spacing, typography, useTheme } from '../theme';

interface Props {
  citations: Citation[];
  onSelect: (citation: Citation) => void;
}

export function CitationChips({ citations, onSelect }: Props): React.JSX.Element | null {
  const theme = useTheme();
  if (citations.length === 0) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row} contentContainerStyle={styles.content}>
      {citations.map((citation) => (
        <Pressable
          key={citation.chunkId}
          onPress={() => onSelect(citation)}
          style={({ pressed }) => [
            styles.chip,
            { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[typography.caption, { color: theme.colors.primary }]}>
            {formatTimeRange(citation.startedAt, citation.endedAt)}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexGrow: 0, marginTop: spacing.xs },
  content: { gap: spacing.xs },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
});
