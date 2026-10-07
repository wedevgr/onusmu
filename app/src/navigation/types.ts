import type { NavigatorScreenParams } from '@react-navigation/native';

export type MainTabParamList = {
  Home: undefined;
  Timeline: { sessionId?: string; highlightChunkId?: string } | undefined;
  Search: undefined;
  Chat: { initialMessage?: string } | undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  Recording: undefined;
};
