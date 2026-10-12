import React, { useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tabBar, useTheme } from '../theme';

const EDGE = 6;
const ICON_SIZE = 22;

// Floating glass tab bar. A pill springs across to the selected tab while its icon lifts
// and its label fades in; unselected tabs show only an icon.
export function GlassTabBar({ state, descriptors, navigation }: BottomTabBarProps): React.JSX.Element | null {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [rowWidth, setRowWidth] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const count = state.routes.length;
  const tabWidth = rowWidth / count;

  const position = useRef(new Animated.Value(state.index)).current;
  const focus = useRef(
    state.routes.map((_, index) => new Animated.Value(index === state.index ? 1 : 0)),
  ).current;

  useEffect(() => {
    Animated.spring(position, {
      toValue: state.index,
      damping: 16,
      stiffness: 210,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
    focus.forEach((value, index) => {
      Animated.spring(value, {
        toValue: index === state.index ? 1 : 0,
        damping: 13,
        stiffness: 230,
        useNativeDriver: true,
      }).start();
    });
  }, [focus, position, state.index]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  if (keyboardOpen) return null;

  return (
    <View
      style={[
        styles.bar,
        { bottom: Math.max(insets.bottom, tabBar.gap), borderColor: theme.colors.border },
      ]}
    >
      <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.tint]} />

      <View style={styles.row} onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
        {rowWidth > 0 ? (
          <Animated.View
            style={[
              styles.pill,
              {
                width: tabWidth,
                backgroundColor: theme.colors.surfaceMuted,
                borderColor: theme.colors.border,
                transform: [
                  {
                    translateX: position.interpolate({
                      inputRange: [0, Math.max(count - 1, 1)],
                      outputRange: [0, Math.max(count - 1, 1) * tabWidth],
                    }),
                  },
                ],
              },
            ]}
          />
        ) : null}

        {state.routes.map((route, index) => {
          const descriptor = descriptors[route.key];
          const options = descriptor?.options ?? {};
          const focused = state.index === index;
          const label = options.title ?? route.name;
          const color = focused ? theme.colors.text : theme.colors.textFaint;
          const value = focus[index] ?? position;

          const onPress = (): void => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={label}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              style={styles.tab}
            >
              <Animated.View
                style={{
                  transform: [
                    {
                      translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }),
                    },
                    { scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) },
                  ],
                }}
              >
                {options.tabBarIcon?.({ focused, color, size: ICON_SIZE })}
              </Animated.View>
              <Animated.Text
                numberOfLines={1}
                style={[
                  styles.label,
                  {
                    color: theme.colors.text,
                    opacity: value.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [0, 0, 1],
                      extrapolate: 'clamp',
                    }),
                    transform: [
                      {
                        translateY: value.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
                      },
                    ],
                  },
                ]}
              >
                {label}
              </Animated.Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: tabBar.inset,
    right: tabBar.inset,
    height: tabBar.height,
    borderRadius: tabBar.height / 2,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tint: {
    backgroundColor: 'rgba(16,17,22,0.66)',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    marginHorizontal: EDGE,
  },
  pill: {
    position: 'absolute',
    top: EDGE,
    bottom: EDGE,
    left: 0,
    borderRadius: tabBar.height / 2,
    borderWidth: 1,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    position: 'absolute',
    bottom: 11,
    left: 2,
    right: 2,
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
  },
});
