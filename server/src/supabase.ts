import { createClient } from '@supabase/supabase-js';
import { config } from './config';

// Used only to verify user JWTs (auth.getUser).
export const supabaseAuth = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Used for storage and admin operations. Never expose to clients.
export const supabaseService = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
