import { createLovableAuth, type OAuthProvider } from "@lovable.dev/cloud-auth-js";
import { createClient } from "@/lib/supabase/client";

const lovableAuth = createLovableAuth();

/**
 * Lovable Cloud sign-in (Google, Apple, Microsoft) through Lovable's OAuth broker, which needs no Google
 * credentials of our own. In the editor preview it opens a popup and returns tokens; on the published site it
 * redirects, and the tokens come back in the redirect URL, where the Supabase client picks them up.
 */
export const lovable = {
  auth: {
    async signInWithOAuth(provider: OAuthProvider, opts?: { redirect_uri?: string }) {
      const result = await lovableAuth.signInWithOAuth(provider, { redirect_uri: opts?.redirect_uri });
      if (result.redirected || result.error) return result;
      const client = createClient();
      if (!client) return { error: new Error("Sign-in is unavailable right now.") };
      const { error } = await client.auth.setSession(result.tokens);
      return error ? { error } : result;
    },
  },
};
