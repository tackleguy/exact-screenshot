import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";
import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";

let shared: SupabaseClient | null = null;

/**
 * The one browser Supabase client. The session is kept in browser storage — through the Lovable editor's broker when
 * the app runs in its preview frame, where cookies are blocked — and new-style publishable keys (sb_publishable_…)
 * are sent only as `apikey`, never as a bearer token.
 */
export function createClient(): SupabaseClient | null {
  if (shared) return shared;
  const env = getSupabaseEnv();
  if (!env) return null;
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
