import 'react-native-url-polyfill/auto';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { RootNavigator } from './src/navigation/RootNavigator';
import { startSyncLoop, stopSyncLoop } from './src/lib/sync';
import { bootstrapAuth, useAuthStore } from './src/stores/auth';
import { useTheme } from './src/theme';

export default function App(): React.JSX.Element {
  const theme = useTheme();
  const initialized = useAuthStore((s) => s.initialized);
  const user = useAuthStore((s) => s.user);

  useEffect(() => bootstrapAuth(), []);

  useEffect(() => {
    if (user) {
      startSyncLoop();
    } else {
      stopSyncLoop();
    }
  }, [user]);

  if (!initialized) {
    return (
      <View style={[styles.splash, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <RootNavigator />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
