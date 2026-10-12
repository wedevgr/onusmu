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
import { Icon, Logo } from '../components/Icon';
import { Screen } from '../components/Screen';
import { radius, spacing, typography, useTheme } from '../theme';

type Mode = 'login' | 'register';

export default function AuthScreen(): React.JSX.Element {
  const theme = useTheme();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      setError(e instanceof Error ? e.message : 'Κάτι πήγε στραβά.');
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
          setNotice('Έλεγξε το email σου για να επιβεβαιώσεις τον λογαριασμό και μετά συνδέσου.');
        }
        return { error: result.error };
      });
    }
  };

  const sendReset = () => {
    void run(async () => {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
      if (!resetError) {
        setNotice('Έλεγξε τα εισερχόμενά σου για τον σύνδεσμο επαναφοράς κωδικού.');
        setForgotOpen(false);
      }
      return { error: resetError };
    });
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setForgotOpen(false);
    setError(null);
    setNotice(null);
  };

  const field = [styles.field, theme.glass];

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.hero}>
          <Logo size={64} />
          <Text style={[typography.title, styles.title, { color: theme.colors.text }]}>
            {mode === 'login' ? 'Καλώς ήρθες ξανά' : 'Δημιούργησε λογαριασμό'}
          </Text>
          <Text style={[typography.body, styles.subtitle, { color: theme.colors.textMuted }]}>
            Η προσωπική σου μνήμη, έτοιμη για αναζήτηση.
          </Text>
        </View>

        {!isSupabaseConfigured ? (
          <View style={[styles.banner, theme.glass]}>
            <Icon name="alert-triangle" size={20} color={theme.colors.warning} />
            <Text style={[typography.caption, styles.bannerBody, { color: theme.colors.textMuted }]}>
              Λείπει η ρύθμιση. Όρισε τα EXPO_PUBLIC_SUPABASE_URL και
              EXPO_PUBLIC_SUPABASE_ANON_KEY στο αρχείο .env.
            </Text>
          </View>
        ) : null}

        <View style={field}>
          <Icon name="mail" size={20} color={theme.colors.textMuted} />
          <TextInput
            style={[styles.input, { color: theme.colors.text }]}
            placeholder="Email"
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
        </View>
        <View style={field}>
          <Icon name="lock" size={20} color={theme.colors.textMuted} />
          <TextInput
            style={[styles.input, { color: theme.colors.text }]}
            placeholder="Κωδικός"
            placeholderTextColor={theme.colors.textFaint}
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Απόκρυψη κωδικού' : 'Εμφάνιση κωδικού'}
            onPress={() => setShowPassword(!showPassword)}
            hitSlop={10}
          >
            <Icon
              name={showPassword ? 'eye-off' : 'eye'}
              size={20}
              color={theme.colors.textMuted}
            />
          </Pressable>
        </View>

        {error ? (
          <Text style={[typography.caption, styles.feedback, { color: theme.colors.danger }]}>
            {error}
          </Text>
        ) : null}
        {notice ? (
          <Text style={[typography.caption, styles.feedback, { color: theme.colors.success }]}>
            {notice}
          </Text>
        ) : null}

        <View style={styles.submit}>
          <Button
            title={mode === 'login' ? 'Συνέχεια' : 'Δημιουργία λογαριασμού'}
            onPress={submit}
            loading={busy}
            disabled={email.length === 0 || password.length === 0}
          />
        </View>

        {forgotOpen ? (
          <View style={styles.forgotBox}>
            <Text style={[typography.caption, styles.centerText, { color: theme.colors.textMuted }]}>
              Θα σταλεί σύνδεσμος επαναφοράς στο {email || 'email σου'}.
            </Text>
            <Button title="Αποστολή συνδέσμου" variant="secondary" onPress={sendReset} loading={busy} />
          </View>
        ) : mode === 'login' ? (
          <Pressable onPress={() => setForgotOpen(true)} hitSlop={8} style={styles.link}>
            <Text style={[typography.label, { color: theme.colors.textMuted }]}>
              Ξέχασες τον κωδικό;
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.switchRow}>
          <Text style={[typography.label, styles.switchText, { color: theme.colors.textMuted }]}>
            {mode === 'login' ? 'Νέος χρήστης;' : 'Έχεις ήδη λογαριασμό;'}
          </Text>
          <Pressable onPress={switchMode} hitSlop={8}>
            <Text style={[typography.label, styles.switchAction, { color: theme.colors.text }]}>
              {mode === 'login' ? 'Δημιούργησε λογαριασμό' : 'Σύνδεση'}
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
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 6,
    textAlign: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: 12,
  },
  bannerBody: {
    flex: 1,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 56,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
  },
  feedback: {
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  submit: {
    marginTop: spacing.sm,
  },
  forgotBox: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  centerText: {
    textAlign: 'center',
  },
  link: {
    alignSelf: 'center',
    marginTop: spacing.md,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.lg,
  },
  switchText: {
    fontWeight: '400',
  },
  switchAction: {
    fontWeight: '600',
  },
});
