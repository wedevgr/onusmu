import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '../supabase';
import { isSupabaseConfigured } from '../config';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { radius, spacing, typography, useTheme } from '../theme';

type Mode = 'login' | 'register';

export default function AuthScreen(): React.JSX.Element {
  const theme = useTheme();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<{ error: { message: string } | null }>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error: authError } = await action();
      if (authError) {
        setError(authError.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (mode === 'login') {
      void run(() => supabase.auth.signInWithPassword({ email, password }));
    } else {
      void run(async () => {
        const result = await supabase.auth.signUp({ email, password });
        if (!result.error && result.data.session === null) {
          setNotice('Check your email to confirm your account, then log in.');
        }
        return { error: result.error };
      });
    }
  };

  const sendReset = () => {
    void run(async () => {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
      if (!resetError) {
        setNotice('Check your inbox for a password reset link.');
        setForgotOpen(false);
      }
      return { error: resetError };
    });
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={[typography.title, { color: theme.colors.text }]}>AI Memory</Text>
          <Text style={[typography.body, { color: theme.colors.textMuted }]}>
            Your personal, searchable memory.
          </Text>
        </View>

        {!isSupabaseConfigured ? (
          <Card>
            <Text style={[typography.label, { color: theme.colors.warning }]}>
              Missing configuration
            </Text>
            <Text style={[typography.body, styles.noticeBody, { color: theme.colors.textMuted }]}>
              Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file.
            </Text>
          </Card>
        ) : null}

        <View style={[styles.segment, { backgroundColor: theme.colors.surfaceMuted }]}>
          {(['login', 'register'] as const).map((item) => (
            <Pressable
              key={item}
              onPress={() => setMode(item)}
              style={[
                styles.segmentItem,
                mode === item && { backgroundColor: theme.colors.surface },
              ]}
            >
              <Text
                style={[
                  typography.label,
                  { color: mode === item ? theme.colors.text : theme.colors.textMuted },
                ]}
              >
                {item === 'login' ? 'Login' : 'Register'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Card>
          <TextInput
            style={[
              styles.input,
              { borderColor: theme.colors.border, color: theme.colors.text },
            ]}
            placeholder="Email"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={[
              styles.input,
              { borderColor: theme.colors.border, color: theme.colors.text },
            ]}
            placeholder="Password"
            placeholderTextColor={theme.colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error ? (
            <Text style={[typography.label, styles.feedback, { color: theme.colors.danger }]}>
              {error}
            </Text>
          ) : null}
          {notice ? (
            <Text style={[typography.label, styles.feedback, { color: theme.colors.success }]}>
              {notice}
            </Text>
          ) : null}

          <Button
            title={mode === 'login' ? 'Login' : 'Create account'}
            onPress={submit}
            loading={busy}
            disabled={email.length === 0 || password.length === 0}
          />

          {forgotOpen ? (
            <View style={styles.forgotBox}>
              <Text style={[typography.body, { color: theme.colors.textMuted }]}>
                A reset link will be sent to {email || 'your email'}.
              </Text>
              <Button title="Send reset link" variant="secondary" onPress={sendReset} loading={busy} />
            </View>
          ) : (
            <Pressable onPress={() => setForgotOpen(true)}>
              <Text style={[typography.label, styles.forgotLink, { color: theme.colors.primary }]}>
                Forgot password?
              </Text>
            </Pressable>
          )}
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: 4,
    marginBottom: spacing.md,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.md,
    fontSize: 16,
  },
  feedback: {
    marginBottom: spacing.sm,
  },
  forgotBox: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  forgotLink: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  noticeBody: {
    marginTop: spacing.xs,
  },
});
