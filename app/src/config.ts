// Expo only inlines EXPO_PUBLIC_* in release builds when referenced statically
// (process.env.EXPO_PUBLIC_X). Dynamic access like process.env[name] is undefined there.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? '';
// The website, where plans are bought (its /account page). Empty hides the upgrade buttons.
const websiteUrl = process.env.EXPO_PUBLIC_WEBSITE_URL?.trim() ?? '';

export const config = {
  supabaseUrl: supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey: supabaseAnonKey || 'placeholder-anon-key',
  apiUrl: (apiUrl || 'http://localhost:8787').replace(/\/+$/, ''),
  websiteUrl: websiteUrl.replace(/\/+$/, ''),
} as const;

export const isSupabaseConfigured: boolean = Boolean(supabaseUrl) && Boolean(supabaseAnonKey);
