import { createClient } from '@supabase/supabase-js';
import { config } from './config';
import { secureSessionStorage } from './lib/secureSessionStorage';

export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    storage: secureSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
