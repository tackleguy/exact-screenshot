"use client";
import { useEffect, useState } from "react";
import { friendlyError } from "@/lib/errors";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/account/auth";

/** Where Google sign-in and email confirmation links return: finish the sign-in, then continue to `next`. */
export function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = safeNext(params.get("next"));
    const failure = params.get("error_description") ?? params.get("error");
    const client = createClient();
    const finish = async () => {
      if (failure) throw new Error(failure);
      if (!client) throw new Error("Sign-in is unavailable right now.");
      const code = params.get("code");
      if (!(await client.auth.getSession()).data.session && code) {
        // The browser client may already have exchanged the code on load; only a missing session is an error.
        const { error: exchange } = await client.auth.exchangeCodeForSession(code);
        if (exchange && !(await client.auth.getSession()).data.session) throw exchange;
      }
      if (!(await client.auth.getSession()).data.session) throw new Error("The sign-in link has expired or was already used. Sign in again.");
      router.replace(next);
      router.refresh();
    };
    finish().catch((e: unknown) => setError(friendlyError(e, "Sign-in could not be completed.")));
  }, [router]);
  return (
    <section className="fieldbook-page">
      <h1>{error ? "Sign-in didn’t finish" : "Signing you in…"}</h1>
      <p role="status">{error ?? "Moving anything you made as a guest into your account."}</p>
      {error && <Link className="btn-primary" href="/login">Back to sign in</Link>}
    </section>
  );
}
