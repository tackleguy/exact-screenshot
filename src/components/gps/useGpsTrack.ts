"use client";

import { useCallback, useEffect } from "react";
import { formatDistance, formatDuration, pointsToGeoJSON } from "@/lib/gps";
import type { GpsActivity, TrailProfile } from "@/lib/gps-track";
import { recording, useRecording, type RecorderState } from "@/lib/recording";

export type { RecorderState };
export type GpsQuality = "excellent" | "good" | "fair" | "poor" | "unknown";

/** Excellent within 5 m (the target), good under 10 m, fair to 30 m, poor beyond. */
export function qualityFromAccuracy(m: number | null): GpsQuality {
  if (m === null) return "unknown";
  if (m <= 5) return "excellent";
  if (m < 10) return "good";
  if (m <= 30) return "fair";
  return "poor";
}

/**
 * The recorder page's view of the site-wide recording (src/lib/recording.ts). The recording itself lives outside
 * the page, so it keeps going while the hiker looks at other pages; this hook only reads it and passes actions on.
 */
export function useGpsTrack({ activity = "hike", title = "", trailId = null, trail = null }: { activity?: GpsActivity; title?: string; trailId?: string | null; trail?: TrailProfile | null } = {}) {
  const v = useRecording();
  const active = v.state !== "idle" && v.state !== "saving";
  // The followed trail's line and profile, once the recorder page has loaded them (only for this trail's recording).
  useEffect(() => { if (!active || v.trailId === trailId) recording.setTrail(trail); }, [trail, trailId, active, v.trailId]);
  useEffect(() => { recording.checkSaved(); }, []);

  const here = () => (typeof window === "undefined" ? null : window.location.pathname + window.location.search);
  const start = useCallback(() => recording.start({ activity, title, trailId, returnUrl: here() }), [activity, title, trailId]);
  const durationSec = v.elapsedSec || (v.points.length > 1 ? Math.round((v.points[v.points.length - 1].timestamp - v.points[0].timestamp) / 1000) : 0);

  return {
    state: v.state, setState: (s: RecorderState) => recording.setState(s), error: v.error,
    /** What the running recording is (it may have been started from another trail's page). */
    recordingTitle: v.title, recordingTrailId: v.trailId, returnUrl: v.returnUrl,
    points: v.points, pointCount: v.points.length,
    currentSpeedMph: v.speedMph,
    currentAltitudeFt: v.current?.altitudeFt ?? null,
    currentLat: v.current?.lat ?? null,
    currentLng: v.current?.lng ?? null,
    currentHeading: v.current?.heading ?? null,
    currentAccuracy: v.current?.accuracy ?? null,
    gpsQuality: qualityFromAccuracy(v.current?.accuracy ?? null),
    acquiringProgress: v.state === "acquiring" ? v.current?.accuracy ?? null : null,
    weakGps: v.weakGps,
    approximate: v.approximate,
    filteredAccuracy: v.filteredAccuracyM,
    distanceM: v.distanceM,
    elevationGainFt: v.gainFt,
    durationSec,
    movingSec: v.movingSec,
    offTrail: v.offTrail,
    offTrailM: v.offTrailM,
    backgrounded: v.backgrounded, dismissBackgrounded: () => recording.dismissBackgrounded(),
    gap: v.gap, dismissGap: () => recording.dismissGap(),
    savedTrack: v.savedTrack, resumeSaved: () => recording.resumeSaved(here()), discardSaved: () => recording.discardSaved(), forget: () => recording.forget(),
    routeGeoJSON: v.points.length >= 2 ? pointsToGeoJSON(v.points, v.estimatedGainFt) : null,
    estimatedM: v.estimatedM,
    estimatedGainFt: v.estimatedGainFt,
    formattedDistance: formatDistance(v.distanceM),
    formattedDuration: formatDuration(durationSec),
    start, pause: () => recording.pause(), resume: () => recording.resume(), stop: () => recording.stop(),
  };
}
