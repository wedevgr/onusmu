import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, spacing, typography, useTheme } from '../theme';
import { Icon, type IconName } from './Icon';

interface ListGroupProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function ListGroup({ children, style }: ListGroupProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={[styles.group, theme.glass, style]}>{children}</View>
  );
}

interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  right?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  danger?: boolean;
  // The first row in a group has no divider above it.
  first?: boolean;
}

const ICON_SIZE = 22;
const ROW_GAP = 14;

export function ListRow({
  title,
  subtitle,
  icon,
  right,
  onPress,
  chevron = false,
  danger = false,
  first = false,
}: ListRowProps): React.JSX.Element {
  const theme = useTheme();
  const tint = danger ? theme.colors.danger : theme.colors.text;

  const content = (
    <>
      {first ? null : (
        <View
          style={[
            styles.divider,
            {
              backgroundColor: theme.colors.border,
              left: icon ? spacing.md + ICON_SIZE + ROW_GAP : spacing.md,
            },
          ]}
        />
      )}
      {icon ? <Icon name={icon} size={ICON_SIZE} color={tint} /> : null}
      <View style={styles.text}>
        <Text style={[typography.body, { color: tint }]}>{title}</Text>
        {subtitle ? (
          <Text style={[typography.caption, styles.subtitle, { color: theme.colors.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron ? <Icon name="chevron-right" size={18} color={theme.colors.textFaint} /> : null}
    </>
  );

  if (!onPress) {
    return <View style={styles.row}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ROW_GAP,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  divider: {
    position: 'absolute',
    top: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  text: {
    flex: 1,
  },
  subtitle: {
    marginTop: 1,
  },
});
