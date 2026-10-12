import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';

const DOTS = [0, 1, 2];

// Three dots that rise in turn while an answer is on its way.
export function TypingDots(): React.JSX.Element {
  const theme = useTheme();
  const values = useRef(DOTS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.stagger(
        160,
        values.map((value) =>
          Animated.sequence([
            Animated.timing(value, { toValue: 1, duration: 320, useNativeDriver: true }),
            Animated.timing(value, { toValue: 0, duration: 320, useNativeDriver: true }),
            Animated.delay(240),
          ]),
        ),
      ),
    );
    animation.start();
    return () => animation.stop();
  }, [values]);

  return (
    <View style={styles.row} accessibilityLabel="Αναζήτηση στις μνήμες σου">
      {values.map((value, index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            {
              backgroundColor: theme.colors.textMuted,
              opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
              transform: [
                { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
});
