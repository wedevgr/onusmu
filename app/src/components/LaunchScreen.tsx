import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { brand } from '../theme';
import { Glow } from './Screen';
import { Logo } from './Icon';

const LOGO_SIZE = 76;
const HALO_SIZE = 260;
// Long enough for the emblem to settle even when the session loads instantly.
const MIN_VISIBLE_MS = 1100;

interface LaunchScreenProps {
  // True once the app knows where to go (signed in or not).
  ready: boolean;
  onFinished: () => void;
}

// Covers the app at start: the plain green native splash, then the emblem fading in,
// then the whole layer dissolving into whatever screen is underneath.
export function LaunchScreen({ ready, onFinished }: LaunchScreenProps): React.JSX.Element {
  const logo = useRef(new Animated.Value(0)).current;
  const layer = useRef(new Animated.Value(1)).current;
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    Animated.timing(logo, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(() => setIntroDone(true), MIN_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [logo]);

  useEffect(() => {
    if (!ready || !introDone) return;
    Animated.timing(layer, {
      toValue: 0,
      duration: 380,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => finished && onFinished());
  }, [ready, introDone, layer, onFinished]);

  const scale = logo.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const glow = logo.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0, 1] });

  return (
    <Animated.View
      pointerEvents={ready && introDone ? 'none' : 'auto'}
      // Flat green, identical to the native splash, so the handover is invisible.
      style={[StyleSheet.absoluteFill, { backgroundColor: brand.green, opacity: layer }]}
    >
      <View style={styles.center}>
        <Animated.View style={[styles.halo, { opacity: glow }]}>
          <Glow size={HALO_SIZE} rgb={brand.glow} strength={0.22} style={styles.haloGlow} />
        </Animated.View>
        <Animated.View style={{ opacity: logo, transform: [{ scale }] }}>
          <Logo size={LOGO_SIZE} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A faint lift behind the chrome so it reads as lit, not pasted on.
  halo: {
    position: 'absolute',
    width: HALO_SIZE,
    height: HALO_SIZE,
  },
  haloGlow: {
    top: 0,
    left: 0,
  },
});
