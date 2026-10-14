import 'react-native-url-polyfill/auto';
import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import RootNavigator from './src/navigation/RootNavigator';
import { bootstrapAuth, useAuthStore } from './src/stores/auth';
import { useRemindersStore } from './src/stores/reminders';
import { bootstrapSync } from './src/lib/sync';

export default function App(): React.JSX.Element {
  useEffect(() => {
    const unsubscribe = bootstrapAuth();
    void bootstrapSync();
    return unsubscribe;
  }, []);

  // Reminders made from recordings arrive on the server; fetching them on return to the
  // app is what schedules their notifications on this phone.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && useAuthStore.getState().session) {
        void useRemindersStore.getState().refresh();
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <RootNavigator />
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
