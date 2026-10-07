import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Citation } from '../api/types';
import { formatTimeRange } from '../lib/time';
import { radius, spacing, typography, useTheme } from '../theme';

interface CitationChipsProps {
  citations: Citation[];
  onPress?: (citation: Citation) => void;
}

export function CitationChips({ citations, onPress }: CitationChipsProps): React.JSX.Element | null {
  const theme = useTheme();
  if (citations.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {citations.map((citation, index) => (
        <Pressable
          key={`${citation.chunkId}-${index}`}
          onPress={() => onPress?.(citation)}
          disabled={!onPress}
          style={({ pressed }) => [
            styles.chip,
            {
              backgroundColor: theme.colors.surfaceMuted,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[typography.caption, styles.label, { color: theme.colors.primary }]}>
            {formatTimeRange(citation.startedAt, citation.endedAt)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  chip: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  label: {
    fontWeight: '600',
  },
});
