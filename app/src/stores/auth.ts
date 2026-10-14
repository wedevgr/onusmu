import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { api } from '../api/client';
import { supabase } from '../supabase';
import { useBillingStore } from './billing';
import { useRemindersStore } from './reminders';

interface AuthState {
  user: User | null;
  session: Session | null;
  initialized: boolean;
}

export const useAuthStore = create<AuthState>(() => ({
  user: null,
  session: null,
  initialized: false,
}));

// Runs once per signed-in user: the server needs the timezone to place spoken times
// ("tomorrow at 5"), and reminders are loaded so their notifications get scheduled.
let preparedUserId: string | null = null;

function onSignedIn(session: Session): void {
  if (preparedUserId === session.user.id) return;
  preparedUserId = session.user.id;
  // Deferred: calling Supabase from inside its own auth callback can deadlock.
  setTimeout(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) void api.updateTimezone(timezone).catch(() => undefined);
    void useRemindersStore.getState().refresh();
  }, 0);
}

export function bootstrapAuth(): () => void {
  void supabase.auth.getSession().then(({ data }) => {
    useAuthStore.setState({
      session: data.session,
      user: data.session?.user ?? null,
      initialized: true,
    });
    if (data.session) onSignedIn(data.session);
  });

  const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
    useAuthStore.setState({ session, user: session?.user ?? null });
    if (session) {
      onSignedIn(session);
      return;
    }
    // Plan, usage and reminders belong to the account that just signed out.
    preparedUserId = null;
    useBillingStore.getState().clear();
    useRemindersStore.getState().clear();
  });

  return () => subscription.subscription.unsubscribe();
}
