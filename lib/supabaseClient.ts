import { createClient } from "@supabase/supabase-js";
import meta from "../metadata.json";

const env = (import.meta as any).env || {};

const supabaseUrl =
  env.VITE_SUPABASE_URL || (meta as any)?.supabase?.url;

const supabaseAnonKey =
  env.VITE_SUPABASE_ANON_KEY || (meta as any)?.supabase?.anonKey;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Supabase config missing. Set VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY or add supabase.url + supabase.anonKey to metadata.json."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);