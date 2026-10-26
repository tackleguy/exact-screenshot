"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRecording } from "@/lib/recording";
import { formatDuration } from "@/lib/gps";
import { formatMeters } from "@/lib/units";

/** Shown on every other page while a recording runs: what it has so far, and the way back to the recorder. */
export function RecordingPill() {
  const v = useRecording();
  const pathname = usePathname();
  if (pathname.startsWith("/record/live") || (v.state !== "recording" && v.state !== "paused" && v.state !== "acquiring")) return null;
  const label = v.state === "paused" ? "Paused" : v.state === "acquiring" ? "Finding GPS" : "Recording";
  return (
    <Link className={`recording-pill recording-pill--${v.state}`} href={v.returnUrl ?? "/record/live"} aria-label={`${label}: ${v.title || "activity"}. Return to the recorder`}>
      <i aria-hidden="true" />
      <strong>{label}</strong>
      <span>{formatMeters(v.distanceM) ?? "0 ft"} · {formatDuration(v.elapsedSec)}</span>
      <small>Return</small>
    </Link>
  );
}
