import React from 'react';
import { Image, Pressable, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useTheme } from '../theme';

export type IconName = React.ComponentProps<typeof Feather>['name'];

export { Feather as Icon };

interface IconButtonProps {
  name: IconName;
  label: string;
  onPress: () => void;
  filled?: boolean;
  disabled?: boolean;
  color?: string;
}

export function IconButton({
  name,
  label,
  onPress,
  filled = true,
  disabled = false,
  color,
}: IconButtonProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [
        styles.button,
        filled && theme.glass,
        { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
      ]}
    >
      <Feather name={name} size={20} color={color ?? theme.colors.text} />
    </Pressable>
  );
}

// The app mark: the chrome emblem on transparency, so it sits directly on any backdrop.
export function Logo({ size = 64 }: { size?: number }): React.JSX.Element {
  return (
    <Image
      source={require('../../assets/emblem.png')}
      style={{ width: size, height: size }}
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
