import React from 'react';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import { ChatScreen } from '../screens/ChatScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { RecordingScreen } from '../screens/RecordingScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { TimelineScreen } from '../screens/TimelineScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { useTheme } from '../theme';
import type { MainTabParamList, RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

function TabDot({ focused, color }: { focused: boolean; color: string }): React.JSX.Element {
  return <View style={[styles.dot, { backgroundColor: color, opacity: focused ? 1 : 0.35 }]} />;
}

function MainTabs(): React.JSX.Element {
  const theme = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
      }}
    >
      <Tabs.Screen name="Home" component={HomeScreen} options={{ title: 'Home', tabBarIcon: TabDot }} />
      <Tabs.Screen name="Timeline" component={TimelineScreen} options={{ title: 'Timeline', tabBarIcon: TabDot }} />
      <Tabs.Screen name="Search" component={SearchScreen} options={{ title: 'Search', tabBarIcon: TabDot }} />
      <Tabs.Screen name="Chat" component={ChatScreen} options={{ title: 'Chat', tabBarIcon: TabDot }} />
      <Tabs.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings', tabBarIcon: TabDot }} />
    </Tabs.Navigator>
  );
}

export function RootNavigator(): React.JSX.Element {
  const theme = useTheme();
  const navTheme: NavigationTheme = {
    ...(theme.dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme.dark ? DarkTheme.colors : DefaultTheme.colors),
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.surface,
      text: theme.colors.text,
      border: theme.colors.border,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Auth" component={AuthScreen} />
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen
          name="Recording"
          component={RecordingScreen}
          options={{ headerShown: true, title: 'Recording', headerBackVisible: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 4 },
});
