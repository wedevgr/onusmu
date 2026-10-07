import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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

type Mode = 'login' | 'register' | 'reset';

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

export function AuthScreen(): React.JSX.Element {
  const theme = useTheme();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (mode !== 'reset' && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) setError(err.message);
      } else if (mode === 'register') {
        const { data, error: err } = await supabase.auth.signUp({ email: email.trim(), password });
        if (err) {
          setError(err.message);
        } else if (!data.session) {
          setNotice('Registration successful. Check your email to confirm your account, then log in.');
          setMode('login');
        }
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim());
        if (err) {
          setError(err.message);
        } else {
          setNotice('If an account exists for this email, a reset link is on its way.');
        }
      }
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setLoading(false);
    }
  }

  const title = mode === 'login' ? 'Welcome back' : mode === 'register' ? 'Create your account' : 'Reset password';

  return (
    <Screen>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[typography.title, { color: theme.colors.text }]}>AI Memory</Text>
          <Text style={[typography.body, styles.subtitle, { color: theme.colors.textMuted }]}>
            Your personal, searchable memory.
          </Text>

          {!isSupabaseConfigured ? (
            <Card style={{ borderColor: theme.colors.warning }}>
              <Text style={[typography.label, { color: theme.colors.warning }]}>
                Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in app/.env.
              </Text>
            </Card>
          ) : null}

          <Card>
            <Text style={[typography.heading, styles.cardTitle, { color: theme.colors.text }]}>{title}</Text>

            <TextInput
              style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.surfaceMuted }]}
              placeholder="Email"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            {mode !== 'reset' ? (
              <TextInput
                style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.surfaceMuted }]}
                placeholder="Password"
                placeholderTextColor={theme.colors.textMuted}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            ) : null}

            {error ? <Text style={[typography.label, { color: theme.colors.danger }]}>{error}</Text> : null}
            {notice ? <Text style={[typography.label, { color: theme.colors.success }]}>{notice}</Text> : null}

            <View style={styles.submit}>
              <Button
                title={mode === 'login' ? 'Log in' : mode === 'register' ? 'Register' : 'Send reset link'}
                onPress={() => void submit()}
                loading={loading}
              />
            </View>
          </Card>

          <View style={styles.switchRow}>
            {mode !== 'login' ? (
              <Text style={[typography.label, styles.switchLink, { color: theme.colors.primary }]} onPress={() => { setMode('login'); setError(null); }}>
                Log in
              </Text>
            ) : null}
            {mode !== 'register' ? (
              <Text style={[typography.label, styles.switchLink, { color: theme.colors.primary }]} onPress={() => { setMode('register'); setError(null); }}>
                Create account
              </Text>
            ) : null}
            {mode !== 'reset' ? (
              <Text style={[typography.label, styles.switchLink, { color: theme.colors.primary }]} onPress={() => { setMode('reset'); setError(null); }}>
                Forgot password?
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.xl },
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.xl },
  cardTitle: { marginBottom: spacing.md },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.sm,
    fontSize: 16,
  },
  submit: { marginTop: spacing.sm },
  switchRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, marginTop: spacing.lg },
  switchLink: { padding: spacing.xs },
});
