import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";
import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";

let shared: SupabaseClient | null = null;

/** Public project values (safe to ship in the browser; data is protected by row-level security). */
const PUBLIC_SUPABASE_URL = "https://leuxfffsxjzxmqmqgavy.supabase.co";
const PUBLIC_SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxldXhmZmZzeGp6eG1xbXFnYXZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMzkzMzQsImV4cCI6MjA4OTcxNTMzNH0.lBzzFc5MrXB8fjGf8sbxZ7BkJLJcwzkhlUH8jOgc7UE";

/**
 * The one browser Supabase client. The session is kept in browser storage — through the Lovable editor's broker when
 * the app runs in its preview frame, where cookies are blocked — and new-style publishable keys (sb_publishable_…)
 * are sent only as `apikey`, never as a bearer token.
 */
export function createClient(): SupabaseClient | null {
  if (shared) return shared;
  // Lovable provides Vite's public values directly; the separately hosted app uses Next's values.
  // Builds that run without env files fall back to the project's public (publishable) values.
  const viteUrl = import.meta.env?.VITE_SUPABASE_URL;
  const viteKey = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;
  const env = viteUrl && viteKey ? { url: viteUrl, anonKey: viteKey } : getSupabaseEnv() ?? { url: PUBLIC_SUPABASE_URL, anonKey: PUBLIC_SUPABASE_KEY };
  const key = env.anonKey;
  const opaqueKey = key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
  const supabaseFetch: typeof fetch = (input, init) => {
    const headers = new Headers(typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    if (opaqueKey && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
  shared = createSupabaseClient(env.url, key, {
    global: { fetch: supabaseFetch },
    auth: { storage: brokeredPreviewStorage(), persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return shared;
}
