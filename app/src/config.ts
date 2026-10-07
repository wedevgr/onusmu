const read = (name: string): string => process.env[name]?.trim() ?? '';

export const config = {
  supabaseUrl: read('EXPO_PUBLIC_SUPABASE_URL') || 'https://placeholder.supabase.co',
  supabaseAnonKey: read('EXPO_PUBLIC_SUPABASE_ANON_KEY') || 'placeholder-anon-key',
  apiUrl: (read('EXPO_PUBLIC_API_URL') || 'http://localhost:8787').replace(/\/+$/, ''),
} as const;

export const isSupabaseConfigured: boolean =
  Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL) && Boolean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
