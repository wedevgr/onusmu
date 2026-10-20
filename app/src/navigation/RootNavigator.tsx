import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  createNavigationContainerRef,
  type NavigatorScreenParams,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { useAuthStore } from '../stores/auth';
import { brand, darkTheme, lightTheme, useTheme } from '../theme';
import AuthScreen from '../screens/AuthScreen';
import HomeScreen from '../screens/HomeScreen';
import RecordingScreen from '../screens/RecordingScreen';
import TimelineScreen from '../screens/TimelineScreen';
import SearchScreen from '../screens/SearchScreen';
import ChatScreen from '../screens/ChatScreen';
import ChatHistoryScreen from '../screens/ChatHistoryScreen';
import RemindersScreen from '../screens/RemindersScreen';
import SettingsScreen from '../screens/SettingsScreen';
import TermsScreen from '../screens/TermsScreen';
import { GlassTabBar } from '../components/GlassTabBar';
import { LaunchScreen } from '../components/LaunchScreen';
import { Icon, type IconName } from '../components/Icon';

export type TimelineParams = {
  highlightChunkId?: string;
  dayOffset?: number;
  sessionId?: string;
};

export type ChatParams = {
  initialMessage?: string;
  conversationId?: string;
};

export type HomeParams = {
  // Set (to a fresh value each time) to start recording on arrival, e.g. from a shortcut.
  record?: number;
};

export type TabParamList = {
  Home: HomeParams | undefined;
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
  Reminders: undefined;
  Terms: undefined;
};

export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();
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
  const [navReady, setNavReady] = useState(false);
  const [launchDone, setLaunchDone] = useState(false);

  // Tapping a notification, including one that launched the app: the morning briefing opens
  // Home, a reminder opens Reminders.
  const notificationResponse = Notifications.useLastNotificationResponse();
  const [handledNotification, setHandledNotification] = useState<string | null>(null);
  useEffect(() => {
    if (!notificationResponse || !navReady || session === null) return;
    const id = notificationResponse.notification.request.identifier;
    if (id === handledNotification) return;
    setHandledNotification(id);
    if (!navigationRef.isReady()) return;
    if (notificationResponse.notification.request.content.data?.kind === 'briefing') {
      navigationRef.navigate('Main', { screen: 'Home' });
    } else {
      navigationRef.navigate('Reminders');
    }
  }, [notificationResponse, navReady, session, handledNotification]);

  // aimemory://record (from a Siri or home-screen shortcut) opens Home and starts recording.
  // The link can arrive before sign-in finishes, so it waits until Home can take it.
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  useEffect(() => {
    void Linking.getInitialURL().then((url) => url && setPendingLink(url));
    const subscription = Linking.addEventListener('url', ({ url }) => setPendingLink(url));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!pendingLink || !navReady || session === null || !navigationRef.isReady()) return;
    if (/^aimemory:\/\/\/?record\b/.test(pendingLink)) {
      navigationRef.navigate('Main', { screen: 'Home', params: { record: Date.now() } });
    }
    setPendingLink(null);
  }, [pendingLink, navReady, session]);

  return (
    <View style={styles.root}>
      <NavigationContainer
        ref={navigationRef}
        onReady={() => setNavReady(true)}
        theme={buildNavigationTheme(theme.dark)}
      >
        {!initialized ? (
          <View style={styles.root} />
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
                <Stack.Screen
                  name="Reminders"
                  component={RemindersScreen}
                  options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
                />
                <Stack.Screen
                  name="Terms"
                  component={TermsScreen}
                  options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
                />
              </>
            )}
          </Stack.Navigator>
        )}
      </NavigationContainer>
      {launchDone ? null : (
        <LaunchScreen ready={initialized} onFinished={() => setLaunchDone(true)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Brand green underneath everything, so nothing dark shows between splash and first screen.
  root: {
    flex: 1,
    backgroundColor: brand.green,
  },
});
