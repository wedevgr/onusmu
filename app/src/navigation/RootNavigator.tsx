import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
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
import { darkTheme, lightTheme, spacing, typography, useTheme } from '../theme';
import AuthScreen from '../screens/AuthScreen';
import HomeScreen from '../screens/HomeScreen';
import RecordingScreen from '../screens/RecordingScreen';
import TimelineScreen from '../screens/TimelineScreen';
import SearchScreen from '../screens/SearchScreen';
import ChatScreen from '../screens/ChatScreen';
import ChatHistoryScreen from '../screens/ChatHistoryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { GlassTabBar } from '../components/GlassTabBar';
import { Screen } from '../components/Screen';
import { Icon, Logo, type IconName } from '../components/Icon';

export type TimelineParams = {
  highlightChunkId?: string;
  dayOffset?: number;
  sessionId?: string;
};

export type ChatParams = {
  initialMessage?: string;
  conversationId?: string;
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
  ChatHistory: undefined;
};

export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function tabIcon(name: IconName) {
  return function TabIcon({ color, size }: { color: string; size: number }): React.JSX.Element {
    return <Icon name={name} color={color} size={size} />;
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
      card: colors.background,
      text: colors.text,
      border: colors.border,
    },
  };
}

function MainTabs(): React.JSX.Element {
  return (
    <Tab.Navigator
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'Αρχική', tabBarIcon: tabIcon('home') }}
      />
      <Tab.Screen
        name="Timeline"
        component={TimelineScreen}
        options={{ title: 'Χρονολόγιο', tabBarIcon: tabIcon('clock') }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{ title: 'Αναζήτηση', tabBarIcon: tabIcon('search') }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatScreen}
        options={{ title: 'Συνομιλία', tabBarIcon: tabIcon('message-circle') }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Ρυθμίσεις', tabBarIcon: tabIcon('settings') }}
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
          <View style={styles.splash}>
            <Logo size={72} />
            <Text style={[typography.heading, styles.splashTitle, { color: theme.colors.text }]}>
              AI Memory
            </Text>
            <ActivityIndicator color={theme.colors.textMuted} />
          </View>
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
              <Stack.Screen
                name="ChatHistory"
                component={ChatHistoryScreen}
                options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
              />
            </>
          )}
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashTitle: {
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
});
