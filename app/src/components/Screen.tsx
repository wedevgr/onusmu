import React from 'react';
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  StyleSheet,
  View,
  type KeyboardEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { brand, spacing, tabBar, useTheme } from '../theme';

interface ScreenProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  // Tab screens sit above the tab bar, which already clears the home indicator.
  bottomInset?: boolean;
  // 'brand' is the dark green of the emblem, for the launch and sign-in screens.
  backdrop?: 'glass' | 'brand';
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
export function Glow({ size, rgb, strength, style }: GlowProps): React.JSX.Element {
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

// Dark green, slightly lighter at the top, with one faint mint light behind the header.
export function BrandBackdrop(): React.JSX.Element {
  return (
    <View pointerEvents="none" style={styles.backdrop}>
      <LinearGradient
        colors={[brand.greenTop, brand.green, brand.greenBottom]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Glow size={620} rgb={brand.glow} strength={0.08} style={styles.glowBrand} />
    </View>
  );
}

export function Screen({
  children,
  style,
  padded = true,
  bottomInset = true,
  backdrop = 'glass',
}: ScreenProps): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const insideTabs = React.useContext(BottomTabBarHeightContext) !== undefined;
  const rootRef = React.useRef<View>(null);
  // How far the keyboard reaches over this screen; null while the keyboard is closed.
  const [keyboardInset, setKeyboardInset] = React.useState<number | null>(null);
  const navigationBar = React.useRef(insets.bottom);
  navigationBar.current = insets.bottom;

  // Android draws edge to edge, so the window no longer shrinks for the keyboard and the
  // screen has to make room itself. On iOS the overlap is measured, which also covers a
  // screen that does not reach the bottom.
  React.useEffect(() => {
    // Measuring is asynchronous, so a late result must not reopen a keyboard that has closed.
    let visible = false;
    const onShow = (event: KeyboardEvent): void => {
      visible = true;
      if (Platform.OS === 'android') {
        // React Native reports the keyboard without the navigation bar under it, and
        // measureInWindow and screenY disagree by the status bar, so measuring left the
        // fields partly covered. Every screen reaches the bottom edge, so the keyboard
        // covers its full height: the reported height plus the navigation bar.
        setKeyboardInset(event.endCoordinates.height + navigationBar.current);
        return;
      }
      const keyboardTop = event.endCoordinates.screenY;
      rootRef.current?.measureInWindow((_x, y, _width, height) => {
        if (!visible) return;
        if (Platform.OS === 'ios' && event.duration > 0) {
          LayoutAnimation.configureNext({
            duration: event.duration,
            update: { type: LayoutAnimation.Types.keyboard },
          });
        }
        setKeyboardInset(Math.max(0, y + height - keyboardTop));
      });
    };
    const onHide = (event: KeyboardEvent): void => {
      visible = false;
      if (Platform.OS === 'ios' && event.duration > 0) {
        LayoutAnimation.configureNext({
          duration: event.duration,
          update: { type: LayoutAnimation.Types.keyboard },
        });
      }
      setKeyboardInset(null);
    };
    // iOS sends another will-show whenever the keyboard changes height.
    const subscriptions =
      Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillShow', onShow),
            Keyboard.addListener('keyboardWillHide', onHide),
          ]
        : [
            Keyboard.addListener('keyboardDidShow', onShow),
            Keyboard.addListener('keyboardDidHide', onHide),
          ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);

  // With the keyboard up the tab bar is hidden or covered, so only the keyboard needs room.
  const paddingBottom =
    keyboardInset !== null
      ? keyboardInset + spacing.md
      : insideTabs
        ? Math.max(insets.bottom, tabBar.gap) + tabBar.height + spacing.sm
        : bottomInset
          ? insets.bottom
          : 0;

  return (
    <View
      ref={rootRef}
      style={[
        styles.base,
        {
          backgroundColor: backdrop === 'brand' ? brand.green : theme.colors.background,
          paddingTop: insets.top + spacing.sm,
          paddingBottom,
        },
        style,
      ]}
    >
      {backdrop === 'brand' ? (
        <BrandBackdrop />
      ) : (
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
      )}
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
  glowBrand: {
    top: -330,
    alignSelf: 'center',
  },
  padded: {
    flex: 1,
    paddingHorizontal: SCREEN_GUTTER,
  },
  flush: {
    flex: 1,
  },
});
