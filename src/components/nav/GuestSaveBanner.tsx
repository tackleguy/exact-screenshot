"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const EVENT = "hyked:guest-progress";
const SAVE_EVENT = "hyked:guest-save";
const SEEN = "hyked:save-banner";
/** The first-save explainer shows once per browser, not once per visit. */
const SAVE_SEEN = "hyked:save-intro-seen";

/** Call when a guest builds a trip or adds gear; the banner below shows once per session. */
export function noteGuestProgress() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** Call when a guest saves a trail; the first time ever, the banner explains what an account gives. */
export function noteGuestSave() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SAVE_EVENT));
}

/** Marks a storage key; returns false when it was already set (the banner has been shown). */
function firstTime(storage: () => Storage, key: string) {
  try {
    if (storage().getItem(key)) return false;
    storage().setItem(key, "1");
  } catch { /* private mode: still show once for this page view */ }
  return true;
}

export function GuestSaveBanner({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState<"progress" | "save" | null>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (signedIn) return;
    const progress = () => { if (firstTime(() => sessionStorage, SEEN)) setOpen("progress"); };
    const save = () => { if (firstTime(() => localStorage, SAVE_SEEN)) setOpen("save"); };
    window.addEventListener(EVENT, progress);
    window.addEventListener(SAVE_EVENT, save);
    return () => { window.removeEventListener(EVENT, progress); window.removeEventListener(SAVE_EVENT, save); };
  }, [signedIn]);
  if (!open || signedIn) return null;
  const next = encodeURIComponent(pathname);
  return (
    <aside className={`guest-save-banner${open === "save" ? " guest-save-banner--save" : ""}`} role="status">
      {open === "save" ? (
        <>
          <div className="guest-save-copy">
            <p><strong>Saved on this device.</strong> A free account keeps your saved trails on every device and adds:</p>
            <ul>
              <li>Saved trails and lists that sync to your phone and computer</li>
              <li>Recorded hikes and trip plans kept in one place</li>
              <li>Reviews and trail reports under your name</li>
            </ul>
          </div>
          <div className="guest-save-actions">
            <Link className="btn-primary" href={`/signup?next=${next}`} onClick={() => setOpen(null)}>Create a free account</Link>
            <Link className="btn-ghost" href={`/login?next=${next}`} onClick={() => setOpen(null)}>Sign in</Link>
          </div>
        </>
      ) : (
        <>
          <p>Save this to your account so it’s here on every device. As a guest it’s kept only until you leave.</p>
          <Link className="btn-primary" href={`/signup?next=${next}`}>Create a free account</Link>
        </>
      )}
      <button type="button" className="guest-save-close" aria-label="Dismiss" onClick={() => setOpen(null)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </aside>
  );
}
