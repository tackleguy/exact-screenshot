"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const EVENT = "hyked:guest-progress";
const SEEN = "hyked:save-banner";

/** Call when a guest builds a trip or adds gear; the banner below shows once per session. */
export function noteGuestProgress() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function GuestSaveBanner({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    if (signedIn) return;
    const show = () => {
      try {
        if (sessionStorage.getItem(SEEN)) return;
        sessionStorage.setItem(SEEN, "1");
      } catch { /* private mode: still show once for this page view */ }
      setOpen(true);
    };
    window.addEventListener(EVENT, show);
    return () => window.removeEventListener(EVENT, show);
  }, [signedIn]);
  if (!open || signedIn) return null;
  return (
    <aside className="guest-save-banner" role="status">
      <p>Save this to your account so it’s here on every device. As a guest it’s kept only until you leave.</p>
      <Link className="btn-primary" href={`/signup?next=${encodeURIComponent(pathname)}`}>Create a free account</Link>
      <button type="button" className="guest-save-close" aria-label="Dismiss" onClick={() => setOpen(false)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </aside>
  );
}
