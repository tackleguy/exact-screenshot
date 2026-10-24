export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey || anonKey === "your-publishable-key") {
    return null;
  }

  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  // The browser client always has the project's public values built in.
  return typeof window !== "undefined" || getSupabaseEnv() !== null;
}

export const missingEnvMessage =
  "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel → Project Settings → Environment Variables, then redeploy.";
