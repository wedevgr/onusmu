import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { supabase } from '../supabase';

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

export function bootstrapAuth(): () => void {
  void supabase.auth.getSession().then(({ data }) => {
    useAuthStore.setState({
      session: data.session,
      user: data.session?.user ?? null,
      initialized: true,
    });
  });

  const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
    useAuthStore.setState({ session, user: session?.user ?? null });
  });

  return () => subscription.subscription.unsubscribe();
}
