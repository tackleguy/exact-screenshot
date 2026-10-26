"use client";

import { toggleSaved, useSavedTrails } from "@/lib/saved-trails";
import "./trail-social.css";

/** The "Save to list" heart for a trail, on cards and the trail page. */
export function SaveHeart({ trailId, name, label = false, className = "" }: { trailId: string; name: string; label?: boolean; className?: string }) {
  const saved = useSavedTrails().includes(trailId);
  return (
    <button
      type="button"
      className={`save-heart${saved ? " is-saved" : ""} ${className}`}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from saved trails` : `Save ${name}`}
      title={saved ? "Saved" : "Save to list"}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void toggleSaved(trailId); }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.4-9.3C1.2 7.9 3.4 4.5 6.9 4.5c2 0 3.5 1.1 4.3 2.5h1.6c.8-1.4 2.3-2.5 4.3-2.5 3.5 0 5.7 3.4 4.3 6.7-1.9 4.7-9.4 9.3-9.4 9.3z" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
      {label && <span>{saved ? "Saved" : "Save"}</span>}
    </button>
  );
}
