import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../supabase';

// The app's URL scheme (app.json "scheme"). Must be listed in Supabase → Auth → Redirect URLs.
export const GOOGLE_REDIRECT_URL = 'aimemory://auth-callback';

/**
 * Opens Google sign-in in a browser sheet. Supabase sends the user back to the app with
 * the session tokens, which are stored like an email sign-in. Signing in also creates the account if needed.
 * Returns error null when signed in or when the user closed the sheet.
 */
export async function signInWithGoogle(): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: GOOGLE_REDIRECT_URL, skipBrowserRedirect: true },
  });
  if (error) return { error };
  if (!data.url) return { error: { message: 'Η σύνδεση με Google δεν είναι διαθέσιμη.' } };

  const result = await WebBrowser.openAuthSessionAsync(data.url, GOOGLE_REDIRECT_URL);
  if (result.type !== 'success') return { error: null };

  // Supabase returns the session in the URL fragment: #access_token=...&refresh_token=...
  const fragment = new URLSearchParams(result.url.split('#')[1] ?? '');
  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  if (!accessToken || !refreshToken) {
    const query = new URLSearchParams(result.url.split('?')[1]?.split('#')[0] ?? '');
    const reason = fragment.get('error_description') ?? query.get('error_description');
    return { error: { message: reason ?? 'Η σύνδεση με Google δεν ολοκληρώθηκε.' } };
  }
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return { error: sessionError };
}
