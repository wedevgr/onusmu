import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import * as Crypto from 'expo-crypto';
import type { RootStackParamList, TabParamList } from '../navigation/RootNavigator';
import { api } from '../api/client';
import type { ChatMessage } from '../api/types';
import { CitationChips } from '../components/CitationChips';import { Header } from '../components/Header';
import { Icon, IconButton } from '../components/Icon';
import { Screen, SCREEN_GUTTER } from '../components/Screen';
import { TypingDots } from '../components/TypingDots';
import { radius, spacing, typography, useTheme } from '../theme';

type Props = BottomTabScreenProps<TabParamList, 'Chat'>;

function dayOffsetFor(iso: string): number {
  const day = new Date(iso);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - day.getTime()) / 86400000);
}

export default function ChatScreen({ navigation, route }: Props): React.JSX.Element {
  const theme = useTheme();
  const rootNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>(SUGGESTIONS);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const handledInitialMessage = useRef<string | null>(null);

  const loadHistory = useCallback(
    async (conversationId: string): Promise<void> => {
      try {
        const { messages: history } = await api.listMessages(conversationId);
        setConversationId(conversationId);
        setMessages(history);
      } catch {
        setConversationId(null);
        setMessages([]);
      } finally {
        setHistoryLoaded(true);
      }
    },
    [],
  );

  const loadLatest = useCallback(async (): Promise<void> => {
    try {
      const { conversations } = await api.listConversations();
      if (conversations.length === 0) {
        setHistoryLoaded(true);
        return;
      }
      const latest = [...conversations].sort((a, b) =>
        (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''),
      )[0];
      if (!latest) {
        setHistoryLoaded(true);
        return;
      }
      await loadHistory(latest.id);
    } catch {
      setHistoryLoaded(true);
    }
  }, [loadHistory]);

  const requestedConversationId = route.params?.conversationId;
  const handledConversationId = useRef<string | undefined>(undefined);
  const initialLoadDone = useRef(false);

  const loadSuggestions = useCallback((): void => {
    api
      .getSuggestions()
      .then((response) => {
        if (response.suggestions.length > 0) {
          setSuggestions(response.suggestions.slice(0, SUGGESTIONS.length));
        }
      })
      .catch(() => {
        // Keep the static fallback suggestions.
      });
  }, []);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  useEffect(() => {
    if (requestedConversationId) {
      if (handledConversationId.current !== requestedConversationId) {
        handledConversationId.current = requestedConversationId;
        setHistoryLoaded(false);
        void loadHistory(requestedConversationId);
      }
    } else if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      void loadLatest();
    }
  }, [requestedConversationId, loadHistory, loadLatest]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || sending) return;
      setSending(true);
      setError(null);
      const optimistic: ChatMessage = {
        id: Crypto.randomUUID(),
        role: 'user',
        content: trimmed,
        citations: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, optimistic]);
      try {
        const response = await api.sendChat({
          message: trimmed,
          conversationId: conversationId ?? undefined,
        });
        setConversationId(response.conversationId);
        setMessages((current) => [
          ...current,
          {
            id: response.messageId,
            role: 'assistant',
            content: response.answer,
            citations: response.citations,
            createdAt: new Date().toISOString(),
          },
        ]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Δεν ήταν δυνατή η απάντηση.');
      } finally {
        setSending(false);
      }
    },
    [conversationId, sending],
  );

  useEffect(() => {
    const initial = route.params?.initialMessage;
    if (
      initial !== undefined &&
      initial.length > 0 &&
      handledInitialMessage.current !== initial &&
      historyLoaded
    ) {
      handledInitialMessage.current = initial;
      void send(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params, historyLoaded, send]);

  const newChat = (): void => {
    handledConversationId.current = undefined;
    setConversationId(null);
    setMessages([]);
    setError(null);
    navigation.setParams({ conversationId: undefined });
    loadSuggestions();
  };

  const openHistory = (): void => {
    rootNav.navigate('ChatHistory');
  };

  const openCitation = (chunkId: string, startedAt: string, sessionId: string): void => {
    rootNav.navigate('Main', {
      screen: 'Timeline',
      params: { highlightChunkId: chunkId, dayOffset: dayOffsetFor(startedAt), sessionId },
    });
  };

  const submit = (): void => {
    const trimmed = input.trim();
    if (trimmed.length === 0) return;
    setInput('');
    void send(trimmed);
  };

  const canSend = !sending && input.trim().length > 0;
  const showWelcome = historyLoaded && messages.length === 0 && !sending;

  return (
    <Screen padded={false} bottomInset={false}>
      <View style={styles.flex}>
        <View style={styles.header}>
          <Header
            title="Συνομιλία"
            right={
              <View style={styles.headerButtons}>
                <IconButton name="clock" label="Ιστορικό" filled={false} onPress={openHistory} />
                <IconButton name="edit" label="Νέα συνομιλία" filled={false} onPress={newChat} />
              </View>
            }
          />
        </View>

        {showWelcome ? (
          <View style={styles.welcome}>
            <Text style={[typography.title, styles.welcomeTitle, { color: theme.colors.text }]}>
              Ρώτα τη μνήμη σου
            </Text>
            <Text style={[typography.label, styles.welcomeNote, { color: theme.colors.textMuted }]}>
              Οι απαντήσεις βασίζονται μόνο στις καταγραφές σου.
            </Text>
            <View style={styles.suggestions}>
              {suggestions.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  accessibilityRole="button"
                  onPress={() => void send(suggestion)}
                  style={({ pressed }) => [
                    styles.suggestion,
                    theme.glass,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[typography.label, styles.suggestionText, { color: theme.colors.text }]}>
                    {suggestion}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd({ animated: true })
            }
            // The list shrinks when the keyboard opens; keep the latest message in view.
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
            ListFooterComponent={
              sending ? (
                <View style={styles.answer}>
                  <TypingDots />
                </View>
              ) : null
            }
            renderItem={({ item }) => {
              if (item.role === 'user') {
                return (
                  <View style={styles.questionWrap}>
                    <View style={[styles.question, { backgroundColor: theme.colors.surfaceMuted }]}>
                      <Text style={[styles.messageText, { color: theme.colors.text }]}>
                        {item.content}
                      </Text>
                    </View>
                  </View>
                );
              }
              return (
                <View style={styles.answer}>
                  <Text style={[styles.messageText, { color: theme.colors.text }]}>
                    {item.content}
                  </Text>
                  <CitationChips
                    citations={item.citations ?? []}
                    onPress={(citation) =>
                      openCitation(citation.chunkId, citation.startedAt, citation.sessionId)
                    }
                  />
                </View>
              );
            }}
          />
        )}

        {error ? (
          <View style={styles.errorLine}>
            <Icon name="alert-circle" size={14} color={theme.colors.danger} />
            <Text style={[typography.caption, styles.errorText, { color: theme.colors.danger }]}>
              {error}
            </Text>
          </View>
        ) : null}

        <View style={styles.composer}>
          <View style={[styles.inputRow, theme.glass]}>
            <TextInput
              style={[styles.input, { color: theme.colors.text }]}
              placeholder="Ρώτα οτιδήποτε"
              placeholderTextColor={theme.colors.textFaint}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={submit}
              returnKeyType="send"
              blurOnSubmit={false}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Αποστολή"
              onPress={submit}
              disabled={!canSend}
              hitSlop={8}
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor: canSend ? theme.colors.primary : 'transparent',
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Icon
                name="arrow-up"
                size={20}
                color={canSend ? theme.colors.onPrimary : theme.colors.textFaint}
              />
            </Pressable>
          </View>
        </View>
      </View>
    </Screen>
  );
}

const SUGGESTIONS = [
  'Τι συζήτησα σήμερα;',
  'Σύνοψε την πιο πρόσφατη καταγραφή μου',
  'Τι είπα ότι πρέπει να κάνω;',
];

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    paddingHorizontal: SCREEN_GUTTER,
  },
  headerButtons: {
    flexDirection: 'row',
    marginRight: -spacing.sm,
  },
  welcome: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SCREEN_GUTTER,
  },
  welcomeTitle: {
    textAlign: 'center',
  },
  welcomeNote: {
    textAlign: 'center',
    fontWeight: '400',
    marginTop: 6,
    marginBottom: spacing.xl,
  },
  suggestions: {
    gap: spacing.sm,
  },
  suggestion: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  suggestionText: {
    fontWeight: '400',
  },
  listContent: {
    paddingHorizontal: SCREEN_GUTTER,
    paddingBottom: spacing.lg,
    flexGrow: 1,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 25,
  },
  questionWrap: {
    alignItems: 'flex-end',
    marginTop: 28,
  },
  question: {
    maxWidth: '80%',
    borderRadius: 20,
    borderBottomRightRadius: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  answer: {
    marginTop: spacing.md,
    paddingRight: spacing.lg,
  },
  errorLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SCREEN_GUTTER,
    marginBottom: spacing.xs,
  },
  errorText: {
    flex: 1,
  },
  composer: {
    paddingHorizontal: SCREEN_GUTTER,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingLeft: 20,
    paddingRight: 7,
    minHeight: 52,
  },
  input: {
    flex: 1,
    fontSize: 16,
    maxHeight: 100,
    paddingVertical: 12,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
});
