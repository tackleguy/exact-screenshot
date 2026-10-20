"use client";

import { useState } from "react";

type Decision = "approve" | "reject" | null;
const LABEL: Record<"approve" | "reject", string> = { approve: "Approved — shown", reject: "Rejected — hidden" };

/** Approve, reject or undo an admin decision on a flagged trail. */
export function TrailReviewControls({ trailId, secret, initial }: { trailId: string; secret: string; initial: Decision }) {
  const [decision, setDecision] = useState<Decision>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(next: "approve" | "reject" | "reverse") {
    setBusy(true);
    setError("");
    const response = await fetch("/api/admin/trail-reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ trailId, decision: next }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const data = await response?.json().catch(() => null);
      setError(data?.error ?? "Couldn’t save the decision.");
      return;
    }
    setDecision(next === "reverse" ? null : next);
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-stone-600">{decision ? LABEL[decision] : "Flagged, not modified"}</span>
      <div className="flex gap-1">
        <button type="button" disabled={busy || decision === "approve"} onClick={() => send("approve")} className="rounded border border-emerald-700 px-2 py-0.5 text-xs text-emerald-800 disabled:opacity-40">Approve</button>
        <button type="button" disabled={busy || decision === "reject"} onClick={() => send("reject")} className="rounded border border-red-700 px-2 py-0.5 text-xs text-red-800 disabled:opacity-40">Reject</button>
        <button type="button" disabled={busy || !decision} onClick={() => send("reverse")} className="rounded border border-stone-400 px-2 py-0.5 text-xs text-stone-700 disabled:opacity-40">Undo</button>
      </div>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
