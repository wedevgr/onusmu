import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import AntDesign from '@expo/vector-icons/AntDesign';
import { supabase } from '../supabase';
import { signInWithGoogle } from '../lib/googleSignIn';
import { isSupabaseConfigured } from '../config';
import { Button } from '../components/Button';
import { Icon, Logo, type IconName } from '../components/Icon';
import { Screen } from '../components/Screen';
import { useFocusedFieldVisible } from '../lib/keyboardScroll';
import { radius, spacing, typography, useTheme } from '../theme';

type Mode = 'login' | 'register' | 'reset';

// Supabase's default minimum; keep in step with Auth → Password settings.
const MIN_PASSWORD = 6;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

const COPY = {
  login: {
    title: 'Καλώς ήρθες ξανά',
    subtitle: 'Συνδέσου για να συνεχίσεις στη μνήμη σου.',
    submit: 'Σύνδεση',
  },
  register: {
    title: 'Ξεκίνα τώρα',
    subtitle: 'Η προσωπική σου μνήμη, έτοιμη για αναζήτηση.',
    submit: 'Δημιουργία λογαριασμού',
  },
  reset: {
    title: 'Επαναφορά κωδικού',
    subtitle: 'Γράψε το email σου και θα σου στείλουμε σύνδεσμο.',
    submit: 'Αποστολή συνδέσμου',
  },
} as const;

// Supabase answers in English; the common cases read better in the app's language.
function friendlyError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes('invalid login credentials')) return 'Λάθος email ή κωδικός.';
  if (text.includes('already registered')) return 'Υπάρχει ήδη λογαριασμός με αυτό το email. Συνδέσου.';
  if (text.includes('email not confirmed')) return 'Επιβεβαίωσε πρώτα το email σου από τον σύνδεσμο που σου στείλαμε.';
  if (text.includes('rate limit') || text.includes('too many'))
    return 'Πολλές προσπάθειες. Δοκίμασε ξανά σε λίγο.';
  if (text.includes('network')) return 'Δεν υπάρχει σύνδεση. Έλεγξε το internet σου.';
  return message;
}

interface FieldProps extends TextInputProps {
  label: string;
  icon: IconName;
  error?: string | null;
  accessory?: React.ReactNode;
  labelAccessory?: React.ReactNode;
  inputRef?: React.Ref<TextInput>;
}

