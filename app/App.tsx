import 'react-native-url-polyfill/auto';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import RootNavigator from './src/navigation/RootNavigator';
import { bootstrapAuth } from './src/stores/auth';
import { bootstrapSync } from './src/lib/sync';

export default function App(): React.JSX.Element {
  useEffect(() => {
    const unsubscribe = bootstrapAuth();
    void bootstrapSync();
    return unsubscribe;
  }, []);

  return (
    <SafeAreaProvider>
      <RootNavigator />
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
