import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { spacing, typography, useTheme } from '../theme';

interface Props {
  label?: string;
  size?: number;
}

export function RecordingDot({ label = 'Microphone active', size = 14 }: Props): React.JSX.Element {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <View style={styles.row}>
      <View style={[styles.dotWrap, { width: size * 3, height: size * 3 }]}>
        <Animated.View
          style={[styles.halo, { width: size, height: size, borderRadius: size, backgroundColor: theme.colors.recording, transform: [{ scale }], opacity }]}
        />
        <View style={[styles.dot, { width: size, height: size, borderRadius: size, backgroundColor: theme.colors.recording }]} />
      </View>
      <Text style={[typography.label, { color: theme.colors.recording }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  dotWrap: { alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  dot: { position: 'absolute' },
  halo: { position: 'absolute' },
});
