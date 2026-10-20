import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { brand } from '../theme';
import { Glow } from './Screen';
import { Emblem } from './Emblem';

const LOGO_SIZE = 60;
const RING_SIZE = 128;
const HALO_SIZE = 280;
const MINT = `rgb(${brand.glow})`;
const mint = (alpha: number): string => `rgba(${brand.glow},${alpha})`;
// Long enough for one full turn of the loader even when the session loads instantly.
const MIN_VISIBLE_MS = 1400;

interface LaunchScreenProps {
  // True once the app knows where to go (signed in or not).
  ready: boolean;
  onFinished: () => void;
}

// Covers the app at start: the plain green native splash, then the vector emblem tracing its
// outline and filling with chrome, a spinning light ring, soft ripples and a breathing glow until the app is ready, then a zoom-and-dissolve
// into whatever screen is underneath.
export function LaunchScreen({ ready, onFinished }: LaunchScreenProps): React.JSX.Element {
  const intro = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  // SVG props cannot use the native driver, so the outline trace runs on its own value.
  const trace = useRef(new Animated.Value(0)).current;
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    Animated.timing(intro, {
      toValue: 1,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    Animated.timing(trace, {
      toValue: 1,
      duration: 1000,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
    const loops = [
      Animated.loop(
        Animated.timing(spin, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: true }),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(breath, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(breath, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.timing(ripple, { toValue: 1, duration: 3200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ),
    ];
    loops.forEach((loop) => loop.start());
    const timer = setTimeout(() => setIntroDone(true), MIN_VISIBLE_MS);
    return () => {
      clearTimeout(timer);
      loops.forEach((loop) => loop.stop());
    };
  }, [intro, trace, spin, breath, ripple]);

  useEffect(() => {
    if (!ready || !introDone) return;
    Animated.timing(exit, {
      toValue: 1,
      duration: 480,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => finished && onFinished());
  }, [ready, introDone, exit, onFinished]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const logoScale = Animated.multiply(
    intro.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }),
    breath.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.03] }),
  );
  const glow = breath.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  // Two ripples half a cycle apart.
  const rippleA = { scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }), opacity: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }) };
  const rippleB = {
    scale: ripple.interpolate({ inputRange: [0, 0.5, 0.5001, 1], outputRange: [1.45, 1.9, 1, 1.45] }),
    opacity: ripple.interpolate({ inputRange: [0, 0.5, 0.5001, 1], outputRange: [0.17, 0, 0.35, 0.17] }),
  };
  const layerOpacity = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const exitScale = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });

  return (
    <Animated.View
      pointerEvents={ready && introDone ? 'none' : 'auto'}
      // Flat green, identical to the native splash, so the handover is invisible.
      style={[StyleSheet.absoluteFill, { backgroundColor: brand.green, opacity: layerOpacity }]}
    >
      <View style={styles.center}>
        <Animated.View style={[styles.stage, { opacity: intro, transform: [{ scale: exitScale }] }]}>
          <Animated.View style={[styles.halo, { opacity: glow }]}>
            <Glow size={HALO_SIZE} rgb={brand.glow} strength={0.24} style={styles.haloGlow} />
          </Animated.View>
          {[rippleA, rippleB].map((r, i) => (
            <Animated.View key={i} style={[styles.ring, styles.ripple, { opacity: r.opacity, transform: [{ scale: r.scale }] }]} />
          ))}
          <View style={[styles.ring, styles.track]} />
          <Animated.View style={[styles.ring, styles.arc, { transform: [{ rotate }] }]} />
          <Animated.View style={{ transform: [{ scale: logoScale }] }}>
            <Emblem size={LOGO_SIZE} draw={trace} fill={trace.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] })} />
          </Animated.View>
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
  stage: {
    width: HALO_SIZE,
    height: HALO_SIZE,
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
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
  },
  ripple: {
    borderWidth: 1,
    borderColor: MINT,
  },
  track: {
    borderWidth: 2,
    borderColor: mint(0.1),
  },
  // A bright head fading into a dimmer tail: two coloured sides of a transparent ring.
  arc: {
    borderWidth: 2,
    borderColor: 'transparent',
    borderTopColor: MINT,
    borderRightColor: mint(0.35),
  },
});
