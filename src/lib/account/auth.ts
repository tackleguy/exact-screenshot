"use client";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { handOffGuestBeforeRedirect } from "./guest";
import { lovable } from "@/integrations/lovable";

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

/** Local development and non-Lovable hosts use Supabase's own Google provider; Lovable hosting uses its broker. */
function viaLovableBroker() {
  if (import.meta.env?.VITE_AUTH_DIRECT_OAUTH === "true") return false;
  return !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
}

/**
 * Google sign-in. On Lovable hosting it goes through Lovable Cloud's managed Google sign-in (nothing to configure);
 * elsewhere through Supabase OAuth (needs the Google provider enabled in Supabase). The guest's work rides along
 * through the redirect and lands in the account.
 */
export async function signInWithGoogle(next: string): Promise<string | null> {
  const client = createClient();
  if (!client) return SIGN_IN_UNAVAILABLE;
  handOffGuestBeforeRedirect();
  if (viaLovableBroker()) {
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: callbackUrl(next) });
    if (result.error) return friendlyError(result.error, "Sign-in isn’t working right now. Try again in a moment.");
    // Popup sign-in (editor preview) finishes here; a redirect finishes on /auth/callback.
    if (!result.redirected) window.location.assign(safeNext(next));
    return null;
  }
  const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl(next) } });
  return error ? friendlyError(error, "Sign-in isn’t working right now. Try again in a moment.") : null;
}
