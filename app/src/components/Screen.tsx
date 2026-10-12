import React from 'react';
import {
  Keyboard,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { spacing, tabBar, useTheme } from '../theme';

interface ScreenProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  // Tab screens sit above the tab bar, which already clears the home indicator.
  bottomInset?: boolean;
}

export const SCREEN_GUTTER = 20;

// Enough steps that neighbouring discs differ by about one colour level, so no rings show.
const GLOW_STEPS = 36;

interface GlowProps {
  size: number;
  rgb: string;
  strength: number;
  style: ViewStyle;
}

// A soft light source built from stacked translucent discs, so it stays smooth on Android,
// where the blur layer above cannot be relied on.
function Glow({ size, rgb, strength, style }: GlowProps): React.JSX.Element {
  return (
    <View style={[styles.glow, { width: size, height: size }, style]}>
      {Array.from({ length: GLOW_STEPS }, (_, step) => {
        const diameter = size * (1 - step / GLOW_STEPS);
        return (
          <View
            key={step}
            style={{
              position: 'absolute',
              width: diameter,
              height: diameter,
              borderRadius: diameter / 2,
              backgroundColor: `rgba(${rgb},${strength / GLOW_STEPS})`,
            }}
          />
        );
      })}
    </View>
  );
}

export function Screen({
  children,
  style,
  padded = true,
  bottomInset = true,
}: ScreenProps): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const insideTabs = React.useContext(BottomTabBarHeightContext) !== undefined;
  const [keyboardOpen, setKeyboardOpen] = React.useState(false);

  // Android resizes the window for the keyboard and the tab bar hides, so the room
  // reserved for the bar would otherwise sit as a gap above the keyboard.
  React.useEffect(() => {
    if (Platform.OS !== 'android' || !insideTabs) return;
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [insideTabs]);

  const paddingBottom = insideTabs
    ? keyboardOpen
      ? spacing.sm
      : Math.max(insets.bottom, tabBar.gap) + tabBar.height + spacing.sm
    : bottomInset
      ? insets.bottom
      : 0;

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: theme.colors.background,
          paddingTop: insets.top + spacing.sm,
          paddingBottom,
        },
        style,
      ]}
    >
      <View pointerEvents="none" style={styles.backdrop}>
        <LinearGradient
          colors={['#0C0D11', '#07080A', '#0A0B0E']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Glow size={560} rgb="150,168,205" strength={0.26} style={styles.glowTop} />
        <Glow size={540} rgb="120,128,150" strength={0.16} style={styles.glowBottom} />
        <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />
      </View>
      <View style={padded ? styles.padded : styles.flush}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowTop: {
    top: -230,
    right: -210,
  },
  glowBottom: {
    bottom: -250,
    left: -230,
  },
  padded: {
    flex: 1,
    paddingHorizontal: SCREEN_GUTTER,
  },
  flush: {
    flex: 1,
  },
});
