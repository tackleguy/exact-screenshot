interface ImportMetaEnv {
  readonly VITE_HYKED_API_URL?: string
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  readonly VITE_SUPABASE_PROJECT_ID?: string
  /** "true": Google sign-in through Supabase directly instead of Lovable Cloud's broker. */
  readonly VITE_AUTH_DIRECT_OAUTH?: string
}
interface ImportMeta { readonly env: ImportMetaEnv }