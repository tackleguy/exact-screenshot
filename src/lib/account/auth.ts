"use client";
import { createClient } from "@/lib/supabase/client";
import { handOffGuestBeforeRedirect } from "./guest";

/** Only same-site paths are followed after signing in. */
export function safeNext(raw: string | null | undefined, fallback = "/"): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : fallback;
}

export function nextFromLocation(fallback = "/") {
  return typeof window === "undefined" ? fallback : safeNext(new URLSearchParams(window.location.search).get("next"), fallback);
}

export function callbackUrl(next: string) {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}

export const SIGN_IN_UNAVAILABLE = "Sign-in is unavailable right now. You can keep exploring trails and planning as a guest; what you create is kept for this visit.";

/** Google sign-in (Supabase OAuth). The guest's work rides along through the redirect and lands in the account. */
export async function signInWithGoogle(next: string): Promise<string | null> {
  const client = createClient();
  if (!client) return SIGN_IN_UNAVAILABLE;
  handOffGuestBeforeRedirect();
  const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl(next) } });
  return error ? error.message : null;
}
