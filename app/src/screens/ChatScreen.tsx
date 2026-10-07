import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
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
import { CitationChips } from '../components/CitationChips';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';
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
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const handledInitialMessage = useRef<string | null>(null);

  const loadHistory = useCallback(async (): Promise<void> => {
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
      const { messages: history } = await api.listMessages(latest.id);
      setConversationId(latest.id);
      setMessages(history);
      setHistoryLoaded(true);
    } catch {
      setHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

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
        setError(e instanceof Error ? e.message : 'Could not get an answer.');
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
    setConversationId(null);
    setMessages([]);
    setError(null);
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

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <View style={styles.header}>
          <Text style={[typography.caption, styles.disclaimer, { color: theme.colors.textMuted }]}>
            Answers come only from your recorded memories.
          </Text>
          <Pressable onPress={newChat} hitSlop={8}>
            <Text style={[typography.label, { color: theme.colors.primary }]}>New chat</Text>
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: true })
          }
          ListEmptyComponent={
            historyLoaded ? (
              <EmptyState
                title="Ask your memory"
                message="Questions are answered only from things you have recorded."
              />
            ) : null
          }
          renderItem={({ item }) => {
            const isUser = item.role === 'user';
            return (
              <View
                style={[
                  styles.bubbleWrap,
                  isUser ? styles.bubbleRight : styles.bubbleLeft,
                ]}
              >
                <View
                  style={[
                    styles.bubble,
                    {
                      backgroundColor: isUser ? theme.colors.primary : theme.colors.surface,
                      borderColor: isUser ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      typography.body,
                      { color: isUser ? theme.colors.onPrimary : theme.colors.text },
                    ]}
                  >
                    {item.content}
                  </Text>
                  {!isUser ? (
                    <CitationChips
                      citations={item.citations ?? []}
                      onPress={(citation) =>
                        openCitation(citation.chunkId, citation.startedAt, citation.sessionId)
                      }
                    />
                  ) : null}
                </View>
              </View>
            );
          }}
        />

        {error ? (
          <Text style={[typography.label, styles.errorLine, { color: theme.colors.danger }]}>
            {error}
          </Text>
        ) : null}

        <View style={[styles.inputRow, { borderColor: theme.colors.border }]}>
          <TextInput
            style={[styles.input, { color: theme.colors.text }]}
            placeholder="Ask a question…"
            placeholderTextColor={theme.colors.textMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={submit}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <Pressable
            onPress={submit}
            disabled={sending || input.trim().length === 0}
            style={({ pressed }) => [
              styles.sendButton,
              { backgroundColor: theme.colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[typography.label, { color: theme.colors.onPrimary }]}>
              {sending ? '…' : 'Send'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  disclaimer: {
    flex: 1,
    marginRight: spacing.md,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    flexGrow: 1,
  },
  bubbleWrap: {
    marginTop: spacing.sm,
  },
  bubbleRight: {
    alignItems: 'flex-end',
  },
  bubbleLeft: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorLine: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 16,
    maxHeight: 100,
  },
  sendButton: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 64,
    alignItems: 'center',
  },
});
