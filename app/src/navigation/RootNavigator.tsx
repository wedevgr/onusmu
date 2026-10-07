import React from 'react';
import { Text } from 'react-native';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type NavigatorScreenParams,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { useAuthStore } from '../stores/auth';
import { darkTheme, lightTheme, useTheme } from '../theme';
import AuthScreen from '../screens/AuthScreen';
import HomeScreen from '../screens/HomeScreen';
import RecordingScreen from '../screens/RecordingScreen';
import TimelineScreen from '../screens/TimelineScreen';
import SearchScreen from '../screens/SearchScreen';
import ChatScreen from '../screens/ChatScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { Screen } from '../components/Screen';
import { EmptyState } from '../components/EmptyState';

export type TimelineParams = {
  highlightChunkId?: string;
  dayOffset?: number;
  sessionId?: string;
};

export type ChatParams = {
  initialMessage?: string;
};

export type TabParamList = {
  Home: undefined;
  Timeline: TimelineParams | undefined;
  Search: undefined;
  Chat: ChatParams | undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: NavigatorScreenParams<TabParamList>;
  Recording: undefined;
};

export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function tabIcon(glyph: string) {
  return function TabIcon({ color }: { color: string }): React.JSX.Element {
    return <Text style={{ fontSize: 18, color }}>{glyph}</Text>;
  };
}

function buildNavigationTheme(dark: boolean): NavigationTheme {
  const base = dark ? DarkTheme : DefaultTheme;
  const colors = dark ? darkTheme.colors : lightTheme.colors;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
    },
  };
}

function MainTabs(): React.JSX.Element {
  const theme = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'Home', tabBarIcon: tabIcon('🏠') }}
      />
      <Tab.Screen
        name="Timeline"
        component={TimelineScreen}
        options={{ title: 'Timeline', tabBarIcon: tabIcon('🕘') }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{ title: 'Search', tabBarIcon: tabIcon('🔍') }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatScreen}
        options={{ title: 'Chat', tabBarIcon: tabIcon('💬') }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings', tabBarIcon: tabIcon('⚙️') }}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator(): React.JSX.Element {
  const theme = useTheme();
  const session = useAuthStore((state) => state.session);
  const initialized = useAuthStore((state) => state.initialized);

  return (
    <NavigationContainer theme={buildNavigationTheme(theme.dark)}>
      {!initialized ? (
        <Screen>
          <EmptyState title="AI Memory" message="Loading your session…" />
        </Screen>
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {session === null ? (
            <Stack.Screen name="Auth" component={AuthScreen} />
          ) : (
            <>
              <Stack.Screen name="Main" component={MainTabs} />
              <Stack.Screen
                name="Recording"
                component={RecordingScreen}
                options={{ animation: 'slide_from_bottom' }}
              />
            </>
          )}
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}
