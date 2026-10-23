"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { nextFromLocation, SIGN_IN_UNAVAILABLE } from "@/lib/account/auth";

const inputClass =
  "w-full rounded-[var(--radius-lg)] border border-[var(--control-border)] bg-surface-muted px-3 py-2.5 text-base text-cream placeholder:text-mist focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-4";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    if (!supabase) {
      setError(SIGN_IN_UNAVAILABLE);
      setLoading(false);
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push(nextFromLocation());
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-sage">
          Email
        </label>
        <input
          id="email"
          autoComplete="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-sage">
          Password
        </label>
        <input
          id="password"
          autoComplete="current-password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
        {loading ? "Signing in..." : "Sign in"}
      </button>
      <p className="text-center text-sm text-mist">
        No account?{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline" onClick={(e) => { const next = nextFromLocation(""); if (next) { e.preventDefault(); router.push(`/signup?next=${encodeURIComponent(next)}`); } }}>
          Sign up
        </Link>
      </p>
    </form>
  );
}
