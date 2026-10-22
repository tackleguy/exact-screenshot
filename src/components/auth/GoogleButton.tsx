"use client";
import { useState } from "react";
import { signInWithGoogle } from "@/lib/account/auth";

export function GoogleButton({ next, label = "Continue with Google" }: { next: () => string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        className="btn-ghost flex w-full items-center justify-center gap-2 disabled:opacity-50"
        onClick={async () => {
          setBusy(true); setError(null);
          const failure = await signInWithGoogle(next());
          if (failure) { setError(failure); setBusy(false); }
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" /></svg>
        {busy ? "Opening Google…" : label}
      </button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
