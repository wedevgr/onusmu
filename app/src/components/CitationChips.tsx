import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Citation } from '../api/types';
import { formatClock, formatDayLabel } from '../lib/time';
import { radius, useTheme } from '../theme';
import { Icon } from './Icon';

interface CitationChipsProps {
  citations: Citation[];
  onPress?: (citation: Citation) => void;
}

const COLLAPSED_COUNT = 3;

function labelFor(citation: Citation): string {
  const day = formatDayLabel(citation.startedAt);
  const clock = formatClock(citation.startedAt);
  return day === 'Σήμερα' || day.length === 0 ? clock : `${day} ${clock}`;
}

// Source times for an answer, kept to one quiet line: start time only, repeats merged,
// and anything past the first few folded behind a "+N" toggle.
export function CitationChips({ citations, onPress }: CitationChipsProps): React.JSX.Element | null {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const sources = useMemo(() => {
    const seen = new Set<string>();
    const unique: { citation: Citation; label: string }[] = [];
    for (const citation of citations) {
      const label = labelFor(citation);
      if (seen.has(label)) continue;
      seen.add(label);
      unique.push({ citation, label });
    }
    return unique;
  }, [citations]);

  if (sources.length === 0) return null;

  const visible = expanded ? sources : sources.slice(0, COLLAPSED_COUNT);
  const hidden = sources.length - visible.length;

  return (
    <View style={styles.wrap}>
      <Icon name="clock" size={12} color={theme.colors.textFaint} />
      {visible.map(({ citation, label }) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          onPress={() => onPress?.(citation)}
          disabled={!onPress}
          hitSlop={6}
          style={({ pressed }) => [
            styles.chip,
            { backgroundColor: theme.colors.surface, opacity: pressed ? 0.5 : 1 },
          ]}
        >
          <Text style={[styles.label, { color: theme.colors.textMuted }]}>{label}</Text>
        </Pressable>
      ))}
      {hidden > 0 || expanded ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded(!expanded)}
          hitSlop={6}
          style={({ pressed }) => [styles.chip, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Text style={[styles.label, { color: theme.colors.textFaint }]}>
            {expanded ? 'Λιγότερα' : `+${hidden}`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    height: 22,
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
});
