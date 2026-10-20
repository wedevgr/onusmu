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
import { api, ApiError } from '../api/client';
import type { ChatMessage } from '../api/types';
import { CitationChips } from '../components/CitationChips';import { Header } from '../components/Header';
import { Icon, IconButton } from '../components/Icon';
import { Screen, SCREEN_GUTTER } from '../components/Screen';
import { TypingDots } from '../components/TypingDots';
import { radius, spacing, typography, useTheme } from '../theme';

type Props = BottomTabScreenProps<TabParamList, 'Chat'>;

/**
 * The streamed answer without its source markers ("[2]", "[F1]"), including one still being
 * written at the end. The finished answer arrives already clean.
 */
function withoutMarkers(text: string): string {
  return text
    .replace(/\s*\[F?\d+(?:\s*,\s*F?\d+)*\]/g, '')
    .replace(/\s*\[F?[\d,\s]*$/, '')
    .replace(/[ \t]+([.,;:!?·])/g, '$1');
}

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
  // Only questions the server found answers for in the recordings; none until they arrive.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // The answer while it is being written: what the server is doing, then the text so far.
  const [live, setLive] = useState<{ status: string; text: string } | null>(null);
  // Questions to ask next, shown under the latest answer.
  const [followUps, setFollowUps] = useState<string[]>([]);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const handledInitialMessage = useRef<string | null>(null);

  const loadHistory = useCallback(
    async (conversationId: string): Promise<void> => {
      try {
        const { messages: history } = await api.listMessages(conversationId);
        setConversationId(conversationId);
        setMessages(history);
        setFollowUps([]);
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
        setSuggestions(response.suggestions.slice(0, MAX_SUGGESTIONS));
      })
      .catch(() => {
        // No suggestions rather than generic ones the memory may not answer.
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
      setFollowUps([]);
      setLive({ status: 'Καταλαβαίνω την ερώτηση…', text: '' });
      const request = { message: trimmed, conversationId: conversationId ?? undefined };
      let received = false;
      try {
        let response;
        try {
          response = await api.streamChat(request, {
            onStart: (id) => setConversationId(id),
            onStatus: (status) => setLive((current) => (current ? { ...current, status } : current)),
            onDelta: (piece) => {
              received = true;
              setLive((current) => ({ status: current?.status ?? '', text: (current?.text ?? '') + piece }));
            },
          });
        } catch (e) {
          // A server without streaming answers 404; ask the plain way instead.
          if (received || !(e instanceof ApiError) || e.status !== 404) throw e;
          response = await api.sendChat(request);
        }
        setConversationId(response.conversationId);
        setFollowUps(response.followUps ?? []);
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
        setLive(null);
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
    setFollowUps([]);
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
                  {live && live.text.length > 0 ? (
                    <Text style={[styles.messageText, { color: theme.colors.text }]}>
                      {withoutMarkers(live.text)}
                    </Text>
                  ) : (
                    <View style={styles.statusRow}>
                      <TypingDots />
                      {live?.status ? (
                        <Text style={[typography.caption, styles.statusText, { color: theme.colors.textMuted }]}>
                          {live.status}
                        </Text>
                      ) : null}
                    </View>
                  )}
                </View>
              ) : followUps.length > 0 ? (
                <View style={styles.followUps}>
                  {followUps.map((question) => (
                    <Pressable
                      key={question}
                      accessibilityRole="button"
                      onPress={() => void send(question)}
                      style={({ pressed }) => [styles.followUp, theme.glass, { opacity: pressed ? 0.6 : 1 }]}
                    >
                      <Icon name="corner-down-right" size={14} color={theme.colors.textMuted} />
                      <Text style={[typography.label, styles.followUpText, { color: theme.colors.text }]}>
                        {question}
                      </Text>
                    </Pressable>
                  ))}
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

const MAX_SUGGESTIONS = 3;

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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusText: {
    flexShrink: 1,
  },
  followUps: {
    gap: spacing.sm,
    marginTop: spacing.md,
    alignItems: 'flex-start',
  },
  followUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '100%',
  },
  followUpText: {
    fontWeight: '400',
    flexShrink: 1,
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
