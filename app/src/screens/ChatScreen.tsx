import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  useNavigation,
  useRoute,
  type CompositeNavigationProp,
  type RouteProp,
} from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '../api/client';
import type { ChatMessage, Citation } from '../api/types';
import { Button } from '../components/Button';
import { CitationChips } from '../components/CitationChips';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';
import { formatClock, formatDayLabel } from '../lib/time';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';
import { spacing, typography, useTheme } from '../theme';

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Chat'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export function ChatScreen(): React.JSX.Element {
  const theme = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp<MainTabParamList, 'Chat'>>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setError(null);
      setSending(true);
      const optimistic: ChatMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: trimmed,
        citations: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      try {
        const res = await api.sendChat({
          message: trimmed,
          conversationId: conversationId ?? undefined,
        });
        setConversationId(res.conversationId);
        setMessages((prev) => [
          ...prev,
          {
            id: res.messageId ?? `assistant-${Date.now()}`,
            role: 'assistant',
            content: res.answer,
            citations: res.citations,
            createdAt: new Date().toISOString(),
          },
        ]);
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSending(false);
      }
    },
    [conversationId, sending],
  );

  // Initial load: either answer a passed question or resume the last conversation.
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const initial = route.params?.initialMessage;
      if (initial) {
        navigation.setParams({ initialMessage: undefined });
        setLoading(false);
        await send(initial);
        return;
      }
      try {
        const { conversations } = await api.listConversations();
        const latest = conversations[0];
        if (latest?.id && !cancelled) {
          setConversationId(latest.id);
          const { messages: history } = await api.listMessages(latest.id);
          if (!cancelled) setMessages(history);
        }
      } catch {
        // Backend unreachable: start empty.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subsequent param updates (quick-ask while the tab is already mounted).
  useEffect(() => {
    const initial = route.params?.initialMessage;
    if (initial) {
      navigation.setParams({ initialMessage: undefined });
      void send(initial);
    }
  }, [route.params, navigation, send]);

  function openCitation(citation: Citation): void {
    navigation.navigate('Timeline', {
      highlightChunkId: citation.chunkId,
      sessionId: citation.sessionId,
    });
  }

  function newChat(): void {
    setConversationId(null);
    setMessages([]);
    setError(null);
  }

  const data = [...messages].reverse();

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Text style={[typography.title, { color: theme.colors.text }]}>Ask your memory</Text>
        <Button title="New chat" variant="ghost" onPress={newChat} />
      </View>

      <FlatList
        ref={listRef}
        inverted
        data={data}
        keyExtractor={(item) => item.id}
        style={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToOffset({ offset: 0, animated: false })}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              title="Nothing asked yet"
              message='Try: "What did we say about the contract yesterday?"'
            />
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.bubbleRow, item.role === 'user' ? styles.rowEnd : styles.rowStart]}>
            <View
              style={[
                styles.bubble,
                item.role === 'user'
                  ? { backgroundColor: theme.colors.primary }
                  : { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                item.role === 'assistant' && styles.assistantBubble,
              ]}
            >
              <Text style={[typography.body, { color: item.role === 'user' ? theme.colors.onPrimary : theme.colors.text }]}>
                {item.content}
              </Text>
              {item.role === 'assistant' && item.citations ? (
                <CitationChips citations={item.citations} onSelect={openCitation} />
              ) : null}
              {item.role === 'assistant' ? (
                <Text style={[typography.caption, styles.timeCaption, { color: theme.colors.textMuted }]}>
                  {formatDayLabel(item.createdAt)} · {formatClock(item.createdAt)}
                </Text>
              ) : null}
            </View>
          </View>
        )}
      />

      {error ? <Text style={[typography.label, styles.error, { color: theme.colors.danger }]}>{error}</Text> : null}
      <Text style={[typography.caption, styles.disclaimer, { color: theme.colors.textMuted }]}>
        Answers come only from your recorded memories. Tap a time chip to see the source.
      </Text>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputRow}>
          <TextInput
            style={[
              styles.input,
              { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.surface },
            ]}
            placeholder="Ask about your past conversations..."
            placeholderTextColor={theme.colors.textMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => {
              void send(input);
              setInput('');
            }}
            returnKeyType="send"
          />
          <Button
            title="Send"
            onPress={() => {
              void send(input);
              setInput('');
            }}
            loading={sending}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  list: { flex: 1, marginTop: spacing.sm },
  bubbleRow: { flexDirection: 'row', marginBottom: spacing.sm },
  rowEnd: { justifyContent: 'flex-end' },
  rowStart: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', borderRadius: 16, padding: spacing.md },
  assistantBubble: { borderWidth: StyleSheet.hairlineWidth },
  timeCaption: { marginTop: 6 },
  error: { marginBottom: spacing.xs },
  disclaimer: { textAlign: 'center', marginBottom: spacing.xs },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.xs },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
  },
});
