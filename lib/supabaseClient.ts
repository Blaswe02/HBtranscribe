import { createClient, SupabaseClient } from "@supabase/supabase-js";

const env = (import.meta as any).env || {};

const supabaseUrl = env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Lazy proxy: throws only when actually used, not on module load.
// This allows Gemini-only users to load the app without Supabase credentials.
export const supabase: SupabaseClient = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (new Proxy({} as SupabaseClient, {
      get() {
        throw new Error(
          "Supabase niet geconfigureerd. Stel VITE_SUPABASE_URL en VITE_SUPABASE_ANON_KEY in als Vercel environment variables."
        );
      }
    }));