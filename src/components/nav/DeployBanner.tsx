import { isSupabaseConfigured } from "@/lib/env";

/** Development-only reminder that accounts aren't connected; never shown in production builds. */
export function DeployBanner() {
  if (process.env.NODE_ENV === "production" || isSupabaseConfigured()) return null;
  return <footer className="local-preview-note">Development build · Account sign-in and cloud sync are not connected.</footer>;
}