function Field({
  label,
  icon,
  error,
  accessory,
  labelAccessory,
  inputRef,
  onFocus,
  onBlur,
  ...input
}: FieldProps): React.JSX.Element {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error
    ? theme.colors.danger
    : focused
      ? 'rgba(255,255,255,0.5)'
      : theme.colors.border;

  return (
    <View style={styles.fieldBlock}>
      <View style={styles.labelRow}>
        <Text style={[typography.caption, styles.label, { color: theme.colors.textMuted }]}>
          {label}
        </Text>
        {labelAccessory}
      </View>
      <View style={[styles.field, theme.glass, { borderColor }]}>
        <Icon name={icon} size={18} color={focused ? theme.colors.text : theme.colors.textFaint} />
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: theme.colors.text }]}
          placeholderTextColor={theme.colors.textFaint}
          selectionColor={theme.colors.text}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...input}
        />
        {accessory}
      </View>
      {error ? (
        <Text style={[typography.caption, styles.fieldError, { color: theme.colors.danger }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

// Two-option switch with a pill that slides to the chosen side.
function ModeSwitch({
  value,
  onChange,
}: {
  value: 'login' | 'register';
  onChange: (mode: 'login' | 'register') => void;
}): React.JSX.Element {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const position = useRef(new Animated.Value(value === 'login' ? 0 : 1)).current;

  useEffect(() => {
    Animated.spring(position, {
      toValue: value === 'login' ? 0 : 1,
      damping: 18,
      stiffness: 220,
      useNativeDriver: true,
    }).start();
  }, [value, position]);

  const half = Math.max(0, (width - 8) / 2);
  const options: { key: 'login' | 'register'; label: string }[] = [
    { key: 'login', label: 'Σύνδεση' },
    { key: 'register', label: 'Εγγραφή' },
  ];

  return (
    <View
      style={[styles.switch, theme.glass]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="tablist"
    >
      {width > 0 ? (
        <Animated.View
          style={[
            styles.switchPill,
            {
              width: half,
              backgroundColor: theme.colors.surfaceMuted,
              transform: [
                { translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, half] }) },
              ],
            },
          ]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.key)}
            style={styles.switchOption}
          >
            <Text
              style={[
                typography.label,
                styles.switchLabel,
                { color: selected ? theme.colors.text : theme.colors.textMuted },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function AuthScreen(): React.JSX.Element {
  const theme = useTheme();
  const fieldScroll = useFocusedFieldVisible();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const copy = COPY[mode];
  const emailValid = EMAIL_PATTERN.test(email.trim());
  const passwordLongEnough = password.length >= MIN_PASSWORD;
  const emailError =
    (emailTouched || attempted) && email.length > 0 && !emailValid
      ? 'Αυτό δεν μοιάζει με email.'
      : attempted && email.length === 0
        ? 'Γράψε το email σου.'
        : null;
  const passwordError =
    mode !== 'reset' && attempted && password.length === 0
      ? 'Γράψε τον κωδικό σου.'
      : mode === 'register' && attempted && !passwordLongEnough
        ? `Τουλάχιστον ${MIN_PASSWORD} χαρακτήρες.`
        : null;

  const run = async (
    kind: 'email' | 'google',
    action: () => Promise<{ error: { message: string } | null }>,
  ) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const { error: authError } = await action();
      if (authError) setError(friendlyError(authError.message));
    } catch (e) {
      setError(e instanceof Error ? friendlyError(e.message) : 'Κάτι πήγε στραβά.');
    } finally {
      setBusy(null);
    }
  };

  const submit = () => {
    setAttempted(true);
    const trimmed = email.trim();
    if (!EMAIL_PATTERN.test(trimmed)) return;

    if (mode === 'reset') {
      void run('email', async () => {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed);
        if (!resetError) {
          setNotice(`Στείλαμε σύνδεσμο επαναφοράς στο ${trimmed}.`);
          changeMode('login', true);
        }
        return { error: resetError };
      });
      return;
    }

    if (password.length === 0) return;
    if (mode === 'login') {
      void run('email', () => supabase.auth.signInWithPassword({ email: trimmed, password }));
      return;
    }
    if (!passwordLongEnough) return;
    void run('email', async () => {
      const result = await supabase.auth.signUp({ email: trimmed, password });
      if (!result.error && result.data.session === null) {
        setNotice(`Σχεδόν έτοιμο. Άνοιξε το email στο ${trimmed} για να επιβεβαιώσεις τον λογαριασμό.`);
        changeMode('login', true);
      }
      return { error: result.error };
    });
  };

  const changeMode = (next: Mode, keepNotice = false) => {
    setMode(next);
    setAttempted(false);
    setError(null);
    if (!keepNotice) setNotice(null);
    if (next === 'reset') setPassword('');
  };

  const canSubmit =
    email.length > 0 && (mode === 'reset' || password.length > 0) && busy === null;

  return (
    <Screen backdrop="brand">
      <ScrollView
        {...fieldScroll}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandRow}>
          <Logo size={36} />
          <Text style={[styles.wordmark, { color: theme.colors.text }]}>onusmu</Text>
        </View>

        <View style={styles.body}>
          {mode === 'reset' ? (
            <Pressable
              onPress={() => changeMode('login')}
              hitSlop={10}
              style={styles.back}
              accessibilityRole="button"
              accessibilityLabel="Πίσω στη σύνδεση"
            >
              <Icon name="arrow-left" size={18} color={theme.colors.textMuted} />
              <Text style={[typography.label, { color: theme.colors.textMuted }]}>Πίσω</Text>
            </Pressable>
          ) : null}

          <Text style={[typography.title, { color: theme.colors.text }]}>{copy.title}</Text>
          <Text style={[typography.body, styles.subtitle, { color: theme.colors.textMuted }]}>
            {copy.subtitle}
          </Text>

          {!isSupabaseConfigured ? (
            <Banner tone="warning" icon="alert-triangle">
              Λείπει η ρύθμιση. Όρισε τα EXPO_PUBLIC_SUPABASE_URL και EXPO_PUBLIC_SUPABASE_ANON_KEY
              στο αρχείο .env.
            </Banner>
          ) : null}

          {mode !== 'reset' ? (
            <>
              <ModeSwitch value={mode} onChange={(next) => changeMode(next)} />
              <Button
                title="Συνέχεια με Google"
                variant="secondary"
                icon={<AntDesign name="google" size={18} color={theme.colors.text} />}
                onPress={() => void run('google', signInWithGoogle)}
                loading={busy === 'google'}
                disabled={busy !== null}
              />
              <View style={styles.orRow}>
                <View style={[styles.orLine, { backgroundColor: theme.colors.border }]} />
                <Text style={[typography.caption, { color: theme.colors.textFaint }]}>
                  ή με email
                </Text>
                <View style={[styles.orLine, { backgroundColor: theme.colors.border }]} />
              </View>
            </>
          ) : null}

          <Field
            label="Email"
            icon="mail"
            placeholder="esy@paradeigma.gr"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            returnKeyType={mode === 'reset' ? 'send' : 'next'}
            value={email}
            onChangeText={setEmail}
            onBlur={() => setEmailTouched(true)}
            onSubmitEditing={() => (mode === 'reset' ? submit() : passwordRef.current?.focus())}
            submitBehavior={mode === 'reset' ? 'blurAndSubmit' : 'submit'}
            error={emailError}
          />

          {mode !== 'reset' ? (
            <Field
              inputRef={passwordRef}
              label="Κωδικός"
              icon="lock"
              placeholder={mode === 'register' ? `Τουλάχιστον ${MIN_PASSWORD} χαρακτήρες` : '••••••••'}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              textContentType={mode === 'register' ? 'newPassword' : 'password'}
              returnKeyType="go"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={submit}
              error={passwordError}
              labelAccessory={
                mode === 'login' ? (
                  <Pressable onPress={() => changeMode('reset')} hitSlop={10}>
                    <Text style={[typography.caption, styles.forgot, { color: theme.colors.text }]}>
                      Ξέχασες τον κωδικό;
                    </Text>
                  </Pressable>
                ) : null
              }
              accessory={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Απόκρυψη κωδικού' : 'Εμφάνιση κωδικού'}
                  onPress={() => setShowPassword(!showPassword)}
                  hitSlop={10}
                >
                  <Icon
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={18}
                    color={theme.colors.textMuted}
                  />
                </Pressable>
              }
            />
          ) : null}

          {mode === 'register' && password.length > 0 && !passwordError ? (
            <View style={styles.hint}>
              <Icon
                name={passwordLongEnough ? 'check-circle' : 'circle'}
                size={14}
                color={passwordLongEnough ? theme.colors.success : theme.colors.textFaint}
              />
              <Text
                style={[
                  typography.caption,
                  { color: passwordLongEnough ? theme.colors.success : theme.colors.textFaint },
                ]}
              >
                Τουλάχιστον {MIN_PASSWORD} χαρακτήρες
              </Text>
            </View>
          ) : null}

          {error ? (
            <Banner tone="danger" icon="alert-circle">
              {error}
            </Banner>
          ) : null}
          {notice ? (
            <Banner tone="success" icon="mail">
              {notice}
            </Banner>
          ) : null}

          <View style={styles.submit}>
            <Button
              title={copy.submit}
              onPress={submit}
              loading={busy === 'email'}
              disabled={!canSubmit}
            />
          </View>
        </View>

        <Text style={[typography.caption, styles.footer, { color: theme.colors.textFaint }]}>
          Οι ηχογραφήσεις σου αποθηκεύονται κρυπτογραφημένες.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'danger' | 'success' | 'warning';
  icon: IconName;
  children: React.ReactNode;
}): React.JSX.Element {
  const theme = useTheme();
  const color = theme.colors[tone];
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fade]);

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[styles.banner, theme.glass, { borderColor: color, opacity: fade }]}
    >
      <Icon name={icon} size={18} color={color} />
      <Text style={[typography.caption, styles.bannerText, { color: theme.colors.text }]}>
        {children}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  wordmark: {
    fontSize: 19,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  subtitle: {
    marginTop: 6,
    marginBottom: spacing.lg,
  },
  switch: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: 4,
    marginBottom: spacing.md,
  },
  switchPill: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: radius.pill,
  },
  switchOption: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchLabel: {
    fontWeight: '600',
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  orLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  fieldBlock: {
    marginBottom: 14,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  label: {
    fontWeight: '500',
  },
  forgot: {
    fontWeight: '600',
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 54,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
  },
  fieldError: {
    marginTop: 6,
    paddingHorizontal: 4,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -4,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  bannerText: {
    flex: 1,
  },
  submit: {
    marginTop: spacing.xs,
  },
  footer: {
    textAlign: 'center',
  },
});
